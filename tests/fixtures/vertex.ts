import './vertex-auth.mjs';
import type { JsonValue } from '../../src/lib/json-value';
import type { Review } from '../../src/lib/ai';
import { OAuth2Client } from 'google-auth-library';
import type { ProviderConfig } from '../../src/lib/ai-provider';

const enc=(value:JsonValue)=>Buffer.from(JSON.stringify(value)).toString('base64url');

export const vertexTestEnvironment={GOOGLE_VERTEX_PROJECT:'orbiter-ai',GOOGLE_VERTEX_LOCATION:'global',VERTEX_GEMINI_MODEL:'gemini-test',VERTEX_CLAUDE_MODEL:'claude-test@20260101',VERTEX_AUTH_MODE:'wif',GOOGLE_VERTEX_WIF_PROVIDER:'projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel',GOOGLE_VERTEX_SERVICE_ACCOUNT:'vertex-runtime@orbiter-ai.iam.gserviceaccount.com',VERCEL_OIDC_TOKEN:`${enc({alg:'RS256'})}.${enc({exp:Math.floor(Date.now()/1000)+7200,sub:'owner:kosmos42:project:kosmos:environment:production'})}.synthetic`};

export function vertexAuthResponse(url:string){
  if(url==='https://oidc.vercel.com/~token')return Response.json({token:vertexTestEnvironment.VERCEL_OIDC_TOKEN,expiry:Math.floor(Date.now()/1000)+3600});

  if(url==='https://sts.googleapis.com/v1/token')return Response.json({access_token:'synthetic-federated',expires_in:3600,token_type:'Bearer',issued_token_type:'urn:ietf:params:oauth:token-type:access_token'});

  if(url.startsWith('https://iamcredentials.googleapis.com/'))return Response.json({accessToken:'synthetic-vertex',expireTime:new Date(Date.now()+3600000).toISOString()});

  return null;
}

export function vertexTestAuth(){const authClient=new OAuth2Client();authClient.setCredentials({access_token:'synthetic-vertex',expiry_date:Date.now()+3600000});

return {authClient};}

export const vertexTestConfig=(provider:ProviderConfig['provider']):ProviderConfig=>({provider,model:provider==='gemini'?'gemini-test':'claude-test@20260101',project:'orbiter-ai',location:'global'});

export function vertexReviewResponse(provider:ProviderConfig['provider'],result:Review){return provider==='gemini'?{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(result)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}:{id:'synthetic-message',type:'message',role:'assistant',model:'claude-test',content:[{type:'text',text:JSON.stringify(result)}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}};}
