'use client';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowLeft, Cloud, StickyNote, Globe2, HardDrive, Inbox, Link2, NotebookPen, PanelLeft, Paperclip, Plus, Search, Snowflake, Sparkles, Tag, X } from 'lucide-react';
import { DocumentTree } from './document-tree';
import { AIChat } from './ai-chat';
import { editNoteTree, noteTreeWork, treeDestination, type NoteDestination } from '@/lib/note-navigation';
import { useStudio } from './studio-provider';
import { GoogleAccountControl } from './studio-auth';
import { IconButton, Popover, TooltipProvider } from './primitives';
import { RichEditor } from './rich-editor';
import { ThemeControls } from './theme-toggle';
import { useDrawerFocus } from './use-drawer-focus';
import { filterNotes, noteDocument, noteTitle, patchNote } from '@/lib/personal-notes';
import { plainText, type NovelDocument, type PersonalNote } from '@/lib/model';
import { cloud, cloudConfigured } from '@/lib/cloud';
import { db } from '@/lib/database';

const EMPTY_NOTES:PersonalNote[]=[];
const EMPTY_WIKI:NovelDocument[]=[];
const ignoreWiki=()=>{};
type Props={activeId:string;captureId:string;onSelect:(id:string)=>void;onReturn:()=>void;onNew:(to?:NoteDestination)=>void;onOpenWork:(workId:string,docId?:string)=>void};

export function PersonalNotes({activeId,captureId,onSelect,onReturn,onNew,onOpenWork}:Props){
  const s=useStudio(),notes=s.state?.notes||EMPTY_NOTES;
  const [sidebar,setSidebar]=useState(false),[compact,setCompact]=useState(true),[aiOpen,setAiOpen]=useState(false);
  const [query,setQuery]=useState(''),[box,setBox]=useState<'all'|'inbox'|'icebox'>('all'),[tag,setTag]=useState(''),[workId,setWorkId]=useState('');
  const sidebarRef=useRef<HTMLElement>(null),closeSidebar=useCallback(()=>setSidebar(false),[]);
  const aiRef=useRef<HTMLElement>(null),closeAI=useCallback(()=>setAiOpen(false),[]);
  useDrawerFocus(compact&&aiOpen,aiRef,closeAI,'note-ai-toggle');
  useDrawerFocus(compact&&sidebar,sidebarRef,closeSidebar,'sidebar-toggle');
  const search=useDeferredValue(query),visible=useMemo(()=>filterNotes(notes,{query:search,box,tag,workId}),[notes,search,box,tag,workId]);
  const eligible=useMemo(()=>filterNotes(notes,{box,tag,workId}).map(n=>n.id),[notes,box,tag,workId]);
  const tree=useMemo(()=>s.state?noteTreeWork(s.state):null,[s.state]);
  const active=notes.find(n=>n.id===activeId)||visible[0]||notes[0],readonly=!!s.conflict;
  useEffect(()=>{const media=window.matchMedia('(max-width: 900px)');setCompact(media.matches);setSidebar(!media.matches);const change=()=>{setCompact(media.matches);setSidebar(!media.matches);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.code==='KeyK'){event.preventDefault();setAiOpen(false);setSidebar(true);setTimeout(()=>document.getElementById('notes-search')?.focus(),30);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  if(!s.state)return null;
  const works=s.state.works,allTags=[...new Set(notes.flatMap(n=>n.tags))].sort((a,b)=>a.localeCompare(b));
  const inbox=notes.filter(n=>n.box==='inbox').length,icebox=notes.length-inbox;
  function create(to?:NoteDestination){setQuery('');setBox('all');setTag('');setWorkId('');onNew(to);if(compact)setSidebar(false);}
  function select(id:string){onSelect(id);if(compact)setSidebar(false);}
  function patch(id:string,change:Parameters<typeof patchNote>[2]){s.update(state=>patchNote(state,id,change));}
  return <TooltipProvider><div className="studio notes-workspace">
    {sidebar&&<div className="sidebar-backdrop" aria-hidden="true" onClick={closeSidebar}/>}
    {sidebar&&<aside className="studio-sidebar" ref={sidebarRef} aria-label="노트 탐색" role={compact?'dialog':undefined} aria-modal={compact||undefined}>
      <div className="sidebar-close"><IconButton label="노트 탐색 닫기" data-drawer-close onClick={closeSidebar}><X size={17}/></IconButton></div>
      <Link className="studio-brand" href="/"><span aria-hidden="true">◌</span>Orbis Tertius</Link><span className="studio-stripes" aria-hidden="true"/>
      <div className="notes-mode segmented" role="group" aria-label="작업 공간"><button type="button" aria-pressed={false} onClick={onReturn}><NotebookPen size={14}/>집필실</button><button type="button" aria-pressed={true}><StickyNote size={14}/>노트</button></div>
      <nav className="studio-tools notes-tools" aria-label="노트 도구">
        <button type="button" className="nav-item" disabled={readonly} onClick={()=>create()}><Plus size={16}/><span>새 노트</span></button>
        <div className="sidebar-search"><Search size={15}/><input id="notes-search" aria-label="전체 노트 검색" placeholder="제목 · 본문 · 태그 · 폴더 검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<IconButton label="노트 검색 지우기" onClick={()=>setQuery('')}><X size={14}/></IconButton>}</div>
        <div className="notes-views" role="group" aria-label="노트 보기"><button type="button" className="nav-item" aria-pressed={box==='all'} onClick={()=>setBox('all')}><StickyNote size={16}/><span>전체 노트</span><small>{notes.length}</small></button>
        <button type="button" className="nav-item" aria-pressed={box==='inbox'} onClick={()=>setBox('inbox')}><Inbox size={16}/><span>수집함</span><small>{inbox}</small></button>
        <button type="button" className="nav-item" aria-pressed={box==='icebox'} onClick={()=>setBox('icebox')}><Snowflake size={16}/><span>아이스박스</span><small>{icebox}</small></button></div>
        <div className="notes-filters"><label><Tag size={14}/><select aria-label="태그로 노트 찾기" value={tag} onChange={e=>setTag(e.target.value)}><option value="">모든 태그</option>{allTags.map(value=><option key={value}>{value}</option>)}</select></label><label><Link2 size={14}/><select aria-label="연결된 작품으로 노트 찾기" value={workId} onChange={e=>setWorkId(e.target.value)}><option value="">모든 작품</option>{works.map(work=><option value={work.id} key={work.id}>{work.title}</option>)}</select></label></div>
        <button type="button" className="nav-item" onClick={()=>window.dispatchEvent(new CustomEvent('studio-modal',{detail:'backup'}))}><Archive size={16}/><span>백업과 복구</span></button>
      </nav>
      <div className="sidebar-scroll notes-list" aria-label="노트 목록"><DocumentTree work={tree!} query={search} activeId={active?.id||''} readonly={readonly} onOpen={select} onChange={edit=>s.update(state=>editNoteTree(state,edit))} noteView={{matchingIds:visible.map(n=>n.id),eligibleIds:eligible,filtered:!!search.trim()||box!=='all'||!!tag||!!workId,onNew:to=>create(treeDestination(to))}}/>{!notes.length&&!s.state.noteNavigation?.nodes.length&&<p className="muted notes-empty">아직 노트가 없습니다. 새 노트에서 바로 입력하세요.</p>}</div>
      <footer className="sidebar-footer"><div><span className={`save-state ${s.error||s.conflict?'is-error':''}`} aria-live="polite">{cloudConfigured?<Cloud size={14}/>:<HardDrive size={14}/>}<span>{s.status}</span></span><Link className="icon-button" href="/library" aria-label="공개 서재"><Globe2 size={16}/></Link></div><ThemeControls/></footer>
    </aside>}
    <main className="studio-panel">
      <div className="panel-tabs"><IconButton id="sidebar-toggle" label={sidebar?'사이드바 닫기':'사이드바 열기'} aria-pressed={sidebar} onClick={()=>{setAiOpen(false);setSidebar(v=>!v);}}><PanelLeft size={16}/></IconButton><IconButton label="집필실로 돌아가기" onClick={onReturn}><ArrowLeft size={16}/></IconButton><div className="tab-list"><div className="doc-tab active"><StickyNote size={14}/><span>{active?noteTitle(active):'노트'}</span></div></div><span className="tab-spacer"/><GoogleAccountControl/><IconButton label="새 노트" disabled={readonly} onClick={()=>create()}><Plus size={16}/></IconButton></div>
      {s.error&&<button type="button" className="studio-error" onClick={s.clearError}><span>{s.error}</span><X size={14}/></button>}
      {active?<RichEditor key={`${active.id}-${s.epoch}`} doc={noteDocument(active)} readonly={readonly} autofocus={active.id===captureId} contentLabel="노트 본문" wiki={EMPTY_WIKI} onWikiClick={ignoreWiki} onChange={content=>patch(active.id,{content})}
        heading={<NoteHead key={active.id} note={active} readonly={readonly} onPatch={change=>patch(active.id,change)} onOpenWork={onOpenWork}/>}
        toolbarEnd={<><span className="char-count">{plainText(active.content).replace(/\s/g,'').length.toLocaleString()}자{!sidebar&&<span className="toolbar-status"> · {s.status}</span>}</span><span className="toolbar-divider"/><button type="button" id="note-ai-toggle" className="toolbar-text-button" aria-pressed={aiOpen} onClick={()=>{setAiOpen(v=>!v);if(compact)setSidebar(false);}}><Sparkles size={15}/>AI 대화</button></>}/>
        :<div className="notes-welcome"><p className="muted">작품을 고르지 않고 생각과 자료를 담아두세요.</p><button type="button" className="button" disabled={readonly} onClick={()=>create()}><Plus size={15}/>새 노트</button></div>}
    </main>
    {aiOpen&&active&&<><div className="reference-backdrop" aria-hidden="true" onClick={closeAI}/><aside ref={aiRef} className="reference-panel is-chat" aria-label="노트 AI 대화" role={compact?'dialog':undefined} aria-modal={compact||undefined}><div className="reference-tabs"><span>AI 대화</span><IconButton label="노트 AI 대화 닫기" data-drawer-close onClick={closeAI}><X size={15}/></IconButton></div><div className="reference-content"><AIChat key={`${s.namespace}-${active.id}-${s.epoch}`} noteId={active.id} doc={noteDocument(active)} onOpen={id=>{if(notes.some(n=>n.id===id)){select(id);return;}const work=works.find(w=>w.documents.some(d=>d.id===id));if(work)onOpenWork(work.id,id);}}/></div></aside></>}
  </div></TooltipProvider>;
}

function NoteHead({note,readonly,onPatch,onOpenWork}:{note:PersonalNote;readonly:boolean;onPatch:(patch:Parameters<typeof patchNote>[2])=>void;onOpenWork:Props['onOpenWork']}){
  const s=useStudio(),[panel,setPanel]=useState<'tags'|'works'|'copy'|'files'|null>(null),[draftTag,setDraftTag]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [target,setTarget]=useState(s.state!.works[0].id),[kind,setKind]=useState<NovelDocument['kind']>('memo');
  const available=s.state!.works,targetId=available.some(w=>w.id===target)?target:available[0].id;
  const effectiveReadonly=readonly||busy;
  function addTag(){const value=draftTag.trim().replace(/^#+/,'');if(!value)return;if(value.length>40||note.tags.length>=20){setError('태그는 40자 이하, 최대 20개까지 추가할 수 있습니다.');return;}onPatch({tags:[...new Set([...note.tags,value])]});setDraftTag('');setError('');}
  async function download(id:string){try{const meta=s.state!.assets.find(a=>a.id===id);if(!meta)throw new Error('첨부를 찾지 못했습니다.');let blob=(await db.assets.get([s.namespace,id]))?.blob;if(!blob&&cloudConfigured){const result=await cloud().storage.from('private-assets').download(`${s.user}/${id}`);if(result.error)throw result.error;blob=result.data||undefined;}if(!blob)throw new Error('첨부를 찾지 못했습니다.');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=meta.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:'첨부를 내려받지 못했습니다.');}}
  async function copy(){setBusy(true);setError('');try{const id=await s.copyNote(note.id,targetId,kind);onOpenWork(targetId,id);}catch(e){setError(e instanceof Error?e.message:'노트를 가져오지 못했습니다.');}finally{setBusy(false);}}
  return <div className="doc-head">
    <span className="doc-kicker">개인 노트 · {note.box==='icebox'?'아이스박스':'수집함'}</span>
    <input className="doc-title" aria-label="노트 제목" placeholder="제목 없이 시작해도 좋아요" maxLength={300} value={note.title} disabled={effectiveReadonly} onChange={e=>onPatch({title:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.closest('.editor-scroll')?.querySelector<HTMLElement>('.manuscript')?.focus();}}}/>
    <div className="doc-chips">
      <button type="button" className="chip" disabled={effectiveReadonly} onClick={()=>onPatch({box:note.box==='icebox'?'inbox':'icebox'})}>{note.box==='icebox'?<Inbox size={13}/>:<Snowflake size={13}/>} {note.box==='icebox'?'수집함으로 꺼내기':'아이스박스에 넣기'}</button>
      <Popover open={panel==='tags'} onOpenChange={open=>{setPanel(current=>open?'tags':current==='tags'?null:current);setError('');}} title="노트 태그" width={320} onReturnFocus={()=>document.querySelector<HTMLElement>('[aria-label="노트 본문"]')?.focus()} trigger={<button type="button" className="chip"><Tag size={13}/>태그 {note.tags.length||'추가'}</button>}><div className="notes-popover"><div className="doc-chips">{note.tags.map(tag=><button type="button" className="chip" key={tag} aria-label={`${tag} 태그 제거`} disabled={effectiveReadonly} onClick={()=>onPatch({tags:note.tags.filter(value=>value!==tag)})}>#{tag}<X size={12}/></button>)}</div><form onSubmit={e=>{e.preventDefault();addTag();}} className="notes-tag-form"><input aria-label="새 태그" maxLength={40} placeholder="태그 입력" value={draftTag} disabled={effectiveReadonly} onChange={e=>setDraftTag(e.target.value)}/><button type="submit" className="button" disabled={effectiveReadonly}>추가</button></form>{error&&<p className="danger" role="alert">{error}</p>}</div></Popover>
      <Popover open={panel==='works'} onOpenChange={open=>{setPanel(current=>open?'works':current==='works'?null:current);setError('');}} title="작품에 연결" description="같은 노트를 여러 작품에서 참고할 수 있습니다." width={320} onReturnFocus={()=>document.querySelector<HTMLElement>('[aria-label="노트 본문"]')?.focus()} trigger={<button type="button" className="chip"><Link2 size={13}/>작품 {note.linkedWorkIds.length||'연결'}</button>}><div className="notes-popover">{available.map(work=><label className="check-label" key={work.id}><input type="checkbox" aria-label={`${work.title}에 노트 연결`} disabled={effectiveReadonly} checked={note.linkedWorkIds.includes(work.id)} onChange={e=>onPatch({linkedWorkIds:e.target.checked?[...note.linkedWorkIds,work.id]:note.linkedWorkIds.filter(id=>id!==work.id)})}/>{work.title}</label>)}</div></Popover>
      <Popover open={panel==='copy'} onOpenChange={open=>{setPanel(current=>open?'copy':current==='copy'?null:current);setError('');}} title="작품 문서로 가져오기" description="본문과 첨부를 새 비공개 문서로 복사합니다. 원본 노트는 남습니다." width={320} onReturnFocus={()=>document.querySelector<HTMLElement>('[aria-label="노트 본문"]')?.focus()} trigger={<button type="button" className="chip" disabled={effectiveReadonly}><NotebookPen size={13}/>작품으로 가져오기</button>}><div className="form-grid"><label>대상 작품<select aria-label="노트를 가져올 작품" value={targetId} disabled={effectiveReadonly} onChange={e=>setTarget(e.target.value)}>{available.map(work=><option key={work.id} value={work.id}>{work.title}</option>)}</select></label><label>문서 종류<select aria-label="노트를 가져올 문서 종류" value={kind} disabled={effectiveReadonly} onChange={e=>setKind(e.target.value as NovelDocument['kind'])}><option value="memo">메모 · 리서치</option><option value="scene">원고</option><option value="wiki">설정집</option></select></label><button type="button" className="button" disabled={effectiveReadonly} onClick={()=>void copy()}>{busy?'가져오는 중':'가져오기'}</button>{error&&<p className="danger" role="alert">{error}</p>}</div></Popover>
      <Popover open={panel==='files'} onOpenChange={open=>{setPanel(current=>open?'files':current==='files'?null:current);setError('');}} title="노트 첨부" width={320} onReturnFocus={()=>document.querySelector<HTMLElement>('[aria-label="노트 본문"]')?.focus()} trigger={<button type="button" className="chip"><Paperclip size={13}/>첨부 {note.assetIds.length||'추가'}</button>}><div className="notes-popover">{note.assetIds.map(id=><button type="button" className="reference-card" key={id} onClick={()=>void download(id)}><Paperclip size={14}/><span>{s.state!.assets.find(a=>a.id===id)?.name}</span></button>)}<label className="asset-upload">이미지 첨부<input aria-label="노트 이미지 첨부" type="file" disabled={effectiveReadonly} accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);setError('');void s.addNoteAsset(note.id,file).catch(e=>setError(e instanceof Error?e.message:'이미지를 첨부하지 못했습니다.')).finally(()=>setBusy(false));}}/></label>{busy&&<p className="muted" role="status">첨부를 저장하는 중입니다.</p>}{error&&<p className="danger" role="alert">{error}</p>}</div></Popover>
      {note.tags.map(tag=><span className="chip soft" key={tag}>#{tag}</span>)}
      {note.linkedWorkIds.map(id=>{const work=available.find(w=>w.id===id);return work?<button type="button" className="chip soft" key={id} onClick={()=>onOpenWork(id)}><Link2 size={13}/>{work.title}</button>:null;})}
    </div>
    <div className="doc-divider"/>
  </div>;
}
