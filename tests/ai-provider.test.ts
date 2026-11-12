import { test } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { providerConfig,vertexModelIdSchema } from '../src/lib/ai-provider';
import { requestChat,requestReview } from '../src/lib/ai-vertex';
import { readLimitedJson,BodyLimitError } from '../src/lib/http';
import { vertexTestAuth,vertexTestConfig,vertexReviewResponse,vertexTestEnvironment } from './fixtures/vertex';

const review={review:'문체를 유지하세요.',suggestions:[{quote:'안녕',replacement:'안녕하세요',reason:'호흡 조정'}]};

for(const provider of ['gemini','anthropic'] as const)test(`Vertex ${provider}: OAuth 인증·프로젝트 경로·대화·구조화 응답`,async()=>{
  const config=vertexTestConfig(provider),requests:{url:string;body:any}[]=[],mock:typeof fetch=async(input,init)=>{
    const request=new Request(input,init),body=await request.json();requests.push({url:request.url,body});
    assert.equal(new URL(request.url).hostname,'aiplatform.googleapis.com');assert(request.url.includes('/projects/orbiter-ai/locations/global/publishers/'));assert(request.url.includes(provider==='gemini'?'/google/':'/anthropic/'));assert.equal(request.headers.get('authorization'),'Bearer synthetic-vertex');assert(!JSON.stringify(body).includes('synthetic-vertex'));

    return Response.json(vertexReviewResponse(provider,review));
  };

  const options={googleAuthOptions:vertexTestAuth()};
  assert.deepEqual(await requestReview(config,{manuscript:'안녕'},mock,options),review);
  assert.deepEqual(await requestChat(config,{question:'새 질문'},[{role:'user',content:'이전 질문'},{role:'assistant',content:'이전 답변'}],mock,'고유 지침',options),review);
  const body=requests.at(-1)!.body,turns=provider==='gemini'?body.contents:body.messages;assert.equal(turns.length,3);assert.equal(turns[1].role,provider==='gemini'?'model':'assistant');assert(JSON.stringify(body).includes('고유 지침'));
  assert.equal(provider==='gemini'?body.generationConfig.maxOutputTokens:body.max_tokens,2200);
  await assert.rejects(()=>requestReview(config,{},async()=>new Response('invalid permission',{status:403}),options),/Vertex AI/);
  await assert.rejects(()=>requestReview(config,{},async()=>Response.json(vertexReviewResponse(provider,{...review,suggestions:Array(6).fill(review.suggestions[0])})),options),/Vertex AI/);
});

test('Vertex Claude JSON 도구 출력과 중단 응답을 구분한다',async()=>{
  const config=vertexTestConfig('anthropic'),options={googleAuthOptions:vertexTestAuth()},result=vertexReviewResponse('anthropic',review);
  assert.deepEqual(await requestReview(config,{},async()=>Response.json({...result,content:[{type:'tool_use',id:'json-output',name:'json',input:review}],stop_reason:'tool_use'}),options),review);

  for(const provider of ['gemini','anthropic'] as const){
    const body=vertexReviewResponse(provider,review),truncated=provider==='gemini'?{...body,candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(review)}]}}]}:{...body,stop_reason:'max_tokens'};
    await assert.rejects(()=>requestReview(vertexTestConfig(provider),{},async()=>Response.json(truncated),options),/Vertex AI/);
  }
});

test('Vertex 설정만 허용하고 모델 ID로 경로·인증을 바꿀 수 없다',()=>{
  assert.equal(providerConfig('gemini',{}),null);assert.equal(providerConfig('openai',{...vertexTestEnvironment,AI_API_KEY:'legacy',AI_MODEL:'old'}),null);
  assert.equal(providerConfig('gemini',vertexTestEnvironment)?.project,'orbiter-ai');assert.equal(providerConfig('anthropic',vertexTestEnvironment)?.model,'claude-test@20260101');

  for(const model of ['../secret','projects/x/models/y','https://evil.invalid','a?key=secret','a..b'])assert(!vertexModelIdSchema.safeParse(model).success);
  assert.equal(providerConfig('gemini',{...vertexTestEnvironment,VERTEX_AUTH_MODE:'unknown'}),null);
});

test('Content-Length가 없어도 스트림 본문 크기를 제한한다',async()=>{
  const source=()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('"'+ 'x'.repeat(1000)+'"'));c.close();}}));await assert.rejects(()=>readLimitedJson(source(),100),BodyLimitError);assert.equal(z.string().parse(await readLimitedJson(source(),2000)).length,1000);
});

test('JSON 경계는 비유한 수를 거절하고 정상 JSON 값은 보존한다',async()=>{
  await assert.rejects(()=>readLimitedJson(new Response('{"value":1e400}'),1024),SyntaxError);
  assert.deepEqual(await readLimitedJson(new Response('{"value":[null,true,3,"한글"]}'),1024),{value:[null,true,3,'한글']});
});
