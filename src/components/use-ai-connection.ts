'use client';

import { useCallback,useEffect,useState } from 'react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { vertexProviderSchema,activeAIProviders,providerLabels,type AIProvider } from '@/lib/ai-provider';
import { z } from 'zod';
import type { AIProviderStatus } from '@/lib/ai-settings';
import { useStudio } from './studio-provider';

const initialProviders:AIProviderStatus[]=activeAIProviders.map(id=>({id,label:providerLabels[id],configured:false,model:null,source:null,browserStored:false,browserInvalid:false}));

const selections=new Map<string,AIProvider>();

const choiceKey=(namespace:string)=>`kosmos:ai-provider:${namespace}`;

function savedProvider(namespace:string){try{const value=localStorage.getItem(choiceKey(namespace));

const parsed=vertexProviderSchema.safeParse(value);

return parsed.success?parsed.data:undefined;}catch{return undefined;}}

/** Both surfaces share a device preference; authentication stays on Vertex; only model preferences use the secure cookie. */
export function useAIConnection(){
  const {namespace}=useStudio();
  const [providers,setProviders]=useState(initialProviders),[provider,setProviderState]=useState<AIProvider>(selections.get(namespace)||'gemini');
  const [loadingProviders,setLoadingProviders]=useState(cloudConfigured),[storageAvailable,setStorageAvailable]=useState(false),[connectionError,setConnectionError]=useState('');

  const setProvider=useCallback((id:AIProvider)=>{selections.set(namespace,id);setProviderState(id);

try{localStorage.setItem(choiceKey(namespace),id);}catch{/* In-memory preference still works. */}

window.dispatchEvent(new CustomEvent('kosmos:ai-provider',{detail:{namespace,id}}));},[namespace]);

  const refreshProviders=useCallback(async(selected?:AIProvider,signal?:AbortSignal)=>{
    if(!cloudConfigured)return;
    const session=(await cloud().auth.getSession()).data.session;

if(!session)throw new Error('작가 로그인이 필요합니다.');
    const response=await fetch('/api/ai/providers',{headers:{Authorization:`Bearer ${session.access_token}`},signal});
    const body=await response.json();

if(!response.ok)throw new Error(body.error||'AI 연결 상태를 확인하지 못했습니다.');

    if(signal?.aborted)return;
    setProviders(body.providers);setStorageAvailable(!!body.storageAvailable);setConnectionError('');
    const remembered=selected||selections.get(namespace)||savedProvider(namespace),choice=body.providers.some((p:AIProviderStatus)=>p.id===remembered)?remembered:body.providers.find((p:AIProviderStatus)=>p.configured)?.id||'gemini';setProvider(vertexProviderSchema.parse(choice));

    if(selected)window.dispatchEvent(new CustomEvent('kosmos:ai-connection',{detail:{namespace}}));
  },[namespace,setProvider]);

  useEffect(()=>{
    const controller=new AbortController();
    void refreshProviders(undefined,controller.signal).catch(e=>{if(!controller.signal.aborted)setConnectionError(e instanceof Error?e.message:'AI 연결을 확인하지 못했습니다.');}).finally(()=>{if(!controller.signal.aborted)setLoadingProviders(false);});

    const change=(event:Event)=>{if(!(event instanceof CustomEvent))return;const parsed=z.object({namespace:z.string(),id:vertexProviderSchema}).safeParse(event.detail);

if(parsed.success&&parsed.data.namespace===namespace)setProviderState(parsed.data.id);};

window.addEventListener('kosmos:ai-provider',change);
    const reconnect=(event:Event)=>{if(event instanceof CustomEvent&&z.object({namespace:z.literal(namespace)}).safeParse(event.detail).success)void refreshProviders(undefined,controller.signal).catch(e=>{if(!controller.signal.aborted)setConnectionError(e instanceof Error?e.message:'AI 연결을 확인하지 못했습니다.');});};

window.addEventListener('kosmos:ai-connection',reconnect);

    return()=>{controller.abort();window.removeEventListener('kosmos:ai-provider',change);window.removeEventListener('kosmos:ai-connection',reconnect);};
  },[namespace,refreshProviders]);

  return {providers,provider,setProvider,loadingProviders,storageAvailable,connectionError,refreshProviders,currentProvider:providers.find(p=>p.id===provider)!};
}
