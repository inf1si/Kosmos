import { parseDocument, DomUtils } from 'htmlparser2';
import { XMLValidator } from 'fast-xml-parser';

type XmlNode=ReturnType<typeof parseDocument>['children'][number];

type XmlElement=XmlNode & {name:string;attribs:Record<string,string>;children:XmlNode[]};

/** One binder item. `place` is the item's position in the binder (ids joined by `/`) so sub-documents nest under their parent. */
export type ScrivenerItem={id:string;title:string;place:string;content?:string;synopsis?:string;image?:string;type:string};

const isElement=(n:XmlNode):n is XmlElement=>'name' in n&&'attribs' in n;

const kids=(n:XmlNode|undefined,name:string):XmlElement[]=>n&&'children' in n?n.children.filter((c):c is XmlElement=>isElement(c)&&c.name===name):[];

/**
 * Scrivener 2/3 project (.scriv folder, picked as a folder or zipped): the binder order and titles from the .scrivx file,
 * text from Files/Data/<UUID>/content.rtf (Scrivener 3) or Files/Docs/<ID>.rtf (Scrivener 2). The trash is skipped.
 */
type ScrivenerResult={items:ScrivenerItem[];warnings:string[]};

export function readScrivener(scrivx:string,source:string,files:Map<string,Uint8Array>):ScrivenerResult{
  if(source.length>20*1024*1024)throw new Error(`${scrivx}: 스크리브너 프로젝트 정보가 너무 큽니다.`);

  if(/<!ENTITY/i.test(source)||/<!DOCTYPE[^>]*\[/i.test(source))throw new Error('XML 내부 엔티티 선언은 지원하지 않습니다.');

  if(XMLValidator.validate(source)!==true)throw new Error(`${scrivx}: 스크리브너 프로젝트 정보(.scrivx)가 손상되었습니다.`);
  const root=scrivx.includes('/')?scrivx.slice(0,scrivx.lastIndexOf('/')+1):'',doc=parseDocument(source,{xmlMode:true});
  const binder=DomUtils.findOne(e=>e.name==='Binder',doc.children);

if(!binder)throw new Error(`${scrivx}: 스크리브너 바인더를 찾지 못했습니다.`);
  const items:ScrivenerItem[]=[],warnings:string[]=[];let count=0;

  const text=(path:string)=>{const b=files.get(path);

if(!b)return undefined;

try{return new TextDecoder('utf-8',{fatal:true}).decode(b).trim();}catch{return undefined;}};

  const visit=(item:XmlElement,parent:string,depth:number)=>{
    if(++count>5000||depth>20)throw new Error(`${scrivx}: 바인더 항목이 너무 많거나 깊습니다.`);
    const type=item.attribs.Type||'Text';

if(type==='TrashFolder')return;
    const id=item.attribs.UUID||item.attribs.ID||String(count),title=(DomUtils.textContent(kids(item,'Title')[0]||[]).trim()||'제목 없음').slice(0,300),place=`${parent}/${id}`;
    const v3=`${root}Files/Data/${id}/`,v2=`${root}Files/Docs/${id}`;
    const content=[`${v3}content.rtf`,`${v2}.rtf`].find(p=>files.has(p));
    const image=[...files.keys()].find(p=>p.startsWith(`${v3}content.`)&&/\.(png|jpe?g|webp)$/i.test(p)||p.startsWith(`${v2}.`)&&/\.(png|jpe?g|webp)$/i.test(p));

    if(!content&&!image&&['PDF','WebArchive','Media','Image'].includes(type))warnings.push(`${title}: 스크리브너의 ${type} 자료는 가져오지 않습니다. 원본 프로젝트를 보관하세요.`);
    items.push({id,title,place,content,image,synopsis:text(`${v3}synopsis.txt`)||text(`${v2}_synopsis.txt`),type});

    for(const children of kids(item,'Children'))for(const c of kids(children,'BinderItem'))visit(c,place,depth+1);
  };

  for(const item of kids(binder,'BinderItem'))visit(item,root.replace(/\/$/,'')||'project',0);

  if(!items.length)throw new Error(`${scrivx}: 가져올 바인더 항목이 없습니다.`);

  return {items,warnings};
}
