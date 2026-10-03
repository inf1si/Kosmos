import { createCipheriv,createDecipheriv,hkdfSync,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { providerConfig,providerLabels,type AIProvider,type ProviderConfig } from './ai-provider';
import { credentialInputSchema,type AIProviderStatus } from './ai-settings';

type Environment=Record<string,string|undefined>;
export const AI_CREDENTIAL_TTL=30*24*60*60;
const payloadSchema=credentialInputSchema.omit({provider:true}).extend({key:credentialInputSchema.shape.key.unwrap(),expiresAt:z.number().int()});
function secret(env:Environment){const value=env.AI_CREDENTIAL_SECRET||env.SUPABASE_SERVICE_ROLE_KEY;return value&&value.length>=32?value:null;}
export function credentialStorageAvailable(env:Environment=process.env){return !!secret(env);}
export function credentialCookieName(provider:AIProvider,production=process.env.NODE_ENV==='production'){return `${production?'__Host-':''}orbis-ai-${provider}`;}
function encryptionKey(env:Environment){const value=secret(env);if(!value)throw new Error('AI 키 암호화 설정이 필요합니다.');return Buffer.from(hkdfSync('sha256',value,'orbis-tertius-ai-cookie-v1','credential-encryption',32));}
const aad=(userId:string,provider:AIProvider)=>Buffer.from(`orbis-ai:v1:${userId}:${provider}`);
export function sealCredential(config:ProviderConfig,userId:string,env:Environment=process.env,now=Math.floor(Date.now()/1000)){
  const payload=payloadSchema.parse({key:config.key,model:config.model,expiresAt:now+AI_CREDENTIAL_TTL});
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(env),iv);
  cipher.setAAD(aad(userId,config.provider));const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  const value=['v1',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
  if(value.length>3600)throw new Error('AI 연결값이 너무 깁니다.');return value;
}
export function openCredential(value:string|undefined,provider:AIProvider,userId:string,env:Environment=process.env,now=Math.floor(Date.now()/1000)):ProviderConfig|null{
  if(!value||value.length>3600)return null;
  try{
    const parts=value.split('.');if(parts.length!==4||parts[0]!=='v1'||parts.slice(1).some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))return null;
    const iv=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[3],'base64url');if(iv.length!==12||tag.length!==16)return null;
    const decipher=createDecipheriv('aes-256-gcm',encryptionKey(env),iv);decipher.setAAD(aad(userId,provider));decipher.setAuthTag(tag);
    const payload=payloadSchema.parse(JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()]).toString('utf8')));
    if(payload.expiresAt<=now||payload.expiresAt>now+AI_CREDENTIAL_TTL)return null;
    return {provider,key:payload.key,model:payload.model};
  }catch{return null;}
}
export function requestCredentialCookie(request:Request,provider:AIProvider,production=process.env.NODE_ENV==='production'){
  const name=credentialCookieName(provider,production);return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
}
export function requestProviderConfig(request:Request,provider:AIProvider,userId:string,env:Environment=process.env){
  const value=requestCredentialCookie(request,provider,env.NODE_ENV==='production');
  // An expired/corrupt personal key must not silently switch billing to a server key.
  return value?openCredential(value,provider,userId,env):providerConfig(provider,env);
}
export function providerSettingsStatus(request:Request,userId:string,env:Environment=process.env){
  const providers:AIProviderStatus[]=(['openai','anthropic','gemini'] as const).map(id=>{
    const value=requestCredentialCookie(request,id,env.NODE_ENV==='production'),personal=openCredential(value,id,userId,env),config=value?personal:providerConfig(id,env);
    return {id,label:providerLabels[id],configured:!!config,model:config?.model||null,source:personal?'browser':config?'server':null,browserStored:!!value,browserInvalid:!!value&&!personal};
  });
  return {providers,storageAvailable:credentialStorageAvailable(env)};
}
