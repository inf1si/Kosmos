'use client';

import { providerSchema } from '@/lib/ai-provider';
import { useEffect, useState } from 'react';
import { NovelDocument, RichNode } from '@/lib/model';
import { Review, applySuggestion } from '@/lib/ai';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { useStudio } from './studio-provider';

type Provider='openai'|'anthropic'|'gemini';

type AvailableProvider={id:Provider;label:string;configured:boolean;model:string|null};

export function AIReview({workId,doc,onChange,onOpen}:{workId:string;doc:NovelDocument;onChange:(content:RichNode)=>void;onOpen:(id:string)=>void}){
  const s=useStudio();const [goal,setGoal]=useState('style');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [review,setReview]=useState<{result:Review;version:string;sources:{id:string;title:string}[];docId:string;provider:Provider;model:string}|null>(null);
  const [provider,setProvider]=useState<Provider>('openai');const [providers,setProviders]=useState<AvailableProvider[]>([{id:'openai',label:'OpenAI',configured:false,model:null},{id:'anthropic',label:'Claude',configured:false,model:null},{id:'gemini',label:'Gemini',configured:false,model:null}]);
  useEffect(()=>{if(!cloudConfigured||!s.user)return;let cancelled=false;void(async()=>{try{const session=await cloud().auth.getSession();const response=await fetch('/api/ai/providers',{headers:{Authorization:`Bearer ${session.data.session?.access_token||''}`}});

if(!response.ok)throw new Error();const result=await response.json();

if(!cancelled){setProviders(result.providers);const first=result.providers.find((p:AvailableProvider)=>p.configured);

if(first)setProvider(first.id);}}catch{if(!cancelled)setError('AI 연결 상태를 확인하지 못했습니다. 잠시 뒤 다시 열어주세요.');}})();

return()=>{cancelled=true;};},[s.user]);

  async function run(){setBusy(true);setError('');

try{await s.flush();await s.syncNow();const {data}=await cloud().auth.getSession();const response=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session?.access_token||''}`},body:JSON.stringify({workId,docId:doc.id,version:doc.updatedAt,goal,provider})});const result=await response.json();

if(!response.ok)throw new Error(result.error);setReview({...result,docId:doc.id});}catch(e){setError(e instanceof Error?e.message:'검토를 완료하지 못했습니다.');}finally{setBusy(false);}}

  return <div className="inspector-section"><h3>원고 검토</h3><label>검토할 AI<select aria-label="검토할 AI" value={provider} disabled={busy} onChange={e=>setProvider(providerSchema.parse(e.target.value))}>{providers.map(p=><option key={p.id} value={p.id}>{p.label}{p.configured?'':' · 연결 전'}</option>)}</select></label>{providers.find(p=>p.id===provider)?.model&&<p className="field-help">{providers.find(p=>p.id===provider)?.model}</p>}<label>검토 목적<select value={goal} onChange={e=>setGoal(e.target.value)}><option value="style">문장과 호흡</option><option value="continuity">설정 · 시간 · 인물의 지식</option></select></label><button className="button full" disabled={busy||!cloudConfigured||!providers.find(p=>p.id===provider)?.configured} onClick={()=>void run()}>{busy?'검토 중':'현재 문서 검토'}</button>{!providers.find(p=>p.id===provider)?.configured&&<p className="muted">선택한 AI는 아직 연결하지 않았습니다.</p>}<p className="ai-source">12,000자 이하 · 모든 AI 합산 하루 최대 10회</p>{error&&<p className="error-message">{error}</p>}{review&&review.docId===doc.id&&<><div className="ai-result"><h4>{providers.find(p=>p.id===review.provider)?.label} · {review.version===doc.updatedAt?'현재 원고 기준':'이전 원고 기준'}</h4><p>{review.result.review}</p></div>{review.result.suggestions.map((item,i)=><div className="ai-result" key={i}><h4>수정 제안 {i+1}</h4><s>{item.quote}</s><p>{item.replacement}</p><small>{item.reason}</small><button className="button full" disabled={review.version!==doc.updatedAt} onClick={async()=>{try{await s.snapshot('AI 수정 적용 전');s.update(state=>{const current=state.works.find(w=>w.id===workId)?.documents.find(d=>d.id===doc.id);

if(!current||current.updatedAt!==review.version)throw new Error('검토 이후 원고가 바뀌었습니다. 다시 비교하세요.');const content=applySuggestion(current.content,item.quote,item.replacement);

return{...state,works:state.works.map(w=>w.id===workId?{...w,documents:w.documents.map(d=>d.id===doc.id?{...d,content,updatedAt:new Date().toISOString()}:d)}:w)};});}catch(e){setError(e instanceof Error?e.message:'제안을 적용하지 못했습니다.');}}}>제안 적용</button></div>)}{review.sources.map(source=><button className="reference-card" key={source.id} onClick={()=>onOpen(source.id)}>{source.title}</button>)}</>}</div>;
}
