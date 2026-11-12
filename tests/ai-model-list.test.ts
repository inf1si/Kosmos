import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeAICredential } from '../src/lib/ai-credential-handler';
import { credentialCookieName,openCredential,providerSettingsStatus,requestProviderConfig,sealCredential } from '../src/lib/ai-credentials';

const env={NODE_ENV:'production',AI_CREDENTIAL_SECRET:'synthetic-model-list-secret-'.repeat(3),VERTEX_AUTH_MODE:'adc',GOOGLE_VERTEX_PROJECT:'orbiter-ai',VERTEX_GEMINI_MODEL:'gemini-default',VERTEX_GEMINI_MODELS:'gemini-fast, gemini-deep\ngemini-fast',VERTEX_CLAUDE_MODEL:'claude-default'},owner='model-list-owner';

const request=(body:Record<string,string|string[]>,cookie='')=>new Request('https://orbis.example/api/ai/settings',{method:'POST',headers:{Origin:'https://orbis.example','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});

test('여러 모델 저장·선택은 목록과 기존 기본 모델을 보존한다',async()=>{
  assert.deepEqual(providerSettingsStatus(request({}),owner,env).providers[0].models,['gemini-default','gemini-fast','gemini-deep']);
  const selected={provider:'gemini',model:'gemini-fast',models:['gemini-fast','gemini-deep']},saved=await changeAICredential(request(selected),owner,env);assert.equal(saved.status,200);
  const cookie=saved.cookies.get(credentialCookieName('gemini',true))!,header=`${cookie.name}=${cookie.value}`,status=providerSettingsStatus(request({},header),owner,env);
  assert.deepEqual(status.providers[0].models,selected.models);assert.equal(status.providers[0].model,'gemini-fast');
  assert.deepEqual(openCredential(cookie.value,'gemini',owner,env),selected);
  assert.equal(requestProviderConfig(request({},header),'gemini',owner,env,'gemini-deep')?.model,'gemini-deep');
  assert.equal(requestProviderConfig(request({},header),'gemini',owner,env)?.model,'gemini-fast');
  const switched=await changeAICredential(request({provider:'gemini',model:'gemini-deep'},header),owner,env);
  assert.deepEqual(openCredential(switched.cookies.get(cookie.name)!.value,'gemini',owner,env)?.models,selected.models);
});

test('목록 밖 기본 선택·중복·경로 삽입·쿠키 한도 초과를 거절하고 만료 선택으로 우회하지 않는다',async()=>{
  for(const models of [['gemini-deep'],['gemini-fast','gemini-fast'],['gemini-fast','../wrong'],[]])assert.equal((await changeAICredential(request({provider:'gemini',model:'gemini-fast',models}),owner,env)).status,400);
  const huge=Array.from({length:25},(_,i)=>'m'+i+'x'.repeat(140));assert.equal((await changeAICredential(request({provider:'gemini',model:huge[0],models:huge}),owner,env)).status,413);
  const invalid=`${credentialCookieName('gemini',true)}=invalid`;assert.equal(requestProviderConfig(request({},invalid),'gemini',owner,env,'gemini-deep'),null);
  const old=sealCredential({provider:'gemini',model:'old-model'},owner,env),status=providerSettingsStatus(request({},`${credentialCookieName('gemini',true)}=${old}`),owner,env);
  assert(status.providers[0].models.includes('old-model'));
});
