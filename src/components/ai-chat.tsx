'use client';

import { documentTitle, povSettings } from '@/lib/model';

import { providerSchema } from '@/lib/ai-provider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, FileText, MessageSquarePlus, Search, Sparkles, Settings2 } from 'lucide-react';
import { applySuggestion,reviewSchema } from '@/lib/ai';
import { chatMessageSchema,recentChatHistory, type ChatMessage } from '@/lib/ai-conversation';
import { NovelDocument, newDocument, plainText, uid, wikiReferences } from '@/lib/model';
import { cloud,cloudConfigured } from '@/lib/cloud';
import type { AIProvider } from '@/lib/ai-provider';
import { useStudio } from './studio-provider';
import { IconButton,Modal,Popover } from './primitives';
import { AISettingsDialog } from './ai-settings-dialog';
import { addNote, newNote, applyNoteSuggestion, clearNoteConversation, noteAISources } from '@/lib/personal-notes';
import { appendEditorExchange } from '@/lib/editor-ai-conversation';
import { useAIConnection } from './use-ai-connection';
import { useAppPreferences } from './use-app-preferences';
import { activePromptPreset,activatePromptPreset,promptCatalog } from '@/lib/ai-prompt-presets';

const starters=[
  {title:'문장 퇴고',text:'현재 원고의 문체와 시점을 유지하면서 호흡과 어색한 문장을 살펴봐 줘. 필요한 곳만 수정안을 제안해 줘.'},
  {title:'설정 점검',text:'원고와 선택한 자료 사이의 시간, 인물의 지식, 기술 설정의 모순을 찾아줘. 확실한 모순과 확인이 필요한 부분을 구분해 줘.'},
  {title:'장면 구상',text:'현재 장면 다음에 이어질 수 있는 전개를 세 가지 제안해 줘. 작품의 설정을 존중하고 새로운 아이디어는 따로 표시해 줘.'},
  {title:'장면 요약',text:'현재 장면의 핵심 사건, 인물의 변화, 남은 질문을 짧게 정리해 줘.'},
  {title:'SF 개연성',text:'현재 원고와 자료의 SF 설정에서 검증할 과학적 가정과 독자가 의문을 가질 지점을 정리해 줘. 확인되지 않은 사실은 단정하지 말아줘.'},
  {title:'자료 질문',text:'선택한 자료를 바탕으로 내 질문에 답해 줘: '},
];

type ChatScope={workId:string;noteId?:never}|{noteId:string;workId?:never};

export function AIChat({workId,noteId,doc,onOpen}:ChatScope&{doc:NovelDocument;onOpen:(id:string)=>void}){
  const s=useStudio(),work=s.state!.works.find(w=>w.id===workId),note=s.state!.notes?.find(n=>n.id===noteId);
  const noun=noteId?'노트':'원고',materials=useMemo(()=>noteId?noteAISources(s.state!,noteId):work!.documents,[s.state,noteId,work]);
  const messages=noteId?note?.aiMessages||[]:work!.aiConversations?.find(c=>c.docId===doc.id)?.messages||[];
  const {providers,provider,setProvider,loadingProviders,storageAvailable,connectionError,refreshProviders,currentProvider}=useAIConnection();
  const [settingsOpen,setSettingsOpen]=useState(false);
  const activePreset=activePromptPreset(s.state?.aiPreferences),systemPrompt=activePreset.prompt;
  const [prompt,setPrompt]=useState('');const [busy,setBusy]=useState(false);const [pending,setPending]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [aiDefaults]=useAppPreferences();const [includeManuscript,setIncludeManuscript]=useState(aiDefaults.aiIncludeManuscript);const [sourceIds,setSourceIds]=useState(()=>noteId||!aiDefaults.aiAttachLinked?[]:[...new Set([...wikiReferences(doc.content),...povSettings(work!.documents,doc.pov).map(d=>d.id)])].slice(0,8));
  const [sourcesOpen,setSourcesOpen]=useState(false);const [sourceQuery,setSourceQuery]=useState('');const [resetOpen,setResetOpen]=useState(false);
  const log=useRef<HTMLDivElement>(null);const textarea=useRef<HTMLTextAreaElement>(null);const disposed=useRef(false);const settingsTrigger=useRef<HTMLElement|null>(null);
  const availableIds=new Set(materials.filter(d=>d.id!==doc.id).map(d=>d.id));const selectedIds=sourceIds.filter(id=>availableIds.has(id));
  const full=messages.length>=40||(!messages.length&&(noteId?(s.state!.notes||[]).filter(n=>n.aiMessages?.length).length:(work!.aiConversations?.length||0))>=200);const configured=cloudConfigured&&currentProvider.configured;const chars=plainText(doc.content).length;
  useEffect(()=>{disposed.current=false;

return()=>{disposed.current=true;};},[]);
  useEffect(()=>{if(messages.length||pending)log.current?.scrollTo({top:log.current.scrollHeight,behavior:'smooth'});},[messages.length,pending]);

  async function send(){
    const question=prompt.trim();

if(!question||busy||!configured||full||s.conflict)return;
    setBusy(true);setPending(question);setError('');setNotice('');

    try{
      await s.flush();await s.syncNow();const session=(await cloud().auth.getSession()).data.session;

if(!session)throw new Error('작가 로그인이 필요합니다.');
      const version=doc.updatedAt;const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({...(noteId?{noteId}:{workId}),docId:doc.id,version,provider,message:question,includeManuscript,sourceIds:selectedIds,history:recentChatHistory(messages),systemPrompt,promptPresetId:activePreset.id})});
      const body=await response.json();

if(!response.ok)throw new Error(body.error||'대화를 완료하지 못했습니다.');
      const answer=chatMessageSchema.parse({id:uid(),role:'assistant',createdAt:new Date().toISOString(),result:reviewSchema.parse(body.result),provider,model:body.model,version:body.version,sources:body.sources,promptPreset:body.promptPreset});

      if(answer.role!=='assistant')throw new Error('답변 형식을 확인하세요.');
      // Capture the originating document so switching tabs cannot attach an answer elsewhere.
      s.update(state=>appendEditorExchange(state,noteId?{noteId,docId:doc.id}:{workId:workId!,docId:doc.id},messages.length,question,answer));
      await s.flush();

if(!disposed.current)setPrompt('');
    }catch(e){if(!disposed.current)setError(e instanceof Error?e.message:'AI 대화를 완료하지 못했습니다.');}
    finally{if(!disposed.current){setBusy(false);setPending('');}}
  }

  async function apply(message:Extract<ChatMessage,{role:'assistant'}>,index:number){
    try{await s.snapshot('AI 수정 적용 전');s.update(state=>noteId?applyNoteSuggestion(state,noteId,message,index):({...state,works:state.works.map(w=>w.id===workId?{...w,documents:w.documents.map(d=>{if(d.id!==doc.id)return d;

if(d.updatedAt!==message.version)throw new Error('답변 이후 원고가 바뀌었습니다. 새로 질문하거나 직접 비교하세요.');const suggestion=message.result.suggestions[index];

return {...d,content:applySuggestion(d.content,suggestion.quote,suggestion.replacement),updatedAt:new Date().toISOString()};})}:w)}));setNotice(`수정안을 적용했습니다. 적용 전 ${noun}는 복구 지점에 있습니다.`);}
    catch(e){setError(e instanceof Error?e.message:'수정안을 적용하지 못했습니다.');}
  }

  function saveAsMemo(){
    if(!messages.length)return;const memo=newDocument('memo',`AI 대화 · ${documentTitle(doc)}`.slice(0,300));memo.content={type:'doc',content:messages.map(m=>({type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:m.role==='user'?`작가: ${m.text}`:`${m.provider} (${m.model}): ${m.result.review}${m.result.suggestions.map(p=>`\n수정 제안: ${p.quote}\n→ ${p.replacement}\n${p.reason}`).join('')}` }]}))};

    if(noteId){const saved={...newNote(),title:memo.title,content:memo.content};s.update(state=>addNote(state,saved,{parentId:noteId}));setNotice('대화를 하위 노트로 보관했습니다.');onOpen(saved.id);}
    else{s.update(state=>({...state,works:state.works.map(w=>w.id===workId?{...w,documents:[...w.documents,memo]}:w)}));setNotice('대화를 메모로 보관했습니다.');onOpen(memo.id);}
  }

  return <div className="ai-chat">
    <div className="chat-heading"><div><strong title={documentTitle(doc)}>{documentTitle(doc)}</strong></div><IconButton label="AI 설정" disabled={busy||loadingProviders} onClick={e=>{settingsTrigger.current=e.currentTarget;setSettingsOpen(true);}}><Settings2 size={17}/></IconButton><IconButton label="새 대화" disabled={busy||!messages.length||!!s.conflict} onClick={()=>setResetOpen(true)}><MessageSquarePlus size={17}/></IconButton></div>
    <div className="chat-provider"><label>제공자<select aria-label="AI 제공자" value={provider} disabled={busy||loadingProviders} onChange={e=>setProvider(providerSchema.parse(e.target.value))}>{providers.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.label}{p.configured?'':' · 연결 필요'}</option>)}</select></label><span title={currentProvider.model||undefined}>{loadingProviders?'연결 확인 중':currentProvider.model||'API 키·모델 미설정'}</span></div>
    {!configured&&!loadingProviders&&<div className="chat-connection"><p>{currentProvider.browserInvalid?'보관한 연결이 만료되었거나 읽히지 않습니다. AI 설정에서 다시 입력하거나 해제하세요.':'AI 설정에서 API 키와 모델을 입력하면 대화할 수 있습니다. 아래 추천으로 질문을 미리 작성해 보세요.'}</p><button type="button" onClick={e=>{settingsTrigger.current=e.currentTarget;setSettingsOpen(true);}}>AI 설정 열기</button></div>}
    {configured&&<p className="chat-settings-source">{currentProvider.source==='browser'?'이 브라우저의 키 사용':'서버 키 사용'}</p>}
    <div className="chat-preset"><label>프리셋<select aria-label="AI 프롬프트 프리셋" value={activePreset.id} disabled={busy||!!s.conflict} onChange={e=>{try{const id=e.target.value;s.update(state=>({...state,aiPreferences:activatePromptPreset(state.aiPreferences,id)}));setNotice('프리셋을 적용했습니다. 다음 질문부터 사용합니다.');setError('');}catch(err){setError(err instanceof Error?err.message:'프리셋을 적용하지 못했습니다.');}}}>{promptCatalog(s.state?.aiPreferences).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label></div>
    <details className="chat-context"><summary>보낼 자료 · {includeManuscript?`현재 ${noun}`:`${noun} 제외`} · 참고 {selectedIds.length}개</summary><label className="chat-check"><input type="checkbox" checked={includeManuscript} disabled={busy} onChange={e=>setIncludeManuscript(e.target.checked)}/>현재 {noun} 포함 · {chars.toLocaleString()}자</label><p>{noun} 최대 12,000자 · 자료마다 앞 1,800자 · 최대 8개. 이전 대화는 최근 5회 중 길이 한도 안에서 함께 보냅니다.</p><div className="chat-source-chips">{selectedIds.map(id=><button type="button" key={id} disabled={busy} onClick={()=>setSourceIds(ids=>ids.filter(v=>v!==id))}>{materials.find(d=>d.id===id)?.title} ×</button>)}</div><Popover open={sourcesOpen} onOpenChange={setSourcesOpen} side="top" width={340} title="AI 참고 자료 선택" description={noteId?'다른 노트와 연결한 작품의 자료에서 최대 8개를 선택하세요. 선택한 자료의 앞 1,800자만 전송합니다.':'이 작품의 원고·설정·메모에서 최대 8개를 선택하세요. 각 자료의 앞 1,800자를 전송합니다.'} trigger={<button type="button" className="chat-secondary" disabled={busy}><Search size={13}/>참고 자료 선택</button>}><input aria-label="참고 자료 검색" placeholder="제목이나 본문 검색" value={sourceQuery} onChange={e=>setSourceQuery(e.target.value)}/><div className="chat-source-picker">{materials.filter(d=>d.id!==doc.id&&`${documentTitle(d)} ${plainText(d.content)}`.toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase())).map(d=><label key={d.id}><input type="checkbox" checked={selectedIds.includes(d.id)} disabled={!selectedIds.includes(d.id)&&selectedIds.length>=8} onChange={e=>setSourceIds(ids=>e.target.checked?[...ids,d.id]:ids.filter(id=>id!==d.id))}/><span><strong>{documentTitle(d)}</strong><small>{d.kind==='wiki'?d.category||'설정':d.kind==='memo'?(noteId&&s.state!.notes?.some(n=>n.id===d.id)?'개인 노트':'메모'):'원고'}</small></span></label>)}</div><div className="popover-actions"><button className="primary" onClick={()=>setSourcesOpen(false)}>선택 완료 · {selectedIds.length}개</button></div></Popover></details>
    <div className="chat-log" ref={log} role="log" aria-label="AI 대화 기록" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
      {!messages.length&&!pending&&<div className="chat-welcome"><Sparkles size={21}/><strong>무엇을 도와드릴까요?</strong><p>질문을 직접 쓰거나 아래 기능으로 시작하세요.</p><div className="chat-starters">{(noteId?[{title:'아이디어 확장',text:'현재 노트의 아이디어를 서로 다른 방향 세 가지로 확장해 줘. 새 아이디어와 원래 내용을 구분하고 각각의 가능성과 질문을 정리해 줘.'},{title:'브레인스토밍',text:'현재 노트를 출발점으로 자유롭게 연상할 수 있는 아이디어와 조합을 제안해 줘. 아직 작품의 정해진 설정으로 취급하지 말아줘.'},{title:'생각 정리',text:'현재 노트에서 핵심 생각, 연결점, 아직 답하지 않은 질문을 정리해 줘.'},{title:'문장 다듬기',text:'현재 노트의 의도를 유지하면서 어색한 문장만 수정안을 제안해 줘.'},{title:'자료 질문',text:'현재 노트와 선택한 자료를 바탕으로 내 질문에 답해 줘: '}]:starters).map(p=><button type="button" key={p.title} onClick={()=>{setPrompt(p.text);textarea.current?.focus();}}><span>{p.title}</span><small>{p.text}</small></button>)}</div></div>}
      {messages.map(m=><article key={m.id} className={`chat-message ${m.role}`}><header>{m.role==='user'?'작가':providers.find(p=>p.id===m.provider)?.label}<small>{m.role==='assistant'?m.model:''}</small></header><p>{m.role==='user'?m.text:m.result.review}</p>{m.role==='assistant'&&<><div className="chat-message-actions"><button type="button" onClick={()=>void navigator.clipboard.writeText(m.result.review).then(()=>setNotice('답변을 복사했습니다.')).catch(()=>setError('복사하지 못했습니다. 답변을 직접 선택해 주세요.'))}><Copy size={12}/>복사</button>{m.sources.map(source=><button type="button" key={source.id} onClick={()=>onOpen(source.id)}><FileText size={12}/>{source.title}</button>)}</div>{m.result.suggestions.map((p,i)=><div className="chat-suggestion" key={i}><blockquote>{p.quote}</blockquote><p>{p.replacement}</p><small>{p.reason}</small><button type="button" disabled={busy||!!s.conflict||doc.updatedAt!==m.version} onClick={()=>void apply(m,i)}><Check size={13}/>{doc.updatedAt===m.version?`${noun}에 적용`:`${noun}가 바뀜 · 직접 비교`}</button></div>)}</>}</article>)}
      {pending&&<article className="chat-message user"><header>작가</header><p>{pending}</p></article>}{busy&&<p className="chat-working" role="status">답변을 준비하고 있어요…</p>}
    </div>
    {messages.length>0&&<button type="button" className="chat-save-memo" disabled={busy||!!s.conflict} onClick={saveAsMemo}><FileText size={13}/>대화를 {noteId?'노트':'메모'}로 보관 · {messages.length/2}회 / 20회</button>}
    {(error||connectionError)&&<p role="alert" className="chat-error">{error||connectionError}</p>}{notice&&<p role="status" className="chat-notice">{notice}</p>}
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={textarea} aria-label="AI에게 질문" rows={3} maxLength={2000} disabled={busy||!!s.conflict} placeholder={noteId?'아이디어와 자료에 대해 이야기해 보세요…':'원고와 설정에 대해 이야기해 보세요…'} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span>{full?`대화를 ${noteId?'노트':'메모'}로 보관한 뒤 새 대화를 시작하세요.`:'Enter 전송 · Shift+Enter 줄바꿈'}<small>{prompt.length.toLocaleString()} / 2,000자 · 하루 10회</small></span><button type="submit" className="primary" aria-label="질문 보내기" disabled={!configured||busy||full||!prompt.trim()||!!s.conflict||(includeManuscript&&chars>12000)}><ArrowUp size={17}/></button></div>{includeManuscript&&chars>12000&&<p className="chat-error">{noun}가 12,000자를 넘습니다. 보낼 자료에서 {noun} 포함을 끄세요.</p>}<small>대화는 {noteId?'노트':'문서'}별로 저장·동기화되며 전체 백업에 포함됩니다.</small></form>
    
    <Modal open={resetOpen} onClose={()=>setResetOpen(false)} title="새 대화 시작" description={noteId?'현재 노트의 대화 기록을 비웁니다. 먼저 하위 노트로 보관하면 계속 읽을 수 있습니다.':'현재 문서의 대화 기록을 비웁니다. 먼저 메모로 보관하면 계속 읽거나 내보낼 수 있습니다.'}><div className="modal-actions"><button onClick={()=>setResetOpen(false)}>취소</button><button className="primary" onClick={()=>void(async()=>{try{await s.snapshot('AI 새 대화 시작 전');s.update(state=>noteId?clearNoteConversation(state,noteId):({...state,works:state.works.map(w=>w.id===workId?{...w,aiConversations:(w.aiConversations||[]).filter(c=>c.docId!==doc.id)}:w)}));setPrompt('');setError('');setNotice('새 대화를 시작했습니다.');setResetOpen(false);}catch(e){setError(e instanceof Error?e.message:'새 대화를 시작하지 못했습니다.');}})()}>새 대화</button></div></Modal>
    {settingsOpen&&<AISettingsDialog providers={providers} providerId={provider} storageAvailable={storageAvailable} onRefresh={refreshProviders} onClose={()=>setSettingsOpen(false)} onReturnFocus={()=>settingsTrigger.current?.focus()}/>}
  </div>;
}
