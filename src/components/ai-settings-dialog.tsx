'use client';
import { useEffect,useState } from 'react';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { DEFAULT_AI_SYSTEM_PROMPT,type AIProviderStatus } from '@/lib/ai-settings';
import { Modal } from './primitives';

export function AISettingsDialog({providers,providerId,storageAvailable,systemPrompt,onSavePrompt,onRefresh,onClose,onReturnFocus}:{providers:AIProviderStatus[];providerId:AIProviderStatus['id'];storageAvailable:boolean;systemPrompt:string;onSavePrompt:(value:string)=>boolean;onRefresh:(provider:AIProviderStatus['id'])=>Promise<void>;onClose:()=>void;onReturnFocus:()=>void}){
  const [provider,setProvider]=useState(providerId),[model,setModel]=useState(''),[key,setKey]=useState(''),[draft,setDraft]=useState(systemPrompt);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const selected=providers.find(p=>p.id===provider)!;
  useEffect(()=>{setModel(selected.model||'');setKey('');},[provider,selected.model]);
  async function change(remove=false){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      const session=(await cloud().auth.getSession()).data.session;if(!session)throw new Error('작가 로그인이 필요합니다.');
      const response=await fetch('/api/ai/settings',{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(remove?{provider}:{provider,model:model.trim(),...(key.trim()?{key:key.trim()}:{})})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'AI 설정을 저장하지 못했습니다.');
      setKey('');await onRefresh(provider);setNotice(remove?'브라우저 연결을 해제했습니다. 서버 설정이 있으면 다시 사용합니다.':'키와 모델을 이 브라우저에 보관했습니다. 실제 연결은 첫 대화에서 확인됩니다.');
    }catch(e){setError(e instanceof Error?e.message:'AI 설정을 저장하지 못했습니다.');}
    finally{setBusy(false);}
  }
  return <Modal open onClose={onClose} onReturnFocus={onReturnFocus} title="AI 설정" description="제공자 연결과 시스템 프롬프트를 설정하세요. 원고를 보내거나 AI를 호출하지 않고 저장합니다." wide>
    <div className="ai-settings">
      <section aria-labelledby="ai-connection-title"><h3 id="ai-connection-title">제공자 연결</h3>
        <form onSubmit={e=>{e.preventDefault();void change();}}>
          <div className="ai-settings-grid"><label>제공자<select aria-label="설정할 AI 제공자" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value as AIProviderStatus['id']);setError('');setNotice('');}}>{providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>모델 ID<input aria-label="AI 모델 ID" value={model} maxLength={200} required disabled={busy} autoComplete="off" spellCheck={false} placeholder="제공자의 모델 ID" onChange={e=>setModel(e.target.value)}/></label></div>
          <p className="ai-settings-state">{selected.browserInvalid?'브라우저에 보관한 연결이 만료되었거나 읽히지 않습니다. 다시 입력하거나 해제하세요.':selected.source==='browser'?'이 브라우저의 키·모델을 사용합니다.':selected.source==='server'?'Vercel 서버에 설정된 키·모델을 사용합니다. 새 키를 넣으면 이 브라우저에서 우선 사용합니다.':'API 키와 모델을 입력하면 이 제공자로 대화할 수 있습니다.'}</p>
          <label>API 키<input type="password" aria-label="AI API 키" value={key} maxLength={1600} autoComplete="new-password" spellCheck={false} disabled={busy||!cloudConfigured||!storageAvailable} placeholder={selected.source==='browser'?'보관된 키 유지 · 교체할 때만 입력':'이 제공자의 API 키 붙여 넣기'} onChange={e=>setKey(e.target.value)}/></label>
          <p className="ai-settings-help">키는 서버가 암호화해 이 브라우저에 최대 30일 보관합니다. 저장한 값은 다시 표시하지 않으며 원고·대화·백업에 포함하지 않습니다. 다른 기기나 도메인에서는 다시 입력하세요.</p>
          {!cloudConfigured&&<p className="ai-settings-help">API 키 저장은 로그인한 운영 집필실에서 사용할 수 있습니다.</p>}
          {cloudConfigured&&!storageAvailable&&<p className="ai-settings-help">서버에 AI 키 보관용 암호화 설정이 필요합니다. 시스템 프롬프트는 먼저 저장할 수 있습니다.</p>}
          <div className="ai-settings-actions">{selected.browserStored&&<button type="button" disabled={busy||!cloudConfigured} onClick={()=>void change(true)}>브라우저 연결 해제</button>}<button type="submit" className="primary" disabled={busy||!cloudConfigured||!storageAvailable||!model.trim()||(!key.trim()&&selected.source!=='browser')}>{busy?'처리 중…':'연결 저장'}</button></div>
        </form>
      </section>
      <section aria-labelledby="ai-system-title"><h3 id="ai-system-title">시스템 프롬프트</h3>
        <label className="ai-settings-help" htmlFor="ai-system-prompt">문체·답변 방식·집필 방향을 정하세요. 세 제공자의 다음 질문부터 적용되며, 이미 받은 답변은 그대로 남습니다.</label>
        <textarea id="ai-system-prompt" aria-label="시스템 프롬프트" rows={7} maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder={DEFAULT_AI_SYSTEM_PROMPT}/>
        <p className="ai-settings-help">이 브라우저에 저장 · {draft.length.toLocaleString()} / 4,000자. 비워두면 기본 프롬프트를 사용합니다. 자료 범위·응답 형식·수정 적용 규칙은 계속 유지됩니다.</p>
        <div className="ai-settings-actions"><button type="button" onClick={()=>{setDraft(DEFAULT_AI_SYSTEM_PROMPT);setNotice('기본 프롬프트를 불러왔습니다. 저장하면 적용됩니다.');}}>기본값 불러오기</button><button type="button" onClick={()=>{setError('');const persistent=onSavePrompt(draft);setNotice(persistent?'시스템 프롬프트를 저장했습니다. 다음 질문부터 적용됩니다.':'이 탭에 적용했습니다. 브라우저 저장 공간이 없어 새로고침하면 다시 입력해야 합니다.');}}>프롬프트 저장</button></div>
      </section>
      {error&&<p role="alert" className="ai-settings-error">{error}</p>}{notice&&<p role="status" className="ai-settings-notice">{notice}</p>}
    </div>
  </Modal>;
}
