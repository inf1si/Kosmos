import type { RichNode, NovelDocument } from './model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const countMetrics=[
  {id:'charactersWithSpaces',label:'글자 수 · 공백 포함',unit:'자',suffix:'공백 포함'},
  {id:'charactersWithoutSpaces',label:'글자 수 · 공백 제외',unit:'자',suffix:'공백 제외'},
  {id:'words',label:'단어 수 (어절)',unit:'단어',suffix:'어절 기준'},
  {id:'paragraphs',label:'문단 수',unit:'문단',suffix:''},
  {id:'sheets',label:'200자 원고지 환산',unit:'매',suffix:'200자 환산'},
  {id:'a4',label:'A4 · 10pt 160%',unit:'매',suffix:'A4'},
] as const;

export type CountMetric=typeof countMetrics[number]['id'];

export type TextStatistics={charactersWithoutSpaces:number;charactersWithSpaces:number;words:number;paragraphs:number;footnotes:number;sheets:number;a4Lines:number;a4:number};

const segmenter=new Intl.Segmenter('ko',{granularity:'grapheme'});

const cache=new WeakMap<RichNode,TextStatistics>();

// 한글 프로그램 기본 A4 쪽(여백 위 20·아래 15·좌우 30·머리말 15·꼬리말 15mm), 10pt, 줄간격 160%:
// 본문 150mm × 232mm라서 한 줄 42자(10pt 전각), 한 쪽 41줄(16pt 간격).
const a4LineWidth=42,a4PageLines=41;

const fullWidth=/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}\u3000-\u303F\uFF00-\uFFEF]/u;

/** Lines a text block fills on the A4 page: Hangul and other full-width letters take one column, the rest half. */
function a4Lines(text:string){
  return text.split('\n').reduce((lines,line)=>{let width=0;

    for(const {segment} of segmenter.segment(line))width+=fullWidth.test(segment)?1:.5;

    return lines+Math.max(1,Math.ceil(width/a4LineWidth));},0);
}

const a4Pages=(lines:number)=>Math.ceil(lines/a4PageLines*10)/10;

const containers=new Set(['doc','blockquote','bulletList','orderedList','listItem','table','tableRow','tableCell','tableHeader']);

/** Keep ancestor blocks so a partial selection still counts its selected paragraphs. */
export function statisticsSelection(doc:ProseMirrorNode,from:number,to:number):RichNode|null{
  return from===to?null:{type:'doc',content:doc.slice(from,to,true).content.toJSON()};
}

/** Preserve block and hard-break boundaries; footnote text and its marker are separate from the body. */
export function statisticsText(node:RichNode):string{
  if(node.type==='footnote'||node.type==='horizontalRule')return '';

  if(node.type==='text')return node.text||'';

  if(node.type==='hardBreak')return '\n';

  return (node.content||[]).map(statisticsText).join(containers.has(node.type)?'\n':'');
}

function characters(text:string){let count=0;

for(const _ of segmenter.segment(text))count++;

return count;}

export function textStatistics(content:RichNode):TextStatistics{
  const existing=cache.get(content);

if(existing)return existing;
  const text=statisticsText(content),charactersWithSpaces=characters(text.replace(/[\r\n]/gu,''));
  let paragraphs=0,footnotes=0,lines=0;

  function visit(node:RichNode){
    if(node.type==='footnote'){footnotes++;

return;}

    if(node.type==='paragraph'&&statisticsText(node).trim())paragraphs++;

    // Footnote text sits inside the paragraph but statisticsText leaves it out, so only body lines count.
    if(node.type==='paragraph'||node.type==='heading'||node.type==='codeBlock')lines+=a4Lines(statisticsText(node));
    node.content?.forEach(visit);
  }

  visit(content);

  const value={charactersWithoutSpaces:characters(text.replace(/\s/gu,'')),charactersWithSpaces,
    words:text.split(/\s+/u).filter(token=>/[\p{L}\p{N}]/u.test(token)).length,paragraphs,footnotes,sheets:Math.ceil(charactersWithSpaces/200),a4Lines:lines,a4:charactersWithSpaces?a4Pages(lines):0};

  // Content is replaced immutably by the editor and workspace operations. Unchanged chapters cost no recount.
  cache.set(content,value);

return value;
}

export function manuscriptStatistics(documents:NovelDocument[]):TextStatistics{
  const total:TextStatistics={charactersWithoutSpaces:0,charactersWithSpaces:0,words:0,paragraphs:0,footnotes:0,sheets:0,a4Lines:0,a4:0};

  for(const doc of documents){if(doc.kind!=='scene')continue;const stats=textStatistics(doc.content);

    for(const key of ['charactersWithoutSpaces','charactersWithSpaces','words','paragraphs','footnotes','a4Lines'] as const)total[key]+=stats[key];
  }

  total.sheets=Math.ceil(total.charactersWithSpaces/200);
  total.a4=total.charactersWithSpaces?a4Pages(total.a4Lines):0;

return total;
}
