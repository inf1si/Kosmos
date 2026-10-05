import type { RichNode, NovelDocument } from './model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const countMetrics=[
  {id:'charactersWithSpaces',label:'글자 수 · 공백 포함',unit:'자',suffix:'공백 포함'},
  {id:'charactersWithoutSpaces',label:'글자 수 · 공백 제외',unit:'자',suffix:'공백 제외'},
  {id:'words',label:'단어 수 (어절)',unit:'단어',suffix:'어절 기준'},
  {id:'paragraphs',label:'문단 수',unit:'문단',suffix:''},
  {id:'sheets',label:'200자 원고지 환산',unit:'매',suffix:'200자 환산'},
] as const;
export type CountMetric=typeof countMetrics[number]['id'];
export type TextStatistics={charactersWithoutSpaces:number;charactersWithSpaces:number;words:number;paragraphs:number;footnotes:number;sheets:number};
const segmenter=new Intl.Segmenter('ko',{granularity:'grapheme'});
const cache=new WeakMap<RichNode,TextStatistics>();
const containers=new Set(['doc','blockquote','bulletList','orderedList','listItem','table','tableRow','tableCell','tableHeader']);

/** Keep ancestor blocks so a partial selection still counts its selected paragraphs. */
export function statisticsSelection(doc:ProseMirrorNode,from:number,to:number):RichNode|null{
  return from===to?null:{type:'doc',content:doc.slice(from,to,true).content.toJSON() as RichNode[]};
}

/** Preserve block and hard-break boundaries; footnote text and its marker are separate from the body. */
export function statisticsText(node:RichNode):string{
  if(node.type==='footnote'||node.type==='horizontalRule')return '';
  if(node.type==='text')return node.text||'';
  if(node.type==='hardBreak')return '\n';
  return (node.content||[]).map(statisticsText).join(containers.has(node.type)?'\n':'');
}
function characters(text:string){let count=0;for(const _ of segmenter.segment(text))count++;return count;}
export function textStatistics(content:RichNode):TextStatistics{
  const existing=cache.get(content);if(existing)return existing;
  const text=statisticsText(content),charactersWithSpaces=characters(text.replace(/[\r\n]/gu,''));
  let paragraphs=0,footnotes=0;
  function visit(node:RichNode){
    if(node.type==='footnote'){footnotes++;return;}
    if(node.type==='paragraph'&&statisticsText(node).trim())paragraphs++;
    node.content?.forEach(visit);
  }
  visit(content);
  const value={charactersWithoutSpaces:characters(text.replace(/\s/gu,'')),charactersWithSpaces,
    words:text.split(/\s+/u).filter(token=>/[\p{L}\p{N}]/u.test(token)).length,paragraphs,footnotes,sheets:Math.ceil(charactersWithSpaces/200)};
  // Content is replaced immutably by the editor and workspace operations. Unchanged chapters cost no recount.
  cache.set(content,value);return value;
}
export function manuscriptStatistics(documents:NovelDocument[]):TextStatistics{
  const total:TextStatistics={charactersWithoutSpaces:0,charactersWithSpaces:0,words:0,paragraphs:0,footnotes:0,sheets:0};
  for(const doc of documents){if(doc.kind!=='scene')continue;const stats=textStatistics(doc.content);
    for(const key of ['charactersWithoutSpaces','charactersWithSpaces','words','paragraphs','footnotes'] as const)total[key]+=stats[key];
  }
  total.sheets=Math.ceil(total.charactersWithSpaces/200);return total;
}
