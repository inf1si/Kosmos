import { test } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { providerConfig,providerRequest,parseProviderResult,requestReview,type AIProvider } from '../src/lib/ai-provider';
import { readLimitedJson,BodyLimitError } from '../src/lib/http';

const review={review:'문체를 유지하세요.',suggestions:[{quote:'안녕',replacement:'안녕하세요',reason:'호흡 조정'}]};

const resultFor=(provider:AIProvider)=>provider==='openai'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(review)}]}]}:provider==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(review)}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:'내부 추론',thought:true},{text:JSON.stringify(review)}]}}]};

for(const provider of ['openai','anthropic','gemini'] as const)test(`${provider}: 공식 요청 형식·서버 키·완료 응답·제안 검증`,async()=>{
  const config={provider,key:'server-key',model:'configured-model'},request=providerRequest(config,{manuscript:'안녕'});const body=JSON.parse(String(request.init.body));assert(request.url.startsWith('https://'));assert(!request.url.includes(config.key));assert(!String(request.init.body).includes(config.key));

  if(provider==='openai'){assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.max_output_tokens,2200);}else if(provider==='anthropic'){assert.equal(body.output_config.format.type,'json_schema');assert.equal(body.max_tokens,2200);}else{assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.maxOutputTokens,2200);}

  assert.deepEqual(parseProviderResult(provider,resultFor(provider)),review);const mock=async()=>Response.json(resultFor(provider));assert.deepEqual(await requestReview(config,{manuscript:'안녕'},mock),review);
  await assert.rejects(()=>requestReview(config,{},(async()=>new Response('invalid key',{status:401}))),/제공자/);
});

test('AI 중단·거부·빈 응답·과도한 제안을 거절하고 미설정 제공자를 비활성화한다',()=>{
  assert.throws(()=>parseProviderResult('openai',{status:'incomplete',output:[]}));assert.throws(()=>parseProviderResult('anthropic',{stop_reason:'refusal',content:[]}));assert.throws(()=>parseProviderResult('gemini',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[]}}]}));assert.throws(()=>parseProviderResult('gemini',{candidates:[]}));
  assert.throws(()=>parseProviderResult('anthropic',{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({...review,suggestions:Array(6).fill(review.suggestions[0])})}]}));
  assert.equal(providerConfig('gemini',{}),null);assert.deepEqual(providerConfig('openai',{AI_API_KEY:'legacy',AI_MODEL:'legacy-model'}),{provider:'openai',key:'legacy',model:'legacy-model'});
});

test('Content-Length가 없어도 스트림 본문 크기를 제한한다',async()=>{
  const source=()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('"'+ 'x'.repeat(1000)+'"'));c.close();}}));await assert.rejects(()=>readLimitedJson(source(),100),BodyLimitError);assert.equal(z.string().parse(await readLimitedJson(source(),2000)).length,1000);
});

test('JSON 경계는 비유한 수를 거절하고 정상 JSON 값은 보존한다',async()=>{
  await assert.rejects(()=>readLimitedJson(new Response('{"value":1e400}'),1024),SyntaxError);
  assert.deepEqual(await readLimitedJson(new Response('{"value":[null,true,3,"한글"]}'),1024),{value:[null,true,3,'한글']});
});
