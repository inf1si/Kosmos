import { uid,type Workspace } from './model';
import { conversationSchema,type ChatMessage,type EditorAIScope } from './ai-conversation';
import { appendNoteExchange } from './personal-notes';

export function editorAIOrigin(state:Workspace|null|undefined,scope:EditorAIScope){
  if(scope.noteId)return state?.notes?.find(n=>n.id===scope.noteId);
  return state?.works.find(w=>w.id===scope.workId)?.documents.find(d=>d.id===scope.docId);
}
export function editorAIMessages(state:Workspace|null|undefined,scope:EditorAIScope):ChatMessage[]{
  if(scope.noteId)return state?.notes?.find(n=>n.id===scope.noteId)?.aiMessages||[];
  return state?.works.find(w=>w.id===scope.workId)?.aiConversations?.find(c=>c.docId===scope.docId)?.messages||[];
}
export function editorAIIsFull(state:Workspace|null|undefined,scope:EditorAIScope){
  const messages=editorAIMessages(state,scope);
  const count=scope.noteId?(state?.notes||[]).filter(n=>n.aiMessages?.length).length:state?.works.find(w=>w.id===scope.workId)?.aiConversations?.length||0;
  return messages.length>=40||(!messages.length&&count>=200);
}
/** Append to the originating document only; never attach a delayed reply to the active tab. */
export function appendEditorExchange(state:Workspace,scope:EditorAIScope,expectedCount:number,question:string,answer:Extract<ChatMessage,{role:'assistant'}>):Workspace{
  if(scope.noteId)return appendNoteExchange(state,scope.noteId,expectedCount,question,answer);
  const work=state.works.find(w=>w.id===scope.workId);
  if(!work?.documents.some(d=>d.id===scope.docId))throw new Error('대화 중 문서를 찾지 못했습니다.');
  const threads=work.aiConversations||[],thread=threads.find(c=>c.docId===scope.docId);
  if((thread?.messages.length||0)!==expectedCount)throw new Error('다른 창에서 대화가 바뀌었습니다. 다시 보내세요.');
  if(!thread&&threads.length>=200)throw new Error('작품당 대화 200개 한도입니다. 대화를 메모로 보관하고 새 대화를 시작하세요.');
  const next=conversationSchema.parse({docId:scope.docId,messages:[...(thread?.messages||[]),{id:uid(),role:'user',text:question,createdAt:new Date().toISOString()},answer]});
  return {...state,works:state.works.map(w=>w.id===scope.workId?{...w,aiConversations:thread?threads.map(c=>c.docId===scope.docId?next:c):[...threads,next]}:w)};
}
