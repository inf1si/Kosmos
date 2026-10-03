import { z } from 'zod';

export const DEFAULT_AI_SYSTEM_PROMPT='한국어 SF 출판소설의 집필을 돕는다. 작가의 문체와 시점을 존중한다. 퇴고, 설정 일관성, 장면 구상과 요약을 대화로 돕는다. 새로운 아이디어와 이미 정한 설정을 구분한다. 확실하지 않은 과학적 가정은 확인할 질문으로 제시한다. 간결하게 답하되 수정 이유를 설명한다.';
export const systemPromptSchema=z.string().max(4000);
export function effectiveSystemPrompt(value?:string){return systemPromptSchema.parse(value??'').trim()||DEFAULT_AI_SYSTEM_PROMPT;}
export const credentialInputSchema=z.object({
  provider:z.enum(['openai','anthropic','gemini']),
  key:z.string().trim().regex(/^[A-Za-z0-9._~+/=-]{8,1600}$/).optional(),
  model:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/),
});
export type AIProviderStatus={id:'openai'|'anthropic'|'gemini';label:string;configured:boolean;model:string|null;source:'browser'|'server'|null;browserStored:boolean;browserInvalid:boolean};
