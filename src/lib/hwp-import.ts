import JSZip from 'jszip';
import { parseDocument, DomUtils } from 'htmlparser2';
import { XMLValidator } from 'fast-xml-parser';

type XmlNode=ReturnType<typeof parseDocument>['children'][number];
type XmlElement=XmlNode & {name:string;attribs:Record<string,string>;children:XmlNode[]};
export type HwpImage={key:string;name:string;bytes:Uint8Array};
export type HwpResult={html:string;images:HwpImage[];warnings:string[]};
const isElement=(n:XmlNode):n is XmlElement=>'name' in n&&'attribs' in n;
const kids=(n:XmlNode|undefined):XmlElement[]=>n&&'children' in n?n.children.filter(isElement):[];
// HWPX prefixes vary between writers (hp:, hs:, hc:); match on the local name.
const local=(e:XmlElement)=>e.name.slice(e.name.indexOf(':')+1);
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/** 한글 HWPX (OWPML ZIP): paragraphs, line breaks, tables and embedded PNG/JPEG/WebP images. Character styles are not read. */
export async function hwpxToHtml(bytes:Uint8Array,key:string):Promise<HwpResult>{
  let zip:JSZip;try{zip=await JSZip.loadAsync(bytes);}catch{throw new Error(`${key}: 한글 문서(hwpx)를 열지 못했습니다.`);}
  const files=Object.values(zip.files).filter(f=>!f.dir);if(files.length>3000)throw new Error(`${key}: 한글 문서의 내부 파일이 너무 많습니다.`);
  let declared=0;for(const f of files){const size=(f as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize;if(!Number.isSafeInteger(size)||size!<0)throw new Error(`${key}: 한글 문서 크기를 확인하지 못했습니다.`);declared+=size!;}
  if(declared>100*1024*1024)throw new Error(`${key}: 압축 해제 크기가 100MB를 넘습니다.`);
  const sections=files.map(f=>f.name).filter(n=>/^Contents\/section\d+\.xml$/i.test(n)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0]));
  if(!sections.length)throw new Error(`${key}: 한글 문서 본문을 찾지 못했습니다.`);
  const warnings:string[]=[],warn=(m:string)=>{if(!warnings.includes(m))warnings.push(m);},images:HwpImage[]=[];
  let count=0;const enter=()=>{if(++count>200000)throw new Error(`${key}: 문서가 너무 복잡합니다.`);};
  async function image(id:string|undefined){
    const file=id?files.find(f=>f.name.startsWith('BinData/')&&f.name.split('/').pop()!.replace(/\.[^.]+$/,'')===id):undefined;if(!file){warn(`${key}: 찾지 못한 그림은 가져오지 않습니다.`);return'';}
    const assetKey=`${key}::${file.name}`;if(!images.some(i=>i.key===assetKey))images.push({key:assetKey,name:file.name.split('/').pop()!,bytes:await file.async('uint8array')});
    return `<img data-kosmos-asset="${esc(assetKey)}" alt="${esc(file.name.split('/').pop()!)}">`;
  }
  async function inline(e:XmlElement,depth:number):Promise<{text:string;blocks:string[]}>{
    if(depth>40)throw new Error(`${key}: 문서의 중첩이 너무 깊습니다.`);let text='';const blocks:string[]=[];
    for(const c of kids(e)){enter();const name=local(c);
      if(name==='t'){for(const part of c.children){if(part.type==='text')text+=esc(part.data);else if(isElement(part)){const n=local(part);if(n==='lineBreak')text+='<br>';else if(n==='tab')text+=' ';}}}
      else if(name==='tbl')blocks.push(await table(c,depth+1));
      else if(name==='pic'){const img=DomUtils.findOne(el=>/(^|:)img$/.test(el.name),c.children);text+=await image(img?.attribs.binaryItemIDRef);}
      else if(['equation','ole','chart','video'].includes(name))warn(`${key}: 수식·개체·차트는 가져오지 않습니다.`);
      else if(['run','ctrl','container','rect','drawText','subList','p'].includes(name)){const sub=await inline(c,depth+1);text+=sub.text;blocks.push(...sub.blocks);}
    }
    return {text,blocks};
  }
  async function paragraphs(e:XmlElement,depth:number):Promise<string>{
    const out:string[]=[];
    for(const c of kids(e)){enter();const name=local(c);
      if(name==='p'){const {text,blocks}=await inline(c,depth+1);out.push(`<p>${text}</p>`,...blocks);}
      else if(name==='tbl')out.push(await table(c,depth+1));
      else if(['subList','sec'].includes(name))out.push(await paragraphs(c,depth+1));
    }
    return out.join('');
  }
  async function table(tbl:XmlElement,depth:number):Promise<string>{
    if(depth>20)throw new Error(`${key}: 문서의 중첩이 너무 깊습니다.`);
    const rows:string[]=[];
    for(const tr of kids(tbl).filter(r=>local(r)==='tr')){
      const cells:string[]=[];
      for(const tc of kids(tr).filter(c=>local(c)==='tc')){
        const span=kids(tc).find(c=>local(c)==='cellSpan'),col=Math.max(1,Math.min(50,Number(span?.attribs.colSpan)||1)),row=Math.max(1,Math.min(500,Number(span?.attribs.rowSpan)||1));
        const content=(await Promise.all(kids(tc).filter(c=>local(c)==='subList').map(s=>paragraphs(s,depth+1)))).join('');
        cells.push(`<td${col>1?` colspan="${col}"`:''}${row>1?` rowspan="${row}"`:''}>${content}</td>`);
      }
      if(cells.length)rows.push(`<tr>${cells.join('')}</tr>`);
    }
    return `<table>${rows.join('')}</table>`;
  }
  const html:string[]=[];
  for(const name of sections){
    const source=await zip.file(name)!.async('string');if(source.length>20*1024*1024)throw new Error(`${key}: 문서가 너무 큽니다.`);
    if(/<!ENTITY/i.test(source)||/<!DOCTYPE[^>]*\[/i.test(source))throw new Error('XML 내부 엔티티 선언은 지원하지 않습니다.');
    if(XMLValidator.validate(source)!==true)throw new Error(`${key}: 한글 문서의 XML이 손상되었습니다.`);
    const root=kids(parseDocument(source,{xmlMode:true}) as unknown as XmlNode)[0];if(root)html.push(await paragraphs(root,0));
  }
  warn(`${key}: 한글 문서는 글자 모양(굵게·색 등) 없이 문단·표·그림만 가져옵니다.`);
  return {html:html.join(''),images,warnings};
}

/** Minimal OLE compound file reader: enough to list streams of an HWP 5 file. */
function compoundStreams(bytes:Uint8Array,label:string):Map<string,Uint8Array>{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const sig=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];if(bytes.length<512||!sig.every((b,i)=>bytes[i]===b))throw new Error(`${label}: 한글 문서(hwp) 형식이 아닙니다. 한글 97 등 이전 형식은 한글에서 hwpx로 저장해 주세요.`);
  const u32=(o:number)=>{if(o+4>bytes.length)throw new Error(`${label}: 한글 문서가 손상되었습니다.`);return view.getUint32(o,true);};
  const sectorSize=1<<view.getUint16(0x1e,true),miniSize=1<<view.getUint16(0x20,true);if(sectorSize!==512&&sectorSize!==4096)throw new Error(`${label}: 한글 문서가 손상되었습니다.`);
  const offset=(s:number)=>(s+1)*sectorSize;const END=0xfffffffe,maxSectors=Math.ceil(bytes.length/sectorSize)+1;
  const difat:number[]=[];for(let i=0;i<109;i++){const s=u32(0x4c+i*4);if(s<0xfffffffa)difat.push(s);}
  let next=u32(0x44),guard=0;while(next<0xfffffffa&&guard++<maxSectors){for(let i=0;i<sectorSize/4-1;i++){const s=u32(offset(next)+i*4);if(s<0xfffffffa)difat.push(s);}next=u32(offset(next)+sectorSize-4);}
  const fat:number[]=[];for(const s of difat)for(let i=0;i<sectorSize/4;i++)fat.push(u32(offset(s)+i*4));
  const chain=(start:number,table:number[])=>{const out:number[]=[];let s=start;while(s<0xfffffffa&&s!==END){if(out.length>maxSectors||s>=table.length)throw new Error(`${label}: 한글 문서가 손상되었습니다.`);out.push(s);s=table[s];}return out;};
  const read=(start:number,size:number)=>{const out=new Uint8Array(size);let at=0;for(const s of chain(start,fat)){if(at>=size)break;const part=bytes.subarray(offset(s),Math.min(offset(s)+sectorSize,bytes.length)).subarray(0,size-at);out.set(part,at);at+=part.length;}return out;};
  const dirSectors=chain(u32(0x30),fat),dir=new Uint8Array(dirSectors.length*sectorSize);dirSectors.forEach((s,i)=>dir.set(bytes.subarray(offset(s),offset(s)+sectorSize),i*sectorSize));
  const dv=new DataView(dir.buffer);type Entry={name:string;type:number;left:number;right:number;child:number;start:number;size:number};
  const entries:Entry[]=[];for(let o=0;o+128<=dir.length;o+=128){const len=dv.getUint16(o+64,true);let name='';for(let i=0;i<Math.max(0,len/2-1)&&i<32;i++)name+=String.fromCharCode(dv.getUint16(o+i*2,true));entries.push({name,type:dir[o+66],left:dv.getUint32(o+68,true),right:dv.getUint32(o+72,true),child:dv.getUint32(o+76,true),start:dv.getUint32(o+116,true),size:dv.getUint32(o+120,true)});}
  const root=entries[0];if(!root||root.type!==5)throw new Error(`${label}: 한글 문서가 손상되었습니다.`);
  const miniFat:number[]=[];const mfStart=u32(0x3c);if(mfStart<0xfffffffa){const raw=read(mfStart,chain(mfStart,fat).length*sectorSize),mv=new DataView(raw.buffer);for(let i=0;i<raw.length/4;i++)miniFat.push(mv.getUint32(i*4,true));}
  const miniStream=root.size?read(root.start,root.size):new Uint8Array();
  const cutoff=u32(0x38),streams=new Map<string,Uint8Array>(),seen=new Set<number>();
  const visit=(id:number,prefix:string)=>{
    if(id===0xffffffff||id>=entries.length||seen.has(id))return;seen.add(id);const e=entries[id];
    visit(e.left,prefix);visit(e.right,prefix);
    const name=prefix+e.name;
    if(e.type===2){if(e.size>100*1024*1024)throw new Error(`${label}: 한글 문서가 너무 큽니다.`);if(e.size<cutoff){const out=new Uint8Array(e.size);let at=0;for(const s of chain(e.start,miniFat)){if(at>=e.size)break;const part=miniStream.subarray(s*miniSize,s*miniSize+miniSize).subarray(0,e.size-at);out.set(part,at);at+=part.length;}streams.set(name,out);}else streams.set(name,read(e.start,e.size));}
    else if(e.type===1)visit(e.child,`${name}/`);
  };
  visit(root.child,'');return streams;
}
async function inflateRaw(data:Uint8Array,label:string):Promise<Uint8Array>{
  try{const stream=new Blob([Uint8Array.from(data).buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));const out=new Uint8Array(await new Response(stream).arrayBuffer());if(out.length>100*1024*1024)throw new Error('too large');return out;}
  catch{throw new Error(`${label}: 한글 문서 본문의 압축을 풀지 못했습니다.`);}
}

/**
 * 한글 HWP 5.0: paragraph text from BodyText sections. Table cells come out as plain paragraphs in reading order;
 * styles, pictures and drawing objects are not read. Password and 배포용 documents are refused.
 */
export async function hwpToHtml(bytes:Uint8Array,label:string):Promise<HwpResult>{
  const streams=compoundStreams(bytes,label),header=streams.get('FileHeader');
  if(!header||!String.fromCharCode(...header.subarray(0,17)).startsWith('HWP Document File'))throw new Error(`${label}: 한글 문서(hwp) 형식이 아닙니다.`);
  const flags=new DataView(header.buffer,header.byteOffset).getUint32(36,true);
  if(flags&2)throw new Error(`${label}: 암호가 걸린 한글 문서입니다. 한글에서 암호를 해제한 뒤 다시 저장하세요.`);
  if(flags&4)throw new Error(`${label}: 배포용 한글 문서는 읽을 수 없습니다. 일반 문서로 저장해 주세요.`);
  const compressed=!!(flags&1),warnings:string[]=[];
  const names=[...streams.keys()].filter(n=>/^BodyText\/Section\d+$/.test(n)).sort((a,b)=>Number(a.match(/\d+$/)![0])-Number(b.match(/\d+$/)![0]));
  if(!names.length)throw new Error(`${label}: 한글 문서 본문을 찾지 못했습니다.`);
  const out:string[]=[];let tables=false,objects=false;
  for(const name of names){
    const data=compressed?await inflateRaw(streams.get(name)!,label):streams.get(name)!,dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
    let o=0;
    while(o+4<=data.length){
      const h=dv.getUint32(o,true),tag=h&0x3ff;let size=h>>>20;o+=4;if(size===0xfff){if(o+4>data.length)break;size=dv.getUint32(o,true);o+=4;}
      if(o+size>data.length)break;
      if(tag===67){// HWPTAG_PARA_TEXT: UTF-16LE with inline control codes.
        let text='';for(let i=0;i+2<=size;){const ch=dv.getUint16(o+i,true);
          if(ch>=32){text+=String.fromCharCode(ch);i+=2;continue;}
          if([0,10,13,24,25,26,27,28,29,30,31].includes(ch)){if(ch===10)text+='\n';else if(ch===30||ch===31)text+=' ';else if(ch===24)text+='-';i+=2;continue;}
          if(ch===9)text+=' ';
          if(ch===11){const id=String.fromCharCode(dv.getUint8(o+i+5),dv.getUint8(o+i+4),dv.getUint8(o+i+3),dv.getUint8(o+i+2));if(id==='tbl ')tables=true;else if(id==='gso ')objects=true;}
          i+=16;
        }
        out.push(`<p>${esc(text).replace(/\n/g,'<br>')}</p>`);
      }
      o+=size;
    }
  }
  if(tables)warnings.push(`${label}: 한글 문서의 표는 칸 내용을 문단으로 풀어 가져옵니다.`);
  if(objects)warnings.push(`${label}: 한글 문서의 그림·도형은 가져오지 않습니다. 원본 파일을 보관하세요.`);
  warnings.push(`${label}: 한글 문서는 글자 모양(굵게·색 등) 없이 글만 가져옵니다.`);
  return {html:out.join(''),images:[],warnings};
}
