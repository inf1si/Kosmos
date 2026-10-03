import { NextResponse } from 'next/server';
import { readLimitedJson,BodyLimitError } from './http';
import { credentialInputSchema } from './ai-settings';
import { AI_CREDENTIAL_TTL,credentialCookieName,openCredential,requestCredentialCookie,sealCredential } from './ai-credentials';
import { providerSchema } from './ai-provider';

const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function sameOriginCredentialRequest(request:Request){
  // Next.js may build request.url with an internal hostname behind its proxy.
  // Host is the browser's request destination; never trust x-forwarded-host here.
  try{
    const url=new URL(request.url),origin=request.headers.get('origin'),host=request.headers.get('host')||url.host;
    const forwarded=request.headers.get('x-forwarded-proto'),protocol=forwarded==='http'||forwarded==='https'?forwarded+':':url.protocol;
    const destination=new URL(`${protocol}//${host}`);
    return destination.host===host.toLowerCase()&&origin===destination.origin;
  }catch{return false;}
}
export async function changeAICredential(request:Request,userId:string,env:Record<string,string|undefined>=process.env){
  if(!sameOriginCredentialRequest(request))return json({error:'같은 사이트에서 AI 설정을 변경하세요.'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
  try{
    const data=await readLimitedJson(request,8192),response=json({saved:true}),production=env.NODE_ENV==='production';
    if(request.method==='DELETE'){
      const parsed=providerSchema.safeParse((data as {provider?:unknown})?.provider);if(!parsed.success)return json({error:'제공자를 확인하세요.'},400);
      response.cookies.set(credentialCookieName(parsed.data,production),'',{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:0});return response;
    }
    const parsed=credentialInputSchema.safeParse(data);if(!parsed.success)return json({error:'제공자·모델 ID·API 키의 형식과 길이를 확인하세요.'},400);
    const {provider,model}=parsed.data,previous=openCredential(requestCredentialCookie(request,provider,production),provider,userId,env);
    const key=parsed.data.key||previous?.key;if(!key)return json({error:'처음 연결할 때는 API 키를 입력하세요.'},400);
    const value=sealCredential({provider,model,key},userId,env);
    response.cookies.set(credentialCookieName(provider,production),value,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:AI_CREDENTIAL_TTL});return response;
  }catch(e){
    if(e instanceof BodyLimitError)return json({error:'연결값이 너무 큽니다.'},413);
    if(e instanceof SyntaxError)return json({error:'요청 형식을 확인하세요.'},400);
    return json({error:'AI 연결값을 보관하지 못했습니다. 서버의 암호화 설정을 확인하세요.'},503);
  }
}
