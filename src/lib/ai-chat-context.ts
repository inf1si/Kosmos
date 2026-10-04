import { plainText, type Workspace } from './model';
import { noteAISources, noteTitle } from './personal-notes';
import type { ChatInput } from './ai-conversation';
import { noteRangeText } from './note-editor-target';
export class ChatContextError extends Error {constructor(message:string,public status:number){super(message);}}
export function chatContext(data:Workspace,input:ChatInput){
  if(input.noteId)return noteChatContext(data,input);
  const work=data.works.find(w=>w.id===input.workId),doc=work?.documents.find(d=>d.id===input.docId);
  if(!work||!doc)throw new ChatContextError('문서를 찾지 못했습니다.',404);
  if(doc.updatedAt!==input.version)throw new ChatContextError('서버 저장본이 다릅니다. 동기화를 마친 뒤 다시 보내세요.',409);
  const text=input.includeManuscript?plainText(doc.content):'';
  if(text.length>12000)throw new ChatContextError('현재 원고는 12,000자까지 보낼 수 있습니다. 원고 포함을 끄거나 장면을 나누세요.',413);
  const ids=[...new Set(input.sourceIds)];const sources=ids.map(id=>work.documents.find(d=>d.id===id));
  if(sources.some(d=>!d))throw new ChatContextError('같은 작품의 자료만 선택할 수 있습니다.',400);
  return {input:{work:work.title,form:work.form,title:doc.title,document:{kind:doc.kind,chapter:doc.chapter,pov:doc.pov,storyTime:doc.storyTime},manuscript:text,references:sources.map(d=>({id:d!.id,title:d!.title,kind:d!.kind,category:d!.category,chapter:d!.chapter,pov:d!.pov,storyTime:d!.storyTime,text:plainText(d!.content).slice(0,1800),truncated:plainText(d!.content).length>1800})),question:input.message},sources:sources.map(d=>({id:d!.id,title:d!.title})),version:doc.updatedAt};
}

function noteChatContext(data:Workspace,input:ChatInput){
  const note=data.notes?.find(n=>n.id===input.noteId);if(!note)throw new ChatContextError('노트를 찾지 못했습니다.',404);
  if(note.updatedAt!==input.version)throw new ChatContextError('서버 저장본이 다릅니다. 동기화를 마친 뒤 다시 보내세요.',409);
  let text=input.includeManuscript?plainText(note.content):'';
  if(input.noteRange){
    try{text=noteRangeText(note.content,input.noteRange.from,input.noteRange.to);}catch{throw new ChatContextError('선택 범위가 저장한 노트와 다릅니다. 다시 선택하세요.',409);}
    if(text!==input.noteRange.text)throw new ChatContextError('선택한 글이 저장본과 다릅니다. 다시 선택하세요.',409);
  }
  if(text.length>12000)throw new ChatContextError('현재 노트는 12,000자까지 보낼 수 있습니다. 노트 포함을 끄거나 나누세요.',413);
  const available=noteAISources(data,note.id),sources=[...new Set(input.sourceIds)].map(id=>available.find(d=>d.id===id));
  if(sources.some(d=>!d))throw new ChatContextError('다른 노트 또는 연결한 작품의 자료만 선택할 수 있습니다.',400);
  const noteIds=new Set((data.notes||[]).map(n=>n.id));
  return {input:{work:'',form:'개인 노트',title:noteTitle(note),document:{kind:'note',chapter:'',pov:'',storyTime:'',tags:note.tags,box:note.box,...(input.noteRange?{scope:input.noteRange.kind}:{})},manuscript:text,references:sources.map(d=>({id:d!.id,title:d!.title,kind:noteIds.has(d!.id)?'note':d!.kind,category:d!.category,text:plainText(d!.content).slice(0,1800),truncated:plainText(d!.content).length>1800})),question:input.message},sources:sources.map(d=>({id:d!.id,title:d!.title})),version:note.updatedAt};
}
