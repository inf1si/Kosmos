import { buildAIInstructions } from './ai-instructions';
import type { JsonValue } from './json-value';

export function providerMessageContext(input:JsonValue,history:{role:'user'|'assistant';content:string}[]=[],systemPrompt?:string){
  return {system:buildAIInstructions(systemPrompt),messages:[...history,{role:'user' as const,content:JSON.stringify(input)}]};
}
