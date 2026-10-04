import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GOOGLE_AUTH_PENDING,startGoogleAuth,validateGoogleReturn,googleAuthError } from '../src/lib/google-auth';

function setup({author=true,identityError=null}:{author?:boolean;identityError?:{code:string}|null}={}){
  const calls:{method:string;args:unknown}[]=[];const values=new Map<string,string>();
  const storage={setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>{values.delete(k);}};
  const result={data:{url:'https://example.supabase.co/auth/v1/authorize?provider=google'},error:identityError};
  const client={auth:{getUser:async()=>({data:{user:{id:'original-author'}},error:null}),linkIdentity:async(args:unknown)=>{calls.push({method:'link',args});return result;},signInWithOAuth:async(args:unknown)=>{calls.push({method:'login',args});return result;}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:author?{user_id:'original-author'}:null,error:null})})})})} as unknown as SupabaseClient;
  return {client,calls,storage,values};
}
test('서로 다른 이메일의 Google 연결은 기존 작가 인증을 요구하고 UUID를 유지한다',async()=>{
  const f=setup();await startGoogleAuth(f.client,'link','https://kosmos.example',f.storage,async()=>true);
  assert.equal(f.calls[0].method,'link');assert.deepEqual(f.calls[0].args,{provider:'google',options:{redirectTo:'https://kosmos.example/auth/callback',skipBrowserRedirect:true,queryParams:{prompt:'select_account'}}});
  assert.equal(JSON.parse(f.values.get(GOOGLE_AUTH_PENDING)!).userId,'original-author');
  const denied=setup({author:false});await assert.rejects(()=>startGoogleAuth(denied.client,'link','https://kosmos.example',denied.storage,async()=>true),/권한/);assert.equal(denied.calls.length,0);
});
test('Google 비활성·연결 실패는 리디렉션하지 않고 다음 시도를 허용한다',async()=>{
  const f=setup();await assert.rejects(()=>startGoogleAuth(f.client,'login','http://localhost:3210',f.storage,async()=>false),/아직 설정/);assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
  const disabled=setup({identityError:{code:'manual_linking_disabled'}});await assert.rejects(()=>startGoogleAuth(disabled.client,'link','https://kosmos.example',disabled.storage,async()=>true),/활성화/);assert.equal(disabled.values.size,0);
  assert.match(googleAuthError({code:'signup_disabled'}),/기존 이메일/);assert.match(googleAuthError({code:'identity_already_exists'}),/다른 계정/);
});
test('Google 인증 복귀는 다른 사용자·만료·Google 미연결 계정을 거절한다',()=>{
  const intent={mode:'link' as const,userId:'original-author',startedAt:100};const user={id:'original-author',identities:[{provider:'google'}]};
  validateGoogleReturn(intent,user,200);
  assert.throws(()=>validateGoogleReturn(intent,{...user,id:'another-user'},200),/인증 계정이 다릅니다/);
  assert.throws(()=>validateGoogleReturn(intent,user,700000),/만료/);
  assert.throws(()=>validateGoogleReturn(intent,{...user,identities:[{provider:'email'}]},200),/연결을 확인/);
  assert.throws(()=>validateGoogleReturn({...intent,userId:undefined},user,200),/인증 계정/);
});
