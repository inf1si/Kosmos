'use client';
import { useSyncExternalStore } from 'react';
import { DEFAULT_AI_SYSTEM_PROMPT,systemPromptSchema } from '@/lib/ai-settings';
const key='orbis-ai-system-prompt',event='orbis-ai-system-prompt-change';
let fallback:string|null=null,volatile=false;
function subscribe(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener(event,callback);return()=>{window.removeEventListener('storage',callback);window.removeEventListener(event,callback);};}
function snapshot(){if(volatile)return fallback;try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
export function useAISystemPrompt(){
  const raw=useSyncExternalStore(subscribe,snapshot,()=>null);
  const value=systemPromptSchema.safeParse(raw);const prompt=value.success?value.data:DEFAULT_AI_SYSTEM_PROMPT;
  function save(next:string){systemPromptSchema.parse(next);fallback=next;volatile=false;try{localStorage.setItem(key,next);}catch{volatile=true;}window.dispatchEvent(new Event(event));return !volatile;}
  return [prompt,save] as const;
}
