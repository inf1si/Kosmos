'use client';

import { useEffect,useRef,useState } from 'react';
import { deleteSkill,MAX_SKILLS,saveSkill,type AISkill } from '@/lib/ai-prompt-presets';
import { uid } from '@/lib/model';
import { useStudio } from './studio-provider';

const blank:AISkill={id:'new',title:'',description:'',prompt:'',updatedAt:''};

export function AISkillEditor({focus=false}:{focus?:boolean}){
  const studio=useStudio(),skills=studio.state?.aiPreferences?.skills||[];
  const [selectedId,setSelectedId]=useState(skills[0]?.id||'new'),baseline=useRef<AISkill>(skills[0]||blank);
  const [title,setTitle]=useState(baseline.current.title),[description,setDescription]=useState(baseline.current.description),[prompt,setPrompt]=useState(baseline.current.prompt);
  const [pending,setPending]=useState<string|null>(null),[deleteOpen,setDeleteOpen]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const section=useRef<HTMLElement>(null),picker=useRef<HTMLSelectElement>(null);
  useEffect(()=>{if(focus){section.current?.scrollIntoView({block:'start'});picker.current?.focus();}},[focus]);
  const selected=skills.find(p=>p.id===selectedId),readonly=!!studio.conflict||busy;
  const dirty=title!==baseline.current.title||description!==baseline.current.description||prompt!==baseline.current.prompt;
  const remoteChanged=selectedId!=='new'&&selected?.updatedAt!==baseline.current.updatedAt;

  function load(id:string){
    const skill=id==='new'?blank:skills.find(p=>p.id===id);

if(!skill){setError('스킬이 바뀌었습니다. 최신 목록에서 선택하세요.');

return;}

    baseline.current=skill;setSelectedId(id);setTitle(skill.title);setDescription(skill.description);setPrompt(skill.prompt);setPending(null);setDeleteOpen(false);setError('');setNotice('');
  }

  function save(){
    if(readonly){setError('원고 충돌을 해결한 뒤 스킬을 저장하세요.');

return;}

    const id=selectedId==='new'?uid():selectedId;

    try{
      let saved:AISkill|undefined;
      studio.update(state=>{const next=saveSkill(state.aiPreferences,{id,title,description,prompt},selectedId==='new'?undefined:baseline.current.updatedAt);saved=next.skills!.find(p=>p.id===id);

return {...state,aiPreferences:next};});
      baseline.current=saved!;setSelectedId(id);setTitle(saved!.title);setDescription(saved!.description);setPrompt(saved!.prompt);setPending(null);setError('');setNotice('스킬을 저장했습니다. 본문에서 / 또는 선택한 글 우클릭으로 부를 수 있습니다.');
    }catch(e){setError(e instanceof Error?e.message:'스킬을 저장하지 못했습니다.');}
  }

  async function remove(){
    if(readonly||!selected)return;setBusy(true);setError('');

    try{await studio.snapshot('AI 스킬 삭제 전');studio.update(state=>({...state,aiPreferences:deleteSkill(state.aiPreferences,selectedId,baseline.current.updatedAt)}));baseline.current=blank;setSelectedId('new');setTitle('');setDescription('');setPrompt('');setDeleteOpen(false);setNotice('스킬을 삭제했습니다.');}
    catch(e){setError(e instanceof Error?e.message:'삭제하지 못했습니다.');}finally{setBusy(false);}
  }

  return <section ref={section} aria-labelledby="ai-skill-title" className="ai-prompt-editor"><h3 id="ai-skill-title">내 스킬</h3>
    <div className="ai-preset-picker"><label>편집할 스킬<select ref={picker} aria-label="편집할 스킬" value={selectedId} disabled={readonly} onChange={e=>{if(dirty){setPending(e.target.value);setDeleteOpen(false);}else load(e.target.value);}}>{skills.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}{selectedId!=='new'&&!selected&&<option value={selectedId}>삭제된 스킬의 편집본</option>}<option value="new">새 스킬 작성</option></select></label></div>
    {pending&&<div className="ai-prompt-confirm" role="status"><p>저장하지 않은 변경이 있습니다.</p><button type="button" onClick={()=>load(pending)} disabled={readonly}>편집을 버리고 전환</button><button type="button" onClick={()=>setPending(null)}>계속 편집</button></div>}
    {remoteChanged&&<div className="ai-prompt-confirm" role="status"><p>다른 창에서 스킬이 바뀌었거나 삭제되었습니다.</p><button type="button" onClick={()=>load(selected?selected.id:'new')}>최신 내용 불러오기</button></div>}
    <label>스킬 이름<input aria-label="스킬 이름" maxLength={40} value={title} disabled={readonly} placeholder="예: 존댓말로 바꾸기" onChange={e=>setTitle(e.target.value)}/></label>
    <label>설명 (선택)<input aria-label="스킬 설명" maxLength={120} value={description} disabled={readonly} placeholder="검색에 사용할 설명" onChange={e=>setDescription(e.target.value)}/></label>
    <label htmlFor="ai-skill-prompt">요청</label>
    <textarea id="ai-skill-prompt" aria-label="스킬 요청" rows={6} maxLength={2000} value={prompt} disabled={readonly} placeholder="예: 보낸 글을 인물의 존댓말 말투로 바꿔 줘. 설명 없이 바꾼 글만 답해 줘." onChange={e=>setPrompt(e.target.value)}/>
    <p className="ai-settings-help">{prompt.length.toLocaleString()} / 2,000자 · 스킬 {skills.length} / {MAX_SKILLS}개</p>
    <div className="ai-settings-actions">{selected&&<button type="button" disabled={readonly||remoteChanged} onClick={()=>setDeleteOpen(v=>!v)}>스킬 삭제</button>}<button type="button" disabled={readonly||remoteChanged||!title.trim()||!prompt.trim()||(!dirty&&selectedId!=='new')} onClick={save}>{selectedId==='new'?'새 스킬 저장':'스킬 저장'}</button></div>
    {deleteOpen&&<div className="ai-prompt-confirm"><p>이 스킬을 삭제할까요?</p><button type="button" disabled={readonly} onClick={()=>void remove()}>삭제</button><button type="button" onClick={()=>setDeleteOpen(false)}>취소</button></div>}
    {error&&<p role="alert" className="ai-settings-error">{error}</p>}{notice&&<p role="status" className="ai-settings-notice">{notice}</p>}
  </section>;
}
