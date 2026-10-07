import JSZip from 'jszip';
import { assetSchema } from './model';
import { zipUncompressedSize, zipOriginalName } from './zip-metadata';
import MarkdownIt from 'markdown-it';
import markdownFootnote from 'markdown-it-footnote';
import { parseDocument, DomUtils } from 'htmlparser2';
import { XMLValidator } from 'fast-xml-parser';
import SparkMD5 from 'spark-md5';
import { z } from 'zod';
import { newDocument, uid, fromText, workspaceSchema, documentSchema, type RichNode, type NovelDocument, type Workspace, type Work, type AssetMeta } from './model';
import { applyNavigation, defaultSections, resolveNavigation, subsetNavigation, type DocumentNavigation } from './document-navigation';
import { navigationSchema, navigationIssues } from './document-navigation-schema';
import { docxToHtml } from './docx-import';
import { rtfToHtml } from './rtf-import';
import { hwpToHtml, hwpxToHtml } from './hwp-import';
import { readEpub } from './epub-import';
import { readScrivener } from './scrivener-import';
import { paragraphCss,htmlParagraphAttrs,cellSpan,tableColumns,inlineFontSize,listStyleType,validListStyle } from './manuscript-format';

const MAX_BYTES=100*1024*1024, MAX_TEXT=5*1024*1024, MAX_PAGES=500;

const encoder=new TextEncoder();

// The footnote plugin's published types still reference markdown-it 14; its runtime API is compatible with 15.
const markdown=new MarkdownIt({html:true,breaks:false});

markdown.use(markdownFootnote);

type HtmlNode=ReturnType<typeof parseDocument>['children'][number];

type HtmlElement=HtmlNode & {name:string;attribs:Record<string,string>;children:HtmlNode[]};

export type ImportedAsset={key:string;name:string;blob:Blob};

export type ImportedPage={key:string;title:string;kind:NovelDocument['kind'];content:RichNode;assetKeys:string[];chapter:string;category:string;summary:string;tags?:string[];created?:string;updated?:string;place?:string};

export type ImportBundle={source:string;pages:ImportedPage[];assets:ImportedAsset[];warnings:string[];navigation?:DocumentNavigation;sourceIds?:Record<string,string>};

export type ImportChoice={key:string;title:string;kind:NovelDocument['kind']};

export type ExportFormat='markdown'|'html'|'enex';

export type TransferDownload={blob:Blob;name:string};

const imageTypes=new Map<string,AssetMeta['type']>([['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['webp','image/webp']]);

const isElement=(n:HtmlNode):n is HtmlElement=>'name' in n&&'attribs' in n;

const text=(n:HtmlNode)=>DomUtils.textContent(n);

const children=(n:HtmlNode):HtmlNode[]=>'children' in n?n.children:[];

function elements(n:HtmlNode,name:string):HtmlElement[]{const found:HtmlElement[]=[];

const visit=(v:HtmlNode,depth:number)=>{if(depth>60)throw new Error('문서의 중첩이 너무 깊습니다.');

if(isElement(v)&&v.name===name)found.push(v);children(v).forEach(c=>visit(c,depth+1));};

visit(n,0);

return found;}

function warning(bundle:ImportBundle,message:string){if(!bundle.warnings.includes(message))bundle.warnings.push(message);}

function path(value:string):string {
  if(value.includes('\\')||value.startsWith('/')||value.includes('\0')||/^[a-z]+:/i.test(value))throw new Error('안전하지 않은 파일 경로입니다.');
  const segments:string[]=[];

  for(const part of value.split('/')){if(!part||part==='.')continue;

if(part==='..'){if(!segments.length)throw new Error('묶음 밖의 경로입니다.');segments.pop();}else segments.push(part);}

  return segments.join('/');
}

function resolve(base:string,href:string):string|null {try{const clean=decodeURIComponent(href.split('#')[0].split('?')[0]);

if(!clean||clean.startsWith('//')||/^[a-z]+:/i.test(clean))return null;

return path(`${base.includes('/')?base.slice(0,base.lastIndexOf('/')+1):''}${clean}`);}catch{return null;}}

function safeLink(href:string){return /^(https?:|mailto:)/i.test(href)&&!/[\u0000-\u0020]/.test(href)?href:undefined;}

function baseTitle(name:string){return name.split('/').pop()!.replace(/\.(md|markdown|txt|html?|csv|enex|docx|rtf|hwpx?|epub)$/i,'').replace(/\s+[a-f0-9]{32}$/i,'').trim().slice(0,300)||'제목 없는 문서';}

function imageMime(bytes:Uint8Array):AssetMeta['type']|null {
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return'image/png';

  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';

  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return'image/webp';

  return null;
}

function base64(bytes:Uint8Array){let s='';

for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));

return btoa(s);}

function unbase64(value:string){const compact=value.replace(/\s/g,'');

if(compact.length>14*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(compact))throw new Error('첨부의 Base64 형식 또는 크기를 확인하세요.');const s=atob(compact);

return Uint8Array.from(s,c=>c.charCodeAt(0));}

function paragraph(content:RichNode[]):RichNode{return{type:'paragraph',attrs:{blockId:uid()},content};}

function appendInline(out:RichNode[],n:RichNode){const last=out.at(-1);

if(n.type==='text'&&!n.text)return;

if(last?.type==='text'&&n.type==='text'&&JSON.stringify(last.marks)===JSON.stringify(n.marks))last.text=(last.text||'')+n.text;else out.push(n);}

const pageExt=/\.(md|markdown|txt|html?|csv|docx|rtf|hwpx?)$/i;

const loose=(v:string)=>v.normalize('NFC').toLowerCase();

/** Obsidian-style `[[이름]]`, `[[폴더/이름#제목|별칭]]` to a page in the same bundle: exact path first, then file name, then title. */
function linkedPage(bundle:ImportBundle,from:string,raw:string):string|undefined{
  const name=loose(raw.split('#')[0].trim());

if(!name)return;
  const keys=bundle.pages.map(p=>({key:p.key,bare:loose(p.key.replace(pageExt,'')),title:loose(p.title)}));const dir=loose(from.includes('/')?from.slice(0,from.lastIndexOf('/')+1):'');

  return (keys.find(k=>k.bare===dir+name)||keys.find(k=>k.bare===name)||keys.find(k=>k.bare.endsWith(`/${name}`))||keys.find(k=>baseTitle(k.bare)===name)||keys.find(k=>k.title===name))?.key;
}

/** Obsidian `![[그림.png]]` names a file anywhere in the vault. */
function embeddedAsset(bundle:ImportBundle,from:string,raw:string):string|null{
  const name=loose(raw.split('|')[0].trim()),relative=resolve(from,raw.split('|')[0].trim());

  if(relative&&bundle.assets.some(a=>a.key===relative))return relative;

  return bundle.assets.find(a=>loose(a.key)===name||loose(a.key).endsWith(`/${name}`))?.key||null;
}

/** Wiki links and embeds become inline HTML before Markdown rendering; code spans and fenced code keep the brackets. */
function obsidianMarkdown(source:string):string{
  let fenced=false;

  return source.split('\n').map(line=>{
    if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;

return line;}

if(fenced)return line;

    return line.split(/(`+[^`]*`+)/).map((part,i)=>i%2?part:part.replace(/(!?)\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g,(_,bang:string,target:string,alias?:string)=>{
      const label=alias?.trim()||target.split('#')[0].split('/').pop()!.trim()||target;

      return bang?`<img data-kosmos-embed="${esc(target.trim())}" alt="${esc(label)}">`:`<a data-kosmos-page="${esc(target.trim())}">${esc(label)}</a>`;
    })).join('');
  }).join('\n');
}

/** Parse into our explicit node whitelist. HTML is never mounted or executed, and resources are never fetched. */
function htmlContent(html:string,page:ImportedPage,bundle:ImportBundle):RichNode {
  const tree=parseDocument(html);const notes=new Map<string,string>();

  for(const li of elements(tree,'li'))if(li.attribs.id&&/^fn\d+/.test(li.attribs.id))notes.set(li.attribs.id,text(li).replace(/\s*↩︎?\s*$/,'').trim());
  let nodeCount=0;
  const enter=(depth:number)=>{if(depth>40||++nodeCount>50000)throw new Error(`${page.title}: 문서가 너무 복잡합니다.`);};

  const inline=(nodes:HtmlNode[],marks:NonNullable<RichNode['marks']>=[],depth=0):RichNode[]=>{
    const out:RichNode[]=[];

    for(const n of nodes){enter(depth);

if(n.type==='text'){const node:RichNode={type:'text',text:n.data.replace(/[\t\r\n ]+/g,' ')};

if(marks.length)node.marks=marks;appendInline(out,node);continue;}

if(!isElement(n))continue;
      const tag=n.name,attrs=n.attribs;

      if(['script','style','iframe','object','embed','head','svg','form','noscript','template'].includes(tag)){warning(bundle,`${page.title}: 실행 코드·외부 삽입·스타일은 가져오지 않습니다.`);continue;}

      if(tag==='en-crypt'){warning(bundle,`${page.title}: 암호화된 내용은 원본 앱에서 복호화 후 다시 내보내세요.`);appendInline(out,{type:'text',text:'[암호화된 내용 — 원본 확인 필요]'});continue;}

      if(tag==='img'||tag==='en-media'){
        const raw=tag==='en-media'?`enex:${page.key}:${attrs.hash?.toLowerCase()}`:attrs['data-kosmos-asset']??(attrs['data-kosmos-embed']!==undefined?embeddedAsset(bundle,page.key,attrs['data-kosmos-embed']):resolve(page.key,attrs.src||''));
        const asset=bundle.assets.find(a=>a.key===raw);

        if(asset){if(!page.assetKeys.includes(asset.key))page.assetKeys.push(asset.key);appendInline(out,{type:'text',text:`[첨부: ${asset.name}]`});}
        else {warning(bundle,`${page.title}: 이미지·첨부를 찾지 못했거나 지원하지 않습니다 (${attrs.alt||attrs.src||attrs.type||'이름 없음'}).`);appendInline(out,{type:'text',text:`[첨부 확인 필요: ${attrs.alt||attrs.type||'이미지'}]`});}

if(tag==='en-media')inline(n.children,marks,depth+1).forEach(v=>appendInline(out,v));continue;
      }

      if(tag==='br'){out.push({type:'hardBreak'});continue;}

      if(tag==='en-todo'||(tag==='input'&&attrs.type==='checkbox')){appendInline(out,{type:'text',text:(attrs.checked==='true'||attrs.checked!==undefined&&attrs.checked!=='false')?'☑ ':'☐ '});inline(n.children,marks,depth+1).forEach(v=>appendInline(out,v));continue;}

      const ownNote=attrs['data-kosmos-note'];

      if(ownNote!==undefined){out.push({type:'footnote',attrs:{noteId:uid(),text:ownNote}});continue;}

      if(tag==='a'&&attrs.href?.startsWith('#')&&notes.has(attrs.href.slice(1))){out.push({type:'footnote',attrs:{noteId:uid(),text:notes.get(attrs.href.slice(1))}});continue;}

      const additions:NonNullable<RichNode['marks']>=[];
      const m=new Map([['b','bold'],['strong','bold'],['i','italic'],['em','italic'],['s','strike'],['del','strike'],['u','underline'],['code','code'],['sup','superscript'],['sub','subscript'],['mark','highlight']]);

      const markType=m.get(tag);

      if(markType)additions.push({type:markType});
      const style=attrs.style||'';

      if(/font-weight\s*:\s*(bold|[6-9]00)/i.test(style))additions.push({type:'bold'});

      if(/font-style\s*:\s*italic/i.test(style))additions.push({type:'italic'});

      if(/background-color\s*:\s*(?:yellow|#ffff00)\s*(?:;|$)/i.test(style))additions.push({type:'highlight'});

      if(/text-decoration[^:]*\s*:[^;]*underline/i.test(style))additions.push({type:'underline'});

      if(/text-decoration[^:]*\s*:[^;]*line-through/i.test(style))additions.push({type:'strike'});

      if(tag==='a'&&attrs['data-kosmos-page']!==undefined){const target=linkedPage(bundle,page.key,attrs['data-kosmos-page']);

if(target)additions.push({type:'wikiLink',attrs:{sourceKey:target}});else warning(bundle,`${page.title}: 묶음에 없는 노트 링크 [[${attrs['data-kosmos-page']}]]를 일반 텍스트로 가져왔습니다.`);}

      if(tag==='a'&&attrs.href){const href=safeLink(attrs.href);

if(href)additions.push({type:'link',attrs:{href,target:'_blank',rel:'noopener noreferrer'}});else{const target=resolve(page.key,attrs.href);

if(target&&bundle.pages.some(p=>p.key===target))additions.push({type:'wikiLink',attrs:{sourceKey:target}});else if(!attrs.href.startsWith('#'))warning(bundle,`${page.title}: 이동할 수 없는 링크를 일반 텍스트로 가져왔습니다.`);}}

      const size=inlineFontSize(Number(attrs['data-font-size']));

if(size)additions.push({type:'fontSize',attrs:{size}});

      if(attrs['data-kosmos-wiki'])additions.push({type:'wikiLink',attrs:{sourceKey:resolve(page.key,attrs['data-kosmos-wiki'])}});
      inline(n.children,[...marks,...additions],depth+1).forEach(v=>appendInline(out,v));
    }

    return out;
  };

  const blockTags=new Set(['p','div','section','article','main','header','footer','h1','h2','h3','h4','h5','h6','ul','ol','blockquote','pre','hr','table','en-note']);

  const blocks=(nodes:HtmlNode[],depth=0):RichNode[]=>{
    const out:RichNode[]=[];let pending:HtmlNode[]=[];

    const flush=()=>{const content=inline(pending,[],depth+1);pending=[];

if(content.some(n=>n.type!=='text'||n.text?.trim()))out.push(paragraph(content));};

    for(const n of nodes){enter(depth);

if(!isElement(n)||!blockTags.has(n.name)){pending.push(n);continue;}

flush();
      const tag=n.name;

if(n.attribs.class?.split(' ').includes('footnotes'))continue;

      if(tag==='hr'){out.push({type:'horizontalRule'});continue;}

      if(tag==='pre'){out.push({type:'codeBlock',content:[{type:'text',text:text(n)}]});continue;}

      if(tag==='ul'||tag==='ol'){const items=n.children.filter(v=>isElement(v)&&v.name==='li').map(li=>({type:'listItem',content:blocks(children(li),depth+1)}));

if(items.length){const type=tag==='ul'?'bulletList':'orderedList',style=n.attribs['data-list-style'],listStyle=style&&validListStyle(type,style)?{listStyle:style}:{};out.push({type,attrs:tag==='ol'?{start:Number(n.attribs.start)||1,...listStyle}:listStyle,content:items});}

continue;}

      if(tag==='blockquote'){out.push({type:'blockquote',content:blocks(n.children,depth+1)});continue;}

      if(tag==='table'){
        const rows=elements(n,'tr').filter(row=>{let parent=row.parent;

while(parent&&(!isElement(parent)||parent.name!=='table'))parent=parent.parent;

return parent===n;}).map(row=>{
          enter(depth+1);

const cells=row.children.filter((c):c is HtmlElement=>isElement(c)&&['td','th'].includes(c.name)).map(c=>{
            enter(depth+2);const content=blocks(c.children,depth+3),colspan=cellSpan(Number(c.attribs.colspan)),rowspan=cellSpan(Number(c.attribs.rowspan)),widths=c.attribs['data-orbis-colwidth']?.split(',').map(Number);

            return {type:c.name==='th'?'tableHeader':'tableCell',attrs:{colspan,rowspan,colwidth:widths?.length===colspan&&widths.every(w=>Number.isInteger(w)&&w>0&&w<=2000)?widths:null},content:content.length?content:[paragraph([])]};
          });

return {type:'tableRow',content:cells};
        });

        if(rows.length)out.push({type:'table',content:rows});continue;
      }

      if(/^h[1-6]$/.test(tag)){out.push({type:'heading',attrs:{level:Number(tag[1]),blockId:uid(),...htmlParagraphAttrs(n.attribs.style||'')},content:inline(n.children,[],depth+1)});continue;}

      if(tag==='p'||tag==='div'&&!n.children.some(c=>isElement(c)&&blockTags.has(c.name))){const p=paragraph(inline(n.children,[],depth+1));p.attrs={...p.attrs,...htmlParagraphAttrs(n.attribs.style||'')};out.push(p);continue;}

      out.push(...blocks(n.children,depth+1));
    }

flush();

return out;
  };

  const article=elements(tree,'article')[0];const pageBody=article?.children.find(n=>isElement(n)&&n.attribs.class?.split(' ').includes('page-body'));
  let root=pageBody||elements(tree,'body')[0]||tree;

  if(isElement(root)&&root.name==='body'&&article)root=pageBody||article;
  const content=blocks(children(root));

  // Notion's page title and our export's title are metadata, not a second copy in the manuscript.
  if(content[0]?.type==='heading'&&content[0]?.attrs?.level===1&&content[0].content?.map(n=>n.text||'').join('').trim()===page.title)content.shift();

  return{type:'doc',content:content.length?content:[paragraph([])]};
}

export function parseCsv(value:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;

  for(let i=0;i<value.length;i++){const c=value[i];

if(c==='"'){if(quoted&&value[i+1]==='"'){cell+='"';i++;}else if(quoted)quoted=false;else if(!cell)quoted=true;else throw new Error('CSV의 따옴표 형식을 확인하세요.');}
    else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&value[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;

    if(rows.length>10000||row.length>200||cell.length>200000)throw new Error('CSV가 너무 큽니다.');
  }

if(quoted)throw new Error('CSV의 닫히지 않은 따옴표가 있습니다.');

if(cell||row.length){row.push(cell);rows.push(row);}

return rows;
}

function csvContent(csv:string,bundle:ImportBundle,page:ImportedPage):RichNode{
  warning(bundle,`${page.title}: CSV는 행별 문서 목록으로 가져옵니다. 관계·수식·필터는 복원하지 않습니다.`);
  const rows=parseCsv(csv),header=rows.shift()||[];const content=rows.flatMap((r,i)=>[{type:'heading',attrs:{level:2,blockId:uid()},content:[{type:'text',text:r[0]||`${i+1}번 항목`}]},...r.map((v,j)=>paragraph([{type:'text',text:`${header[j]||`열 ${j+1}`}: ${v}`}]))]);

return{type:'doc',content:content.length?content:[paragraph([])]};
}

export async function readInterchange(files:readonly File[]):Promise<ImportBundle> {
  if(!files.length)throw new Error('가져올 파일을 선택하세요.');

  if(files.reduce((n,f)=>n+f.size,0)>MAX_BYTES)throw new Error('한 번에 100MB까지 가져올 수 있습니다.');
  const bundle:ImportBundle={source:files.map(f=>f.name).join(', '),pages:[],assets:[],warnings:[]};
  const entries=new Map<string,Uint8Array>();let total=0;

  function add(name:string,bytes:Uint8Array){const key=path(name);

if(entries.has(key))throw new Error(`중복된 파일 경로입니다: ${key}`);total+=bytes.length;

if(total>MAX_BYTES||entries.size>=3000)throw new Error('압축 해제한 파일은 100MB·3,000개 이하로 나누어 가져오세요.');entries.set(key,bytes);}

  const hidden=(name:string)=>name.split('/').some(part=>part.startsWith('.')||part==='__MACOSX');

  // Notion splits large exports into Part-n.zip files inside one ZIP; those are opened once more in place.
  async function addZip(data:Uint8Array|ArrayBuffer,prefix:string,depth:number){
    const zip=await JSZip.loadAsync(data);

if(depth===0&&zip.file('manifest.json'))throw new Error('전체 백업 ZIP은 「백업과 복구」에서 복원하세요.');
    const all=Object.values(zip.files).filter(f=>!f.dir);

if(all.length>3000)throw new Error('ZIP의 파일이 너무 많습니다.');
    let declared=total;

    for(const entry of all){const original=zipOriginalName(entry);

if(path(original)!==original)throw new Error('ZIP에 안전하지 않은 경로가 있습니다.');const size=zipUncompressedSize(entry);

if(size===undefined)throw new Error('ZIP 크기를 확인하지 못했습니다.');declared+=size;

if(declared>MAX_BYTES)throw new Error('압축 해제 크기가 100MB를 넘습니다.');}

    for(const entry of all){const name=prefix+entry.name;

if(depth<1&&/\.zip$/i.test(entry.name)&&!hidden(entry.name)){await addZip(await entry.async('uint8array'),name.slice(0,name.lastIndexOf('/')+1),depth+1);continue;}

add(name,await entry.async('uint8array'));}
  }

  for(const file of files){if(/\.zip$/i.test(file.name))await addZip(await file.arrayBuffer(),file.webkitRelativePath?file.webkitRelativePath.slice(0,file.webkitRelativePath.lastIndexOf('/')+1):'',0);
    else add(file.webkitRelativePath||file.name,new Uint8Array(await file.arrayBuffer()));}

  const decoder=new TextDecoder('utf-8',{fatal:true});
  // Korean Windows tools (메모장 이전 버전, 한글 TXT 저장) still write EUC-KR/CP949; plain documents fall back to it.
  const legacy=(()=>{try{return new TextDecoder('euc-kr',{fatal:true});}catch{return null;}})();

  const decode=(key:string,bytes:Uint8Array,limit=MAX_TEXT,fallback=false)=>{if(bytes.length>limit)throw new Error(`${key}: 파일을 더 작게 나누어 주세요 (문서 5MB / ENEX 100MB).`);

try{return decoder.decode(bytes).replace(/^\uFEFF/,'');}catch{if(fallback&&legacy)try{const value=legacy.decode(bytes);warning(bundle,`${key}: UTF-8이 아니어서 한국어 윈도우 인코딩(EUC-KR)으로 읽었습니다. 글자가 깨졌는지 확인하세요.`);

return value;}catch{/* neither encoding */}

throw new Error(`${key}: UTF-8 또는 EUC-KR로 저장한 파일을 선택하세요.`);}};

  let metadata=new Map<string,Partial<ImportedPage>>();const metaBytes=entries.get('kosmos-transfer.json');

  if(metaBytes){const parsed=z.object({format:z.literal('kosmos-transfer'),version:z.literal(1),navigation:navigationSchema.optional(),documents:z.array(z.object({id:z.uuid().optional(),path:z.string().min(1).max(1000),title:z.string().min(1).max(300).optional(),kind:z.enum(['scene','wiki','memo']).optional(),chapter:z.string().max(300).optional(),category:z.string().max(200).optional(),summary:z.string().max(20000).optional()})).max(MAX_PAGES)}).safeParse(JSON.parse(decode('kosmos-transfer.json',metaBytes)));

if(!parsed.success)throw new Error('문서 묶음의 정보를 확인하세요.');metadata=new Map(parsed.data.documents.map(d=>[path(d.path),d]));

if(metadata.size!==parsed.data.documents.length)throw new Error('문서 묶음에 중복된 경로가 있습니다.');

    if(parsed.data.navigation){const sourceIds=parsed.data.documents.flatMap(d=>d.id?[d.id]:[]),issue=navigationIssues(parsed.data.navigation,sourceIds)[0];

if(issue||new Set(sourceIds).size!==sourceIds.length)throw new Error(issue||'문서 묶음의 ID가 중복됩니다.');bundle.navigation=parsed.data.navigation;bundle.sourceIds=Object.fromEntries(parsed.data.documents.flatMap(d=>d.id?[[path(d.path),d.id]]:[]));}
  }

  const sources=new Map<string,string>();

  const pushImage=(key:string,name:string,bytes:Uint8Array,label:string)=>{const type=imageMime(bytes);

if(!type||bytes.length>10*1024*1024){warning(bundle,`${label}: ${name} 이미지는 PNG/JPEG/WebP 10MB 이하만 가져옵니다.`);

return false;}

if(!bundle.assets.some(a=>a.key===key))bundle.assets.push({key,name:name.slice(0,300),blob:new Blob([Uint8Array.from(bytes).buffer],{type})});

return true;};

  const dirOf=(key:string)=>key.split('/').slice(0,-1).join('/').slice(0,300);
  // A Scrivener project is read through its binder; the files inside it are not imported one by one.
  const scrivRoots:string[]=[];

  for(const [key,bytes]of entries){if(hidden(key)||!/\.scrivx$/i.test(key))continue;
    const root=key.includes('/')?key.slice(0,key.lastIndexOf('/')+1):'';scrivRoots.push(root);
    const project=readScrivener(key,decode(key,bytes,20*1024*1024),entries);project.warnings.forEach(w=>warning(bundle,w));

    for(const item of project.items){
      let html=item.synopsis?`<blockquote><p>${esc(item.synopsis).replace(/\n/g,'<br>')}</p></blockquote>`:'';

      if(item.content){const rtf=rtfToHtml(entries.get(item.content)!,item.title);rtf.warnings.forEach(w=>warning(bundle,w));html+=rtf.html;}

      if(item.image&&pushImage(item.image,item.image.split('/').pop()!,entries.get(item.image)!,item.title))html+=`<p><img data-kosmos-asset="${esc(item.image)}"></p>`;
      const pageKey=item.content||`${root}binder/${item.id}`;
      bundle.pages.push({key:pageKey,title:item.title,kind:'memo',content:fromText(''),assetKeys:[],chapter:baseTitle(root.replace(/\/$/,'')||key),category:'',summary:'',place:item.place});sources.set(pageKey,html);

      if(bundle.pages.length>MAX_PAGES)throw new Error('한 번에 500개 문서까지 가져올 수 있습니다.');
    }
  }

  for(const [key,bytes]of entries){if(hidden(key)||key==='kosmos-transfer.json'||key==='README-ORBIS-TERTIUS.txt'||/\.scrivx$/i.test(key)||scrivRoots.some(root=>root?key.startsWith(root):/^(Files|Settings|QuickLook)\//.test(key)))continue;
    const ext=key.split('.').pop()?.toLowerCase()||'';

    if(imageTypes.get(ext)){const type=imageMime(bytes);

if(type!==imageTypes.get(ext)||bytes.length>10*1024*1024){warning(bundle,`${key}: 이미지 형식이 올바르지 않거나 10MB를 넘어서 제외했습니다.`);continue;}

bundle.assets.push({key,name:key.split('/').pop()!.slice(0,300),blob:new Blob([Uint8Array.from(bytes).buffer],{type})});}
    else if(['rtf','hwp','hwpx'].includes(ext)){
      if(bytes.length>MAX_BYTES)throw new Error(`${key}: 파일을 더 작게 나누어 주세요.`);
      const result=ext==='rtf'?{...rtfToHtml(bytes,key),images:[]}:ext==='hwp'?await hwpToHtml(bytes,key):await hwpxToHtml(bytes,key);result.warnings.forEach(w=>warning(bundle,w));

      for(const image of result.images)pushImage(image.key,image.name,image.bytes,key);
      bundle.pages.push({key,title:baseTitle(key),kind:'memo',content:fromText(''),assetKeys:[],chapter:dirOf(key),category:'',summary:''});sources.set(key,result.html);
    }
    else if(ext==='epub'){
      const files=new Map<string,Uint8Array>();let book:JSZip;

try{book=await JSZip.loadAsync(bytes);}catch{throw new Error(`${key}: EPUB 파일을 열지 못했습니다.`);}

      const all=Object.values(book.files).filter(f=>!f.dir);

if(all.length>3000)throw new Error(`${key}: EPUB 안의 파일이 너무 많습니다.`);
      let declared=0;

for(const entry of all){const size=zipUncompressedSize(entry);

if(size===undefined)throw new Error('EPUB 크기를 확인하지 못했습니다.');declared+=size;}

if(declared>MAX_BYTES)throw new Error(`${key}: 압축 해제 크기가 100MB를 넘습니다.`);

      for(const entry of all){if(path(entry.name)!==entry.name)throw new Error(`${key}: EPUB에 안전하지 않은 경로가 있습니다.`);files.set(entry.name,await entry.async('uint8array'));}

      const epub=readEpub(files,key);epub.warnings.forEach(w=>warning(bundle,w));
      // Only images a chapter actually shows are kept; covers and decorations are dropped quietly.
      const shown=new Set<string>();

for(const chapter of epub.chapters)for(const m of chapter.html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)){const target=resolve(chapter.path,m[1]);

if(target)shown.add(target);}

      for(const [name,data]of files)if(shown.has(name)&&imageTypes.get(name.split('.').pop()?.toLowerCase()||''))pushImage(`${key}/${name}`,name.split('/').pop()!,data,key);
      epub.chapters.forEach((chapter,i)=>{const pageKey=`${key}/${chapter.path}`;bundle.pages.push({key:pageKey,title:chapter.title,kind:'memo',content:fromText(''),assetKeys:[],chapter:epub.title||baseTitle(key),category:'',summary:'',place:`${key}/${String(i+1).padStart(4,'0')}`});sources.set(pageKey,chapter.html);});
    }
    else if(['md','markdown','txt','html','htm','csv'].includes(ext)){
      const source=decode(key,bytes,MAX_TEXT,true),meta=metadata.get(key);const page:ImportedPage={key,title:baseTitle(key),kind:meta?.kind&&['scene','wiki','memo'].includes(meta.kind)?meta.kind:'memo',content:fromText(''),assetKeys:[],chapter:meta?.chapter||key.split('/').slice(0,-1).join('/').slice(0,300),category:meta?.category||'',summary:meta?.summary||''};

      if(meta?.title)page.title=meta.title.slice(0,300);
      else if(['html','htm'].includes(ext)){const tree=parseDocument(source);page.title=(elements(tree,'h1').find(n=>n.attribs.class?.includes('page-title'))||elements(tree,'title')[0])?text(elements(tree,'h1').find(n=>n.attribs.class?.includes('page-title'))||elements(tree,'title')[0]).trim().slice(0,300)||page.title:page.title;}
      else if(['md','markdown'].includes(ext)&&/^#\s+[^\n]+/.test(source))page.title=source.match(/^#\s+([^\n]+)/)![1].trim().slice(0,300);
      bundle.pages.push(page);sources.set(key,source);
    }else if(ext==='docx'){
      if(bytes.length>MAX_BYTES)throw new Error(`${key}: 파일을 더 작게 나누어 주세요.`);const docx=await docxToHtml(bytes,key),meta=metadata.get(key);docx.warnings.forEach(w=>warning(bundle,w));

      for(const image of docx.images)pushImage(image.key,image.name,image.bytes,key);
      bundle.pages.push({key,title:(meta?.title||docx.title||baseTitle(key)).slice(0,300),kind:meta?.kind||'memo',content:fromText(''),assetKeys:[],chapter:meta?.chapter||key.split('/').slice(0,-1).join('/').slice(0,300),category:meta?.category||'',summary:meta?.summary||''});sources.set(key,docx.html);
    }else if(ext==='enex'){const xml=decode(key,bytes,MAX_BYTES);

if(/<!ENTITY/i.test(xml)||/<!DOCTYPE[^>]*\[/i.test(xml))throw new Error('XML 내부 엔티티 선언은 지원하지 않습니다.');

if(XMLValidator.validate(xml)!==true)throw new Error(`${key}: 올바른 ENEX XML 파일이 아닙니다.`);
      const tree=parseDocument(xml,{xmlMode:true});const root=elements(tree,'en-export')[0];

if(!root)throw new Error(`${key}: Evernote ENEX 형식이 아닙니다.`);

      for(const [i,note]of elements(root,'note').entries()){
        const page:ImportedPage={key:`${key}/note-${i+1}`,title:text(elements(note,'title')[0]||note).slice(0,300)||'제목 없는 노트',kind:'memo',content:fromText(''),assetKeys:[],chapter:'',category:'',summary:''};
        const tags=elements(note,'tag').map(text);page.summary=tags.length?`원본 태그: ${tags.join(', ')}`.slice(0,20000):'';page.tags=tags;page.created=elements(note,'created')[0]?text(elements(note,'created')[0]).trim():undefined;page.updated=elements(note,'updated')[0]?text(elements(note,'updated')[0]).trim():undefined;

        if(tags.includes('kosmos:scene'))page.kind='scene';else if(tags.includes('kosmos:wiki'))page.kind='wiki';

        for(const [j,resource]of elements(note,'resource').entries()){
          const mimeElement=elements(resource,'mime')[0],filename=elements(resource,'file-name')[0];const mime=mimeElement?text(mimeElement):'',data=elements(resource,'data')[0],name=(filename?text(filename):`첨부-${j+1}`).slice(0,300);

          if(!data||![...imageTypes.values()].some(type=>type===mime)){warning(bundle,`${page.title}: ${name} (${mime}) 첨부는 지원하지 않습니다. 원본 ENEX를 보관하세요.`);continue;}

          const bytes=unbase64(text(data));

if(bytes.length>10*1024*1024||imageMime(bytes)!==mime){warning(bundle,`${page.title}: ${name} 이미지의 형식·크기를 확인하세요.`);continue;}

          const hash=SparkMD5.ArrayBuffer.hash(Uint8Array.from(bytes).buffer),assetKey=`enex:${page.key}:${hash}`;

          if(!bundle.assets.some(a=>a.key===assetKey))bundle.assets.push({key:assetKey,name,blob:new Blob([Uint8Array.from(bytes).buffer],{type:mime})});page.assetKeys.push(assetKey);
        }

        const enml=elements(note,'content')[0];

if(!enml)throw new Error(`${page.title}: 본문이 없는 ENEX 노트입니다.`);const body=text(enml);

if(encoder.encode(body).length>MAX_TEXT)throw new Error(`${page.title}: 본문이 5MB를 넘습니다.`);bundle.pages.push(page);sources.set(page.key,body);
      }
    }else warning(bundle,`${key}: 지원하지 않는 파일이므로 가져오지 않습니다.`);

    if(bundle.pages.length>MAX_PAGES)throw new Error('한 번에 500개 문서까지 가져올 수 있습니다.');
  }

  if(!bundle.pages.length)throw new Error('가져올 문서가 없습니다. ENEX, Markdown, HTML, TXT, CSV, Word(docx), RTF, 한글(hwp·hwpx), EPUB, 스크리브너 프로젝트 또는 이들을 담은 ZIP·폴더를 선택하세요.');

  for(const page of bundle.pages){const source=sources.get(page.key)!;

if(/\.txt$/i.test(page.key))page.content=fromText(source);else if(/\.csv$/i.test(page.key))page.content=csvContent(source,bundle,page);else page.content=htmlContent(/\.(md|markdown)$/i.test(page.key)?markdown.render(obsidianMarkdown(source)):source,page,bundle);documentSchema.parse({...newDocument(page.kind,page.title),content:page.content,summary:page.summary,chapter:page.chapter,category:page.category});}

  const used=new Set(bundle.pages.flatMap(p=>p.assetKeys));

for(const a of bundle.assets)if(!used.has(a.key))warning(bundle,`${a.name}: 문서에서 참조하지 않는 이미지이므로 가져오지 않습니다.`);
  bundle.assets=bundle.assets.filter(a=>used.has(a.key));

return bundle;
}

type PreparedImport={state:Workspace;assets:{id:string;blob:Blob}[];workId:string};

export function prepareImport(state:Workspace,bundle:ImportBundle,choices:ImportChoice[],target:{workId:string}|{title:string;form:Work['form']}):PreparedImport {
  if(!choices.length||new Set(choices.map(c=>c.key)).size!==choices.length)throw new Error('가져올 문서를 선택하세요.');
  const workId='workId'in target?target.workId:uid();

if('workId'in target&&!state.works.some(w=>w.id===workId))throw new Error('작품을 찾지 못했습니다.');
  const ids=new Map(choices.map(c=>[c.key,uid()])),kinds=new Map(choices.map(c=>[c.key,c.kind]));
  const assetIds=new Map<string,string>(),assetMetas:AssetMeta[]=[],blobs:{id:string;blob:Blob}[]=[];

  const documents=choices.map(choice=>{
    const page=bundle.pages.find(p=>p.key===choice.key);

if(!page)throw new Error('가져올 문서가 바뀌었습니다.');const d=newDocument(choice.kind,choice.title.trim());d.id=ids.get(page.key)!;d.chapter=page.chapter;d.category=page.category||d.category;d.summary=page.summary;d.content=structuredClone(page.content);

    const visit=(node:RichNode)=>{if(node.type==='footnote')node.attrs={...node.attrs,noteId:uid()};

if(['paragraph','heading'].includes(node.type))node.attrs={...node.attrs,blockId:uid()};node.marks=node.marks?.flatMap(mark=>{if(mark.type!=='wikiLink')return[mark];const key=String(mark.attrs?.sourceKey||'');

return kinds.get(key)==='wiki'?[{type:'wikiLink',attrs:{targetId:ids.get(key)}}]:[];});node.content?.forEach(visit);};

visit(d.content);

    for(const key of new Set(page.assetKeys)){const asset=bundle.assets.find(a=>a.key===key);

if(!asset)throw new Error('가져올 첨부가 없습니다.');let id=assetIds.get(key);

if(!id){id=uid();assetIds.set(key,id);assetMetas.push({id,workId,name:asset.name,type:assetSchema.shape.type.parse(asset.blob.type),size:asset.blob.size});blobs.push({id,blob:asset.blob});}

d.assetIds.push(id);}

return d;
  });

  const next=structuredClone(state);

if('workId'in target)next.works.find(w=>w.id===workId)!.documents.push(...documents);else next.works.push({id:workId,title:target.title.trim(),form:target.form,subtitle:'',description:'',documents,publications:[],activePublicationId:null});

  if(bundle.navigation&&bundle.sourceIds){
    const targetWork=next.works.find(w=>w.id===workId)!,sourceToNew=new Map<string,string>();

    for(const choice of choices){const source=bundle.sourceIds[choice.key];

if(source)sourceToNew.set(source,ids.get(choice.key)!);}

    const selected=subsetNavigation(bundle.navigation,[...sourceToNew.keys()],choices.length===bundle.pages.length),nav='workId'in target?resolveNavigation(targetWork):{version:1 as const,sections:structuredClone(defaultSections),nodes:[]};
    nav.nodes=nav.nodes.filter(n=>!documents.some(d=>d.id===n.id));
    const sectionIds=new Map<string,string>();

for(const section of selected.sections){let existing=nav.sections.find(s=>s.title===section.title&&s.defaultKind===section.defaultKind);

if(!('workId'in target)&&['scene','wiki','memo'].includes(section.id)){existing=nav.sections.find(s=>s.id===section.id)!;Object.assign(existing,section);}

if(!existing){existing={...section,id:uid()};nav.sections.push(existing);}

sectionIds.set(section.id,existing.id);}

    for(const n of selected.nodes)if(n.type==='folder')sourceToNew.set(n.id,uid());

    for(const n of selected.nodes)nav.nodes.push({...n,id:sourceToNew.get(n.id)!,sectionId:sectionIds.get(n.sectionId)!,parentId:n.parentId?sourceToNew.get(n.parentId)!:null});
    next.works=next.works.map(w=>w.id===workId?applyNavigation(w,nav):w);
  }

  next.assets.push(...assetMetas);next.updatedAt=new Date().toISOString();workspaceSchema.parse(next);

  if(encoder.encode(JSON.stringify(next)).length>19000000)throw new Error('원고 저장 용량을 넘습니다. 더 적은 문서를 가져오세요.');

  return{state:next,assets:blobs,workId};
}

const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const mdEsc=(s:string)=>s.replace(/[\\`*_{}\[\]<>#!|]/g,'\\$&');

const safeFilename=(s:string)=>s.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'문서';

function htmlRender(node:RichNode,links:Map<string,string>,notes:{id:string;text:string}[]):string {
  if(node.type==='text'){let body=esc(node.text||'');

for(const mark of node.marks||[]){const tags=new Map([['bold','strong'],['italic','em'],['strike','s'],['underline','u'],['code','code'],['superscript','sup'],['subscript','sub'],['highlight','mark']]);

if(tags.get(mark.type))body=`<${tags.get(mark.type)}>${body}</${tags.get(mark.type)}>`;else if(mark.type==='fontSize'){const size=inlineFontSize(mark.attrs?.size);

if(size)body=`<span data-font-size="${size}" style="font-size:${size}px">${body}</span>`;}else if(mark.type==='link'){const href=safeLink(String(mark.attrs?.href||''));

if(href)body=`<a href="${esc(href)}">${body}</a>`;}else if(mark.type==='wikiLink'){const href=links.get(String(mark.attrs?.targetId));

if(href)body=`<a href="${esc(href)}">${body}</a>`;} }

return body;}

  if(node.type==='footnote'){notes.push({id:String(node.attrs?.noteId||uid()),text:String(node.attrs?.text||'')});

return`<sup data-kosmos-note="${esc(String(node.attrs?.text||''))}"><a href="#note-${notes.length}">[${notes.length}]</a></sup>`;}

  const body=(node.content||[]).map(n=>htmlRender(n,links,notes)).join('');
  const tags=new Map([['paragraph','p'],['blockquote','blockquote'],['bulletList','ul'],['orderedList','ol'],['listItem','li'],['codeBlock','pre'],['tableRow','tr']]);
  const style=paragraphCss(node.attrs),format=style?` style="${esc(style)}"`:'';

  if(node.type==='paragraph')return`<p${format}>${body}</p>`;

  if(node.type==='heading')return`<h${Math.max(1,Math.min(6,Number(node.attrs?.level)||2))}${format}>${body}</h${Math.max(1,Math.min(6,Number(node.attrs?.level)||2))}>`;

  if(node.type==='table')return`<table style="border-collapse:collapse"><colgroup>${tableColumns(node.content?.[0]).map(w=>w?`<col width="${w}" />`:'<col />').join('')}</colgroup><tbody>${body}</tbody></table>`;

  if(node.type==='tableCell'||node.type==='tableHeader'){
    const tag=node.type==='tableHeader'?'th':'td',colspan=cellSpan(node.attrs?.colspan),rowspan=cellSpan(node.attrs?.rowspan),widths=node.attrs?.colwidth;
    const width=Array.isArray(widths)&&widths.length===colspan&&z.array(z.number().int().min(1).max(2000)).safeParse(widths).success?` data-orbis-colwidth="${widths.join(',')}"`:'';

    return`<${tag} colspan="${colspan}" rowspan="${rowspan}"${width} style="border:1px solid currentColor;padding:6px;vertical-align:top">${body}</${tag}>`;
  }

  if(node.type==='hardBreak')return'<br />';

if(node.type==='horizontalRule')return'<hr />';const list=listStyleType(node),listAttrs=list?` data-list-style="${list}" style="list-style-type:${list}"`:'';

  if(node.type==='orderedList')return`<ol start="${Number(node.attrs?.start)||1}"${listAttrs}>${body}</ol>`;

if(node.type==='bulletList')return`<ul${listAttrs}>${body}</ul>`;

  return tags.get(node.type)?`<${tags.get(node.type)}>${body}</${tags.get(node.type)}>`:body;
}

function mdRender(node:RichNode,links:Map<string,string>,notes:string[]):string {
  // CommonMark has no merged-cell, paragraph-format, text-size or list-marker syntax. Raw HTML retains those values.
  if(node.type==='table'||(['paragraph','heading'].includes(node.type)&&(paragraphCss(node.attrs)||node.content?.some(c=>c.marks?.some(m=>m.type==='fontSize'))))||(['bulletList','orderedList'].includes(node.type)&&listStyleType(node))){
    const htmlNotes=notes.map((text,i)=>({id:String(i),text})),before=htmlNotes.length,body=htmlRender(node,links,htmlNotes);notes.push(...htmlNotes.slice(before).map(n=>n.text));

return body+'\n\n';
  }

  if(node.type==='text'){let s=mdEsc(node.text||'');

for(const m of node.marks||[]){if(m.type==='bold')s=`**${s}**`;else if(m.type==='italic')s=`*${s}*`;else if(m.type==='strike')s=`~~${s}~~`;else if(m.type==='code'){const fence='`'.repeat(Math.max(1,...(node.text?.match(/`+/g)||[]).map(v=>v.length+1)));s=`${fence} ${(node.text||'')} ${fence}`;}else if(['underline','superscript','subscript','highlight'].includes(m.type)){const tag=new Map([['underline','u'],['superscript','sup'],['subscript','sub'],['highlight','mark']]).get(m.type);s=`<${tag}>${s}</${tag}>`;}else{const href=m.type==='wikiLink'?links.get(String(m.attrs?.targetId)):m.type==='link'?safeLink(String(m.attrs?.href||'')):undefined;

if(href)s=`[${s}](<${href.replace(/>/g,'%3E')}>)`;}}

return s;}

  if(node.type==='footnote'){notes.push(String(node.attrs?.text||''));

return`[^${notes.length}]`;}

  const body=(node.content||[]).map(n=>mdRender(n,links,notes)).join('');

  if(node.type==='paragraph')return`${body}\n\n`;

if(node.type==='hardBreak')return'  \n';

if(node.type==='heading')return`${'#'.repeat(Math.max(1,Math.min(6,Number(node.attrs?.level)||2)))} ${body}\n\n`;

  if(node.type==='horizontalRule')return'---\n\n';

if(node.type==='blockquote')return body.trim().split('\n').map(l=>`> ${l}`).join('\n')+'\n\n';

  if(node.type==='bulletList'||node.type==='orderedList')return(node.content||[]).map((n,i)=>`${node.type==='bulletList'?'-':`${(Number(node.attrs?.start)||1)+i}.`} ${mdRender(n,links,notes).trim().replace(/\n/g,'\n    ')}`).join('\n')+'\n\n';

  if(node.type==='codeBlock'){const code=(node.content||[]).map(n=>n.text||'').join(''),fence='`'.repeat(Math.max(3,...(code.match(/`+/g)||[]).map(v=>v.length+1)));

return`${fence}\n${code}\n${fence}\n\n`;}

return body;
}

export async function exportInterchange(work:Work,documentIds:string[],metas:AssetMeta[],assets:{id:string;blob:Blob}[],format:ExportFormat):Promise<TransferDownload> {
  const docs=work.documents.filter(d=>documentIds.includes(d.id));

if(!docs.length)throw new Error('내보낼 문서를 선택하세요.');
  const filenames=new Map(docs.map((d,i)=>[d.id,`${String(i+1).padStart(3,'0')}-${safeFilename(d.title)}.${format==='html'?'html':'md'}`]));
  const zip=new JSZip(),assetMap=new Map(assets.map(a=>[a.id,a.blob]));let total=0;

  const getAsset=(id:string)=>{const meta=metas.find(m=>m.id===id),blob=assetMap.get(id);

if(!meta||!blob||blob.size!==meta.size)throw new Error('첨부를 모두 내려받은 뒤 내보내세요.');

return{meta,blob};};

  if(format==='enex'){
    const noteXml:string[]=[];

    for(const d of docs){const notes:{id:string;text:string}[]=[];let body=htmlRender(d.content,new Map(),notes).replace(/<sup data-kosmos-note="[^"]*">([\s\S]*?)<\/sup>/g,'<sup>$1</sup>').replace(/<mark>/g,'<span style="background-color:yellow">').replace(/<\/mark>/g,'</span>').replace(/ data-(?:orbis-colwidth|font-size|list-style)="[^"]*"/g,'');const resources:string[]=[];

      for(const id of d.assetIds){const{meta,blob}=getAsset(id),bytes=new Uint8Array(await blob.arrayBuffer()),hash=SparkMD5.ArrayBuffer.hash(bytes.buffer);total+=bytes.length;body+=`<div><en-media type="${meta.type}" hash="${hash}" /></div>`;resources.push(`<resource><data encoding="base64">${base64(bytes)}</data><mime>${meta.type}</mime><resource-attributes><file-name>${esc(meta.name)}</file-name></resource-attributes></resource>`);}

      if(notes.length)body+=`<div><h2>각주</h2>${notes.map((n,i)=>`<p>${i+1}. ${esc(n.text)}</p>`).join('')}</div>`;

      if(d.summary)body+=`<div><h2>문서 요약</h2><p>${esc(d.summary)}</p></div>`;
      const enml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${body}</en-note>`;
      noteXml.push(`<note><title>${esc(d.title)}</title><content><![CDATA[${enml.replace(/\]\]>/g,']]]]><![CDATA[>')}]]></content><created>${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}</created><tag>kosmos:${d.kind}</tag>${resources.join('')}</note>`);
    }

    const xml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd"><en-export export-date="${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}" application="Orbis Tertius" version="1">${noteXml.join('')}</en-export>`;

    if(encoder.encode(xml).length>MAX_BYTES)throw new Error('내보내기 크기가 100MB를 넘습니다.');

return{blob:new Blob([xml],{type:'application/xml'}),name:`${safeFilename(work.title)}.enex`};
  }

  const written=new Set<string>();

  for(const d of docs){const attachments:string[]=[];

    for(const id of d.assetIds){const{meta,blob}=getAsset(id),name=`assets/${id}-${safeFilename(meta.name)}`;

if(!written.has(id)){total+=blob.size;zip.file(name,await blob.arrayBuffer());written.add(id);}

attachments.push(format==='html'?`<p><img src="${esc(name)}" alt="${esc(meta.name)}" /></p>`:`![${mdEsc(meta.name)}](<${name}>)`);}

    let output:string;

    if(format==='html'){const notes:{id:string;text:string}[]=[];const body=htmlRender(d.content,filenames,notes);output=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body><article><h1>${esc(d.title)}</h1>${body}${attachments.join('')}<section class="footnotes"><h2>각주</h2>${notes.map((n,i)=>`<p id="note-${i+1}">${i+1}. ${esc(n.text)}</p>`).join('')}</section></article></body></html>`;}
    else {const notes:string[]=[];output=`# ${mdEsc(d.title)}\n\n${mdRender(d.content,filenames,notes)}${attachments.join('\n\n')}\n\n${notes.map((n,i)=>`[^${i+1}]: ${n.replace(/\n/g,'\n    ')}`).join('\n')}`;}

    total+=encoder.encode(output).length;

if(total>MAX_BYTES)throw new Error('내보내기 크기가 100MB를 넘습니다.');zip.file(filenames.get(d.id)!,output);
  }

  zip.file('kosmos-transfer.json',JSON.stringify({format:'kosmos-transfer',version:1,workTitle:work.title,navigation:subsetNavigation(resolveNavigation(work),docs.map(d=>d.id),docs.length===work.documents.length),documents:docs.map(d=>({id:d.id,path:filenames.get(d.id),title:d.title,kind:d.kind,chapter:d.chapter,category:d.category,summary:d.summary}))},null,2));
  zip.file('README-ORBIS-TERTIUS.txt','Orbis Tertius 문서 교환용 파일입니다. 초안과 비공개 설정을 포함할 수 있습니다.\nNotion: 설정 → 가져오기 → ZIP. Obsidian: Markdown 묶음을 압축 해제하세요.\n복구 이력과 공개 판본은 포함하지 않습니다. 전체 보관은 Orbis Tertius 전체 백업을 사용하세요.\n문서 내 이미지는 Orbis Tertius에서는 별도 첨부로 가져오며, 표·데이터베이스·앱 고유 기능은 완전히 복원되지 않습니다.');

  return{blob:await zip.generateAsync({type:'blob',compression:'DEFLATE'}),name:`${safeFilename(work.title)}-${format}.zip`};
}
