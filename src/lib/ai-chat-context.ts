import { plainText, type Workspace } from './model';
import type { ChatInput } from './ai-conversation';
export class ChatContextError extends Error {constructor(message:string,public status:number){super(message);}}
export function chatContext(data:Workspace,input:ChatInput){
  const work=data.works.find(w=>w.id===input.workId),doc=work?.documents.find(d=>d.id===input.docId);
  if(!work||!doc)throw new ChatContextError('문서를 찾지 못했습니다.',404);
  if(doc.updatedAt!==input.version)throw new ChatContextError('서버 저장본이 다릅니다. 동기화를 마친 뒤 다시 보내세요.',409);
  const text=input.includeManuscript?plainText(doc.content):'';
  if(text.length>12000)throw new ChatContextError('현재 원고는 12,000자까지 보낼 수 있습니다. 원고 포함을 끄거나 장면을 나누세요.',413);
  const ids=[...new Set(input.sourceIds)];const sources=ids.map(id=>work.documents.find(d=>d.id===id));
  if(sources.some(d=>!d))throw new ChatContextError('같은 작품의 자료만 선택할 수 있습니다.',400);
  return {input:{work:work.title,form:work.form,title:doc.title,document:{kind:doc.kind,chapter:doc.chapter,pov:doc.pov,storyTime:doc.storyTime},manuscript:text,references:sources.map(d=>({id:d!.id,title:d!.title,kind:d!.kind,category:d!.category,chapter:d!.chapter,pov:d!.pov,storyTime:d!.storyTime,text:plainText(d!.content).slice(0,1800),truncated:plainText(d!.content).length>1800})),question:input.message},sources:sources.map(d=>({id:d!.id,title:d!.title})),version:doc.updatedAt};
}
