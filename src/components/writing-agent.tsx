'use client';

import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { z } from 'zod';
import { ArrowUp,Download,FileText,MessageSquarePlus,Settings2,Square,Undo2 } from 'lucide-react';
import { IconButton,Modal,TooltipProvider } from './primitives';
import { useAIConnection } from './use-ai-connection';
import { reasoningLabels,eventReasoning,isReasoningEvent } from '@/lib/ai-reasoning';
import { Select } from './select';
import { useStudio } from './studio-provider';
import { AISettingsDialog } from './ai-settings-dialog';
import { ChatMentionInput } from './chat-mention-input';
import { cloud,cloudConfigured } from '@/lib/cloud';
import { db } from '@/lib/database';
import { uid,type Workspace } from '@/lib/model';
import { noteSpaceFor,resolveNoteNavigation } from '@/lib/note-navigation';
import { referenceTargets } from '@/lib/internal-references';
import { activePromptPreset,activatePromptPreset,promptCatalog } from '@/lib/ai-prompt-presets';
import type { ChatMessage } from '@/lib/ai-conversation';
import { providerLabels,providerSchema,activeAIProviders,type AIProvider } from '@/lib/ai-provider';
import { agentSessionSchema,agentRunViewSchema,agentMemorySchema,agentChangesSchema,agentScopeSchema,agentModeSchema,type AgentSession,type AgentRunView,type AgentMemory,type AgentScope,type AgentMode } from '@/lib/writing-agent';

const stateNames={queued:'대기 중',running:'진행 중',completed:'완료',failed:'실패',cancelled:'중단'};

const modeNames={discuss:'함께 생각하기',review:'검토하며 실행',execute:'맡겨 실행'};

/** The open document, the @ sources and the thinking level are settings kept in the log, not work the agent did. */
const isWork=(event:{id:string})=>event.id!=='focus'&&event.id!=='pointed'&&event.id!=='previous'&&!isReasoningEvent(event);

const indexSchema=z.object({sessions:z.array(agentSessionSchema),providers:z.array(z.object({id:providerSchema,configured:z.boolean(),model:z.string().nullable()})),webAvailable:z.boolean()});

const historySchema=z.object({session:agentSessionSchema,runs:z.array(agentRunViewSchema),memories:z.array(agentMemorySchema)});

type Changes=z.infer<typeof agentChangesSchema>;

/** focusId is the document open behind the dialog; the agent is told so "이 장면" has a referent. */
export function openWritingAgent(scope:AgentScope,focusId?:string){window.dispatchEvent(new CustomEvent('writing-agent-open',{detail:{...scope,focusId}}));}

async function agentRequest<T extends z.ZodType>(owner:string|null,path:string,schema:T,method='GET',body?:string,signal?:AbortSignal):Promise<z.infer<T>>{
  if(!cloudConfigured)throw new Error('작가 계정으로 로그인한 뒤 사용할 수 있습니다.');
  const session=(await cloud().auth.getSession()).data.session,token=session?.access_token;

  if(session&&session.user.id!==owner)throw new Error('계정이 바뀌었습니다.');

  if(!token)throw new Error('작가 로그인이 필요합니다.');
  const response=await fetch(`/api/agent/${path}`,{method,body,signal,headers:{Authorization:`Bearer ${token}`,...body&&{'Content-Type':'application/json'}},cache:'no-store'}),value=await response.json();

  if(!response.ok)throw new Error(z.object({error:z.string()}).safeParse(value).data?.error||'작업 대화에 연결하지 못했습니다.');

  return schema.parse(value);
}

/** Sources can sit in other works or note spaces the agent only read, so the scope comes from where the document lives now. */
function sourceScope(state:Workspace|null,id:string,fallback:AgentScope|null):AgentScope|null{
  const work=state?.works.find(w=>w.documents.some(d=>d.id===id));

  if(work)return {kind:'work',id:work.id};

  return state?.notes?.some(n=>n.id===id)?{kind:'notes',id:noteSpaceFor(state,id)}:fallback;
}

function openSource(state:Workspace|null,id:string,fallback:AgentScope|null){
  const scope=sourceScope(state,id,fallback);

  if(scope)window.dispatchEvent(new CustomEvent('writing-agent-source',{detail:{scope,id}}));
}

const scopeKey=(scope:AgentScope)=>`${scope.kind}:${scope.id}`;

/**
 * Sessions, runs and actions shared by the wide dialog and the chat in the reference panel.
 * pick chooses the session to show from the saved one; the panel keeps one per scope.
 */
function useWritingAgent({open,storageKey,pick}:{open:boolean;storageKey:string;pick:(sessions:AgentSession[],saved:string)=>string}){
  const s=useStudio(),namespace=s.namespace,accountRef=useRef(namespace);accountRef.current=namespace;
  const [sessions,setSessions]=useState<AgentSession[]>([]),[selected,setSelected]=useState(''),[runs,setRuns]=useState<AgentRunView[]>([]),[memories,setMemories]=useState<AgentMemory[]>([]);
  const connection=useAIConnection(),providers=connection.providers;
  const [mode,setMode]=useState<AgentMode>('review'),[sessionProvider,setSessionProvider]=useState<AIProvider|null>(null),[view,setView]=useState<'chat'|'changes'|'memory'>('chat');
  // A chosen session keeps its provider; a new one starts from the provider this device last used for AI.
  const provider=selected&&sessionProvider?sessionProvider:connection.provider;
  const model=connection.modelFor(provider),models=providers.find(p=>p.id===provider)?.models||[],reasoning=connection.reasoningFor(provider,model,true);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const generation=useRef(0),questionId=useRef(''),pickRef=useRef(pick);pickRef.current=pick;
  const [changes,setChanges]=useState<Changes|null>(null),[changeId,setChangeId]=useState('');
  const storage=`orbis-agent-session:${namespace}${storageKey}`;

  const request=useCallback(async<T extends z.ZodType,>(path:string,schema:T,method='GET',body?:string,signal?:AbortSignal):Promise<z.infer<T>>=>{const owner=namespace;const value=await agentRequest(s.user,path,schema,method,body,signal);

if(accountRef.current!==owner)throw new Error('계정이 바뀌었습니다.');

return value;},[namespace,s.user]);

  useEffect(()=>{generation.current++;setSelected('');setSessions([]);setRuns([]);setMemories([]);questionId.current='';},[namespace]);

  useEffect(()=>{if(!open||!s.canUse)return;const abort=new AbortController();setLoading(true);setError('');
    void request('sessions',indexSchema,'GET',undefined,abort.signal).then(value=>{
      setSessions(value.sessions);let saved='';

try{saved=localStorage.getItem(storage)||'';}catch{}

      setSelected(pickRef.current(value.sessions,saved));
    }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'대화를 불러오지 못했습니다.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});

    return()=>abort.abort();
  },[open,storage,s.canUse,request]);

  // A running task is polled closely; a finished one is checked now and then for changes made in another window.
  const watching=useRef(false);watching.current=runs.some(r=>r.status==='queued'||r.status==='running');
  useEffect(()=>{if(!open||!selected){setRuns([]);setMemories([]);

return;}

    const abort=new AbortController(),current=++generation.current;let first=true,tick=0;

    const read=async()=>{try{const value=await request(`sessions/${selected}`,historySchema,'GET',undefined,abort.signal);

if(current!==generation.current)return;setRuns(value.runs);setMemories(value.memories);

if(first){first=false;setMode(value.session.mode);setSessionProvider(value.session.provider);}}catch(e){if(!abort.signal.aborted&&current===generation.current)setError(e instanceof Error?e.message:'작업 기록을 읽지 못했습니다.');}};

    void read();const timer=setInterval(()=>{tick++;

if(watching.current||tick%5===0)void read();},2000);

    try{localStorage.setItem(storage,selected);}catch{}

    return()=>{abort.abort();clearInterval(timer);generation.current++;};
  },[open,selected,storage,request]);
  const refresh=async()=>{if(!selected)return;const value=await request(`sessions/${selected}`,historySchema);setRuns(value.runs);setMemories(value.memories);};

  const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');

try{await action();return true;}catch(e){setError(e instanceof Error?e.message:'작업을 처리하지 못했습니다.');

return false;}finally{setBusy(false);}};

  const sync=async()=>{if(s.conflict)throw new Error('원고 충돌을 먼저 확인하세요.');await s.flush();await s.syncNow();const row=await db.workspaces.get(namespace);

if(!row||row.dirty||row.pendingRequest)throw new Error('원고 동기화를 마친 뒤 다시 시도하세요.');};

  const settings=async(change:{mode?:AgentMode;provider?:AIProvider})=>{
    if(selected){await request(`sessions/${selected}`,z.object({session:agentSessionSchema}),'PATCH',JSON.stringify(change));setSessions(list=>list.map(session=>session.id===selected?{...session,...change}:session));}

    if(change.mode)setMode(change.mode);

if(change.provider){setSessionProvider(change.provider);connection.setProvider(change.provider);}
  };

  /** Starts a session in scope when none is chosen, then sends the request. Returns whether it was accepted. */
  const send=(question:string,scope:AgentScope,focusId?:string,sourceIds:string[]=[],previous:{role:'user'|'assistant';text:string}[]=[])=>act(async()=>{
    if(!question.trim()||connection.loadingProviders)throw new Error('요청을 입력하세요.');await sync();let id=selected;

    if(!id){const created=await request('sessions',z.object({session:agentSessionSchema}),'POST',JSON.stringify({id:uid(),title:question.trim().slice(0,80),scope,mode,provider}));id=created.session.id;setSessions(list=>[created.session,...list]);setSelected(id);}

    questionId.current ||=uid();await request(`sessions/${id}/messages`,z.object({run:agentRunViewSchema}),'POST',JSON.stringify({id:questionId.current,message:question.trim(),model,reasoning:reasoning.level,mode,provider,...focusId&&{focusId},...sourceIds.length&&{sourceIds},...previous.length&&{previous}}));questionId.current='';setView('chat');const value=await request(`sessions/${id}`,historySchema);setRuns(value.runs);setMemories(value.memories);
  });

  const apply=(run:AgentRunView,revert=false)=>act(async()=>{await sync();await request(`changes/${run.id}/${revert?'revert':'apply'}`,z.object({version:z.number()}),'POST','{}');await s.refreshCloud();await refresh();});
  const discard=(run:AgentRunView)=>act(async()=>{await request(`changes/${run.id}/discard`,z.object({discarded:z.boolean()}),'POST','{}');await refresh();});
  const cancel=(run:AgentRunView)=>act(async()=>{await request(`runs/${run.id}/cancel`,z.object({cancelled:z.boolean()}),'POST','{}');await refresh();});
  const forget=(memory:AgentMemory)=>act(async()=>{await request(`memories/${memory.id}/forget`,z.object({forgotten:z.boolean()}),'POST','{}');await refresh();});
  const exportData=()=>act(async()=>{const value=await request('export',z.record(z.string(),z.json())),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='orbis-agent.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const choose=(id:string)=>{generation.current++;setSelected(id);setSessionProvider(null);setRuns([]);setMemories([]);setError('');setView('chat');questionId.current='';};

  const active=runs.find(r=>r.status==='queued'||r.status==='running'),latest=runs.find(r=>r.id===changeId)||runs.findLast(r=>r.operations.length>0);
  const applied=runs.filter(run=>run.applied_version!==null).map(run=>`${run.id}:${run.applied_version}:${run.reverted}`).join('|');
  useEffect(()=>{if(open&&applied)void s.refreshCloud().catch(e=>setError(e instanceof Error?e.message:'원고 변경을 확인하세요.'));},[open,applied,s.refreshCloud]);
  useEffect(()=>{if(!open||view!=='changes'||!latest){setChanges(null);

return;}

const abort=new AbortController();void request(`runs/${latest.id}/changes`,agentChangesSchema,'GET',undefined,abort.signal).then(setChanges).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'변경을 불러오지 못했습니다.');});

return()=>abort.abort();},[open,view,latest?.id,latest?.operations.length,request]);

  return {s,sessions,selected,choose,runs,memories,connection,providers,mode,provider,model,models,reasoning,view,setView,error,setError,busy,loading,changes,setChangeId,active,latest,settings,send,apply,discard,cancel,forget,exportData,questionId,act};
}

type Agent=ReturnType<typeof useWritingAgent>;

function WorkLog({run,onOpen}:{run:AgentRunView;onOpen:(id:string)=>void}){
  if(!run.events.length)return null;

  return <details><summary>{stateNames[run.status]}{run.events.some(isWork)&&` · 작업 ${run.events.filter(isWork).length}개`}</summary><ol>{run.events.map(event=><li key={event.id}><strong>{event.title}</strong>{event.detail&&<p>{event.detail}</p>}{event.sources?.map(source=>source.url?<a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>:<button type="button" className="chip" key={source.id} onClick={()=>onOpen(source.id)}>{source.title}</button>)}{event.searchHtml&&<iframe title="Google 검색 제안" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={event.searchHtml}/>}</li>)}</ol></details>;
}

function AgentChanges({agent,onOpen}:{agent:Agent;onOpen:(id:string)=>void}){
  const {runs,latest,changes,busy,active}=agent;

  return <div className="agent-changes">{runs.some(r=>r.operations.length>0)&&<Select aria-label="변경 작업 선택" value={latest?.id||''} onChange={agent.setChangeId}>{runs.filter(r=>r.operations.length>0).map(r=><option value={r.id} key={r.id}>{r.message.slice(0,80)}</option>)}</Select>}{!latest||!changes?<p className="muted">변경이 없습니다.</p>:<><div className="agent-change-actions"><span>{changes.rows.length}개 문서{changes.structure?` · 구조 변경 ${changes.structure}개`:''}</span>{latest.applied_version!==null&&!latest.reverted?<button type="button" className="button" disabled={busy||!!active} onClick={()=>void agent.apply(latest,true)}><Undo2 size={14}/>되돌리기</button>:<><button type="button" className="button" disabled={busy||!!active||latest.reverted} onClick={()=>void agent.discard(latest)}>작업본 버리기</button><button type="button" className="button primary" disabled={busy||!!active||latest.reverted||latest.status!=='completed'} onClick={()=>void agent.apply(latest)}>변경 적용</button></>}</div>{latest.reverted&&<p className="muted">되돌리거나 버린 변경입니다.</p>}{changes.rows.map(row=><section key={row.id}><div className="agent-diff-title"><FileText size={15}/><strong>{row.title}</strong>{row.created&&<span className="chip">새 문서</span>}{latest.applied_version!==null&&!latest.reverted&&<button type="button" className="button" onClick={()=>onOpen(row.id)}>문서 열기</button>}</div><div className="agent-diff"><div><span className="muted">변경 전</span><pre>{row.before||'빈 문서'}</pre></div><div><span className="muted">변경 후</span><pre>{row.after||'빈 문서'}</pre></div></div></section>)}</>}</div>;
}

function AgentMemories({agent,onOpen}:{agent:Agent;onOpen:(id:string)=>void}){
  return <div className="agent-memories">{!agent.memories.length?<p className="muted">저장한 기억이 없습니다.</p>:agent.memories.map(memory=><article key={memory.id}><div className="agent-change-actions"><strong>{memory.title}</strong><button type="button" className="button" disabled={agent.busy} onClick={()=>void agent.forget(memory)}>잊기</button></div><p>{memory.content}</p>{memory.sources.map(source=><button type="button" className="chip" key={source.id} onClick={()=>onOpen(source.id)}>{source.title}</button>)}</article>)}</div>;
}

function AgentViews({agent}:{agent:Agent}){
  return <div className="segmented" role="group" aria-label="작업 대화 보기">{([['chat','대화'],['changes','변경'],['memory','기억']] as const).map(([id,label])=><button type="button" key={id} aria-pressed={agent.view===id} onClick={()=>agent.setView(id)}>{label}{id==='changes'&&agent.latest?.operations.length?` ${agent.latest.operations.length}`:''}</button>)}</div>;
}

export function WritingAgentDialog(){
  const [open,setOpen]=useState(false),[initialScope,setInitialScope]=useState<AgentScope|null>(null),[scopeValue,setScopeValue]=useState('');
  const agent=useWritingAgent({open,storageKey:'',pick:(sessions,saved)=>sessions.find(session=>session.id===saved)?.id||''}),{s,runs,busy,active,connection,provider,model,models,reasoning}=agent;
  const [question,setQuestion]=useState(''),focusId=useRef<string|undefined>(undefined),inputRef=useRef<HTMLTextAreaElement>(null),opener=useRef<HTMLElement|null>(null);

  useEffect(()=>{const show=(event:Event)=>{if(!(event instanceof CustomEvent))return;const parsed=agentScopeSchema.safeParse(event.detail);

    if(!parsed.success)return;focusId.current=z.object({focusId:z.uuid()}).safeParse(event.detail).data?.focusId;opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setInitialScope(parsed.data);setScopeValue(scopeKey(parsed.data));setOpen(true);};

    window.addEventListener('writing-agent-open',show);

return()=>window.removeEventListener('writing-agent-open',show);
  },[]);
  useEffect(()=>{setQuestion('');setOpen(false);},[s.namespace]);

  const send=()=>{if(!question.trim()||!initialScope)return;const split=scopeValue.indexOf(':'),scope=agentScopeSchema.parse({kind:scopeValue.slice(0,split),id:scopeValue.slice(split+1)});
    void agent.send(question,scope,scopeValue===scopeKey(initialScope)?focusId.current:undefined).then(ok=>{if(ok)setQuestion('');requestAnimationFrame(()=>inputRef.current?.focus());});};
  const session=agent.sessions.find(item=>item.id===agent.selected);
  const choices=s.state?[...s.state.works.map(work=>({value:`work:${work.id}`,label:work.title})),...resolveNoteNavigation(s.state).spaces.map(space=>({value:`notes:${space.id}`,label:`노트 · ${space.title||'이름 없는 작업공간'}`}))]:[];

  function openDocument(id:string){setOpen(false);openSource(s.state,id,session?.scope||initialScope);}

  return <TooltipProvider><Modal open={open&&s.canUse} onClose={()=>setOpen(false)} title="작업 대화" wide className="writing-agent-dialog" onReturnFocus={()=>opener.current?.isConnected&&opener.current.focus()}>
    <div className="board-bar agent-toolbar"><div className="agent-session-choice"><Select aria-label="작업 대화 선택" disabled={busy} value={agent.selected} onChange={agent.choose}><option value="">새 대화</option>{agent.sessions.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</Select><button type="button" className="button" aria-label="새 작업 대화" disabled={busy} onClick={()=>{agent.choose('');setScopeValue(initialScope?scopeKey(initialScope):'');inputRef.current?.focus();}}><MessageSquarePlus size={15}/></button></div><AgentViews agent={agent}/><button type="button" className="button" aria-label="AI 자료 내보내기" disabled={busy} onClick={()=>void agent.exportData()}><Download size={15}/></button></div>
    <div className="agent-settings"><Select aria-label="작업 자료 범위" value={session?scopeKey(session.scope):scopeValue} disabled={!!agent.selected||busy} onChange={setScopeValue}>{choices.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}</Select><Select aria-label="에이전트 실행 방식" value={agent.mode} disabled={busy||!!active} onChange={value=>void agent.act(()=>agent.settings({mode:agentModeSchema.parse(value)}))}>{Object.entries(modeNames).map(([id,label])=><option value={id} key={id}>{label}</option>)}</Select><Select aria-label="에이전트 제공자" value={provider} disabled={busy||!!active} onChange={value=>void agent.act(()=>agent.settings({provider:providerSchema.parse(value)}))}>{activeAIProviders.map(id=><option key={id} value={id}>{providerLabels[id]}</option>)}</Select><Select aria-label="에이전트 모델" value={active?.model||model} disabled={busy||!!active||connection.loadingProviders||!models.length} onChange={value=>connection.setProviderModel(value,provider)}>{[...new Set([...models,...active?[active.model]:[]])].map(id=><option key={id} value={id}>{id}</option>)}</Select><Select aria-label="에이전트 생각 단계" value={active?eventReasoning(active.events):reasoning.level} disabled={busy||!!active||connection.loadingProviders||reasoning.options.length<2} onChange={value=>connection.setProviderReasoning(value,provider)}>{[...new Set([...reasoning.options,...active?[eventReasoning(active.events)]:[]])].map(id=><option key={id} value={id}>생각 · {reasoningLabels[id]}</option>)}</Select></div>
    {(agent.error||connection.connectionError)&&<p role="alert" className="error">{agent.error||connection.connectionError}</p>}
    <div className="agent-content">
      {agent.loading?<p className="muted">불러오는 중…</p>:agent.view==='chat'?<div className="agent-messages" aria-live="polite">{!runs.length?<div className="ai-starters">{['흩어진 구상을 모아 개요를 만들어줘.','이 작품에서 서로 어긋나는 설정을 찾아줘.','이 전제를 뒤집으면 어떤 이야기가 될까?'].map(text=><button type="button" className="button" key={text} disabled={busy} onClick={()=>{setQuestion(text);agent.questionId.current='';inputRef.current?.focus();}}>{text}</button>)}</div>:runs.map(run=><article className="agent-turn" key={run.id}><p className="agent-question">{run.message}</p><WorkLog run={run} onOpen={openDocument}/>{run.answer&&<div className="agent-answer">{run.answer}</div>}{run.error&&<p className="error">{run.error}</p>}{!run.answer&&!run.error&&<p className="muted">{stateNames[run.status]}</p>}</article>)}</div>:agent.view==='changes'?<AgentChanges agent={agent} onOpen={openDocument}/>:<AgentMemories agent={agent} onOpen={openDocument}/>}
    </div>
    <form className="agent-composer" onSubmit={event=>{event.preventDefault();send();}}><textarea ref={inputRef} disabled={busy} aria-label="에이전트에게 요청" placeholder="요청 입력" value={question} onChange={event=>{setQuestion(event.target.value);agent.questionId.current='';}} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();send();}}}/><div className="agent-send-actions">{active&&<button type="button" className="button" disabled={busy} onClick={()=>void agent.cancel(active)}><Square size={13}/>중단</button>}<button type="submit" className="button primary" aria-label="에이전트 요청 보내기" disabled={busy||agent.loading||!question.trim()||!!s.conflict}><ArrowUp size={16}/></button></div></form>
  </Modal></TooltipProvider>;
}

const workStarters=[
  {title:'문장 퇴고',text:'현재 원고의 문체와 시점을 유지하면서 호흡과 어색한 문장을 살펴봐 줘.'},
  {title:'설정 점검',text:'이 원고와 설정 문서 사이의 시간, 인물의 지식, 기술 설정이 어긋나는 곳을 찾아줘.'},
  {title:'장면 구상',text:'이 장면 다음에 이어질 수 있는 전개를 몇 가지 떠올려 줘.'},
  {title:'문서 요약',text:'이 문서의 핵심 사건, 인물의 변화, 남은 질문을 짧게 정리해 줘.'},
  {title:'SF 개연성',text:'이 장면의 SF 설정에서 실제 과학으로 확인할 가정과 독자가 의문을 가질 지점을 짚어 줘.'},
  {title:'다른 작품 참고',text:'내 다른 작품이나 노트에서 이 장면에 쓸 만한 자료를 찾아줘.'},
];

const noteStarters=[
  {title:'아이디어 확장',text:'이 노트의 아이디어를 서로 다른 방향으로 넓혀 줘.'},
  {title:'브레인스토밍',text:'이 노트를 출발점으로 자유롭게 연상할 수 있는 아이디어와 조합을 던져 줘.'},
  {title:'생각 정리',text:'이 노트의 핵심 생각, 연결점, 아직 답하지 않은 질문을 정리해 줘.'},
  {title:'관련 자료 찾기',text:'다른 노트와 작품에서 이 노트와 이어지는 자료를 찾아줘.'},
];

/**
 * The reference-panel AI chat: the writing agent with the open document as its focus.
 * The scope is the document's work or the note's space; sessions continue across documents in it.
 * onOpen handles sources the surrounding screen can show beside the editor and returns false for the rest.
 */
export function AgentPanel({scope,docId,title,legacy,onOpen}:{scope:AgentScope;docId:string;title:string;legacy:ChatMessage[];onOpen:(id:string)=>boolean}){
  const key=scopeKey(scope);
  const agent=useWritingAgent({open:true,storageKey:`:${key}`,pick:(sessions,saved)=>{const mine=sessions.filter(session=>scopeKey(session.scope)===key);

return mine.find(session=>session.id===saved)?.id||mine[0]?.id||'';}});
  const {s,runs,busy,active,connection,providers,provider,model,models,reasoning}=agent;
  const [question,setQuestion]=useState(''),[sourceIds,setSourceIds]=useState<string[]>([]),[settingsOpen,setSettingsOpen]=useState(false);
  const inputRef=useRef<HTMLTextAreaElement>(null),log=useRef<HTMLDivElement>(null),settingsTrigger=useRef<HTMLElement|null>(null);
  const sessions=agent.sessions.filter(session=>scopeKey(session.scope)===key),current=providers.find(p=>p.id===provider);
  const configured=cloudConfigured&&!connection.loadingProviders&&!!current?.configured;
  const targets=useMemo(()=>s.state?referenceTargets(s.state).filter(target=>target.kind==='note'||target.kind==='document'):[],[s.state]);
  const pointed=sourceIds.filter(id=>targets.some(target=>target.targetId===id)),activePreset=activePromptPreset(s.state?.aiPreferences);
  useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[runs.length,runs.at(-1)?.answer]);

  function open(id:string){if(!onOpen(id))openSource(s.state,id,scope);}

  // Quick AI exchanges on this document since the session's last request ride along once, so "AI 대화에서 계속" continues them.
  const since=Date.parse(runs.at(-1)?.created_at||'')||0,previous=legacy.filter(m=>Date.parse(m.createdAt)>since).slice(-6).map(m=>({role:m.role,text:(m.role==='user'?m.text:m.result.review).slice(0,20000)}));
  const send=()=>{if(!question.trim()||busy||!configured||s.conflict)return;void agent.send(question,scope,docId,pointed,previous).then(ok=>{if(ok){setQuestion('');setSourceIds([]);}requestAnimationFrame(()=>inputRef.current?.focus());});};
  const settings=(event:{currentTarget:HTMLElement})=>{settingsTrigger.current=event.currentTarget;setSettingsOpen(true);};

  return <div className="ai-chat agent-panel">
    <div className="chat-heading"><div><strong title={title}>{title}</strong></div><IconButton label="AI 설정" disabled={busy||connection.loadingProviders} onClick={settings}><Settings2 size={17}/></IconButton><IconButton label="새 대화" disabled={busy||!agent.selected} onClick={()=>{agent.choose('');inputRef.current?.focus();}}><MessageSquarePlus size={17}/></IconButton></div>
    <div className="chat-provider">
      {sessions.length>0&&<label>대화<Select aria-label="작업 대화 선택" disabled={busy} value={agent.selected} onChange={agent.choose}><option value="">새 대화</option>{sessions.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</Select></label>}
      <label>방식<Select aria-label="에이전트 실행 방식" value={agent.mode} disabled={busy||!!active} onChange={value=>void agent.act(()=>agent.settings({mode:agentModeSchema.parse(value)}))}>{Object.entries(modeNames).map(([id,label])=><option value={id} key={id}>{label}</option>)}</Select></label>
      <label>제공자<Select aria-label="에이전트 제공자" value={provider} disabled={busy||!!active} onChange={value=>void agent.act(()=>agent.settings({provider:providerSchema.parse(value)}))}>{activeAIProviders.map(id=><option key={id} value={id}>{providerLabels[id]}{providers.find(p=>p.id===id)?.configured===false?' · 연결 필요':''}</option>)}</Select></label>
      <label>모델<Select aria-label="에이전트 모델" value={active?.model||model} disabled={busy||!!active||connection.loadingProviders||!models.length} onChange={value=>connection.setProviderModel(value,provider)}>{[...new Set([...models,...active?[active.model]:[]])].map(id=><option key={id} value={id}>{id}</option>)}</Select></label>
      <label>생각<Select aria-label="에이전트 생각 단계" value={active?eventReasoning(active.events):reasoning.level} disabled={busy||!!active||connection.loadingProviders||reasoning.options.length<2} onChange={value=>connection.setProviderReasoning(value,provider)}>{[...new Set([...reasoning.options,...active?[eventReasoning(active.events)]:[]])].map(id=><option key={id} value={id}>{reasoningLabels[id]}</option>)}</Select></label>
    </div>
    {!configured&&!connection.loadingProviders&&<div className="chat-connection"><p>{current?.browserInvalid?'모델 선택이 만료되었습니다. 다시 저장하세요.':'AI 연결이 필요합니다.'}</p><button type="button" onClick={settings}>AI 설정 열기</button></div>}
    <div className="chat-preset"><label>프리셋<Select aria-label="AI 프롬프트 프리셋" value={activePreset.id} disabled={busy||!!s.conflict} onChange={value=>{try{s.update(state=>({...state,aiPreferences:activatePromptPreset(state.aiPreferences,value)}));}catch(e){agent.setError(e instanceof Error?e.message:'프리셋을 적용하지 못했습니다.');}}}>{promptCatalog(s.state?.aiPreferences).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label></div>
    <div className="agent-panel-views"><AgentViews agent={agent}/></div>
    {legacy.length>0&&<details key={previous.length?'open':'closed'} open={previous.length>0||undefined} className="chat-context agent-legacy"><summary>이전 AI 대화 · {legacy.length}개</summary>{legacy.map(m=><article key={m.id} className={`chat-message ${m.role}`}><header>{m.role==='user'?'작가':providerLabels[m.provider]}<small>{m.role==='assistant'?m.model:''}</small></header><p>{m.role==='user'?m.text:m.result.review}</p></article>)}</details>}
    <div className="chat-log" ref={log} role="log" aria-label="AI 대화 기록" aria-live="polite" aria-relevant="additions" aria-busy={!!active}>
      {agent.loading?<p className="chat-working">불러오는 중…</p>:agent.view==='chat'?<>
        {!runs.length&&<div className="chat-welcome"><div className="chat-starters">{(scope.kind==='notes'?noteStarters:workStarters).map(p=><button type="button" key={p.title} onClick={()=>{setQuestion(p.text);agent.questionId.current='';inputRef.current?.focus();}}><span>{p.title}</span></button>)}</div></div>}
        {runs.map(run=><div className="agent-exchange" key={run.id}><article className="chat-message user"><header>작가</header><p>{run.message}</p></article><article className="chat-message assistant agent-reply"><header>{providerLabels[run.provider]}<small>{run.model}</small></header><WorkLog run={run} onOpen={open}/>{run.answer&&<p>{run.answer}</p>}{run.error&&<p className="error">{run.error}</p>}{!run.answer&&!run.error&&<p className="chat-working">{stateNames[run.status]}</p>}{run.operations.length>0&&run.status==='completed'&&<div className="chat-message-actions"><button type="button" onClick={()=>{agent.setChangeId(run.id);agent.setView('changes');}}><FileText size={12}/>변경 {run.operations.length}개 보기</button></div>}</article></div>)}
      </>:agent.view==='changes'?<AgentChanges agent={agent} onOpen={open}/>:<AgentMemories agent={agent} onOpen={open}/>}
    </div>
    {(agent.error||connection.connectionError)&&<p role="alert" className="chat-error">{agent.error||connection.connectionError}</p>}
    <form className="chat-composer" onSubmit={event=>{event.preventDefault();send();}}>{pointed.length>0&&<div className="chat-source-chips">{pointed.map(id=><button type="button" key={id} disabled={busy} onClick={()=>setSourceIds(ids=>ids.filter(v=>v!==id))}>{targets.find(target=>target.targetId===id)?.label} ×</button>)}</div>}<ChatMentionInput inputRef={inputRef} value={question} onChange={value=>{setQuestion(value);agent.questionId.current='';}} targets={targets} sourceId={docId} selectedIds={pointed} onSelectSource={id=>setSourceIds(ids=>ids.includes(id)?ids:[...ids,id])} disabled={busy||!!s.conflict} onSend={send}/><div>{active&&<button type="button" className="button" disabled={busy} onClick={()=>void agent.cancel(active)}><Square size={13}/>중단</button>}<button type="submit" className="primary" aria-label="질문 보내기" disabled={!configured||busy||agent.loading||!question.trim()||!!s.conflict}><ArrowUp size={17}/></button></div></form>
    {settingsOpen&&<AISettingsDialog providers={providers} providerId={provider} storageAvailable={connection.storageAvailable} onRefresh={connection.refreshProviders} onClose={()=>setSettingsOpen(false)} onReturnFocus={()=>settingsTrigger.current?.focus()}/>}
  </div>;
}
