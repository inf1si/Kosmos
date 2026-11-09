import { test } from 'node:test';
import type { JsonValue } from '../src/lib/json-value';
import assert from 'node:assert/strict';
import { AI_CREDENTIAL_TTL,credentialCookieName,legacyCredentialCookieName,credentialStorageAvailable,openCredential,providerSettingsStatus,requestProviderConfig,sealCredential } from '../src/lib/ai-credentials';
import { changeAICredential,sameOriginCredentialRequest } from '../src/lib/ai-credential-handler';
import { DEFAULT_AI_SYSTEM_PROMPT,effectiveSystemPrompt } from '../src/lib/ai-settings';
import { providerMessageContext } from '../src/lib/ai-request-context';
import { chatInputSchema } from '../src/lib/ai-conversation';
import { POST,DELETE } from '../src/app/api/ai/settings/route';
import { aiWorkspaceFixture } from './fixtures/ai-workspace';

const env={AI_CREDENTIAL_SECRET:'synthetic-encryption-secret-'.repeat(3),NODE_ENV:'production',GOOGLE_VERTEX_PROJECT:'orbiter-ai',VERTEX_AUTH_MODE:'adc',VERTEX_GEMINI_MODEL:'server-model'};

const owner='writer-one',config={provider:'gemini' as const,model:'synthetic-model'};

const request=(body:JsonValue,options:{method?:string;origin?:string;cookie?:string}={})=>{const headers=new Headers({'Content-Type':'application/json',Origin:options.origin||'https://orbis.example'});

if(options.cookie)headers.set('Cookie',options.cookie);

return new Request('https://orbis.example/api/ai/settings',{method:options.method||'POST',headers,body:JSON.stringify(body)});};

test('모델 선택은 매번 다른 암호문이고 계정·제공자·만료·변조·서버 키 교체에 묶인다',()=>{
  const sealed=sealCredential(config,owner,env,100),again=sealCredential(config,owner,env,100);
  assert.notEqual(sealed,again);assert(!sealed.includes(config.model));assert.deepEqual(openCredential(sealed,'gemini',owner,env,101),config);
  assert.equal(openCredential(sealed,'gemini','other-writer',env,101),null);
  assert.equal(openCredential(sealed,'anthropic',owner,env,101),null);
  assert.equal(openCredential(sealed,'gemini',owner,env,100+AI_CREDENTIAL_TTL),null);
  const parts=sealed.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  assert.equal(openCredential(parts.join('.'),'gemini',owner,env,101),null);
  assert.equal(openCredential(sealed,'gemini',owner,{...env,AI_CREDENTIAL_SECRET:'changed-secret-'.repeat(5)},101),null);
  assert.equal(openCredential('v1.invalid','gemini',owner,env,101),null);
  assert(!credentialStorageAvailable({AI_CREDENTIAL_SECRET:'short',SUPABASE_SERVICE_ROLE_KEY:'long-secret-'.repeat(8)}));
  assert(credentialStorageAvailable({SUPABASE_SERVICE_ROLE_KEY:'long-secret-'.repeat(8)}));
  assert(credentialStorageAvailable({AI_CREDENTIAL_SECRET:'',SUPABASE_SERVICE_ROLE_KEY:'long-secret-'.repeat(8)}));
});

test('모델 선택을 우선하고 만료된 선택은 서버 과금으로 조용히 전환하지 않으며 상태 응답은 비밀을 제외한다',()=>{
  const sealed=sealCredential(config,owner,env),cookie=`${credentialCookieName('gemini',true)}=${sealed}`,req=request({}, {cookie});
  assert.deepEqual(requestProviderConfig(req,'gemini',owner,env),{...config,project:'orbiter-ai',location:'global'});
  const status=providerSettingsStatus(req,owner,env);assert.equal(status.providers[0].source,'server');assert.equal(status.providers[0].model,config.model);assert(!JSON.stringify(status).includes(env.GOOGLE_VERTEX_PROJECT));
  assert.equal(status.providers.length,2);assert(!status.providers.some(p=>p.id==='openai'));
  const legacy=request({}, {cookie:`${legacyCredentialCookieName('gemini',true)}=v1.old-direct-api-key`});assert.equal(requestProviderConfig(legacy,'gemini',owner,env)?.model,'server-model');
  const corrupt=request({}, {cookie:`${credentialCookieName('gemini',true)}=invalid`});
  assert.equal(requestProviderConfig(corrupt,'gemini',owner,env),null);assert.equal(providerSettingsStatus(corrupt,owner,env).providers[0].browserInvalid,true);
  assert.equal(requestProviderConfig(request({}),'gemini',owner,env)?.model,'server-model');
});

test('모델 저장·수정·초기화 응답은 HttpOnly·Secure·Strict·30일·호스트 전용 쿠키와 no-store를 유지한다',async()=>{
  const saved=await changeAICredential(request(config),owner,env);assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{saved:true});assert.equal(saved.headers.get('cache-control'),'no-store');

  for(const provider of ['openai','anthropic','gemini'] as const)assert.equal(saved.cookies.get(legacyCredentialCookieName(provider,true))?.maxAge,0);
  const cookie=saved.cookies.get(credentialCookieName('gemini',true))!;assert(cookie.httpOnly);assert(cookie.secure);assert.equal(cookie.sameSite,'strict');assert.equal(cookie.path,'/');assert.equal(cookie.maxAge,AI_CREDENTIAL_TTL);assert.equal(cookie.domain,undefined);
  assert.deepEqual(openCredential(cookie.value,'gemini',owner,env),config);
  const updated=await changeAICredential(request({provider:'gemini',model:'new-model'},{cookie:`${cookie.name}=${cookie.value}`}),owner,env);
  assert.equal(openCredential(updated.cookies.get(cookie.name)!.value,'gemini',owner,env)?.model,'new-model');
  const removed=await changeAICredential(request({provider:'gemini'},{method:'DELETE',cookie:`${cookie.name}=${cookie.value}`}),owner,env);assert.equal(removed.cookies.get(cookie.name)!.maxAge,0);assert.equal(removed.cookies.get(cookie.name)!.value,'');
});

test('자격 증명은 교차 출처·비로그인·과도한 입력·직접 API 키 입력·암호화 미설정을 거절한다',async()=>{
  const proxied=(origin:string)=>new Request('http://localhost:3000/api/ai/settings',{headers:{Host:'orbis.example',Origin:origin,'X-Forwarded-Proto':'https','X-Forwarded-Host':'other.example'}});
  assert(sameOriginCredentialRequest(proxied('https://orbis.example')));
  assert(!sameOriginCredentialRequest(proxied('https://other.example')));
  assert(!sameOriginCredentialRequest(proxied('http://orbis.example')));
  assert(!sameOriginCredentialRequest(proxied('https://orbis.example/')));
  assert(!sameOriginCredentialRequest(new Request('https://orbis.example/api/ai/settings')));
  assert.equal((await changeAICredential(request(config,{origin:'https://other.example'}),owner,env)).status,403);
  assert.equal((await POST(request(config))).status,401);assert.equal((await DELETE(request({provider:'gemini'},{method:'DELETE'}))).status,401);
  assert.equal((await changeAICredential(request({provider:'openai',model:'model'}),owner,env)).status,400);
  assert.equal((await changeAICredential(request({...config,key:'spaces are invalid'}),owner,env)).status,400);
  const unsupported=new Request('https://orbis.example/api/ai/settings',{method:'POST',headers:{Origin:'https://orbis.example','Content-Type':'text/plain'},body:'{}'});assert.equal((await changeAICredential(unsupported,owner,env)).status,415);
  assert.equal((await changeAICredential(request({...config,key:'x'.repeat(9000)}),owner,env)).status,413);
  const failed=await changeAICredential(request(config),owner,{});assert.equal(failed.status,503);assert(!(await failed.text()).includes(config.model));
});

test('사용자 지침과 자료·형식 규칙을 유지한다',()=>{
  const prompt='문장은 차분하게 검토하고 답변은 세 문단으로 작성해줘.',system=providerMessageContext({manuscript:'합성 원고'},[],prompt).system;
  assert(system.includes(prompt));assert(system.includes('참고 데이터'));assert(system.includes('최대 5개'));
  assert.equal(effectiveSystemPrompt('   '),DEFAULT_AI_SYSTEM_PROMPT);assert.equal(effectiveSystemPrompt('x'.repeat(4001)).length,4001);
  const fixture=aiWorkspaceFixture(),work=fixture.works[0],doc=work.documents[0];const input={workId:work.id,docId:doc.id,version:doc.updatedAt,provider:'gemini',message:'질문',includeManuscript:true,sourceIds:[],history:[],systemPrompt:prompt};
  assert(chatInputSchema.safeParse(input).success);assert(chatInputSchema.safeParse({...input,systemPrompt:'x'.repeat(4001)}).success);
});
