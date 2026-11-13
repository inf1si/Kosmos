import { generateText,Output } from 'ai';
import { reviewSchema,type Review } from './ai';
import type { ProviderConfig } from './ai-provider';
import { vertexLanguageModel,type VertexRuntimeOptions } from './vertex-runtime';
import { providerMessageContext } from './ai-request-context';
import type { JsonValue } from './json-value';

export async function requestChat(config:ProviderConfig,input:JsonValue,history:{role:'user'|'assistant';content:string}[],fetcher:typeof fetch=fetch,systemPrompt?:string,options:VertexRuntimeOptions={}):Promise<Review>{
  try{
    const result=await generateText({model:vertexLanguageModel(config,{...options,fetch:fetcher}),...providerMessageContext(input,history,systemPrompt),output:Output.object({schema:reviewSchema}),maxRetries:0,maxOutputTokens:8192,abortSignal:AbortSignal.timeout(45000)});

    if(['length','content-filter','error','other'].includes(result.finishReason))throw new Error('불완전한 AI 응답');

    return reviewSchema.parse(result.output);
  }catch{throw new Error('Vertex AI 응답을 완료하지 못했습니다. 모델·접근 권한·할당량을 확인하세요.');}
}

export function requestReview(config:ProviderConfig,input:JsonValue,fetcher:typeof fetch=fetch,options:VertexRuntimeOptions={}){return requestChat(config,input,[],fetcher,undefined,options);}
