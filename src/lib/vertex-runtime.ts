import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createGoogleVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { IdentityPoolClient,type GoogleAuthOptions } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import { vertexAuthConfigured,vertexAuthMode,type ProviderConfig } from './ai-provider';

export type VertexRuntimeOptions={fetch?:typeof fetch;googleAuthOptions?:GoogleAuthOptions};

let wifClient:IdentityPoolClient|undefined,wifIdentity='';

export function vertexGoogleAuthOptions(env:Record<string,string|undefined>=process.env):GoogleAuthOptions{
  if(!vertexAuthConfigured(env))throw new Error('Vertex AI 서버 인증을 설정하세요.');
  const scopes=['https://www.googleapis.com/auth/cloud-platform'];

  if(vertexAuthMode(env)==='adc')return {projectId:env.GOOGLE_VERTEX_PROJECT,scopes};
  const provider=env.GOOGLE_VERTEX_WIF_PROVIDER!,account=env.GOOGLE_VERTEX_SERVICE_ACCOUNT!,identity=provider+'|'+account;

  if(!wifClient||wifIdentity!==identity){
    wifClient=new IdentityPoolClient({audience:`//iam.googleapis.com/${provider}`,subject_token_type:'urn:ietf:params:oauth:token-type:jwt',token_url:'https://sts.googleapis.com/v1/token',service_account_impersonation_url:`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,subject_token_supplier:{getSubjectToken:()=>getVercelOidcToken({audience:`https://iam.googleapis.com/${provider}`})},scopes,transporterOptions:{fetchImplementation:fetch}});
    wifIdentity=identity;
  }

  return {projectId:env.GOOGLE_VERTEX_PROJECT,authClient:wifClient,scopes};
}

export function vertexGemini(config:ProviderConfig,options:VertexRuntimeOptions={}){
  return createGoogleVertex({project:config.project,location:config.location,googleAuthOptions:options.googleAuthOptions||vertexGoogleAuthOptions(),fetch:options.fetch});
}

export function vertexLanguageModel(config:ProviderConfig,options:VertexRuntimeOptions={}){
  if(config.provider==='gemini')return vertexGemini(config,options)(config.model);

  return createGoogleVertexAnthropic({project:config.project,location:config.location,googleAuthOptions:options.googleAuthOptions||vertexGoogleAuthOptions(),fetch:options.fetch})(config.model);
}
