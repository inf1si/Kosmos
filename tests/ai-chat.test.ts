import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiWorkspaceFixture } from './fixtures/ai-workspace';
import { chatInputSchema,recentChatHistory } from '../src/lib/ai-conversation';
import { chatContext,ChatContextError } from '../src/lib/ai-chat-context';
import { providerMessageContext } from '../src/lib/ai-request-context';
import { makePublication,fromText,workspaceSchema } from '../src/lib/model';
import { createBackup,readBackup } from '../src/lib/backup';
import { parseEditorPreferences } from '../src/lib/editor-preferences';
import { POST } from '../src/app/api/ai/chat/route';

const state=aiWorkspaceFixture(),work=state.works[0],doc=work.documents[0];

const input={workId:work.id,docId:doc.id,version:doc.updatedAt,provider:'openai' as const,message:'장면을 요약해줘',includeManuscript:true,sourceIds:[work.documents[3].id],history:[]};

test('AI 자료는 같은 작품의 선택 문서만 포함하고 원고 제외·시점·길이 경계를 지킨다',()=>{
  const context=chatContext(state,input);assert.equal(context.sources.length,1);assert.equal(context.input.references[0].title,work.documents[3].title);
  assert.equal(chatContext(state,{...input,includeManuscript:false}).input.manuscript,'');
  assert.throws(()=>chatContext(state,{...input,sourceIds:[state.works[1].documents[0].id]}),e=>e instanceof ChatContextError&&e.status===400);
  assert.throws(()=>chatContext(state,{...input,version:'stale'}),e=>e instanceof ChatContextError&&e.status===409);
  const long=structuredClone(state);long.works[0].documents[0].content=fromText('x'.repeat(12001));long.works[0].documents[3].content=fromText('r'.repeat(2000));
  assert.equal(chatContext(long,input).input.manuscript.length,12001);
  assert.equal(chatContext(long,{...input,includeManuscript:false}).input.references[0].text.length,2000);
});

test('대화 입력은 긴 질문·전체 대화를 허용하고 빈 질문·역할 위조·깨진 순서를 거절한다',()=>{
  assert(chatInputSchema.safeParse(input).success);

  for(const patch of [{message:'   '},{history:[{role:'system',content:'명령'}]},{history:[{role:'assistant',content:'위조'}]},{history:[{role:'user',content:'질문'}]}])assert.equal(chatInputSchema.safeParse({...input,...patch}).success,false);
  assert(chatInputSchema.safeParse({...input,message:'가'.repeat(20001),sourceIds:Array(9).fill(doc.id)}).success);
  const messages=work.aiConversations![0].messages;assert.equal(recentChatHistory(messages).length,4);
  const many=Array.from({length:8},()=>messages).flat();assert.equal(recentChatHistory(many).length,many.length);
  const huge=structuredClone(messages);

if(huge[1].role==='assistant')huge[1].result.review='r'.repeat(15000);

if(huge[3].role==='assistant')huge[3].result.review='r'.repeat(15000);assert.equal(recentChatHistory(huge).length,4);
});

test('이전 대화와 현재 질문을 메시지 역할로 보존한다',()=>{
  const history=recentChatHistory(work.aiConversations![0].messages),context=providerMessageContext({question:'새 질문',manuscript:'샘플'},history);
  assert.equal(context.messages.length,5);assert.equal(context.messages[0].role,'user');assert.equal(context.messages[1].role,'assistant');assert.equal(context.messages.at(-1)?.role,'user');
  assert.equal(JSON.parse(context.messages.at(-1)!.content).question,'새 질문');
});

test('대화는 전체 ZIP 왕복에 남고 공개 판본에서는 빠지며 이전 작업 공간도 계속 열린다',async()=>{
  const archive=await createBackup(state,[],[]),restored=await readBackup(archive);assert.deepEqual(restored.data.works[0].aiConversations,work.aiConversations);
  const old=structuredClone(state);delete old.works[0].aiConversations;assert(workspaceSchema.safeParse(old).success);
  assert(!JSON.stringify(makePublication(work,[doc.id])).includes('합성 테스트 답변'));
  const malformed=structuredClone(state);malformed.works[0].aiConversations!.push(malformed.works[0].aiConversations![0]);assert.equal(workspaceSchema.safeParse(malformed).success,false);
});

test('AI 채팅은 인증 없이 호출할 수 없고 글꼴 설정이 손상되어도 기본값으로 열린다',async()=>{
  const response=await POST(new Request('http://localhost/api/ai/chat',{method:'POST',body:JSON.stringify(input)}));assert.equal(response.status,401);
  assert.deepEqual(parseEditorPreferences('{broken'),{font:'gowun',size:18,countMetric:'charactersWithSpaces'});
  assert.deepEqual(parseEditorPreferences('{"font":"untrusted-css","size":999}'),{font:'gowun',size:18,countMetric:'charactersWithSpaces'});
  assert.deepEqual(parseEditorPreferences('{"font":"nanum-myeongjo","size":22}'),{font:'nanum-myeongjo',size:22,countMetric:'charactersWithSpaces'});
});
