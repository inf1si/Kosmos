import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromText,uid,type Workspace } from '../src/lib/model';
import { seedWorkspace } from '../src/lib/seed';
import { chatInputSchema,type ChatMessage } from '../src/lib/ai-conversation';
import { chatContext,ChatContextError } from '../src/lib/ai-chat-context';
import { appendEditorExchange,editorAIIsFull,editorAIMessages } from '../src/lib/editor-ai-conversation';

function fixture(){
  const state=seedWorkspace(),work=state.works[0],doc=work.documents[0];
  doc.content=fromText('짧은 선택\n\n'+'긴 원고'.repeat(4000));
  const input=chatInputSchema.parse({workId:work.id,docId:doc.id,version:doc.updatedAt,provider:'openai',message:'요약',includeManuscript:true,sourceIds:[],history:[],documentRange:{kind:'selection',from:1,to:6,text:'짧은 선택'}});

  return {state,work,doc,input,scope:{workId:work.id,docId:doc.id}};
}

test('긴 집필실 원고·설정·메모의 선택만 전송하고 작품 정보를 유지한다',()=>{
  const {state,work,doc,input}=fixture();

  for(const kind of ['scene','wiki','memo'] as const){doc.kind=kind;const context=chatContext(state,input);assert.equal(context.input.manuscript,'짧은 선택');assert.equal(context.input.work,work.title);assert.equal(context.input.document.kind,kind);assert.equal(context.input.document.scope,'selection');assert.deepEqual(context.input.references,[]);}

  assert.throws(()=>chatContext(state,{...input,documentRange:undefined}),e=>e instanceof ChatContextError&&e.status===413);
  assert.equal(chatContext(state,{...input,documentRange:{kind:'paragraph',from:1,to:1,text:''}}).input.manuscript,'');
});

test('다른 작품의 문서·범위 위조·시점 불일치는 집필실 AI 호출 전에 거절한다',()=>{
  const {state,input}=fixture();

  for(const change of [{...input,version:'stale'},{...input,workId:state.works[1].id},{...input,documentRange:{...input.documentRange!,text:'위조'}},{...input,documentRange:{...input.documentRange!,to:999999}}])assert.throws(()=>chatContext(state,change),e=>e instanceof ChatContextError&&[404,409].includes(e.status));

  for(const change of [{...input,includeManuscript:false},{...input,documentRange:{...input.documentRange!,to:1}},{...input,documentRange:{...input.documentRange!,to:0}},{...input,noteId:input.docId,workId:undefined},{...input,noteRange:input.documentRange}])assert(!chatInputSchema.safeParse(change).success);
});

const answer:Extract<ChatMessage,{role:'assistant'}>={id:uid(),role:'assistant',createdAt:'2026-10-05',provider:'openai',model:'synthetic',version:'test',sources:[],result:{review:'답변',suggestions:[]}};

test('집필실 대화는 원래 문서에만 저장하고 동시 변경·삭제·20회 한도를 막는다',()=>{
  const {state,scope,work,doc}=fixture();const content=structuredClone(doc.content),version=doc.updatedAt;
  const next=appendEditorExchange(state,scope,0,'질문',answer);
  assert.equal(editorAIMessages(next,scope).length,2);assert.equal(editorAIMessages(next,{workId:work.id,docId:work.documents[1].id}).length,0);
  assert.deepEqual(next.works[0].documents[0].content,content);assert.equal(next.works[0].documents[0].updatedAt,version);
  assert.throws(()=>appendEditorExchange(next,scope,0,'다른 창',answer));
  assert.throws(()=>appendEditorExchange({...state,works:[]},scope,0,'삭제된 작품',answer));
  let full:Workspace=next;

for(let i=1;i<20;i++)full=appendEditorExchange(full,scope,i*2,'질문',answer);
  assert(editorAIIsFull(full,scope));assert.throws(()=>appendEditorExchange(full,scope,40,'초과',answer));
});
