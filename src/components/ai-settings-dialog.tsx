'use client';

import { vertexProviderSchema } from '@/lib/ai-provider';
import { useEffect,useState } from 'react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { type AIProviderStatus,type CredentialInput } from '@/lib/ai-settings';
import { Modal } from './primitives';
import { AIPromptEditor } from './ai-prompt-editor';
import { AISkillEditor } from './ai-skill-editor';
import { Select } from './select';

type PanelProps={providers:AIProviderStatus[];providerId:AIProviderStatus['id'];storageAvailable:boolean;onRefresh:(provider:AIProviderStatus['id'])=>Promise<void>;section?:'skills'};

export function AISettingsDialog({onClose,onReturnFocus,...panel}:PanelProps&{onClose:()=>void;onReturnFocus:()=>void}){
  return <Modal open onClose={onClose} onReturnFocus={onReturnFocus} title="AI 설정" wide><AISettingsPanel {...panel}/></Modal>;
}

export function AISettingsPanel({providers,providerId,storageAvailable,onRefresh,section}:PanelProps){
  const [provider,setProvider]=useState(vertexProviderSchema.safeParse(providerId).data||'gemini'),[model,setModel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const selected=providers.find(p=>p.id===provider);
  useEffect(()=>{setModel(selected?.model||'');},[provider,selected?.model]);

  async function change(remove=false){
    if(busy)return;setBusy(true);setError('');setNotice('');

    try{
      const session=(await cloud().auth.getSession()).data.session;

if(!session)throw new Error('작가 로그인이 필요합니다.');
      const connection:CredentialInput={provider,model:model.trim()};
      const response=await fetch('/api/ai/settings',{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(remove?{provider}:connection)}),body=await response.json();

      if(!response.ok)throw new Error(body.error||'모델 선택을 저장하지 못했습니다.');
      await onRefresh(provider);setNotice(remove?'기본 모델로 돌아갔습니다.':'모델 선택을 저장했습니다.');
    }catch(e){setError(e instanceof Error?e.message:'모델 선택을 저장하지 못했습니다.');}finally{setBusy(false);}
  }

  return <div className="ai-settings">
    <section aria-labelledby="ai-connection-title"><h3 id="ai-connection-title">Vertex AI</h3>
      <form onSubmit={e=>{e.preventDefault();void change();}}>
        <div className="ai-settings-grid"><label>제공자<Select aria-label="설정할 AI 제공자" value={provider} disabled={busy} onChange={value=>{setProvider(vertexProviderSchema.parse(value));setError('');setNotice('');}}>{providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</Select></label><label>모델 ID<input aria-label="AI 모델 ID" value={model} maxLength={200} required disabled={busy} autoComplete="off" spellCheck={false} placeholder="Vertex 모델 ID" onChange={e=>setModel(e.target.value)}/></label></div>
        <p className="ai-settings-state">{selected?.browserInvalid?'모델 선택이 만료되었습니다. 다시 저장하세요.':selected?.configured?'서버 연결':'Vertex 서버 연결 필요'}</p>
        <div className="ai-settings-actions">{selected?.browserStored&&<button type="button" disabled={busy||!cloudConfigured} onClick={()=>void change(true)}>기본 모델 사용</button>}<button type="submit" className="primary" disabled={busy||!cloudConfigured||!storageAvailable||!model.trim()}>{busy?'처리 중…':'모델 저장'}</button></div>
      </form>
    </section>
    <AIPromptEditor/><AISkillEditor focus={section==='skills'}/>
    {error&&<p role="alert" className="ai-settings-error">{error}</p>}{notice&&<p role="status" className="ai-settings-notice">{notice}</p>}
  </div>;
}
