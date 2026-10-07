import { test } from 'node:test';
import type { JsonValue } from '../src/lib/json-value';
import assert from 'node:assert/strict';
import { AI_CREDENTIAL_TTL,credentialCookieName,credentialStorageAvailable,openCredential,providerSettingsStatus,requestProviderConfig,sealCredential } from '../src/lib/ai-credentials';
import { changeAICredential,sameOriginCredentialRequest } from '../src/lib/ai-credential-handler';
import { DEFAULT_AI_SYSTEM_PROMPT,effectiveSystemPrompt } from '../src/lib/ai-settings';
import { providerRequest } from '../src/lib/ai-provider';
import { chatInputSchema } from '../src/lib/ai-conversation';
import { POST,DELETE } from '../src/app/api/ai/settings/route';
import { aiWorkspaceFixture } from './fixtures/ai-workspace';

const env={AI_CREDENTIAL_SECRET:'synthetic-encryption-secret-'.repeat(3),NODE_ENV:'production',OPENAI_API_KEY:'server-synthetic-key',OPENAI_MODEL:'server-model'};

const owner='writer-one',config={provider:'openai' as const,key:'synthetic-user-api-key',model:'synthetic-model'};

const request=(body:JsonValue,options:{method?:string;origin?:string;cookie?:string}={})=>{const headers=new Headers({'Content-Type':'application/json',Origin:options.origin||'https://orbis.example'});

if(options.cookie)headers.set('Cookie',options.cookie);

return new Request('https://orbis.example/api/ai/settings',{method:options.method||'POST',headers,body:JSON.stringify(body)});};

test('API 키는 매번 다른 암호문이고 계정·제공자·만료·변조·서버 키 교체에 묶인다',()=>{
  const sealed=sealCredential(config,owner,env,100),again=sealCredential(config,owner,env,100);
  assert.notEqual(sealed,again);assert(!sealed.includes(config.key));assert.deepEqual(openCredential(sealed,'openai',owner,env,101),config);
  assert.equal(openCredential(sealed,'openai','other-writer',env,101),null);
  assert.equal(openCredential(sealed,'gemini',owner,env,101),null);
  assert.equal(openCredential(sealed,'openai',owner,env,100+AI_CREDENTIAL_TTL),null);
  const parts=sealed.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  assert.equal(openCredential(parts.join('.'),'openai',owner,env,101),null);
  assert.equal(openCredential(sealed,'openai',owner,{...env,AI_CREDENTIAL_SECRET:'changed-secret-'.repeat(5)},101),null);
  assert.equal(openCredential('v1.invalid','openai',owner,env,101),null);
  assert(!credentialStorageAvailable({AI_CREDENTIAL_SECRET:'short',SUPABASE_SERVICE_ROLE_KEY:'long-secret-'.repeat(8)}));
  assert(credentialStorageAvailable({SUPABASE_SERVICE_ROLE_KEY:'long-secret-'.repeat(8)}));
  assert(credentialStorageAvailable({AI_CREDENTIAL_SECRET:'',SUPABASE_SERVICE_ROLE_KEY:'long-secret-'.repeat(8)}));
});

test('브라우저 연결을 우선하고 만료된 키는 서버 과금으로 조용히 전환하지 않으며 상태 응답은 비밀을 제외한다',()=>{
  const sealed=sealCredential(config,owner,env),cookie=`${credentialCookieName('openai',true)}=${sealed}`,req=request({}, {cookie});
  assert.deepEqual(requestProviderConfig(req,'openai',owner,env),config);
  const status=providerSettingsStatus(req,owner,env);assert.equal(status.providers[0].source,'browser');assert(!JSON.stringify(status).includes(config.key));assert(!JSON.stringify(status).includes(env.OPENAI_API_KEY));
  const corrupt=request({}, {cookie:`${credentialCookieName('openai',true)}=invalid`});
  assert.equal(requestProviderConfig(corrupt,'openai',owner,env),null);assert.equal(providerSettingsStatus(corrupt,owner,env).providers[0].browserInvalid,true);
  assert.equal(requestProviderConfig(request({}),'openai',owner,env)?.model,'server-model');
});

test('키 저장·모델만 수정·해제 응답은 HttpOnly·Secure·Strict·30일·호스트 전용 쿠키와 no-store를 유지한다',async()=>{
  const saved=await changeAICredential(request(config),owner,env);assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{saved:true});assert.equal(saved.headers.get('cache-control'),'no-store');
  const cookie=saved.cookies.get(credentialCookieName('openai',true))!;assert(cookie.httpOnly);assert(cookie.secure);assert.equal(cookie.sameSite,'strict');assert.equal(cookie.path,'/');assert.equal(cookie.maxAge,AI_CREDENTIAL_TTL);assert.equal(cookie.domain,undefined);
  assert.deepEqual(openCredential(cookie.value,'openai',owner,env),config);
  const updated=await changeAICredential(request({provider:'openai',model:'new-model'},{cookie:`${cookie.name}=${cookie.value}`}),owner,env);
  assert.equal(openCredential(updated.cookies.get(cookie.name)!.value,'openai',owner,env)?.model,'new-model');
  const removed=await changeAICredential(request({provider:'openai'},{method:'DELETE',cookie:`${cookie.name}=${cookie.value}`}),owner,env);assert.equal(removed.cookies.get(cookie.name)!.maxAge,0);assert.equal(removed.cookies.get(cookie.name)!.value,'');
});

test('자격 증명은 교차 출처·비로그인·과도한 입력·처음 연결의 빈 키·암호화 미설정을 거절한다',async()=>{
  const proxied=(origin:string)=>new Request('http://localhost:3000/api/ai/settings',{headers:{Host:'orbis.example',Origin:origin,'X-Forwarded-Proto':'https','X-Forwarded-Host':'other.example'}});
  assert(sameOriginCredentialRequest(proxied('https://orbis.example')));
  assert(!sameOriginCredentialRequest(proxied('https://other.example')));
  assert(!sameOriginCredentialRequest(proxied('http://orbis.example')));
  assert(!sameOriginCredentialRequest(proxied('https://orbis.example/')));
  assert(!sameOriginCredentialRequest(new Request('https://orbis.example/api/ai/settings')));
  assert.equal((await changeAICredential(request(config,{origin:'https://other.example'}),owner,env)).status,403);
  assert.equal((await POST(request(config))).status,401);assert.equal((await DELETE(request({provider:'openai'},{method:'DELETE'}))).status,401);
  assert.equal((await changeAICredential(request({provider:'openai',model:'model'}),owner,env)).status,400);
  assert.equal((await changeAICredential(request({...config,key:'spaces are invalid'}),owner,env)).status,400);
  const unsupported=new Request('https://orbis.example/api/ai/settings',{method:'POST',headers:{Origin:'https://orbis.example','Content-Type':'text/plain'},body:'{}'});assert.equal((await changeAICredential(unsupported,owner,env)).status,415);
  assert.equal((await changeAICredential(request({...config,key:'x'.repeat(9000)}),owner,env)).status,413);
  const failed=await changeAICredential(request(config),owner,{});assert.equal(failed.status,503);assert(!(await failed.text()).includes(config.key));
});

test('사용자 시스템 프롬프트는 세 제공자의 지침으로 전달하며 빈 값은 기본값, 자료·형식 규칙은 유지한다',()=>{
  const prompt='문장은 차분하게 검토하고 답변은 세 문단으로 작성해줘.';

  for(const provider of ['openai','anthropic','gemini'] as const){
    const req=providerRequest({...config,provider},{manuscript:'합성 원고'},[],prompt),body=JSON.parse(String(req.init.body));
    const system=provider==='openai'?body.instructions:provider==='anthropic'?body.system:body.systemInstruction.parts[0].text;
    assert(system.includes(prompt));assert(system.includes('참고 데이터'));assert(system.includes('최대 5개'));assert(!system.includes(config.key));
  }

  assert.equal(effectiveSystemPrompt('   '),DEFAULT_AI_SYSTEM_PROMPT);assert.throws(()=>effectiveSystemPrompt('x'.repeat(4001)));
  const fixture=aiWorkspaceFixture(),work=fixture.works[0],doc=work.documents[0];const input={workId:work.id,docId:doc.id,version:doc.updatedAt,provider:'openai',message:'질문',includeManuscript:true,sourceIds:[],history:[],systemPrompt:prompt};
  assert(chatInputSchema.safeParse(input).success);assert(!chatInputSchema.safeParse({...input,systemPrompt:'x'.repeat(4001)}).success);
});
