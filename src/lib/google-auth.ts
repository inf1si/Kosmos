import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

export const GOOGLE_AUTH_PENDING='kosmos-google-auth';

export const googleAuthIntentSchema=z.object({mode:z.enum(['login','link']),userId:z.string().optional(),startedAt:z.number()});

export type GoogleAuthIntent=z.infer<typeof googleAuthIntentSchema>;

type GoogleOAuthArguments={provider:'google';options:{redirectTo:string;skipBrowserRedirect:boolean;queryParams:{prompt:string}}};

type GoogleOAuthResponse={data:{url?:string|null};error:{code?:string}|null};

/** Only the SDK operations used by this flow; tests can supply them without impersonating a full client. */
export type GoogleAuthClient={
  auth:{getUser:()=>Promise<{data:{user:{id:string}|null};error:{message?:string}|null}>;linkIdentity:(args:GoogleOAuthArguments)=>Promise<GoogleOAuthResponse>;signInWithOAuth:(args:GoogleOAuthArguments)=>Promise<GoogleOAuthResponse>};
  authorExists:(userId:string)=>Promise<boolean>;
};

export function googleAuthClient(client:SupabaseClient):GoogleAuthClient {
  return {auth:client.auth,authorExists:async userId=>{
    const author=await client.from('authors').select('user_id').eq('user_id',userId).maybeSingle();

    return !author.error&&!!author.data;
  }};
}

export function googleAuthError(error:{code?:string}|null|undefined){
  const code=error?.code;

  if(code==='manual_linking_disabled')return 'Google 계정 연결 설정이 아직 활성화되지 않았습니다.';

  if(code==='identity_already_exists')return '이 Google 계정은 다른 계정에 연결되어 있습니다. 기존 작가 계정으로 돌아가 연결할 계정을 확인하세요.';

  if(code==='signup_disabled')return '아직 연결되지 않은 Google 계정입니다. 기존 이메일로 로그인한 뒤 Google 계정을 연결하세요.';

  return 'Google 인증을 완료하지 못했습니다. 기존 로그인으로 다시 시도하세요.';
}

export function validateGoogleReturn(intent:GoogleAuthIntent,user:{id:string;identities?:{provider:string}[]},now=Date.now()){
  if(!['login','link'].includes(intent.mode)||!Number.isFinite(intent.startedAt)||now-intent.startedAt>10*60*1000||now<intent.startedAt)throw new Error('Google 인증 시간이 만료됐습니다. 다시 시도하세요.');

  if(intent.mode==='link'&&intent.userId!==user.id)throw new Error('기존 작가 계정과 인증 계정이 다릅니다. 기존 이메일로 다시 로그인하세요.');

  if(!user.identities?.some(identity=>identity.provider==='google'))throw new Error('Google 계정 연결을 확인하지 못했습니다. 기존 로그인으로 다시 시도하세요.');
}

export async function startGoogleAuth(client:GoogleAuthClient,mode:'login'|'link',origin:string,storage:Pick<Storage,'setItem'|'removeItem'>,providerEnabled:()=>Promise<boolean>){
  if(!await providerEnabled())throw new Error('Google 로그인이 아직 설정되지 않았습니다. 기존 이메일 로그인을 이용하세요.');
  let userId:string|undefined;

  if(mode==='link'){
    const {data,error}=await client.auth.getUser();

    if(error||!data.user)throw new Error('기존 이메일로 로그인한 뒤 Google 계정을 연결하세요.');

    if(!await client.authorExists(data.user.id))throw new Error('이 계정에는 집필실 권한이 없습니다.');
    userId=data.user.id;
  }

  const options={redirectTo:new URL('/auth/callback',origin).href,skipBrowserRedirect:true,queryParams:{prompt:'select_account'}};
  storage.setItem(GOOGLE_AUTH_PENDING,JSON.stringify({mode,userId,startedAt:Date.now()} satisfies GoogleAuthIntent));

  try{
    const result=mode==='link'?await client.auth.linkIdentity({provider:'google',options}):await client.auth.signInWithOAuth({provider:'google',options});

    if(result.error)throw new Error(googleAuthError(result.error));

    if(!result.data.url)throw new Error('Google 인증 화면을 열지 못했습니다. 다시 시도하세요.');

    return result.data.url;
  }catch(error){storage.removeItem(GOOGLE_AUTH_PENDING);throw error;}
}
