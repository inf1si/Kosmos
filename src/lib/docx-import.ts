import JSZip from 'jszip';
import { parseDocument, DomUtils } from 'htmlparser2';
import { XMLValidator } from 'fast-xml-parser';

type XmlNode=ReturnType<typeof parseDocument>['children'][number];
type XmlElement=XmlNode & {name:string;attribs:Record<string,string>;children:XmlNode[]};
export type DocxImage={key:string;name:string;bytes:Uint8Array};
export type DocxResult={html:string;title?:string;images:DocxImage[];warnings:string[]};

const MAX_UNZIPPED=100*1024*1024, MAX_XML=20*1024*1024;
const isElement=(n:XmlNode):n is XmlElement=>'name' in n&&'attribs' in n;
const kids=(n:XmlNode|undefined):XmlElement[]=>n&&'children' in n?n.children.filter(isElement):[];
const child=(n:XmlNode|undefined,name:string)=>kids(n).find(c=>c.name===name);
const val=(n:XmlNode|undefined,name:string)=>child(n,name)?.attribs['w:val'];
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function find(n:XmlNode,name:string,depth=0):XmlElement|undefined{if(depth>80)return;if(isElement(n)&&n.name===name)return n;for(const c of kids(n)){const f=find(c,name,depth+1);if(f)return f;}}
// A run property like <w:b/> is on unless its value says otherwise.
const flag=(rPr:XmlElement|undefined,name:string)=>{const e=child(rPr,name);return!!e&&!['false','0','none'].includes(e.attribs['w:val']||'');};

/**
 * Word (.docx) → plain HTML for the shared importer. Only the parts a note needs are read: headings, lists,
 * tables, basic marks, links, footnotes and embedded PNG/JPEG/WebP images. Nothing is fetched or executed.
 */
export async function docxToHtml(bytes:Uint8Array,key:string):Promise<DocxResult>{
  let zip:JSZip;try{zip=await JSZip.loadAsync(bytes);}catch{throw new Error(`${key}: Word 문서(docx)를 열지 못했습니다.`);}
  const files=Object.values(zip.files).filter(f=>!f.dir);if(files.length>3000)throw new Error(`${key}: Word 문서의 내부 파일이 너무 많습니다.`);
  let declared=0;for(const f of files){const size=(f as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize;if(!Number.isSafeInteger(size)||size!<0)throw new Error(`${key}: Word 문서 크기를 확인하지 못했습니다.`);declared+=size!;}
  if(declared>MAX_UNZIPPED)throw new Error(`${key}: 압축 해제 크기가 100MB를 넘습니다.`);
  const xml=async(name:string)=>{const f=zip.file(name);if(!f)return null;const source=await f.async('string');if(source.length>MAX_XML)throw new Error(`${key}: 문서가 너무 큽니다.`);if(/<!ENTITY/i.test(source)||/<!DOCTYPE[^>]*\[/i.test(source))throw new Error('XML 내부 엔티티 선언은 지원하지 않습니다.');if(XMLValidator.validate(source)!==true)throw new Error(`${key}: Word 문서의 XML이 손상되었습니다.`);return parseDocument(source,{xmlMode:true});};
  const doc=await xml('word/document.xml');if(!doc)throw new Error(`${key}: Word 문서(docx)가 아닙니다. 이전 형식(doc)은 Word에서 docx로 저장해 주세요.`);
  const warnings:string[]=[],warn=(m:string)=>{if(!warnings.includes(m))warnings.push(m);};
  const rels=new Map<string,{target:string;external:boolean}>();
  const relDoc=await xml('word/_rels/document.xml.rels');if(relDoc)for(const r of DomUtils.getElementsByTagName('Relationship',relDoc))rels.set(r.attribs.Id,{target:r.attribs.Target||'',external:r.attribs.TargetMode==='External'});
  const headingLevels=new Map<string,number>(),styleLists=new Map<string,{numId:string;ilvl:number}>();
  const styles=await xml('word/styles.xml');if(styles)for(const s of DomUtils.getElementsByTagName('w:style',styles)){
    // List styles such as "List Bullet" carry their numbering in the style, not on each paragraph.
    const styleNum=child(child(s,'w:pPr'),'w:numPr');if(styleNum&&val(styleNum,'w:numId'))styleLists.set(s.attribs['w:styleId'],{numId:val(styleNum,'w:numId')!,ilvl:Number(val(styleNum,'w:ilvl')||0)});const name=(val(s,'w:name')||'').toLowerCase(),m=name.match(/^heading\s*([1-6])$/),outline=Number(val(child(s,'w:pPr'),'w:outlineLvl'));const level=m?Number(m[1]):name==='title'?1:Number.isInteger(outline)&&outline>=0&&outline<6?outline+1:0;if(level)headingLevels.set(s.attribs['w:styleId'],level);}
  const listTags=new Map<string,'ul'|'ol'>();
  const numbering=await xml('word/numbering.xml');if(numbering){
    const abstract=new Map<string,Map<string,'ul'|'ol'>>();
    for(const a of DomUtils.getElementsByTagName('w:abstractNum',numbering)){const levels=new Map<string,'ul'|'ol'>();for(const l of kids(a).filter(c=>c.name==='w:lvl'))levels.set(l.attribs['w:ilvl'],['bullet','none'].includes(val(l,'w:numFmt')||'bullet')?'ul':'ol');abstract.set(a.attribs['w:abstractNumId'],levels);}
    for(const n of DomUtils.getElementsByTagName('w:num',numbering))for(const [ilvl,tag]of abstract.get(val(n,'w:abstractNumId')||'')||[])listTags.set(`${n.attribs['w:numId']}:${ilvl}`,tag);
  }
  const notes=new Map<string,string>();
  const footnotes=await xml('word/footnotes.xml');if(footnotes)for(const f of DomUtils.getElementsByTagName('w:footnote',footnotes))if(!f.attribs['w:type'])notes.set(f.attribs['w:id'],DomUtils.getElementsByTagName('w:p',f).map(p=>DomUtils.getElementsByTagName('w:t',p).map(DomUtils.textContent).join('')).join(' ').trim());
  const core=await xml('docProps/core.xml');const title=core?DomUtils.textContent(DomUtils.getElementsByTagName('dc:title',core)).trim().slice(0,300):'';
  const images:DocxImage[]=[];
  async function image(relId:string|undefined):Promise<string>{
    const rel=relId?rels.get(relId):undefined;if(!rel||rel.external){warn(`${key}: 연결된 외부 이미지는 가져오지 않습니다.`);return'';}
    const target=rel.target.startsWith('/')?rel.target.slice(1):`word/${rel.target}`,name=target.split('/').pop()!,assetKey=`${key}::${target}`;
    if(!images.some(i=>i.key===assetKey)){const f=zip.file(target);if(!f)return'';images.push({key:assetKey,name,bytes:await f.async('uint8array')});}
    return `<img data-kosmos-asset="${esc(assetKey)}" alt="${esc(name)}">`;
  }
  let nodes=0;const enter=()=>{if(++nodes>200000)throw new Error(`${key}: 문서가 너무 복잡합니다.`);};
  async function runs(n:XmlElement,depth:number):Promise<string>{
    if(depth>40)throw new Error(`${key}: 문서의 중첩이 너무 깊습니다.`);let out='';
    for(const c of kids(n)){enter();
      if(c.name==='w:r'){
        const rPr=child(c,'w:rPr'),va=val(rPr,'w:vertAlign');let body='';
        for(const r of kids(c)){
          if(r.name==='w:t')body+=esc(DomUtils.textContent(r).replace(/^☒/,'☑'));
          else if(r.name==='w:tab')body+=' ';
          else if(r.name==='w:br'||r.name==='w:cr'){if(r.attribs['w:type']!=='page')body+='<br>';}
          else if(r.name==='w:noBreakHyphen')body+='-';
          else if(r.name==='w:footnoteReference'){const t=notes.get(r.attribs['w:id']);if(t)body+=`<span data-kosmos-note="${esc(t)}"></span>`;}
          else if(r.name==='w:drawing')body+=await image(find(r,'a:blip')?.attribs['r:embed']);
          else if(r.name==='w:pict'){const img=find(r,'v:imagedata');if(img)body+=await image(img.attribs['r:id']);}
          else if(r.name==='w:object')warn(`${key}: 삽입 개체(수식·차트 등)는 가져오지 않습니다.`);
        }
        if(!body)continue;
        const wrap:[string,boolean][]=[['strong',flag(rPr,'w:b')],['em',flag(rPr,'w:i')],['u',flag(rPr,'w:u')],['s',flag(rPr,'w:strike')||flag(rPr,'w:dstrike')],['sup',va==='superscript'],['sub',va==='subscript'],['mark',flag(rPr,'w:highlight')]];
        for(const [tag,on]of wrap)if(on)body=`<${tag}>${body}</${tag}>`;out+=body;
      }
      else if(c.name==='w:hyperlink'){const inner=await runs(c,depth+1),rel=rels.get(c.attribs['r:id']);out+=rel?.external?`<a href="${esc(rel.target)}">${inner}</a>`:inner;}
      else if(c.name==='w:del'||c.name==='w:moveFrom')continue;
      else if(['w:ins','w:moveTo','w:smartTag','w:fldSimple','w:sdtContent','w:customXml'].includes(c.name))out+=await runs(c,depth+1);
      else if(c.name==='w:sdt')out+=await runs(child(c,'w:sdtContent')||c,depth+1);
    }
    return out;
  }
  async function blocks(parent:XmlElement,depth:number):Promise<string>{
    if(depth>20)throw new Error(`${key}: 문서의 중첩이 너무 깊습니다.`);
    const out:string[]=[],stack:{tag:'ul'|'ol';level:number}[]=[];
    const closeTo=(level:number)=>{while(stack.length&&stack.at(-1)!.level>level)out.push(`</li></${stack.pop()!.tag}>`);};
    for(const c of kids(parent)){enter();
      if(c.name==='w:sdt'){closeTo(-1);out.push(await blocks(child(c,'w:sdtContent')||c,depth+1));continue;}
      if(c.name==='w:tbl'){closeTo(-1);out.push(await table(c,depth));continue;}
      if(c.name!=='w:p')continue;
      const pPr=child(c,'w:pPr'),numPr=child(pPr,'w:numPr'),styleId=val(pPr,'w:pStyle')||'',level=headingLevels.get(styleId),align=({center:'center',right:'right',end:'right',both:'justify',distribute:'justify'} as Record<string,string>)[val(pPr,'w:jc')||''];
      const inner=await runs(c,depth+1),style=align?` style="text-align:${align}"`:'';
      const fromStyle=styleLists.get(styleId),numId=val(numPr,'w:numId')||fromStyle?.numId,ilvl=Number(val(numPr,'w:ilvl')??fromStyle?.ilvl??0);
      const tag=numId&&numId!=='0'?listTags.get(`${numId}:${ilvl}`)||'ul':undefined;
      if(tag&&!level){
        closeTo(ilvl);const top=stack.at(-1);
        if(top&&top.level===ilvl){if(top.tag===tag)out.push('</li><li>');else{stack.pop();out.push(`</li></${top.tag}><${tag}><li>`);stack.push({tag,level:ilvl});}}
        else{out.push(`<${tag}><li>`);stack.push({tag,level:ilvl});}
        out.push(`<p>${inner}</p>`);continue;
      }
      closeTo(-1);out.push(level?`<h${level}${style}>${inner}</h${level}>`:`<p${style}>${inner}</p>`);
    }
    closeTo(-1);return out.join('');
  }
  async function table(tbl:XmlElement,depth:number):Promise<string>{
    // Vertically merged Word cells continue the cell above; they become one rowspan cell.
    type Cell={tag:string;colspan:number;rowspan:number;html:string};const rows:Cell[][]=[],open=new Map<number,Cell>();
    for(const tr of kids(tbl).filter(r=>r.name==='w:tr')){
      const header=!!child(child(tr,'w:trPr'),'w:tblHeader'),row:Cell[]=[];let col=0;
      for(const tc of kids(tr).filter(c=>c.name==='w:tc')){
        const tcPr=child(tc,'w:tcPr'),span=Math.max(1,Math.min(50,Number(val(tcPr,'w:gridSpan'))||1)),merge=child(tcPr,'w:vMerge');
        if(merge&&merge.attribs['w:val']!=='restart'&&open.has(col)){open.get(col)!.rowspan++;col+=span;continue;}
        const cell={tag:header?'th':'td',colspan:span,rowspan:1,html:await blocks(tc,depth+1)};row.push(cell);
        if(merge)open.set(col,cell);else open.delete(col);col+=span;
      }
      if(row.length)rows.push(row);
    }
    return`<table>${rows.map(r=>`<tr>${r.map(c=>`<${c.tag}${c.colspan>1?` colspan="${c.colspan}"`:''}${c.rowspan>1?` rowspan="${c.rowspan}"`:''}>${c.html}</${c.tag}>`).join('')}</tr>`).join('')}</table>`;
  }
  const body=find(doc,'w:body');if(!body)throw new Error(`${key}: Word 문서 본문을 찾지 못했습니다.`);
  return {html:await blocks(body,0),title:title||undefined,images,warnings};
}
