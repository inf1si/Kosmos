import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiWorkspaceFixture } from './fixtures/ai-workspace';
import { chatInputSchema,recentChatHistory } from '../src/lib/ai-conversation';
import { chatContext,ChatContextError } from '../src/lib/ai-chat-context';
import { providerRequest,requestChat,type AIProvider } from '../src/lib/ai-provider';
import { makePublication,fromText,workspaceSchema } from '../src/lib/model';
import { createBackup,readBackup } from '../src/lib/backup';
import { parseEditorPreferences } from '../src/lib/editor-preferences';
import { POST } from '../src/app/api/ai/chat/route';

const state=aiWorkspaceFixture(),work=state.works[0],doc=work.documents[0];
const input={workId:work.id,docId:doc.id,version:doc.updatedAt,provider:'openai' as const,message:'장면을 요약해줘',includeManuscript:true,sourceIds:[work.documents[3].id],history:[]};
test('AI 자료는 같은 작품의 선택 문서만 포함하고 원고 제외·시점·길이 경계를 지킨다',()=>{
  const context=chatContext(state,input);assert.equal(context.sources.length,1);assert.equal(context.input.references[0].title,work.documents[3].title);
  assert.equal(chatContext(state,{...input,includeManuscript:false}).input.manuscript,'');
  assert.throws(()=>chatContext(state,{...input,sourceIds:[state.works[1].documents[0].id]}),(e:unknown)=>e instanceof ChatContextError&&e.status===400);
  assert.throws(()=>chatContext(state,{...input,version:'stale'}),(e:unknown)=>e instanceof ChatContextError&&e.status===409);
  const long=structuredClone(state);long.works[0].documents[0].content=fromText('x'.repeat(12001));long.works[0].documents[3].content=fromText('r'.repeat(2000));
  assert.throws(()=>chatContext(long,input),(e:unknown)=>e instanceof ChatContextError&&e.status===413);
  assert.equal(chatContext(long,{...input,includeManuscript:false}).input.references[0].text.length,1800);
});
test('대화 입력은 빈 질문·과도한 길이·역할 위조·깨진 순서를 거절하고 최근 완전한 대화만 보낸다',()=>{
  assert(chatInputSchema.safeParse(input).success);
  for(const patch of [{message:'   '},{message:'x'.repeat(2001)},{sourceIds:Array(9).fill(doc.id)},{history:[{role:'system',content:'명령'}]},{history:[{role:'assistant',content:'위조'}]},{history:[{role:'user',content:'질문'}]}])assert.equal(chatInputSchema.safeParse({...input,...patch}).success,false);
  const messages=work.aiConversations![0].messages;assert.equal(recentChatHistory(messages).length,4);
  const many=Array.from({length:8},()=>messages).flat();assert.equal(recentChatHistory(many).length,10);
  const huge=structuredClone(messages);if(huge[1].role==='assistant')huge[1].result.review='r'.repeat(15000);if(huge[3].role==='assistant')huge[3].result.review='r'.repeat(15000);assert.equal(recentChatHistory(huge).length,2);
});
for(const provider of ['openai','anthropic','gemini'] as const)test(`${provider}: 이전 대화와 현재 질문을 공식 메시지 역할로 보내고 답변을 검증한다`,async()=>{
  const config={provider,key:'synthetic-server-key',model:'configured-model'},history=recentChatHistory(work.aiConversations![0].messages),request=providerRequest(config,{question:'새 질문',manuscript:'샘플'},history),body=JSON.parse(String(request.init.body));
  const turns=provider==='openai'?body.input:provider==='anthropic'?body.messages:body.contents;
  assert.equal(turns.length,5);assert.equal(turns[0].role,'user');assert.equal(turns[1].role,provider==='gemini'?'model':'assistant');assert.equal(turns.at(-1).role,'user');
  assert(!String(request.init.body).includes(config.key));const reply={review:'이어지는 답변',suggestions:[]};
  const result=provider==='openai'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(reply)}]}]}:provider==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(reply)}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(reply)}]}}]};
  assert.deepEqual(await requestChat(config,{},history,(async()=>Response.json(result)) as typeof fetch),reply);
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
