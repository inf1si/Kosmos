import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchAgentWeb } from '../src/lib/agent-web';
import { vertexTestEnvironment } from './fixtures/vertex';

test('웹 조사 인증 실패는 전송 라이브러리의 상세 오류를 작업 기록으로 보내지 않는다',async()=>{
  const previous=Object.fromEntries(Object.keys(vertexTestEnvironment).map(key=>[key,process.env[key]])),fetcher=globalThis.fetch;
  Object.assign(process.env,vertexTestEnvironment);let requests=0;
  globalThis.fetch=async input=>{assert.equal(String(input),'https://oidc.vercel.com/~token');requests++;

    return Response.json({error:'synthetic-private-auth-detail'},{status:403});};

  try{
    await assert.rejects(()=>researchAgentWeb('합성 검색'),error=>error instanceof Error&&error.message==='Vertex AI 웹 조사를 완료하지 못했습니다. 모델·접근 권한·할당량을 확인하세요.'&&!('cause' in error));assert.equal(requests,1);
  }finally{globalThis.fetch=fetcher;

for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
