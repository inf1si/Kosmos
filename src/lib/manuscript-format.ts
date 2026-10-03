/** Only bounded numeric formatting reaches HTML, the reader or the editor. */
export function formatNumber(value:unknown,min:number,max:number):number|undefined{
  return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:undefined;
}
export function paragraphStyle(attrs:Record<string,unknown>={}){
  const lineHeight=formatNumber(attrs.lineHeight,1,3),indent=formatNumber(attrs.indent,0,8),firstLineIndent=formatNumber(attrs.firstLineIndent,0,4),spaceBefore=formatNumber(attrs.spaceBefore,0,48),spaceAfter=formatNumber(attrs.spaceAfter,0,48);
  const textAlign=['left','center','right','justify'].includes(String(attrs.textAlign))?attrs.textAlign as 'left'|'center'|'right'|'justify':undefined;
  return {textAlign,lineHeight,marginInlineStart:indent===undefined?undefined:`${indent*1.5}em`,textIndent:firstLineIndent===undefined?undefined:`${firstLineIndent}em`,marginTop:spaceBefore===undefined?undefined:`${spaceBefore}px`,marginBottom:spaceAfter===undefined?undefined:`${spaceAfter}px`};
}
export function paragraphCss(attrs:Record<string,unknown>={}){
  const names:Record<string,string>={textAlign:'text-align',lineHeight:'line-height',marginInlineStart:'margin-inline-start',textIndent:'text-indent',marginTop:'margin-top',marginBottom:'margin-bottom'};
  return Object.entries(paragraphStyle(attrs)).filter(([,v])=>v!==undefined).map(([k,v])=>`${names[k]}:${v}`).join(';');
}
export function htmlParagraphAttrs(style:string):Record<string,unknown>{
  const attrs:Record<string,unknown>={};const declarations=new Map(style.split(';').map(s=>s.trim().split(':').map(v=>v.trim().toLowerCase())).filter(v=>v.length===2).map(v=>[v[0],v[1]]));
  const numeric=(css:string,key:string,min:number,max:number,suffix='',scale=1)=>{const s=declarations.get(css);if(s===undefined||!(suffix?new RegExp(`^\\d+(?:\\.\\d+)?${suffix}$`):/^\d+(?:\.\d+)?$/).test(s))return;const v=formatNumber(Number(s.replace(suffix,''))/scale,min,max);if(v!==undefined)attrs[key]=v;};
  numeric('line-height','lineHeight',1,3);numeric('margin-inline-start','indent',0,8,'em',1.5);numeric('text-indent','firstLineIndent',0,4,'em');numeric('margin-top','spaceBefore',0,48,'px');numeric('margin-bottom','spaceAfter',0,48,'px');
  const align=declarations.get('text-align');if(align&&['left','center','right','justify'].includes(align))attrs.textAlign=align;return attrs;
}
/** A size set on selected text: 10–72px in 0.5px steps, the same range as the manuscript size. */
export function inlineFontSize(value:unknown):number|undefined{
  return typeof value==='number'&&Number.isFinite(value)&&value>=10&&value<=72&&Number.isInteger(value*2)?value:undefined;
}
export const bulletListStyles=[{id:'disc',label:'점',marker:'•'},{id:'circle',label:'빈 원',marker:'◦'},{id:'square',label:'네모',marker:'▪'}] as const;
export const orderedListStyles=[{id:'decimal',label:'숫자',marker:'1.'},{id:'hangul',label:'가나다',marker:'가.'},{id:'hangul-consonant',label:'ㄱㄴㄷ',marker:'ㄱ.'},{id:'lower-alpha',label:'소문자',marker:'a.'},{id:'upper-alpha',label:'대문자',marker:'A.'},{id:'lower-roman',label:'로마자',marker:'i.'}] as const;
const listStyles=(type:string):readonly {id:string}[]=>type==='bulletList'?bulletListStyles:type==='orderedList'?orderedListStyles:[];
/** null means the default marker (점, 숫자). */
export function validListStyle(type:string,value:unknown){return value===null||value===undefined||listStyles(type).some(s=>s.id===value);}
const htmlOrderedTypes:Record<string,string>={'1':'decimal',a:'lower-alpha',A:'upper-alpha',i:'lower-roman',I:'upper-roman'};
/** The marker a list shows. Pasted numbered lists may carry only the HTML type attribute (a, A, i, I). */
export function listStyleType(node:{type:string;attrs?:Record<string,unknown>}):string|undefined{
  const own=listStyles(node.type).find(s=>s.id===node.attrs?.listStyle)?.id;if(own)return own;
  if(node.type==='orderedList'&&typeof node.attrs?.type==='string')return htmlOrderedTypes[node.attrs.type];
}
export function cellSpan(value:unknown){return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=40?value:1;}
export function tableColumns(row?:{content?:{attrs?:Record<string,unknown>}[]}){
  return (row?.content||[]).flatMap(cell=>Array.from({length:cellSpan(cell.attrs?.colspan)},(_,i)=>{
    const widths=cell.attrs?.colwidth;return Array.isArray(widths)?formatNumber(widths[i],1,2000):undefined;
  }));
}
