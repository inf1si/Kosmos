'use client';

import { useCallback,useEffect,useRef,useState } from 'react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { vertexProviderSchema,vertexModelIdSchema,activeAIProviders,providerLabels,type AIProvider } from '@/lib/ai-provider';
import { z } from 'zod';
import type { AIProviderStatus } from '@/lib/ai-settings';
import { useStudio } from './studio-provider';

const initialProviders:AIProviderStatus[]=activeAIProviders.map(id=>({id,label:providerLabels[id],configured:false,model:null,models:[],source:null,browserStored:false,browserInvalid:false}));

const modelChoicesSchema=z.object({gemini:vertexModelIdSchema.optional(),anthropic:vertexModelIdSchema.optional()});

type ModelChoices=z.infer<typeof modelChoicesSchema>;

const selections=new Map<string,AIProvider>(),modelSelections=new Map<string,ModelChoices>();

const choiceKey=(namespace:string)=>`kosmos:ai-provider:${namespace}`,modelKey=(namespace:string)=>`kosmos:ai-models:${namespace}`;

function savedProvider(namespace:string){try{return vertexProviderSchema.safeParse(localStorage.getItem(choiceKey(namespace))).data;}catch{return undefined;}}

function savedModels(namespace:string){try{return modelChoicesSchema.parse(JSON.parse(localStorage.getItem(modelKey(namespace))||'{}'));}catch{return {};}}

/** Model IDs are device preferences; authentication stays on Vertex. Requests capture their chosen model. */
export function useAIConnection(){
  const {namespace,user}=useStudio(),account=useRef(namespace);account.current=namespace;
  const [providers,setProviders]=useState(initialProviders),[provider,setProviderState]=useState<AIProvider>(selections.get(namespace)||'gemini');
  const [choices,setChoices]=useState({namespace,values:modelSelections.get(namespace)||{}});
  const [loadingProviders,setLoadingProviders]=useState(cloudConfigured),[storageAvailable,setStorageAvailable]=useState(false),[connectionError,setConnectionError]=useState('');

  const setProvider=useCallback((id:AIProvider)=>{selections.set(namespace,id);setProviderState(id);

    try{localStorage.setItem(choiceKey(namespace),id);}catch{}

    window.dispatchEvent(new CustomEvent('kosmos:ai-provider',{detail:{namespace,id}}));
  },[namespace]);

  const setModel=useCallback((value:string,family:AIProvider)=>{
    const id=vertexProviderSchema.parse(family),model=vertexModelIdSchema.parse(value),values={...(modelSelections.get(namespace)||savedModels(namespace)),[id]:model};
    modelSelections.set(namespace,values);setChoices({namespace,values});

    try{localStorage.setItem(modelKey(namespace),JSON.stringify(values));}catch{}

    window.dispatchEvent(new CustomEvent('kosmos:ai-model',{detail:{namespace,id,model}}));
  },[namespace]);

  const refreshProviders=useCallback(async(selected?:AIProvider,signal?:AbortSignal)=>{
    if(!cloudConfigured)return;
    const session=(await cloud().auth.getSession()).data.session;

    if(!session||session.user.id!==user)throw new Error('작가 로그인을 확인하세요.');
    const response=await fetch('/api/ai/providers',{headers:{Authorization:`Bearer ${session.access_token}`},signal}),body=await response.json();

    if(!response.ok)throw new Error(body.error||'AI 연결 상태를 확인하지 못했습니다.');

    if(signal?.aborted||account.current!==namespace)return;
    const list:AIProviderStatus[]=body.providers.map((p:AIProviderStatus)=>({...p,models:p.models||(p.model?[p.model]:[])}));
    setProviders(list);setStorageAvailable(!!body.storageAvailable);setConnectionError('');
    const remembered=selected||selections.get(namespace)||savedProvider(namespace),choice=list.some(p=>p.id===remembered)?remembered:list.find(p=>p.configured)?.id||'gemini';setProvider(vertexProviderSchema.parse(choice));

    if(selected){const next=list.find(p=>p.id===selected)?.model;

if(next)setModel(next,selected);window.dispatchEvent(new CustomEvent('kosmos:ai-connection',{detail:{namespace}}));}
  },[namespace,user,setProvider,setModel]);

  useEffect(()=>{
    const controller=new AbortController(),values=modelSelections.get(namespace)||savedModels(namespace);modelSelections.set(namespace,values);setChoices({namespace,values});
    void refreshProviders(undefined,controller.signal).catch(e=>{if(!controller.signal.aborted)setConnectionError(e instanceof Error?e.message:'AI 연결을 확인하지 못했습니다.');}).finally(()=>{if(!controller.signal.aborted)setLoadingProviders(false);});

    const change=(event:Event)=>{if(!(event instanceof CustomEvent))return;const parsed=z.object({namespace:z.literal(namespace),id:vertexProviderSchema}).safeParse(event.detail);

if(parsed.success)setProviderState(parsed.data.id);};

    const modelChange=(event:Event)=>{if(!(event instanceof CustomEvent))return;const parsed=z.object({namespace:z.literal(namespace),id:vertexProviderSchema,model:vertexModelIdSchema}).safeParse(event.detail);

if(parsed.success){const values={...modelSelections.get(namespace),[parsed.data.id]:parsed.data.model};modelSelections.set(namespace,values);setChoices({namespace,values});}};

    const reconnect=(event:Event)=>{if(event instanceof CustomEvent&&z.object({namespace:z.literal(namespace)}).safeParse(event.detail).success)void refreshProviders(undefined,controller.signal).catch(e=>{if(!controller.signal.aborted)setConnectionError(e instanceof Error?e.message:'AI 연결을 확인하지 못했습니다.');});};

    window.addEventListener('kosmos:ai-provider',change);window.addEventListener('kosmos:ai-model',modelChange);window.addEventListener('kosmos:ai-connection',reconnect);

    return()=>{controller.abort();window.removeEventListener('kosmos:ai-provider',change);window.removeEventListener('kosmos:ai-model',modelChange);window.removeEventListener('kosmos:ai-connection',reconnect);};
  },[namespace,refreshProviders]);

  const modelFor=(family:AIProvider)=>{const status=providers.find(p=>p.id===family),id=vertexProviderSchema.safeParse(family),saved=id.success&&choices.namespace===namespace?choices.values[id.data]:undefined;

return saved&&status?.models.includes(saved)?saved:status?.model||status?.models[0]||'';};

  return {providers,provider,setProvider,model:modelFor(provider),modelFor,setModel:(value:string)=>setModel(value,provider),setProviderModel:setModel,loadingProviders,storageAvailable,connectionError,refreshProviders,currentProvider:providers.find(p=>p.id===provider)||initialProviders[0]};
}
