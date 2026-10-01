import { z } from 'zod';
import type { RichNode } from './model';
export const reviewSchema=z.object({review:z.string().max(15000),suggestions:z.array(z.object({quote:z.string().min(1).max(2000),replacement:z.string().max(3000),reason:z.string().max(2000)})).max(5)});
export type Review=z.infer<typeof reviewSchema>;
export function applySuggestion(content:RichNode,quote:string,replacement:string):RichNode{
  if(!quote)throw new Error('비어 있는 수정 제안입니다.');
  let matches=0;const copy=structuredClone(content);
  const count=(n:RichNode)=>{if(n.type==='text'){let pos=0;for(;;){const at=(n.text||'').indexOf(quote,pos);if(at<0)break;matches++;pos=at+quote.length;}}n.content?.forEach(count);};count(copy);
  if(matches!==1)throw new Error('인용한 문장이 하나의 위치에서 확인되지 않습니다. 원고를 직접 비교하세요.');
  const replace=(n:RichNode)=>{if(n.type==='text'&&n.text?.includes(quote))n.text=n.text.replace(quote,()=>replacement);n.content?.forEach(replace);};replace(copy);return copy;
}
