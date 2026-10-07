'use client';

import { useSyncExternalStore } from 'react';
import { legacyCustomPrompt } from '@/lib/ai-prompt-presets';

const key='orbis-ai-system-prompt',event='orbis-ai-system-prompt-change';

function subscribe(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener(event,callback);

return()=>{window.removeEventListener('storage',callback);window.removeEventListener(event,callback);};}

function snapshot(){try{return localStorage.getItem(key);}catch{return null;}}

/** Browser text is offered for explicit import, never copied into another account automatically. */
export function useLegacyAISystemPrompt(){
  const raw=useSyncExternalStore(subscribe,snapshot,()=>null);

  return legacyCustomPrompt(raw);
}
