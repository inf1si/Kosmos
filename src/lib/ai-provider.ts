import { z } from 'zod';
import { reviewSchema, type Review } from './ai';
import { readLimitedJson } from './http';
import { buildAIInstructions } from './ai-instructions';
export const providerSchema=z.enum(['openai','anthropic','gemini']);
export type AIProvider=z.infer<typeof providerSchema>;
export type ProviderConfig={provider:AIProvider;key:string;model:string};
export const providerLabels:Record<AIProvider,string>={openai:'OpenAI',anthropic:'Claude',gemini:'Gemini'};
export function providerConfig(provider:AIProvider,env:Record<string,string|undefined>=process.env):ProviderConfig|null{
  const key=provider==='openai'?(env.OPENAI_API_KEY||env.AI_API_KEY):provider==='anthropic'?env.ANTHROPIC_API_KEY:env.GEMINI_API_KEY;
  const model=provider==='openai'?(env.OPENAI_MODEL||env.AI_MODEL):provider==='anthropic'?env.ANTHROPIC_MODEL:env.GEMINI_MODEL;
  return key&&model?{provider,key,model}:null;
}
const schema={type:'object',properties:{review:{type:'string',description:'한국어 검토 의견과 불확실성'},suggestions:{type:'array',description:'최대 5개 제안',items:{type:'object',properties:{quote:{type:'string'},replacement:{type:'string'},reason:{type:'string'}},required:['quote','replacement','reason'],additionalProperties:false}}},required:['review','suggestions'],additionalProperties:false};
export function providerRequest(config:ProviderConfig,input:unknown,history?:{role:'user'|'assistant';content:string}[],systemPrompt?:string):{url:string;init:RequestInit}{
  const headers:Record<string,string>={'Content-Type':'application/json'};let url:string,body:unknown;
  const system=buildAIInstructions(history?systemPrompt:undefined);
  const messages=[...(history||[]),{role:'user' as const,content:JSON.stringify(input)}];
  if(config.provider==='openai'){
    url='https://api.openai.com/v1/responses';headers.Authorization=`Bearer ${config.key}`;
    body={model:config.model,store:false,max_output_tokens:2200,instructions:system,input:history?messages:JSON.stringify(input),text:{format:{type:'json_schema',name:'novel_review',strict:true,schema}}};
  }else if(config.provider==='anthropic'){
    url='https://api.anthropic.com/v1/messages';headers['x-api-key']=config.key;headers['anthropic-version']='2023-06-01';
    body={model:config.model,max_tokens:2200,system,messages,output_config:{format:{type:'json_schema',schema}}};
  }else{
    url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;headers['x-goog-api-key']=config.key;
    body={systemInstruction:{parts:[{text:system}]},contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{candidateCount:1,maxOutputTokens:2200,responseMimeType:'application/json',responseJsonSchema:schema}};
  }
  return{url,init:{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}};
}
export function parseProviderResult(provider:AIProvider,result:unknown):Review{
  const r=z.record(z.string(),z.unknown()).parse(result);let output='';
  if(provider==='openai'){
    if(r.status!=='completed')throw new Error('AI 응답이 완료되지 않았습니다.');
    const parsed=z.object({output:z.array(z.object({type:z.string(),content:z.array(z.object({type:z.string(),text:z.string().optional()})).optional()}))}).parse(r);
    output=parsed.output.filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text||'').join('');
  }else if(provider==='anthropic'){
    if(r.stop_reason!=='end_turn')throw new Error('Claude 응답이 완료되지 않았습니다.');
    output=z.object({content:z.array(z.object({type:z.string(),text:z.string().optional()}))}).parse(r).content.filter(c=>c.type==='text').map(c=>c.text||'').join('');
  }else{
    const parsed=z.object({candidates:z.array(z.object({finishReason:z.string(),content:z.object({parts:z.array(z.object({text:z.string().optional(),thought:z.boolean().optional()}))})})).min(1)}).parse(r);
    if(parsed.candidates[0].finishReason!=='STOP')throw new Error('Gemini 응답이 완료되지 않았습니다.');output=parsed.candidates[0].content.parts.filter(p=>!p.thought).map(p=>p.text||'').join('');
  }
  return reviewSchema.parse(JSON.parse(output));
}
export async function requestReview(config:ProviderConfig,input:unknown,fetcher:typeof fetch=fetch):Promise<Review>{
  const{url,init}=providerRequest(config,input);const response=await fetcher(url,init);if(!response.ok)throw new Error('AI 제공자가 요청을 완료하지 못했습니다.');return parseProviderResult(config.provider,await readLimitedJson(response,256*1024));
}
export async function requestChat(config:ProviderConfig,input:unknown,history:{role:'user'|'assistant';content:string}[],fetcher:typeof fetch=fetch,systemPrompt?:string):Promise<Review>{
  const{url,init}=providerRequest(config,input,history,systemPrompt);const response=await fetcher(url,init);if(!response.ok)throw new Error('AI 제공자가 요청을 완료하지 못했습니다.');return parseProviderResult(config.provider,await readLimitedJson(response,256*1024));
}
