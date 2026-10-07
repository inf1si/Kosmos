'use client';

import { documentSchema } from '@/lib/model';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, ArrowLeft, FileUp, Cloud, StickyNote, Trash2, Globe2, HardDrive, Inbox, House, Link2, MoreHorizontal, NotebookPen, Pin, PinOff, PanelLeft, Paperclip, Plus, RotateCcw, Search, Settings, SlidersHorizontal, Snowflake, Sparkles, Tag, Waypoints, X } from 'lucide-react';
import { DocumentTree } from './document-tree';
import { NotesHome } from './notes-home';
import { NoteCard } from './notes-reference';
import { AIChat } from './ai-chat';
import { editNoteTree, moveNote, noteTreeWork, treeDestination, type NoteDestination } from '@/lib/note-navigation';
import { descendantsOf } from '@/lib/document-navigation';
import { useStudio } from './studio-provider';
import { GoogleAccountControl } from './studio-auth';
import { IconButton, Popover, TooltipProvider } from './primitives';
import { RichEditor, type NoteTools } from './rich-editor';
import { NoteImageView } from './note-image';
import { FolderWorkPopover, NotesImportDialog } from './notes-transfer';
import { noteExtensions } from '@/lib/editor-extensions';
import { textStatistics } from '@/lib/text-statistics';
import { ThemeControls } from './theme-toggle';
import { useStoredChoice } from './use-app-preferences';
import { NOTES_LIST_VIEW_KEY, notesListViews } from '@/lib/app-preferences';
import { useDrawerFocus } from './use-drawer-focus';
import { filterNotes, noteBacklinks, noteDocument, noteTitle, patchNote } from '@/lib/personal-notes';
import { plainText, wikiReferences, type NovelDocument, type PersonalNote } from '@/lib/model';
import { cloud, cloudConfigured } from '@/lib/cloud';
import { db } from '@/lib/database';

const EMPTY_NOTES:PersonalNote[]=[];

const NOTE_EXTENSIONS=[...noteExtensions,NoteImageView];

const NOTE_LINK_COPY={tool:'노트 링크 추가',title:'노트 연결',description:'선택한 단어를 다른 노트에 연결합니다. Ctrl+클릭으로 엽니다.',select:'연결할 노트',open:'열기'};

type Props={activeId:string;captureId:string;onSelect:(id:string)=>void;onReturn:()=>void;onNew:(to?:NoteDestination,template?:string)=>void;onOpenWork:(workId:string,docId?:string)=>void};

export function PersonalNotes({activeId,captureId,onSelect,onReturn,onNew,onOpenWork}:Props){
  const s=useStudio(),notes=s.state?.notes||EMPTY_NOTES;
  const [sidebar,setSidebar]=useState(false),[compact,setCompact]=useState(true),[side,setSide]=useState<'links'|'ai'|null>(null);
  const [listView,chooseList]=useStoredChoice(NOTES_LIST_VIEW_KEY,notesListViews,'tree'),[importOpen,setImportOpen]=useState(false),[folderWork,setFolderWork]=useState<{id:string;anchor:HTMLElement|null}|null>(null);
  const [query,setQuery]=useState(''),[filterOpen,setFilterOpen]=useState(false),[box,setBox]=useState<'all'|'inbox'|'icebox'>('all'),[tag,setTag]=useState(''),[workId,setWorkId]=useState('');
  const sidebarRef=useRef<HTMLElement>(null),closeSidebar=useCallback(()=>setSidebar(false),[]);
  const aiRef=useRef<HTMLElement>(null),closeAI=useCallback(()=>setSide(null),[]);
  useDrawerFocus(compact&&!!side,aiRef,closeAI,side==='links'?'note-links-toggle':'note-ai-toggle');
  useDrawerFocus(compact&&sidebar,sidebarRef,closeSidebar,'sidebar-toggle');
  const search=useDeferredValue(query),visible=useMemo(()=>filterNotes(notes,{query:search,box,tag,workId}),[notes,search,box,tag,workId]);
  const eligible=useMemo(()=>filterNotes(notes,{box,tag,workId}).map(n=>n.id),[notes,box,tag,workId]);
  const tree=useMemo(()=>s.state?noteTreeWork(s.state):null,[s.state]);
  // No note in the address opens the notes home instead of an arbitrary first note.
  const active=activeId?notes.find(n=>n.id===activeId):undefined,readonly=!!s.conflict;
  useEffect(()=>{const media=window.matchMedia('(max-width: 900px)');setCompact(media.matches);setSidebar(!media.matches);const change=()=>{setCompact(media.matches);setSidebar(!media.matches);};

media.addEventListener('change',change);

return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.code==='KeyK'){event.preventDefault();setSide(null);setSidebar(true);setTimeout(()=>document.getElementById('notes-search')?.focus(),30);}};

window.addEventListener('keydown',key);

return()=>window.removeEventListener('keydown',key);},[]);
  const linkTargets=useMemo(()=>notes.filter(n=>n.id!==activeId).map(n=>({...noteDocument(n),category:'노트'})),[notes,activeId]);

  const noteLinkCount=useMemo(()=>{const a=notes.find(n=>n.id===activeId);

if(!a)return 0;const ids=new Set(notes.map(n=>n.id));

return wikiReferences(a.content).filter(id=>ids.has(id)&&id!==a.id).length+noteBacklinks(notes,a.id).length;},[notes,activeId]);

  const activeNoteId=active?.id,addNoteAsset=s.addNoteAsset;
  const noteTools=useMemo<NoteTools|undefined>(()=>activeNoteId?{extensions:NOTE_EXTENSIONS,onImage:file=>addNoteAsset(activeNoteId,file)}:undefined,[activeNoteId,addNoteAsset]);

  if(!s.state)return null;
  const works=s.state.works,allTags=[...new Set(notes.flatMap(n=>n.tags))].sort((a,b)=>a.localeCompare(b));
  const inbox=notes.filter(n=>n.box==='inbox').length,icebox=notes.length-inbox,filters=(tag?1:0)+(workId?1:0);

  function create(to?:NoteDestination,template?:string){setQuery('');setBox('all');setTag('');setWorkId('');onNew(to,template);

if(compact)setSidebar(false);}

  function move(id:string,to:NoteDestination){try{s.update(state=>moveNote(state,id,to));}catch(e){alert(e instanceof Error?e.message:'노트를 옮기지 못했습니다.');}}

  function select(id:string){onSelect(id);

if(compact)setSidebar(false);}

  function patch(id:string,change:Parameters<typeof patchNote>[2]){s.update(state=>patchNote(state,id,change));}

  async function trashNote(id:string){
    await s.trashNote(id);

    if(active?.id===id){onSelect(visible.find(n=>n.id!==id)?.id||notes.find(n=>n.id!==id)?.id||'');setSide(null);}
  }

  async function trashFolder(id:string){
    const removed=descendantsOf(tree!.navigation!,id);
    await s.trashNoteFolder(id);

    if(active&&removed.has(active.id)){onSelect(visible.find(n=>!removed.has(n.id))?.id||notes.find(n=>!removed.has(n.id))?.id||'');setSide(null);}
  }

  return <TooltipProvider><div className="studio notes-workspace">
    {sidebar&&<div className="sidebar-backdrop" aria-hidden="true" onClick={closeSidebar}/>}
    {sidebar&&<aside className="studio-sidebar" ref={sidebarRef} aria-label="노트 탐색" role={compact?'dialog':undefined} aria-modal={compact||undefined}>
      <div className="sidebar-close"><IconButton label="노트 탐색 닫기" data-drawer-close onClick={closeSidebar}><X size={17}/></IconButton></div>
      <Link className="studio-brand" href="/"><span aria-hidden="true">◌</span>Orbis Tertius</Link><span className="studio-stripes" aria-hidden="true"/>
      <div className="notes-mode segmented" role="group" aria-label="작업 공간"><button type="button" aria-pressed={false} onClick={onReturn}><NotebookPen size={14}/>집필실</button><button type="button" aria-pressed={true}><StickyNote size={14}/>노트</button></div>
      <nav className="studio-tools notes-tools" aria-label="노트 도구">
        <button type="button" className="nav-item" aria-pressed={!active} onClick={()=>select('')}><House size={16}/><span>노트 홈</span></button>
        <button type="button" className="nav-item" disabled={readonly} onClick={()=>create()}><Plus size={16}/><span>새 노트</span></button>
        <div className="notes-search-row"><div className="sidebar-search"><Search size={15}/><input id="notes-search" aria-label="전체 노트 검색" placeholder="제목 · 본문 · 태그 · 폴더 검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<IconButton label="노트 검색 지우기" onClick={()=>setQuery('')}><X size={14}/></IconButton>}</div>
        <Popover open={filterOpen} onOpenChange={setFilterOpen} title="노트 필터" width={280} align="end" trigger={<IconButton label={filters?`노트 필터 · ${filters}개 적용`:'노트 필터'} aria-pressed={!!filters} className="icon-button notes-filter"><SlidersHorizontal size={15}/>{filters>0&&<i className="notes-filter-dot" aria-hidden="true"/>}</IconButton>}>
          <label>태그<select aria-label="태그로 노트 찾기" value={tag} onChange={e=>setTag(e.target.value)}><option value="">모든 태그</option>{allTags.map(value=><option key={value}>{value}</option>)}</select></label>
          <label>연결된 작품<select aria-label="연결된 작품으로 노트 찾기" value={workId} onChange={e=>setWorkId(e.target.value)}><option value="">모든 작품</option>{works.map(work=><option value={work.id} key={work.id}>{work.title}</option>)}</select></label>
          <div className="popover-actions"><button type="button" className="button" disabled={!filters} onClick={()=>{setTag('');setWorkId('');}}><RotateCcw size={13}/>필터 초기화</button></div>
        </Popover></div>
        <div className="notes-views segmented" role="group" aria-label="노트 보기">{([['all','전체',notes.length],['inbox','수집함',inbox],['icebox','아이스박스',icebox]] as const).map(([value,label,count])=><button type="button" key={value} aria-pressed={box===value} onClick={()=>setBox(value)}>{label}<small>{count}</small></button>)}</div>
        <button type="button" className="nav-item" disabled={readonly} onClick={()=>setImportOpen(true)}><FileUp size={16}/><span>노트 가져오기</span></button>
        <button type="button" className="nav-item" onClick={()=>window.dispatchEvent(new CustomEvent('studio-modal',{detail:'trash'}))}><Trash2 size={16}/><span>휴지통</span><small>{s.state.trash?.length||0}</small></button>
        <button type="button" className="nav-item" onClick={()=>window.dispatchEvent(new CustomEvent('studio-modal',{detail:'backup'}))}><Archive size={16}/><span>백업과 복구</span></button>
        <button type="button" className="nav-item" onClick={()=>window.dispatchEvent(new CustomEvent('studio-modal',{detail:'settings:notes'}))}><Settings size={16}/><span>설정</span></button>
      </nav>
      <div className="sidebar-scroll notes-list" aria-label="노트 목록"><div className="notes-list-view segmented" role="group" aria-label="노트 목록 보기"><button type="button" aria-pressed={listView==='tree'} onClick={()=>chooseList('tree')}>폴더</button><button type="button" aria-pressed={listView==='list'} onClick={()=>chooseList('list')}>최근 수정순</button></div>{listView==='tree'?<DocumentTree work={tree!} query={search} activeId={active?.id||''} readonly={readonly} onOpen={select} onChange={edit=>s.update(state=>editNoteTree(state,edit))} onTrash={trashNote} onTrashFolder={trashFolder} noteView={{matchingIds:visible.map(n=>n.id),eligibleIds:eligible,filtered:!!search.trim()||box!=='all'||!!tag||!!workId,onNew:to=>create(treeDestination(to)),onFolderWork:(id,anchor)=>setFolderWork({id,anchor})}}/>:visible.length?visible.map(note=><NoteCard key={note.id} note={note} current={note.id===active?.id} onOpen={select}/>):<p className="muted notes-empty">{notes.length?'조건에 맞는 노트가 없습니다.':'아직 노트가 없습니다.'}</p>}{!notes.length&&!s.state.noteNavigation?.nodes.length&&<p className="muted notes-empty">아직 노트가 없습니다. 새 노트에서 바로 입력하세요.</p>}</div>
      <footer className="sidebar-footer"><div><span className={`save-state ${s.error||s.conflict?'is-error':''}`} aria-live="polite">{cloudConfigured?<Cloud size={14}/>:<HardDrive size={14}/>}<span>{s.status}</span></span><Link className="icon-button" href="/library" aria-label="공개 서재"><Globe2 size={16}/></Link></div><ThemeControls/></footer>
    </aside>}
    <main className="studio-panel">
      <div className="panel-tabs"><IconButton id="sidebar-toggle" label={sidebar?'사이드바 닫기':'사이드바 열기'} aria-pressed={sidebar} onClick={()=>{setSide(null);setSidebar(v=>!v);}}><PanelLeft size={16}/></IconButton><IconButton label="집필실로 돌아가기" onClick={onReturn}><ArrowLeft size={16}/></IconButton><div className="tab-list"><div className="doc-tab active">{active?<StickyNote size={14}/>:<House size={14}/>}<span>{active?noteTitle(active):'노트 홈'}</span></div></div><span className="tab-spacer"/><GoogleAccountControl/><IconButton label="새 노트" disabled={readonly} onClick={()=>create()}><Plus size={16}/></IconButton></div>
      {s.error&&<button type="button" className="studio-error" onClick={s.clearError}><span>{s.error}</span><X size={14}/></button>}
      {active?<RichEditor key={`${active.id}-${s.epoch}`} doc={noteDocument(active)} readonly={readonly} autofocus={active.id===captureId} contentLabel="노트 본문" wiki={linkTargets} onWikiClick={select} linkCopy={NOTE_LINK_COPY} noteTools={noteTools} aiTools={{scope:{noteId:active.id,docId:active.id},onContinue:()=>{setSide('ai');

if(compact)setSidebar(false);}}} onChange={content=>patch(active.id,{content})}
        heading={<NoteHead key={active.id} note={active} readonly={readonly} links={noteLinkCount} linksOpen={side==='links'} onLinks={()=>{setSide(v=>v==='links'?null:'links');

if(compact)setSidebar(false);}} onPatch={change=>patch(active.id,change)} onOpenWork={onOpenWork}/>}
        toolbarEnd={<><span className="char-count" aria-label="글자 수 · 공백 포함">{textStatistics(active.content).charactersWithSpaces.toLocaleString()}자{!sidebar&&<span className="toolbar-status"> · {s.status}</span>}</span><span className="toolbar-divider"/><button type="button" id="note-ai-toggle" className="toolbar-text-button" aria-pressed={side==='ai'} onClick={()=>{setSide(v=>v==='ai'?null:'ai');

if(compact)setSidebar(false);}}><Sparkles size={15}/>AI 대화</button></>}/>
        :<NotesHome state={s.state} readonly={readonly} onOpen={select} onNew={to=>create(to)} onTemplate={id=>create(undefined,id)} onMove={move} onFolderWork={(id,anchor)=>setFolderWork({id,anchor})}/>}
    </main>
    {side&&active&&<><div className="reference-backdrop" aria-hidden="true" onClick={closeAI}/><aside ref={aiRef} className={`reference-panel ${side==='ai'?'is-chat':''}`} aria-label="노트 참고 패널" role={compact?'dialog':undefined} aria-modal={compact||undefined}><div className="reference-tabs" role="tablist" aria-label="노트 참고 자료">{(['links','ai'] as const).map(p=><button type="button" role="tab" key={p} aria-selected={side===p} onClick={()=>setSide(p)}>{p==='links'?'연결':'AI 대화'}</button>)}<IconButton label="노트 참고 패널 닫기" data-drawer-close onClick={closeAI}><X size={15}/></IconButton></div><div className="reference-content">{side==='links'?<NoteLinks note={active} notes={notes} onOpen={select}/>
      :<AIChat key={`${s.namespace}-${active.id}-${s.epoch}`} noteId={active.id} doc={noteDocument(active)} onOpen={id=>{if(notes.some(n=>n.id===id)){select(id);

return;}

const work=works.find(w=>w.documents.some(d=>d.id===id));

if(work)onOpenWork(work.id,id);}}/>}</div></aside></>}
    <NotesImportDialog open={importOpen} onClose={()=>setImportOpen(false)} onImported={()=>{setQuery('');setBox('all');setTag('');setWorkId('');chooseList('tree');}}/>
    {folderWork&&<FolderWorkPopover key={folderWork.id} folderId={folderWork.id} anchor={folderWork.anchor} onClose={()=>setFolderWork(null)} onCreated={id=>{setFolderWork(null);onOpenWork(id);}}/>}
  </div></TooltipProvider>;
}

function NoteHead({note,readonly,links,linksOpen,onLinks,onPatch,onOpenWork}:{note:PersonalNote;readonly:boolean;links:number;linksOpen:boolean;onLinks:()=>void;onPatch:(patch:Parameters<typeof patchNote>[2])=>void;onOpenWork:Props['onOpenWork']}){
  const s=useStudio(),[panel,setPanel]=useState<'tags'|'works'|'copy'|'files'|null>(null),[draftTag,setDraftTag]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [target,setTarget]=useState(s.state!.works[0].id),[kind,setKind]=useState<NovelDocument['kind']>('memo');
  const available=s.state!.works,targetId=available.some(w=>w.id===target)?target:available[0].id;
  const effectiveReadonly=readonly||busy;
  const chipsRef=useRef<HTMLDivElement>(null),keepMenuFocus=useRef(false);
  const returnToBody=()=>document.querySelector<HTMLElement>('[aria-label="노트 본문"]')?.focus();

  // Menu items open a panel under the chip row; the closing menu must not pull focus back to its trigger.
  function openPanel(next:'files'|'copy'){keepMenuFocus.current=true;setError('');window.setTimeout(()=>setPanel(next),0);}

  function addTag(){const value=draftTag.trim().replace(/^#+/,'');

if(!value)return;

if(value.length>40||note.tags.length>=20){setError('태그는 40자 이하, 최대 20개까지 추가할 수 있습니다.');

return;}

onPatch({tags:[...new Set([...note.tags,value])]});setDraftTag('');setError('');}

  async function download(id:string){try{const meta=s.state!.assets.find(a=>a.id===id);

if(!meta)throw new Error('첨부를 찾지 못했습니다.');let blob=(await db.assets.get([s.namespace,id]))?.blob;

if(!blob&&cloudConfigured){const result=await cloud().storage.from('private-assets').download(`${s.user}/${id}`);

if(result.error)throw result.error;blob=result.data||undefined;}

if(!blob)throw new Error('첨부를 찾지 못했습니다.');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=meta.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:'첨부를 내려받지 못했습니다.');}}

  async function copy(){setBusy(true);setError('');

try{const id=await s.copyNote(note.id,targetId,kind);onOpenWork(targetId,id);}catch(e){setError(e instanceof Error?e.message:'노트를 가져오지 못했습니다.');}finally{setBusy(false);}}

  return <div className="doc-head">
    <span className="doc-kicker">개인 노트 · {note.box==='icebox'?'아이스박스':'수집함'}</span>
    <input className="doc-title" aria-label="노트 제목" placeholder="제목 (선택)" maxLength={300} value={note.title} disabled={effectiveReadonly} onChange={e=>onPatch({title:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.closest('.editor-scroll')?.querySelector<HTMLElement>('.manuscript')?.focus();}}}/>
    <div className="doc-chips" ref={chipsRef}>
      <Popover open={panel==='tags'} onOpenChange={open=>{setPanel(current=>open?'tags':current==='tags'?null:current);setError('');}} title="노트 태그" width={320} onReturnFocus={returnToBody} trigger={<button type="button" className="chip" aria-label={note.tags.length?`태그 ${note.tags.length}개`:'태그 추가'}><Tag size={13}/>{note.tags.length?<span className="notes-tag-summary">{note.tags.slice(0,3).map(tag=>`#${tag}`).join(' ')}{note.tags.length>3?` +${note.tags.length-3}`:''}</span>:'태그 추가'}</button>}><div className="notes-popover"><div className="doc-chips">{note.tags.map(tag=><button type="button" className="chip" key={tag} aria-label={`${tag} 태그 제거`} disabled={effectiveReadonly} onClick={()=>onPatch({tags:note.tags.filter(value=>value!==tag)})}>#{tag}<X size={12}/></button>)}</div><form onSubmit={e=>{e.preventDefault();addTag();}} className="notes-tag-form"><input aria-label="새 태그" maxLength={40} placeholder="태그 입력" value={draftTag} disabled={effectiveReadonly} onChange={e=>setDraftTag(e.target.value)}/><button type="submit" className="button" disabled={effectiveReadonly}>추가</button></form>{error&&<p className="danger" role="alert">{error}</p>}</div></Popover>
      <Popover open={panel==='works'} onOpenChange={open=>{setPanel(current=>open?'works':current==='works'?null:current);setError('');}} title="작품에 연결" description="같은 노트를 여러 작품에서 참고할 수 있습니다." width={320} onReturnFocus={returnToBody} trigger={<button type="button" className="chip"><Link2 size={13}/>작품 {note.linkedWorkIds.length||'연결'}</button>}><div className="notes-popover">{available.map(work=><label className="check-label" key={work.id}><input type="checkbox" aria-label={`${work.title}에 노트 연결`} disabled={effectiveReadonly} checked={note.linkedWorkIds.includes(work.id)} onChange={e=>onPatch({linkedWorkIds:e.target.checked?[...note.linkedWorkIds,work.id]:note.linkedWorkIds.filter(id=>id!==work.id)})}/>{work.title}</label>)}</div></Popover>
      {links>0&&<button type="button" id="note-links-toggle" className="chip" aria-pressed={linksOpen} onClick={onLinks}><Waypoints size={13}/>노트 링크 {links}</button>}
      {note.assetIds.length>0&&<button type="button" className="chip" onClick={()=>setPanel('files')}><Paperclip size={13}/>첨부 {note.assetIds.length}</button>}
      {note.linkedWorkIds.map(id=>{const work=available.find(w=>w.id===id);

return work?<button type="button" className="chip soft" key={id} onClick={()=>onOpenWork(id)}><Link2 size={13}/>{work.title}</button>:null;})}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild><button type="button" className="icon-button notes-head-more" aria-label="노트 더 보기" title="노트 더 보기"><MoreHorizontal size={15}/></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="menu" align="start" sideOffset={4} collisionPadding={12} onCloseAutoFocus={e=>{if(keepMenuFocus.current){e.preventDefault();keepMenuFocus.current=false;}}}>
          <DropdownMenu.Item className="menu-item" disabled={effectiveReadonly} onSelect={()=>onPatch({pinned:!note.pinned})}>{note.pinned?<PinOff size={15}/>:<Pin size={15}/>}{note.pinned?'고정 해제':'노트 홈에 고정'}</DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" disabled={effectiveReadonly} onSelect={()=>onPatch({box:note.box==='icebox'?'inbox':'icebox'})}>{note.box==='icebox'?<Inbox size={15}/>:<Snowflake size={15}/>}{note.box==='icebox'?'수집함으로 꺼내기':'아이스박스에 넣기'}</DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-separator"/>
          <DropdownMenu.Item className="menu-item" onSelect={()=>openPanel('files')}><Paperclip size={15}/>이미지 첨부</DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" disabled={effectiveReadonly} onSelect={()=>openPanel('copy')}><NotebookPen size={15}/>작품으로 가져오기</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Popover open={panel==='copy'} onOpenChange={open=>{setPanel(current=>open?'copy':current==='copy'?null:current);setError('');}} anchor={chipsRef} title="작품 문서로 가져오기" description="본문과 첨부를 새 비공개 문서로 복사합니다. 원본 노트는 남습니다." width={320} onReturnFocus={returnToBody}><div className="form-grid"><label>대상 작품<select aria-label="노트를 가져올 작품" value={targetId} disabled={effectiveReadonly} onChange={e=>setTarget(e.target.value)}>{available.map(work=><option key={work.id} value={work.id}>{work.title}</option>)}</select></label><label>문서 종류<select aria-label="노트를 가져올 문서 종류" value={kind} disabled={effectiveReadonly} onChange={e=>setKind(documentSchema.shape.kind.parse(e.target.value))}><option value="memo">메모 · 리서치</option><option value="scene">원고</option><option value="wiki">설정집</option></select></label><button type="button" className="button" disabled={effectiveReadonly} onClick={()=>void copy()}>{busy?'가져오는 중':'가져오기'}</button>{error&&<p className="danger" role="alert">{error}</p>}</div></Popover>
      <Popover open={panel==='files'} onOpenChange={open=>{setPanel(current=>open?'files':current==='files'?null:current);setError('');}} anchor={chipsRef} title="노트 첨부" width={320} onReturnFocus={returnToBody}><div className="notes-popover">{note.assetIds.map(id=><button type="button" className="reference-card" key={id} onClick={()=>void download(id)}><Paperclip size={14}/><span>{s.state!.assets.find(a=>a.id===id)?.name}</span></button>)}<label className="asset-upload">이미지 첨부<input aria-label="노트 이미지 첨부" type="file" disabled={effectiveReadonly} accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';

if(!file)return;setBusy(true);setError('');void s.addNoteAsset(note.id,file).catch(e=>setError(e instanceof Error?e.message:'이미지를 첨부하지 못했습니다.')).finally(()=>setBusy(false));}}/></label>{busy&&<p className="muted" role="status">첨부를 저장하는 중입니다.</p>}{error&&<p className="danger" role="alert">{error}</p>}</div></Popover>
    </div>
    <div className="doc-divider"/>
  </div>;
}

/** 이 노트가 가리키는 노트와 이 노트를 가리키는 노트. 노트 본문의 링크(Ctrl+클릭)와 같은 대상을 연다. */
function NoteLinks({note,notes,onOpen}:{note:PersonalNote;notes:PersonalNote[];onOpen:(id:string)=>void}){
  const byId=new Map(notes.map(n=>[n.id,n])),outgoing=wikiReferences(note.content).map(id=>byId.get(id)).filter((n):n is PersonalNote=>!!n&&n.id!==note.id),incoming=noteBacklinks(notes,note.id);

  return <>
    <h3>이 노트가 가리키는 노트 {outgoing.length}</h3>{outgoing.length?outgoing.map(n=><NoteCard key={n.id} note={n} onOpen={onOpen}/>):<p className="muted">본문에서 단어를 고르고 노트 링크 추가로 연결하세요.</p>}
    <h3>이 노트를 가리키는 노트 {incoming.length}</h3>{incoming.length?incoming.map(n=><NoteCard key={n.id} note={n} onOpen={onOpen}/>):<p className="muted">아직 이 노트를 연결한 노트가 없습니다.</p>}
  </>;
}
