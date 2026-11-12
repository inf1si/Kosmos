'use client';

import { useCallback,useEffect,useRef,useState } from 'react';
import { z } from 'zod';
import { ArrowUp,Download,FileText,MessageSquarePlus,Square,Undo2 } from 'lucide-react';
import { Modal,TooltipProvider } from './primitives';
import { useAIConnection } from './use-ai-connection';
import { Select } from './select';
import { useStudio } from './studio-provider';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { db } from '@/lib/database';
import { uid } from '@/lib/model';
import { resolveNoteNavigation } from '@/lib/note-navigation';
import { providerLabels,providerSchema,activeAIProviders,type AIProvider } from '@/lib/ai-provider';
import { agentSessionSchema,agentRunViewSchema,agentMemorySchema,agentChangesSchema,agentScopeSchema,agentModeSchema,type AgentSession,type AgentRunView,type AgentMemory,type AgentScope,type AgentMode } from '@/lib/writing-agent';

const stateNames={queued:'대기 중',running:'진행 중',completed:'완료',failed:'실패',cancelled:'중단'};

const modeNames={discuss:'함께 생각하기',review:'검토하며 실행',execute:'맡겨 실행'};

const indexSchema=z.object({sessions:z.array(agentSessionSchema),providers:z.array(z.object({id:providerSchema,configured:z.boolean(),model:z.string().nullable()})),webAvailable:z.boolean()});

const historySchema=z.object({session:agentSessionSchema,runs:z.array(agentRunViewSchema),memories:z.array(agentMemorySchema)});

export function openWritingAgent(scope:AgentScope){window.dispatchEvent(new CustomEvent('writing-agent-open',{detail:scope}));}

async function agentRequest<T extends z.ZodType>(owner:string|null,path:string,schema:T,method='GET',body?:string,signal?:AbortSignal):Promise<z.infer<T>>{
  if(!cloudConfigured)throw new Error('작가 계정으로 로그인한 뒤 사용할 수 있습니다.');
  const session=(await cloud().auth.getSession()).data.session,token=session?.access_token;

  if(session&&session.user.id!==owner)throw new Error('계정이 바뀌었습니다.');

  if(!token)throw new Error('작가 로그인이 필요합니다.');
  const response=await fetch(`/api/agent/${path}`,{method,body,signal,headers:{Authorization:`Bearer ${token}`,...body&&{'Content-Type':'application/json'}},cache:'no-store'}),value=await response.json();

  if(!response.ok)throw new Error(z.object({error:z.string()}).safeParse(value).data?.error||'작업 대화에 연결하지 못했습니다.');

  return schema.parse(value);
}

export function WritingAgentDialog(){
  const s=useStudio(),[open,setOpen]=useState(false),[initialScope,setInitialScope]=useState<AgentScope|null>(null);
  const [sessions,setSessions]=useState<AgentSession[]>([]),[selected,setSelected]=useState(''),[runs,setRuns]=useState<AgentRunView[]>([]),[memories,setMemories]=useState<AgentMemory[]>([]);
  const connection=useAIConnection(),providers=connection.providers;
  const [webAvailable,setWebAvailable]=useState(false);
  const [mode,setMode]=useState<AgentMode>('review'),[provider,setProvider]=useState<AIProvider>('gemini'),[web,setWeb]=useState(false),[view,setView]=useState<'chat'|'changes'|'memory'>('chat');
  const model=connection.modelFor(provider),models=providers.find(p=>p.id===provider)?.models||[];
  const [question,setQuestion]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[scopeValue,setScopeValue]=useState('');
  const generation=useRef(0),questionId=useRef(''),inputRef=useRef<HTMLTextAreaElement>(null),opener=useRef<HTMLElement|null>(null);
  const namespace=s.namespace,accountRef=useRef(namespace);accountRef.current=namespace;
  const [changes,setChanges]=useState<z.infer<typeof agentChangesSchema>|null>(null),[changeId,setChangeId]=useState('');

  const request=useCallback(async<T extends z.ZodType,>(path:string,schema:T,method='GET',body?:string,signal?:AbortSignal):Promise<z.infer<T>>=>{const owner=namespace;const value=await agentRequest(s.user,path,schema,method,body,signal);

if(accountRef.current!==owner)throw new Error('계정이 바뀌었습니다.');

return value;},[namespace,s.user]);

  useEffect(()=>{const show=(event:Event)=>{if(!(event instanceof CustomEvent))return;const parsed=agentScopeSchema.safeParse(event.detail);

    if(!parsed.success)return;opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setInitialScope(parsed.data);setScopeValue(`${parsed.data.kind}:${parsed.data.id}`);setOpen(true);};

    window.addEventListener('writing-agent-open',show);

return()=>window.removeEventListener('writing-agent-open',show);
  },[]);
  useEffect(()=>{generation.current++;setSelected('');setSessions([]);setRuns([]);setMemories([]);setQuestion('');questionId.current='';setOpen(false);},[namespace]);

  const loadIndex=useCallback(async(signal?:AbortSignal)=>{
    const value=await request('sessions',indexSchema,'GET',undefined,signal);setSessions(value.sessions);setWebAvailable(value.webAvailable);

return value;
  },[request]);

  useEffect(()=>{if(!open||!s.canUse)return;const abort=new AbortController();setLoading(true);setError('');
    void loadIndex(abort.signal).then(value=>{
      let saved='';

try{saved=localStorage.getItem(`orbis-agent-session:${namespace}`)||'';}catch{}

      const found=value.sessions.find(session=>session.id===saved);setSelected(found?.id||'');

      if(!found){const configured=value.providers.find(p=>p.configured);

if(configured)setProvider(configured.id);}
    }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'대화를 불러오지 못했습니다.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});

    return()=>abort.abort();
  },[open,namespace,s.canUse,loadIndex]);
  useEffect(()=>{if(!open||!selected){setRuns([]);setMemories([]);

return;}

    const abort=new AbortController(),current=++generation.current;let first=true;

    const read=async()=>{try{const value=await request(`sessions/${selected}`,historySchema,'GET',undefined,abort.signal);

if(current!==generation.current)return;setRuns(value.runs);setMemories(value.memories);

if(first){first=false;setMode(value.session.mode);setProvider(value.session.provider);setWeb(value.session.web);setScopeValue(`${value.session.scope.kind}:${value.session.scope.id}`);}}catch(e){if(!abort.signal.aborted&&current===generation.current)setError(e instanceof Error?e.message:'작업 기록을 읽지 못했습니다.');}};

    void read();const timer=setInterval(()=>void read(),2000);

    try{localStorage.setItem(`orbis-agent-session:${namespace}`,selected);}catch{}

    return()=>{abort.abort();clearInterval(timer);generation.current++;};
  },[open,selected,namespace,request]);
  const refresh=async()=>{if(!selected)return;const value=await request(`sessions/${selected}`,historySchema);setRuns(value.runs);setMemories(value.memories);};

  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');

try{await action();}catch(e){setError(e instanceof Error?e.message:'작업을 처리하지 못했습니다.');}finally{setBusy(false);}};

  const sync=async()=>{if(s.conflict)throw new Error('원고 충돌을 먼저 확인하세요.');await s.flush();await s.syncNow();const row=await db.workspaces.get(namespace);

if(!row||row.dirty||row.pendingRequest)throw new Error('원고 동기화를 마친 뒤 다시 시도하세요.');};

  const settings=async(change:{mode?:AgentMode;provider?:AIProvider;web?:boolean})=>{
    if(selected){await request(`sessions/${selected}`,z.object({session:agentSessionSchema}),'PATCH',JSON.stringify(change));setSessions(list=>list.map(session=>session.id===selected?{...session,...change}:session));}

    if(change.mode)setMode(change.mode);

if(change.provider)setProvider(change.provider);

if(change.web!==undefined)setWeb(change.web);
  };

  const send=()=>act(async()=>{
    if(!question.trim()||!initialScope||connection.loadingProviders)return;await sync();let id=selected;

    if(!id){const split=scopeValue.indexOf(':'),scope=agentScopeSchema.parse({kind:scopeValue.slice(0,split),id:scopeValue.slice(split+1)}),created=await request('sessions',z.object({session:agentSessionSchema}),'POST',JSON.stringify({id:uid(),title:question.trim().slice(0,80),scope,mode,provider,web}));id=created.session.id;setSessions(list=>[created.session,...list]);setSelected(id);}

    questionId.current ||=uid();await request(`sessions/${id}/messages`,z.object({run:agentRunViewSchema}),'POST',JSON.stringify({id:questionId.current,message:question.trim(),model,mode,provider,web}));questionId.current='';setQuestion('');setView('chat');const value=await request(`sessions/${id}`,historySchema);setRuns(value.runs);setMemories(value.memories);
  }).finally(()=>requestAnimationFrame(()=>inputRef.current?.focus()));

  const apply=(run:AgentRunView,revert=false)=>act(async()=>{await sync();await request(`changes/${run.id}/${revert?'revert':'apply'}`,z.object({version:z.number()}),'POST','{}');await s.refreshCloud();await refresh();});
  const active=runs.find(r=>r.status==='queued'||r.status==='running'),latest=runs.find(r=>r.id===changeId)||runs.findLast(r=>r.operations.length>0),session=sessions.find(session=>session.id===selected);
  const applied=runs.filter(run=>run.applied_version!==null).map(run=>`${run.id}:${run.applied_version}:${run.reverted}`).join('|');
  useEffect(()=>{if(open&&applied)void s.refreshCloud().catch(e=>setError(e instanceof Error?e.message:'원고 변경을 확인하세요.'));},[open,applied,s.refreshCloud]);
  useEffect(()=>{if(!open||view!=='changes'||!latest){setChanges(null);

return;}

const abort=new AbortController();void request(`runs/${latest.id}/changes`,agentChangesSchema,'GET',undefined,abort.signal).then(setChanges).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'변경을 불러오지 못했습니다.');});

return()=>abort.abort();},[open,view,latest?.id,latest?.operations.length,request]);
  const choices=s.state?[...s.state.works.map(work=>({value:`work:${work.id}`,label:work.title})),...resolveNoteNavigation(s.state).spaces.map(space=>({value:`notes:${space.id}`,label:`노트 · ${space.title||'이름 없는 작업공간'}`}))]:[];

  function openDocument(id:string){const scope=session?.scope||initialScope;

if(!scope)return;setOpen(false);window.dispatchEvent(new CustomEvent('writing-agent-source',{detail:{scope,id}}));}

  return <TooltipProvider><Modal open={open&&s.canUse} onClose={()=>setOpen(false)} title="작업 대화" wide className="writing-agent-dialog" onReturnFocus={()=>opener.current?.isConnected&&opener.current.focus()}>
    <div className="board-bar agent-toolbar"><div className="agent-session-choice"><Select aria-label="작업 대화 선택" disabled={busy} value={selected} onChange={value=>{setSelected(value);setError('');setView('chat');}}><option value="">새 대화</option>{sessions.map(session=><option key={session.id} value={session.id}>{session.title}</option>)}</Select><button type="button" className="button" aria-label="새 작업 대화" disabled={busy} onClick={()=>{generation.current++;setSelected('');setRuns([]);setMemories([]);setError('');setScopeValue(initialScope?`${initialScope.kind}:${initialScope.id}`:'');setView('chat');inputRef.current?.focus();}}><MessageSquarePlus size={15}/></button></div><div className="segmented" role="group" aria-label="작업 대화 보기">{([['chat','대화'],['changes','변경'],['memory','기억']] as const).map(([id,label])=><button type="button" key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}{id==='changes'&&latest?.operations.length?` ${latest.operations.length}`:''}</button>)}</div><button type="button" className="button" aria-label="AI 자료 내보내기" disabled={busy} onClick={()=>void act(async()=>{const value=await request('export',z.record(z.string(),z.json())),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='orbis-agent.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}><Download size={15}/></button></div>
    <div className="agent-settings"><Select aria-label="작업 자료 범위" value={scopeValue} disabled={!!selected||busy} onChange={setScopeValue}>{choices.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}</Select><Select aria-label="에이전트 실행 방식" value={mode} disabled={busy||!!active} onChange={value=>void act(()=>settings({mode:agentModeSchema.parse(value)}))}>{Object.entries(modeNames).map(([id,label])=><option value={id} key={id}>{label}</option>)}</Select><Select aria-label="에이전트 제공자" value={provider} disabled={busy||!!active} onChange={value=>void act(()=>settings({provider:providerSchema.parse(value)}))}>{activeAIProviders.map(id=><option key={id} value={id}>{providerLabels[id]}</option>)}</Select><button type="button" className="button" aria-pressed={web} disabled={busy||!!active||!webAvailable&&!web} onClick={()=>void act(()=>settings({web:!web}))}>웹 조사 · Gemini</button><Select aria-label="에이전트 모델" value={active?.model||model} disabled={busy||!!active||connection.loadingProviders||!models.length} onChange={value=>connection.setProviderModel(value,provider)}>{[...new Set([...models,...active?[active.model]:[]])].map(id=><option key={id} value={id}>{id}</option>)}</Select></div>
    {(error||connection.connectionError)&&<p role="alert" className="error">{error||connection.connectionError}</p>}
    <div className="agent-content">
      {loading?<p className="muted">불러오는 중…</p>:view==='chat'?<div className="agent-messages" aria-live="polite">{!runs.length?<div className="ai-starters">{['흩어진 구상을 모아 개요를 만들어줘.','이 작품에서 서로 어긋나는 설정을 찾아줘.','이 전제를 뒤집으면 어떤 이야기가 될까?'].map(text=><button type="button" className="button" key={text} disabled={busy} onClick={()=>{setQuestion(text);questionId.current='';inputRef.current?.focus();}}>{text}</button>)}</div>:runs.map(run=><article className="agent-turn" key={run.id}><p className="agent-question">{run.message}</p>{run.events.length>0&&<details><summary>{stateNames[run.status]} · 작업 {run.events.length}개</summary><ol>{run.events.map(event=><li key={event.id}><strong>{event.title}</strong>{event.detail&&<p>{event.detail}</p>}{event.sources?.map(source=>source.url?<a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>:<button type="button" className="chip" key={source.id} onClick={()=>openDocument(source.id)}>{source.title}</button>)}{event.searchHtml&&<iframe title="Google 검색 제안" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={event.searchHtml}/>}</li>)}</ol></details>}{run.answer&&<div className="agent-answer">{run.answer}</div>}{run.error&&<p className="error">{run.error}</p>}{!run.answer&&!run.error&&<p className="muted">{stateNames[run.status]}</p>}</article>)}</div>:view==='changes'?<div className="agent-changes">{runs.some(r=>r.operations.length>0)&&<Select aria-label="변경 작업 선택" value={latest?.id||''} onChange={setChangeId}>{runs.filter(r=>r.operations.length>0).map(r=><option value={r.id} key={r.id}>{r.message.slice(0,80)}</option>)}</Select>}{!latest||!changes?<p className="muted">변경이 없습니다.</p>:<><div className="agent-change-actions"><span>{changes.rows.length}개 문서{changes.structure?` · 구조 변경 ${changes.structure}개`:''}</span>{latest.applied_version!==null&&!latest.reverted?<button type="button" className="button" disabled={busy||!!active} onClick={()=>void apply(latest,true)}><Undo2 size={14}/>되돌리기</button>:<><button type="button" className="button" disabled={busy||!!active||latest.reverted} onClick={()=>void act(async()=>{await request(`changes/${latest.id}/discard`,z.object({discarded:z.boolean()}),'POST','{}');await refresh();})}>작업본 버리기</button><button type="button" className="button primary" disabled={busy||!!active||latest.reverted||latest.status!=='completed'} onClick={()=>void apply(latest)}>변경 적용</button></>}</div>{latest.reverted&&<p className="muted">되돌리거나 버린 변경입니다.</p>}{changes.rows.map(row=><section key={row.id}><div className="agent-diff-title"><FileText size={15}/><strong>{row.title}</strong>{row.created&&<span className="chip">새 문서</span>}{latest.applied_version!==null&&!latest.reverted&&<button type="button" className="button" onClick={()=>openDocument(row.id)}>문서 열기</button>}</div><div className="agent-diff"><div><span className="muted">변경 전</span><pre>{row.before||'빈 문서'}</pre></div><div><span className="muted">변경 후</span><pre>{row.after||'빈 문서'}</pre></div></div></section>)}</>}</div>:<div className="agent-memories">{!memories.length?<p className="muted">저장한 기억이 없습니다.</p>:memories.map(memory=><article key={memory.id}><div className="agent-change-actions"><strong>{memory.title}</strong><button type="button" className="button" disabled={busy} onClick={()=>void act(async()=>{await request(`memories/${memory.id}/forget`,z.object({forgotten:z.boolean()}),'POST','{}');await refresh();})}>잊기</button></div><p>{memory.content}</p>{memory.sources.map(source=><button type="button" className="chip" key={source.id} onClick={()=>openDocument(source.id)}>{source.title}</button>)}</article>)}</div>}
    </div>
    <form className="agent-composer" onSubmit={event=>{event.preventDefault();void send();}}><textarea ref={inputRef} disabled={busy} aria-label="에이전트에게 요청" placeholder="요청 입력" value={question} onChange={event=>{setQuestion(event.target.value);questionId.current='';}} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/><div className="agent-send-actions">{active&&<button type="button" className="button" disabled={busy} onClick={()=>void act(async()=>{await request(`runs/${active.id}/cancel`,z.object({cancelled:z.boolean()}),'POST','{}');await refresh();})}><Square size={13}/>중단</button>}<button type="submit" className="button primary" aria-label="에이전트 요청 보내기" disabled={busy||loading||!question.trim()||!!s.conflict}><ArrowUp size={16}/></button></div></form>
  </Modal></TooltipProvider>;
}
