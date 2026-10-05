'use client';
import { useEffect,useRef,useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ArrowUp,Lightbulb,ListCollapse,MessageCircleQuestionMark,PanelRight,PenLine,Settings2,X } from 'lucide-react';
import { applyEditorTarget,targetIsCurrent,type EditorTarget } from '@/lib/editor-target';
import { chatMessageSchema,recentChatHistory,type EditorAIScope } from '@/lib/ai-conversation';
import { appendEditorExchange,editorAIOrigin,editorAIMessages,editorAIIsFull } from '@/lib/editor-ai-conversation';
import { activePromptPreset,promptCatalog,activatePromptPreset,type AISkill } from '@/lib/ai-prompt-presets';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { uid } from '@/lib/model';
import { useStudio } from './studio-provider';
import { useAIConnection } from './use-ai-connection';
import { AISettingsDialog } from './ai-settings-dialog';
import { IconButton } from './primitives';

export type EditorAIAction='ask'|'summarize'|'rewrite'|'expand'|`skill:${string}`;
export const editorAIActions=[{id:'summarize' as const,label:'요약',icon:ListCollapse,question:'보낸 글의 핵심을 짧게 요약해 줘. 설명 없이 바로 사용할 요약문으로 답해 줘.'},{id:'rewrite' as const,label:'문장 다듬기',icon:PenLine,question:'보낸 글의 의미와 문체를 유지하며 문장을 다듬어 줘. 설명 없이 다듬은 글 전체로 답해 줘.'},{id:'expand' as const,label:'아이디어 확장',icon:Lightbulb,question:'보낸 글에서 이어질 아이디어를 세 가지 제안해 줘. 원래 내용과 새 제안을 구분해 줘.'},{id:'ask' as const,label:'질문하기',icon:MessageCircleQuestionMark,question:''}];
/** A deleted skill falls back to an empty question rather than a stale request. */
export function editorAIQuestion(action:EditorAIAction,skills:readonly AISkill[]=[]){
  return action.startsWith('skill:')?skills.find(p=>`skill:${p.id}`===action)?.prompt||'':editorAIActions.find(a=>a.id===action)?.question||'';
}
export function EditorInlineAI({editor,scope,target,action,onClose,onContinue}:{editor:Editor;scope:EditorAIScope;target:EditorTarget;action:EditorAIAction;onClose:()=>void;onContinue:()=>void}){
  const s=useStudio(),live=useRef(s);live.current=s;
  const connection=useAIConnection(),{providers,provider,setProvider,currentProvider,loadingProviders,storageAvailable,refreshProviders,connectionError}=connection;
  const skills=s.state?.aiPreferences?.skills||[];
  const [request,setRequest]=useState<EditorAIAction>(action),[question,setQuestion]=useState(()=>editorAIQuestion(action,skills)),[answer,setAnswer]=useState(''),[hasAnswer,setHasAnswer]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[settings,setSettings]=useState(false);
  const [revision,setRevision]=useState(0);const questionInput=useRef<HTMLTextAreaElement>(null);const alive=useRef(true),locked=useRef(false),settingsTrigger=useRef<HTMLElement|null>(null);
  useEffect(()=>{alive.current=true;const change=()=>setRevision(v=>v+1);editor.on('transaction',change);return()=>{alive.current=false;editor.off('transaction',change);};},[editor]);
  useEffect(()=>{questionInput.current?.focus();},[]);
  const noun=scope.noteId?'노트':'문서',preset=activePromptPreset(s.state?.aiPreferences);
  const current=targetIsCurrent(editor,target);void revision;
  const full=editorAIIsFull(s.state,scope);
  const configured=cloudConfigured&&currentProvider.configured;
  async function send(){
    if(locked.current||!question.trim()||!configured||!current||full||s.conflict||target.text.length>12000)return;
    locked.current=true;setBusy(true);setError('');
    const prompt=question.trim(),chosen=provider;
    try{
      await live.current.flush();await live.current.syncNow();
      const origin=editorAIOrigin(live.current.state,scope);
      if(!origin||!targetIsCurrent(editor,target)||live.current.conflict)throw new Error(`${noun}가 바뀌었습니다. 현재 글에서 다시 질문하세요.`);
      if(editorAIIsFull(live.current.state,scope))throw new Error('대화 한도입니다. 대화를 보관하고 새 대화를 시작하세요.');
      const history=editorAIMessages(live.current.state,scope),active=activePromptPreset(live.current.state?.aiPreferences);
      const session=(await cloud().auth.getSession()).data.session;if(!session)throw new Error('작가 로그인이 필요합니다.');
      if(!alive.current)return;
      const range={kind:target.kind,from:target.from,to:target.to,text:target.text};
      const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({...scope,version:origin.updatedAt,provider:chosen,message:prompt,includeManuscript:true,sourceIds:[],history:recentChatHistory(history),systemPrompt:active.prompt,promptPresetId:active.id,...(scope.noteId?{noteRange:range}:{documentRange:range})})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'답변을 받지 못했습니다.');
      if(body.version!==origin.updatedAt)throw new Error(`답변의 ${noun} 버전이 다릅니다. 다시 질문하세요.`);
      const result=chatMessageSchema.parse({id:uid(),role:'assistant',createdAt:new Date().toISOString(),result:body.result,provider:chosen,model:body.model,version:body.version,sources:body.sources,promptPreset:body.promptPreset});
      if(result.role!=='assistant'||!result.result.review.trim())throw new Error('답변 형식을 확인하세요.');
      // The sidebar must never apply a range reply by searching for a repeated quote elsewhere.
      live.current.update(state=>appendEditorExchange(state,scope,history.length,prompt,{...result,result:{review:result.result.review,suggestions:[]}}));
      await live.current.flush();if(alive.current){setAnswer(result.result.review);setHasAnswer(true);}
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'답변을 받지 못했습니다.');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  async function apply(mode:'replace'|'insert'){
    if(locked.current)return;locked.current=true;setBusy(true);setError('');
    try{await live.current.snapshot('AI 답변 적용 전');if(!alive.current)return;if(live.current.conflict)throw new Error('저장 충돌을 먼저 확인하세요.');applyEditorTarget(editor,target,answer,mode);onClose();}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'답변을 적용하지 못했습니다.');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  return <div className="note-inline-ai">
    <div className="chat-heading"><strong>AI 질문</strong><IconButton label="AI 설정" disabled={busy||loadingProviders} onClick={e=>{settingsTrigger.current=e.currentTarget;setSettings(true);}}><Settings2 size={16}/></IconButton><IconButton label="AI 대화에서 계속" disabled={busy} onClick={onContinue}><PanelRight size={16}/></IconButton><IconButton label="AI 질문 닫기" onClick={onClose}><X size={16}/></IconButton></div>
    <details className="chat-context"><summary>{target.kind==='selection'?'선택한 글':'현재 문단'} · {target.text.length.toLocaleString()}자</summary><p className="note-ai-target">{target.text||'빈 문단'}</p></details>
    <div className="note-ai-settings"><label>제공자<select aria-label="AI 질문 제공자" value={provider} disabled={busy||loadingProviders} onChange={e=>setProvider(e.target.value as typeof provider)}>{providers.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.label}{p.configured?'':' · 연결 필요'}</option>)}</select></label><label>프리셋<select aria-label="AI 질문 프리셋" value={preset.id} disabled={busy||!!s.conflict} onChange={e=>s.update(state=>({...state,aiPreferences:activatePromptPreset(state.aiPreferences,e.target.value)}))}>{promptCatalog(s.state?.aiPreferences).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label className="note-ai-request">스킬<select aria-label="AI 질문 스킬" value={request} disabled={busy||hasAnswer} onChange={e=>{const next=e.target.value as EditorAIAction;setRequest(next);setQuestion(editorAIQuestion(next,skills));questionInput.current?.focus();}}><option value="ask">직접 질문</option><optgroup label="기본">{editorAIActions.filter(a=>a.id!=='ask').map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>{skills.length>0&&<optgroup label="내 스킬">{skills.map(p=><option key={p.id} value={`skill:${p.id}`}>{p.title}</option>)}</optgroup>}{request.startsWith('skill:')&&!skills.some(p=>`skill:${p.id}`===request)&&<option value={request}>삭제된 스킬</option>}</select></label></div>
    {!configured&&!loadingProviders&&<div className="chat-connection"><p>AI 연결을 설정하면 질문할 수 있습니다.</p><button onClick={e=>{settingsTrigger.current=e.currentTarget;setSettings(true);}}>AI 설정 열기</button></div>}
    {hasAnswer?<><label className="note-ai-answer">답변<textarea aria-label="적용할 AI 답변" rows={5} value={answer} maxLength={15000} disabled={busy} onChange={e=>setAnswer(e.target.value)}/></label><div className="popover-actions"><button disabled={busy} onClick={onClose}>취소</button><button disabled={busy||!current||!answer.trim()||!!s.conflict} onClick={()=>void apply('insert')}>커서에 삽입</button><button className="primary" disabled={busy||!current||!answer.trim()||!!s.conflict} onClick={()=>void apply('replace')}>{target.kind==='selection'?'선택 부분 바꾸기':'문단 바꾸기'}</button></div><button className="chat-secondary" disabled={busy} onClick={()=>{setHasAnswer(false);setAnswer('');setError('');}}>다시 질문</button></>:<form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={questionInput} aria-label="AI에게 질문" rows={3} maxLength={2000} disabled={busy||!!s.conflict} placeholder="이 글에 대해 질문하세요…" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span>{busy?'답변을 준비하고 있어요…':'Enter 전송 · Shift+Enter 줄바꿈'}</span><button type="submit" className="primary" aria-label="AI 질문 보내기" disabled={busy||loadingProviders||!configured||!current||full||!question.trim()||target.text.length>12000||!!s.conflict}><ArrowUp size={16}/></button></div></form>}
    {!current&&<p className="chat-error" role="status">{noun}가 바뀌었습니다. 현재 글에서 다시 질문하세요.</p>}
    {target.text.length>12000&&<p className="chat-error">12,000자 이내로 선택하세요.</p>}{full&&<p className="chat-error">AI 대화에서 기록을 보관하고 새 대화를 시작하세요.</p>}
    {(error||connectionError)&&<p className="chat-error" role="alert">{error||connectionError}</p>}
    <small>선택한 글·최근 대화·프리셋을 보냅니다. 하루 10회 · 답변은 {noun} 대화에 저장됩니다.</small>
    {settings&&<AISettingsDialog providers={providers} providerId={provider} storageAvailable={storageAvailable} onRefresh={refreshProviders} onClose={()=>setSettings(false)} onReturnFocus={()=>settingsTrigger.current?.focus()}/>}
  </div>;
}
