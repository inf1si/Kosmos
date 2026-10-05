import { parseDocument, DomUtils } from 'htmlparser2';
import { XMLValidator } from 'fast-xml-parser';

type XmlDocument=ReturnType<typeof parseDocument>;
export type EpubChapter={path:string;title:string;html:string};
export type EpubResult={title:string;chapters:EpubChapter[];warnings:string[]};

function xml(source:string,label:string):XmlDocument{
  if(/<!ENTITY/i.test(source)||/<!DOCTYPE[^>]*\[/i.test(source))throw new Error('XML 내부 엔티티 선언은 지원하지 않습니다.');
  if(XMLValidator.validate(source)!==true)throw new Error(`${label}: EPUB 안의 XML이 손상되었습니다.`);
  return parseDocument(source,{xmlMode:true});
}
const byLocal=(root:XmlDocument|XmlDocument['children'][number],name:string)=>DomUtils.findAll(e=>e.name===name||e.name.endsWith(`:${name}`),'children' in root?root.children:[]);
function join(base:string,href:string){const parts=(base.includes('/')?base.slice(0,base.lastIndexOf('/')+1):'').split('/').filter(Boolean);for(const p of decodeURIComponent(href.split('#')[0]).split('/')){if(!p||p==='.')continue;if(p==='..')parts.pop();else parts.push(p);}return parts.join('/');}

/**
 * EPUB 2/3 → one chapter per spine document, in reading order, titled from the table of contents when it names
 * that file. Paths stay as in the book so images and links between chapters resolve against the other files.
 */
export function readEpub(files:Map<string,Uint8Array>,label:string):EpubResult{
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const text=(path:string)=>{const b=files.get(path);if(!b)return null;if(b.length>5*1024*1024)throw new Error(`${label}: ${path} 파일이 5MB를 넘습니다.`);try{return decoder.decode(b).replace(/^﻿/,'');}catch{throw new Error(`${label}: ${path}가 UTF-8이 아닙니다.`);}};
  const container=text('META-INF/container.xml');if(!container)throw new Error(`${label}: EPUB 형식이 아닙니다.`);
  const opfPath=byLocal(xml(container,label),'rootfile')[0]?.attribs['full-path'];const opfSource=opfPath?text(opfPath):null;if(!opfPath||!opfSource)throw new Error(`${label}: EPUB 목차 정보(OPF)를 찾지 못했습니다.`);
  const opf=xml(opfSource,label),warnings:string[]=[];
  if(files.has('META-INF/encryption.xml')&&/EncryptedData/.test(text('META-INF/encryption.xml')||''))warnings.push(`${label}: DRM이나 글꼴 암호화가 있는 EPUB는 일부 내용이 비어 보일 수 있습니다.`);
  const manifest=new Map(byLocal(opf,'item').map(i=>[i.attribs.id,{path:join(opfPath,i.attribs.href||''),type:i.attribs['media-type']||'',props:i.attribs.properties||''}]));
  const titles=new Map<string,string>();
  // EPUB 3 navigation document first, then the EPUB 2 NCX.
  const nav=[...manifest.values()].find(i=>i.props.split(' ').includes('nav'));const navSource=nav?text(nav.path):null;
  if(nav&&navSource)for(const a of DomUtils.getElementsByTagName('a',parseDocument(navSource))){const target=join(nav.path,a.attribs.href||''),label=DomUtils.textContent(a).trim();if(target&&label&&!titles.has(target))titles.set(target,label.slice(0,300));}
  const ncxId=byLocal(opf,'spine')[0]?.attribs.toc,ncx=ncxId?manifest.get(ncxId):[...manifest.values()].find(i=>i.type==='application/x-dtbncx+xml');const ncxSource=ncx?text(ncx.path):null;
  if(ncx&&ncxSource)for(const point of byLocal(xml(ncxSource,label),'navPoint')){const src=byLocal(point,'content')[0]?.attribs.src,name=DomUtils.textContent(byLocal(point,'text')[0]||[]).trim();if(src&&name){const target=join(ncx.path,src);if(!titles.has(target))titles.set(target,name.slice(0,300));}}
  const bookTitle=DomUtils.textContent(byLocal(opf,'title')[0]||[]).trim().slice(0,300);
  const chapters:EpubChapter[]=[];
  for(const ref of byLocal(opf,'itemref')){
    const item=manifest.get(ref.attribs.idref);if(!item||ref.attribs.linear==='no'||!/x?html/.test(item.type)||item.props.split(' ').includes('nav'))continue;
    const html=text(item.path);if(html===null){warnings.push(`${label}: ${item.path} 파일이 없습니다.`);continue;}
    const doc=parseDocument(html),heading=DomUtils.getElementsByTagName('h1',doc)[0]||DomUtils.getElementsByTagName('h2',doc)[0],docTitle=DomUtils.getElementsByTagName('title',doc)[0];
    const title=titles.get(item.path)||(heading&&DomUtils.textContent(heading).trim())||(docTitle&&DomUtils.textContent(docTitle).trim())||`${chapters.length+1}장`;
    if(!DomUtils.textContent(doc).trim()&&!DomUtils.getElementsByTagName('img',doc).length)continue;
    chapters.push({path:item.path,title:title.slice(0,300),html});
  }
  if(!chapters.length)throw new Error(`${label}: EPUB에서 본문을 찾지 못했습니다.`);
  return {title:bookTitle,chapters,warnings};
}
