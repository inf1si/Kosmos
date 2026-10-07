'use client';

import { providerSchema } from '@/lib/ai-provider';
import { useEffect,useState } from 'react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { type AIProviderStatus,type CredentialInput } from '@/lib/ai-settings';
import { Modal } from './primitives';
import { AIPromptEditor } from './ai-prompt-editor';
import { AISkillEditor } from './ai-skill-editor';

type PanelProps={providers:AIProviderStatus[];providerId:AIProviderStatus['id'];storageAvailable:boolean;onRefresh:(provider:AIProviderStatus['id'])=>Promise<void>;section?:'skills'};

export function AISettingsDialog({onClose,onReturnFocus,...panel}:PanelProps&{onClose:()=>void;onReturnFocus:()=>void}){
  return <Modal open onClose={onClose} onReturnFocus={onReturnFocus} title="AI 설정" description="제공자 연결·시스템 프롬프트·내 스킬을 설정하세요. 원고를 보내거나 AI를 호출하지 않고 저장합니다." wide>
    <AISettingsPanel {...panel}/>
  </Modal>;
}

/** The AI settings body, shared by the AI settings dialog and the AI section of the settings dialog. */
export function AISettingsPanel({providers,providerId,storageAvailable,onRefresh,section}:PanelProps){
  const [provider,setProvider]=useState(providerId),[model,setModel]=useState(''),[key,setKey]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const selected=providers.find(p=>p.id===provider)!;
  useEffect(()=>{setModel(selected.model||'');setKey('');},[provider,selected.model]);

  async function change(remove=false){
    if(busy)return;setBusy(true);setError('');setNotice('');

    try{
      const session=(await cloud().auth.getSession()).data.session;

if(!session)throw new Error('작가 로그인이 필요합니다.');
      const connection:CredentialInput={provider,model:model.trim()};

      if(key.trim())connection.key=key.trim();
      const response=await fetch('/api/ai/settings',{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(remove?{provider}:connection)});
      const body=await response.json();

if(!response.ok)throw new Error(body.error||'AI 설정을 저장하지 못했습니다.');
      setKey('');await onRefresh(provider);setNotice(remove?'브라우저 연결을 해제했습니다. 서버 설정이 있으면 다시 사용합니다.':'키와 모델을 이 브라우저에 보관했습니다. 실제 연결은 첫 대화에서 확인됩니다.');
    }catch(e){setError(e instanceof Error?e.message:'AI 설정을 저장하지 못했습니다.');}
    finally{setBusy(false);}
  }

  return <div className="ai-settings">
      <section aria-labelledby="ai-connection-title"><h3 id="ai-connection-title">제공자 연결</h3>
        <form onSubmit={e=>{e.preventDefault();void change();}}>
          <div className="ai-settings-grid"><label>제공자<select aria-label="설정할 AI 제공자" value={provider} disabled={busy} onChange={e=>{setProvider(providerSchema.parse(e.target.value));setError('');setNotice('');}}>{providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>모델 ID<input aria-label="AI 모델 ID" value={model} maxLength={200} required disabled={busy} autoComplete="off" spellCheck={false} placeholder="제공자의 모델 ID" onChange={e=>setModel(e.target.value)}/></label></div>
          <p className="ai-settings-state">{selected.browserInvalid?'브라우저에 보관한 연결이 만료되었거나 읽히지 않습니다. 다시 입력하거나 해제하세요.':selected.source==='browser'?'이 브라우저의 키·모델을 사용합니다.':selected.source==='server'?'Vercel 서버에 설정된 키·모델을 사용합니다. 새 키를 넣으면 이 브라우저에서 우선 사용합니다.':'API 키와 모델을 입력하면 이 제공자로 대화할 수 있습니다.'}</p>
          <label>API 키<input type="password" aria-label="AI API 키" value={key} maxLength={1600} autoComplete="new-password" spellCheck={false} disabled={busy||!cloudConfigured||!storageAvailable} placeholder={selected.source==='browser'?'보관된 키 유지 · 교체할 때만 입력':'이 제공자의 API 키 붙여 넣기'} onChange={e=>setKey(e.target.value)}/></label>
          <p className="ai-settings-help">키는 서버가 암호화해 이 브라우저에 최대 30일 보관합니다. 저장한 값은 다시 표시하지 않으며 원고·대화·백업에 포함하지 않습니다. 다른 기기나 도메인에서는 다시 입력하세요.</p>
          {!cloudConfigured&&<p className="ai-settings-help">API 키 저장은 로그인한 운영 집필실에서 사용할 수 있습니다.</p>}
          {cloudConfigured&&!storageAvailable&&<p className="ai-settings-help">서버에 AI 키 보관용 암호화 설정이 필요합니다. 시스템 프롬프트는 먼저 저장할 수 있습니다.</p>}
          <div className="ai-settings-actions">{selected.browserStored&&<button type="button" disabled={busy||!cloudConfigured} onClick={()=>void change(true)}>브라우저 연결 해제</button>}<button type="submit" className="primary" disabled={busy||!cloudConfigured||!storageAvailable||!model.trim()||(!key.trim()&&selected.source!=='browser')}>{busy?'처리 중…':'연결 저장'}</button></div>
        </form>
      </section>
      <AIPromptEditor/>
      <AISkillEditor focus={section==='skills'}/>
      {error&&<p role="alert" className="ai-settings-error">{error}</p>}{notice&&<p role="status" className="ai-settings-notice">{notice}</p>}
    </div>;
}
