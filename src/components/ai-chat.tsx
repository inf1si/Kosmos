'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, FileText, MessageSquarePlus, Search, Sparkles } from 'lucide-react';
import { applySuggestion,reviewSchema } from '@/lib/ai';
import { chatMessageSchema,recentChatHistory, type ChatMessage } from '@/lib/ai-conversation';
import { NovelDocument, newDocument, plainText, uid, wikiReferences } from '@/lib/model';
import { cloud,cloudConfigured } from '@/lib/cloud';
import type { AIProvider } from '@/lib/ai-provider';
import { useStudio } from './studio-provider';
import { IconButton,Modal } from './primitives';

type Provider={id:AIProvider;label:string;configured:boolean;model:string|null};
const initialProviders:Provider[]=[{id:'openai',label:'OpenAI',configured:false,model:null},{id:'anthropic',label:'Claude',configured:false,model:null},{id:'gemini',label:'Gemini',configured:false,model:null}];
const starters=[
  {title:'문장 퇴고',text:'현재 원고의 문체와 시점을 유지하면서 호흡과 어색한 문장을 살펴봐 줘. 필요한 곳만 수정안을 제안해 줘.'},
  {title:'설정 점검',text:'원고와 선택한 자료 사이의 시간, 인물의 지식, 기술 설정의 모순을 찾아줘. 확실한 모순과 확인이 필요한 부분을 구분해 줘.'},
  {title:'장면 구상',text:'현재 장면 다음에 이어질 수 있는 전개를 세 가지 제안해 줘. 작품의 설정을 존중하고 새로운 아이디어는 따로 표시해 줘.'},
  {title:'장면 요약',text:'현재 장면의 핵심 사건, 인물의 변화, 남은 질문을 짧게 정리해 줘.'},
  {title:'SF 개연성',text:'현재 원고와 자료의 SF 설정에서 검증할 과학적 가정과 독자가 의문을 가질 지점을 정리해 줘. 확인되지 않은 사실은 단정하지 말아줘.'},
  {title:'자료 질문',text:'선택한 자료를 바탕으로 내 질문에 답해 줘: '},
];
export function AIChat({workId,doc,onOpen}:{workId:string;doc:NovelDocument;onOpen:(id:string)=>void}){
  const s=useStudio();const work=s.state!.works.find(w=>w.id===workId)!;const messages=work.aiConversations?.find(c=>c.docId===doc.id)?.messages||[];
  const [providers,setProviders]=useState(initialProviders);const [provider,setProvider]=useState<AIProvider>('openai');const [loadingProviders,setLoadingProviders]=useState(cloudConfigured);
  const [prompt,setPrompt]=useState('');const [busy,setBusy]=useState(false);const [pending,setPending]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [includeManuscript,setIncludeManuscript]=useState(true);const [sourceIds,setSourceIds]=useState(()=>[...new Set([...wikiReferences(doc.content),...work.documents.filter(d=>d.kind==='wiki'&&d.title===doc.pov).map(d=>d.id)])].slice(0,8));
  const [sourcesOpen,setSourcesOpen]=useState(false);const [sourceQuery,setSourceQuery]=useState('');const [resetOpen,setResetOpen]=useState(false);
  const log=useRef<HTMLDivElement>(null);const textarea=useRef<HTMLTextAreaElement>(null);const disposed=useRef(false);
  const currentProvider=providers.find(p=>p.id===provider)!;const availableIds=new Set(work.documents.filter(d=>d.id!==doc.id).map(d=>d.id));const selectedIds=sourceIds.filter(id=>availableIds.has(id));
  const full=messages.length>=40||(!messages.length&&(work.aiConversations?.length||0)>=200);const configured=cloudConfigured&&currentProvider.configured;const chars=plainText(doc.content).length;
  useEffect(()=>{disposed.current=false;let active=true;if(cloudConfigured)void (async()=>{try{const session=(await cloud().auth.getSession()).data.session;if(!session)throw new Error('작가 로그인이 필요합니다.');const response=await fetch('/api/ai/providers',{headers:{Authorization:`Bearer ${session.access_token}`}});const body=await response.json();if(!response.ok)throw new Error(body.error||'AI 연결 상태를 확인하지 못했습니다.');if(active){setProviders(body.providers);const first=body.providers.find((p:Provider)=>p.configured);if(first)setProvider(first.id);}}catch(e){if(active)setError(e instanceof Error?e.message:'AI 연결을 확인하지 못했습니다.');}finally{if(active)setLoadingProviders(false);}})();return()=>{active=false;disposed.current=true;};},[]);
  useEffect(()=>{if(messages.length||pending)log.current?.scrollTo({top:log.current.scrollHeight,behavior:'smooth'});},[messages.length,pending]);
  async function send(){
    const question=prompt.trim();if(!question||busy||!configured||full||s.conflict)return;
    setBusy(true);setPending(question);setError('');setNotice('');
    try{
      await s.flush();await s.syncNow();const session=(await cloud().auth.getSession()).data.session;if(!session)throw new Error('작가 로그인이 필요합니다.');
      const version=doc.updatedAt;const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({workId,docId:doc.id,version,provider,message:question,includeManuscript,sourceIds:selectedIds,history:recentChatHistory(messages)})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'대화를 완료하지 못했습니다.');
      const answer=chatMessageSchema.parse({id:uid(),role:'assistant',createdAt:new Date().toISOString(),result:reviewSchema.parse(body.result),provider,model:body.model,version:body.version,sources:body.sources});
      // Capture the originating document so switching tabs cannot attach an answer elsewhere.
      s.update(state=>({...state,works:state.works.map(w=>{
        if(w.id!==workId)return w;if(!w.documents.some(d=>d.id===doc.id))throw new Error('대화 중 문서가 바뀌었습니다.');
        const threads=w.aiConversations||[];const thread=threads.find(c=>c.docId===doc.id);if((thread?.messages.length||0)!==messages.length)throw new Error('다른 창에서 대화가 바뀌었습니다. 다시 보내세요.');
        if(!thread&&threads.length>=200)throw new Error('작품당 대화 200개 한도입니다. 대화를 메모로 보관하고 새 대화를 시작하세요.');
        const next={docId:doc.id,messages:[...(thread?.messages||[]),{id:uid(),role:'user' as const,text:question,createdAt:new Date().toISOString()},answer]};
        return {...w,aiConversations:thread?threads.map(c=>c.docId===doc.id?next:c):[...threads,next]};
      })}));
      await s.flush();if(!disposed.current)setPrompt('');
    }catch(e){if(!disposed.current)setError(e instanceof Error?e.message:'AI 대화를 완료하지 못했습니다.');}
    finally{if(!disposed.current){setBusy(false);setPending('');}}
  }
  async function apply(message:Extract<ChatMessage,{role:'assistant'}>,index:number){
    try{await s.snapshot('AI 수정 적용 전');s.update(state=>({...state,works:state.works.map(w=>w.id===workId?{...w,documents:w.documents.map(d=>{if(d.id!==doc.id)return d;if(d.updatedAt!==message.version)throw new Error('답변 이후 원고가 바뀌었습니다. 새로 질문하거나 직접 비교하세요.');const suggestion=message.result.suggestions[index];return {...d,content:applySuggestion(d.content,suggestion.quote,suggestion.replacement),updatedAt:new Date().toISOString()};})}:w)}));setNotice('수정안을 적용했습니다. 적용 전 원고는 복구 지점에 있습니다.');}
    catch(e){setError(e instanceof Error?e.message:'수정안을 적용하지 못했습니다.');}
  }
  function saveAsMemo(){
    if(!messages.length)return;const memo=newDocument('memo',`AI 대화 · ${doc.title}`);memo.content={type:'doc',content:messages.map(m=>({type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:m.role==='user'?`작가: ${m.text}`:`${m.provider} (${m.model}): ${m.result.review}${m.result.suggestions.map(p=>`\n수정 제안: ${p.quote}\n→ ${p.replacement}\n${p.reason}`).join('')}` }]}))};
    s.update(state=>({...state,works:state.works.map(w=>w.id===workId?{...w,documents:[...w.documents,memo]}:w)}));setNotice('대화를 메모로 보관했습니다.');onOpen(memo.id);
  }
  return <div className="ai-chat">
    <div className="chat-heading"><div><strong>AI 대화</strong><small>{doc.title}</small></div><IconButton label="새 대화" disabled={busy||!messages.length||!!s.conflict} onClick={()=>setResetOpen(true)}><MessageSquarePlus size={17}/></IconButton></div>
    <div className="chat-provider"><label>제공자<select aria-label="AI 제공자" value={provider} disabled={busy||loadingProviders} onChange={e=>setProvider(e.target.value as AIProvider)}>{providers.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.label}{p.configured?'':' · 연결 필요'}</option>)}</select></label><span title={currentProvider.model||undefined}>{loadingProviders?'연결 확인 중':currentProvider.model||'API 키·모델 미설정'}</span></div>
    {!configured&&!loadingProviders&&<p className="chat-connection">Vercel에 API 키와 모델을 설정하면 대화할 수 있습니다. 아래 추천으로 질문을 미리 작성해 보세요.</p>}
    <details className="chat-context"><summary>보낼 자료 · {includeManuscript?'현재 원고':'원고 제외'} · 참고 {selectedIds.length}개</summary><label className="chat-check"><input type="checkbox" checked={includeManuscript} disabled={busy} onChange={e=>setIncludeManuscript(e.target.checked)}/>현재 원고 포함 · {chars.toLocaleString()}자</label><p>원고 최대 12,000자 · 자료마다 앞 1,800자 · 최대 8개. 이전 대화는 최근 5회 중 길이 한도 안에서 함께 보냅니다.</p><div className="chat-source-chips">{selectedIds.map(id=><button type="button" key={id} disabled={busy} onClick={()=>setSourceIds(ids=>ids.filter(v=>v!==id))}>{work.documents.find(d=>d.id===id)?.title} ×</button>)}</div><button type="button" className="chat-secondary" disabled={busy} onClick={()=>setSourcesOpen(true)}><Search size={13}/>참고 자료 선택</button></details>
    <div className="chat-log" ref={log} role="log" aria-label="AI 대화 기록" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
      {!messages.length&&!pending&&<div className="chat-welcome"><Sparkles size={21}/><strong>어떤 도움이 필요해?</strong><p>질문을 직접 쓰거나 아래 기능으로 시작하세요.</p><div className="chat-starters">{starters.map(p=><button type="button" key={p.title} onClick={()=>{setPrompt(p.text);textarea.current?.focus();}}><span>{p.title}</span><small>{p.text}</small></button>)}</div></div>}
      {messages.map(m=><article key={m.id} className={`chat-message ${m.role}`}><header>{m.role==='user'?'작가':providers.find(p=>p.id===m.provider)?.label}<small>{m.role==='assistant'?m.model:''}</small></header><p>{m.role==='user'?m.text:m.result.review}</p>{m.role==='assistant'&&<><div className="chat-message-actions"><button type="button" onClick={()=>void navigator.clipboard.writeText(m.result.review).then(()=>setNotice('답변을 복사했습니다.')).catch(()=>setError('복사하지 못했습니다. 답변을 직접 선택해 주세요.'))}><Copy size={12}/>복사</button>{m.sources.map(source=><button type="button" key={source.id} onClick={()=>onOpen(source.id)}><FileText size={12}/>{source.title}</button>)}</div>{m.result.suggestions.map((p,i)=><div className="chat-suggestion" key={i}><blockquote>{p.quote}</blockquote><p>{p.replacement}</p><small>{p.reason}</small><button type="button" disabled={busy||!!s.conflict||doc.updatedAt!==m.version} onClick={()=>void apply(m,i)}><Check size={13}/>{doc.updatedAt===m.version?'원고에 적용':'원고가 바뀜 · 직접 비교'}</button></div>)}</>}</article>)}
      {pending&&<article className="chat-message user"><header>작가</header><p>{pending}</p></article>}{busy&&<p className="chat-working" role="status">답변을 준비하고 있어요…</p>}
    </div>
    {messages.length>0&&<button type="button" className="chat-save-memo" disabled={busy||!!s.conflict} onClick={saveAsMemo}><FileText size={13}/>대화를 메모로 보관 · {messages.length/2}회 / 20회</button>}
    {error&&<p role="alert" className="chat-error">{error}</p>}{notice&&<p role="status" className="chat-notice">{notice}</p>}
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={textarea} aria-label="AI에게 질문" rows={3} maxLength={2000} disabled={busy||!!s.conflict} placeholder="원고와 설정에 대해 이야기해 보세요…" value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span>{full?'메모로 보관한 뒤 새 대화를 시작하세요.':'Enter 전송 · Shift+Enter 줄바꿈'}<small>{prompt.length.toLocaleString()} / 2,000자 · 하루 10회</small></span><button type="submit" className="primary" aria-label="질문 보내기" disabled={!configured||busy||full||!prompt.trim()||!!s.conflict||(includeManuscript&&chars>12000)}><ArrowUp size={17}/></button></div>{includeManuscript&&chars>12000&&<p className="chat-error">원고가 12,000자를 넘습니다. 보낼 자료에서 원고 포함을 끄세요.</p>}<small>대화는 문서별로 저장·동기화되며 전체 백업에 포함됩니다.</small></form>
    <Modal open={sourcesOpen} onClose={()=>setSourcesOpen(false)} title="AI 참고 자료 선택" description="이 작품의 원고·설정·메모에서 최대 8개를 선택하세요. 각 자료의 앞 1,800자를 전송합니다."><input aria-label="참고 자료 검색" placeholder="제목이나 본문 검색" value={sourceQuery} onChange={e=>setSourceQuery(e.target.value)}/><div className="chat-source-picker">{work.documents.filter(d=>d.id!==doc.id&&`${d.title} ${plainText(d.content)}`.toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase())).map(d=><label key={d.id}><input type="checkbox" checked={selectedIds.includes(d.id)} disabled={!selectedIds.includes(d.id)&&selectedIds.length>=8} onChange={e=>setSourceIds(ids=>e.target.checked?[...ids,d.id]:ids.filter(id=>id!==d.id))}/><span><strong>{d.title}</strong><small>{d.kind==='wiki'?d.category||'설정':d.kind==='memo'?'메모':'원고'}</small></span></label>)}</div><div className="modal-actions"><button className="primary" onClick={()=>setSourcesOpen(false)}>선택 완료 · {selectedIds.length}개</button></div></Modal>
    <Modal open={resetOpen} onClose={()=>setResetOpen(false)} title="새 대화 시작" description="현재 문서의 대화 기록을 비웁니다. 먼저 메모로 보관하면 계속 읽거나 내보낼 수 있습니다."><div className="modal-actions"><button onClick={()=>setResetOpen(false)}>취소</button><button className="primary" onClick={()=>void(async()=>{try{await s.snapshot('AI 새 대화 시작 전');s.update(state=>({...state,works:state.works.map(w=>w.id===workId?{...w,aiConversations:(w.aiConversations||[]).filter(c=>c.docId!==doc.id)}:w)}));setPrompt('');setError('');setNotice('새 대화를 시작했습니다.');setResetOpen(false);}catch(e){setError(e instanceof Error?e.message:'새 대화를 시작하지 못했습니다.');}})()}>새 대화</button></div></Modal>
  </div>;
}
