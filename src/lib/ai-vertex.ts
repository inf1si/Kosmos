import { generateText,Output } from 'ai';
import { reviewSchema,type Review } from './ai';
import type { ProviderConfig } from './ai-provider';
import { vertexLanguageModel,type VertexRuntimeOptions } from './vertex-runtime';
import { providerMessageContext } from './ai-request-context';
import type { JsonValue } from './json-value';
import type { ReasoningLevel } from './ai-reasoning';

// Thinking counts toward the output limit, so a chosen level gets room on top of the 8,192-token answer.
const thinkingRoom:Partial<Record<ReasoningLevel,number>>={low:8192,medium:20480,high:32768};

export async function requestChat(config:ProviderConfig,input:JsonValue,history:{role:'user'|'assistant';content:string}[],fetcher:typeof fetch=fetch,systemPrompt?:string,options:VertexRuntimeOptions={},reasoning:ReasoningLevel='auto'):Promise<Review>{
  try{
    const result=await generateText({model:vertexLanguageModel(config,{...options,fetch:fetcher}),...providerMessageContext(input,history,systemPrompt),output:Output.object({schema:reviewSchema}),maxRetries:0,maxOutputTokens:8192+(thinkingRoom[reasoning]||0),...reasoning!=='auto'&&{reasoning},abortSignal:AbortSignal.timeout(45000)});

    if(['length','content-filter','error','other'].includes(result.finishReason))throw new Error('불완전한 AI 응답');

    return reviewSchema.parse(result.output);
  }catch{throw new Error('Vertex AI 응답을 완료하지 못했습니다. 모델·접근 권한·할당량을 확인하세요.');}
}

export function requestReview(config:ProviderConfig,input:JsonValue,fetcher:typeof fetch=fetch,options:VertexRuntimeOptions={}){return requestChat(config,input,[],fetcher,undefined,options);}
