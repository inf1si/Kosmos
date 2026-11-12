import { createCipheriv,createDecipheriv,hkdfSync,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { activeAIProviders,providerConfig,providerLabels,serverModelCatalog,vertexProviderSchema,type AIProvider } from './ai-provider';
import { credentialInputSchema,type AIProviderStatus } from './ai-settings';

type Environment=Record<string,string|undefined>;

export class ModelCatalogSizeError extends Error{}

export const AI_CREDENTIAL_TTL=30*24*60*60;

const payloadSchema=credentialInputSchema.omit({provider:true}).extend({expiresAt:z.number().int()});

function secret(env:Environment){const value=env.AI_CREDENTIAL_SECRET||env.SUPABASE_SERVICE_ROLE_KEY;

return value&&value.length>=32?value:null;}

export function credentialStorageAvailable(env:Environment=process.env){return !!secret(env);}

export function credentialCookieName(provider:AIProvider,production=process.env.NODE_ENV==='production'){return `${production?'__Host-':''}orbis-vertex-model-${provider}`;}

export function legacyCredentialCookieName(provider:AIProvider,production=process.env.NODE_ENV==='production'){return `${production?'__Host-':''}orbis-ai-${provider}`;}

function encryptionKey(env:Environment){const value=secret(env);

if(!value)throw new Error('모델 선택 암호화 설정이 필요합니다.');

return Buffer.from(hkdfSync('sha256',value,'orbis-vertex-model-v1','model-preference',32));}

const aad=(userId:string,provider:AIProvider)=>Buffer.from(`orbis-vertex:model:v1:${userId}:${provider}`);

export function sealCredential(config:z.infer<typeof credentialInputSchema>,userId:string,env:Environment=process.env,now=Math.floor(Date.now()/1000)){
  const payload=payloadSchema.parse({model:config.model,...config.models&&{models:config.models},expiresAt:now+AI_CREDENTIAL_TTL}),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(env),iv);
  cipher.setAAD(aad(userId,config.provider));const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);

  const value=['v2',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');

  if(value.length>3800)throw new ModelCatalogSizeError('모델 목록이 쿠키 저장 한도를 넘었습니다. 일부 항목을 줄여주세요.');

  return value;
}

export function openCredential(value:string|undefined,provider:AIProvider,userId:string,env:Environment=process.env,now=Math.floor(Date.now()/1000)){
  if(!value||value.length>3800||!vertexProviderSchema.safeParse(provider).success)return null;

  try{
    const parts=value.split('.');

if(parts.length!==4||parts[0]!=='v2'||parts.slice(1).some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))return null;
    const iv=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[3],'base64url');

if(iv.length!==12||tag.length!==16)return null;
    const decipher=createDecipheriv('aes-256-gcm',encryptionKey(env),iv);decipher.setAAD(aad(userId,provider));decipher.setAuthTag(tag);
    const payload=payloadSchema.parse(JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()]).toString('utf8')));

    if(payload.expiresAt<=now||payload.expiresAt>now+AI_CREDENTIAL_TTL)return null;

    if(payload.models&&!payload.models.includes(payload.model))return null;

    return {provider:vertexProviderSchema.parse(provider),model:payload.model,...payload.models&&{models:payload.models}};
  }catch{return null;}
}

export function requestCredentialCookie(request:Request,provider:AIProvider,production=process.env.NODE_ENV==='production'){
  const name=credentialCookieName(provider,production);

return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
}

export function requestProviderConfig(request:Request,provider:AIProvider,userId:string,env:Environment=process.env,modelOverride?:string){
  const raw=requestCredentialCookie(request,provider,env.NODE_ENV==='production'),preference=openCredential(raw,provider,userId,env);

  if(raw&&!preference)return null;

  return providerConfig(provider,env,modelOverride||preference?.model);
}

export function providerSettingsStatus(request:Request,userId:string,env:Environment=process.env){
  const providers:AIProviderStatus[]=activeAIProviders.map(id=>{
    const raw=requestCredentialCookie(request,id,env.NODE_ENV==='production'),preference=openCredential(raw,id,userId,env),config=raw&&!preference?null:providerConfig(id,env,preference?.model);
    const defaultModel=serverModelCatalog(id,env)[0],models=preference?.models||[...new Set([...serverModelCatalog(id,env),...preference?.model?[preference.model]:[]])];

    return {id,label:providerLabels[id],configured:!!config,models,model:preference?.model||config?.model||defaultModel||null,source:config?'server':null,browserStored:!!raw,browserInvalid:!!raw&&!preference};
  });

  return {providers,storageAvailable:credentialStorageAvailable(env)};
}
