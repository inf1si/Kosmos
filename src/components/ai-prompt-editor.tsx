'use client';

import { useRef,useState } from 'react';
import { DEFAULT_AI_SYSTEM_PROMPT } from '@/lib/ai-settings';
import { activePromptPreset,activatePromptPreset,deletePromptPreset,DEFAULT_PROMPT_ID,MAX_CUSTOM_PRESETS,promptCatalog,savePromptPreset,type AIPreferences,type PromptPreset } from '@/lib/ai-prompt-presets';
import { uid } from '@/lib/model';
import { useStudio } from './studio-provider';
import { useLegacyAISystemPrompt } from './use-ai-system-prompt';

export function AIPromptEditor(){
  const studio=useStudio(),preferences=studio.state?.aiPreferences,catalog=promptCatalog(preferences),active=activePromptPreset(preferences);
  const [selectedId,setSelectedId]=useState(active.id),[name,setName]=useState(active.title),[draft,setDraft]=useState(active.prompt);
  const baseline=useRef<PromptPreset>(active);
  const [pendingSelection,setPendingSelection]=useState<string|null>(null),[deleteOpen,setDeleteOpen]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const legacy=useLegacyAISystemPrompt(),canImport=legacy&&!preferences?.presets.some(p=>p.prompt===legacy);
  const selected=catalog.find(p=>p.id===selectedId),readonly=!!studio.conflict||busy;
  const dirty=name!==baseline.current.title||draft!==baseline.current.prompt;
  const remoteChanged=selectedId!=='new'&&(!selected||selected.prompt!==baseline.current.prompt||selected.title!==baseline.current.title||selected.updatedAt!==baseline.current.updatedAt);

  function load(id:string){
    const preset=id==='new'?{id:'new',title:'새 프리셋',prompt:DEFAULT_AI_SYSTEM_PROMPT,updatedAt:'',builtin:false}:catalog.find(p=>p.id===id);

    if(!preset){setError('프리셋이 바뀌었습니다. 최신 목록에서 선택하세요.');

return;}

    baseline.current=preset;setSelectedId(id);setName(preset.title);setDraft(preset.prompt);setPendingSelection(null);setDeleteOpen(false);setError('');setNotice('');
  }

  function select(id:string){if(dirty){setPendingSelection(id);setDeleteOpen(false);}else load(id);}

  function change(fn:(value:AIPreferences|undefined)=>AIPreferences){
    if(readonly){setError('원고 충돌을 해결한 뒤 프리셋을 저장하세요.');

return null;}

    let result:AIPreferences|null=null;

    try{studio.update(state=>{result=fn(state.aiPreferences);

return {...state,aiPreferences:result};});setError('');

return result;}catch(e){setError(e instanceof Error?e.message:'프리셋을 저장하지 못했습니다.');

return null;}
  }

  function save(copy=false){
    const newPreset=copy||selectedId==='new'||baseline.current.builtin,id=newPreset?uid():selectedId;
    const title=copy?`${name.trim()} · 사본`:baseline.current.builtin&&name===baseline.current.title?`${name} · 사용자`:name;
    const next=change(p=>savePromptPreset(p,{id,title,prompt:draft},newPreset?undefined:baseline.current.updatedAt));

if(!next)return;
    const saved=promptCatalog(next).find(p=>p.id===id)!;baseline.current=saved;setSelectedId(id);setName(saved.title);setDraft(saved.prompt);setPendingSelection(null);setDeleteOpen(false);setNotice('프리셋을 저장·적용했습니다. 저장 상태에서 클라우드 동기화를 확인하세요.');
  }

  function activate(id=selectedId){
    const next=change(p=>activatePromptPreset(p,id));

if(!next)return;

    if(id===DEFAULT_PROMPT_ID){const preset=activePromptPreset(next);baseline.current=preset;setSelectedId(id);setName(preset.title);setDraft(preset.prompt);setPendingSelection(null);setDeleteOpen(false);}

    setNotice(id===DEFAULT_PROMPT_ID?'기본 프롬프트로 재설정했습니다. 사용자 프리셋은 보관됩니다.':'선택한 프리셋을 적용했습니다. 다음 질문부터 사용합니다.');
  }

  async function remove(){
    if(readonly||!selected||selected.builtin)return;setBusy(true);setError('');

    try{
      await studio.snapshot('AI 프리셋 삭제 전');
      studio.update(state=>({...state,aiPreferences:deletePromptPreset(state.aiPreferences,selectedId,baseline.current.updatedAt)}));
      const preset=catalog.find(p=>p.id===DEFAULT_PROMPT_ID)!;baseline.current=preset;setSelectedId(preset.id);setName(preset.title);setDraft(preset.prompt);setDeleteOpen(false);setNotice('프리셋을 삭제했습니다. 삭제 전 설정은 복구 이력에 있습니다.');
    }catch(e){setError(e instanceof Error?e.message:'삭제하지 못했습니다.');}finally{setBusy(false);}
  }

  return <section aria-labelledby="ai-system-title" className="ai-prompt-editor"><h3 id="ai-system-title">시스템 프롬프트·프리셋</h3>
    <p className="ai-settings-help">현재 적용: <strong>{active.title}</strong> · {studio.status}. 프리셋은 이 계정의 작품 전체에서 사용하며 원고와 함께 저장·동기화·백업됩니다.</p>
    <div className="ai-preset-picker"><label>프롬프트 프리셋<select aria-label="편집할 프롬프트 프리셋" value={selectedId} disabled={readonly} onChange={e=>select(e.target.value)}><optgroup label="기본 프리셋">{catalog.filter(p=>p.builtin).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</optgroup><optgroup label="사용자 프리셋">{catalog.filter(p=>!p.builtin).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</optgroup>{selectedId!=='new'&&!selected&&<option value={selectedId}>삭제된 프리셋의 편집본</option>}<option value="new">새 프리셋 작성</option></select></label><button type="button" disabled={readonly||!selected||dirty||remoteChanged} onClick={()=>activate()}>선택 적용</button></div>
    {pendingSelection&&<div className="ai-prompt-confirm" role="status"><p>저장하지 않은 편집이 있습니다. 저장하거나 편집 내용을 버리고 전환하세요.</p><button type="button" onClick={()=>load(pendingSelection)} disabled={readonly}>편집을 버리고 전환</button><button type="button" onClick={()=>setPendingSelection(null)}>계속 편집</button></div>}
    {remoteChanged&&<div className="ai-prompt-confirm" role="status"><p>다른 창의 프리셋이 바뀌었습니다. 현재 편집본을 사본으로 보관하거나 최신 내용을 불러오세요.</p><button type="button" onClick={()=>selected?load(selected.id):load(DEFAULT_PROMPT_ID)}>최신 내용 불러오기</button></div>}
    <label>프리셋 이름<input aria-label="프리셋 이름" maxLength={80} value={name} disabled={readonly} onChange={e=>setName(e.target.value)}/></label>
    <label className="ai-settings-help" htmlFor="ai-system-prompt">문체·답변 방식·집필 방향을 정하세요. 기본 프리셋을 수정하면 사용자 프리셋으로 저장합니다.</label>
    <textarea id="ai-system-prompt" aria-label="시스템 프롬프트" rows={9} maxLength={4000} value={draft} disabled={readonly} onChange={e=>setDraft(e.target.value)} placeholder={DEFAULT_AI_SYSTEM_PROMPT}/>
    <p className="ai-settings-help">{draft.length.toLocaleString()} / 4,000자 · 사용자 프리셋 {preferences?.presets.length||0} / {MAX_CUSTOM_PRESETS}개. 빈 지침은 기본값으로 저장합니다. 선택 적용·저장·재설정은 AI를 호출하지 않습니다.</p>
    <div className="ai-settings-actions"><button type="button" disabled={readonly} onClick={()=>{if(dirty)setPendingSelection(DEFAULT_PROMPT_ID);else activate(DEFAULT_PROMPT_ID);}}>기본값으로 재설정</button><button type="button" disabled={readonly||!name.trim()} onClick={()=>save(true)}>사본으로 저장·적용</button><button type="button" disabled={readonly||!name.trim()||remoteChanged} onClick={()=>save()}>{baseline.current.builtin||selectedId==='new'?'새 프리셋으로 저장·적용':'프리셋 저장·적용'}</button></div>
    {pendingSelection===DEFAULT_PROMPT_ID&&<button type="button" className="chat-secondary" disabled={readonly} onClick={()=>activate(DEFAULT_PROMPT_ID)}>편집을 버리고 기본값 적용</button>}
    {selected&&!selected.builtin&&<div className="ai-settings-actions"><button type="button" disabled={readonly||remoteChanged} onClick={()=>setDeleteOpen(v=>!v)}>사용자 프리셋 삭제</button></div>}
    {deleteOpen&&<div className="ai-prompt-confirm"><p>삭제 전 설정을 복구 이력에 보관합니다. 적용 중인 프리셋을 삭제하면 기본값으로 돌아갑니다.</p><button type="button" disabled={readonly} onClick={()=>void remove()}>삭제</button><button type="button" onClick={()=>setDeleteOpen(false)}>취소</button></div>}
    {canImport&&<div className="ai-prompt-confirm"><p>이 브라우저에 이전 버전의 사용자 지침이 있습니다. 현재 계정의 프리셋으로 가져올 수 있습니다.</p><button type="button" disabled={readonly||dirty} onClick={()=>{load('new');setName('이전 브라우저 지침');setDraft(legacy);setNotice('이전 지침을 불러왔습니다. 저장·적용하면 이 계정에 동기화합니다.');}}>이전 지침 불러오기</button></div>}
    {error&&<p role="alert" className="ai-settings-error">{error}</p>}{notice&&<p role="status" className="ai-settings-notice">{notice}</p>}
  </section>;
}
