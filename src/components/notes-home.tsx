'use client';
import { useMemo, useState, type DragEvent } from 'react';
import { BookOpen, BookPlus, Clapperboard, Folder, Globe2, Inbox, Lightbulb, Plus, Snowflake, UserRound } from 'lucide-react';
import { NoteCard } from './notes-reference';
import { IconButton } from './primitives';
import { noteBoardColumns, noteDate, noteSnippet, noteTitle } from '@/lib/personal-notes';
import type { NoteDestination } from '@/lib/note-navigation';
import { noteTemplates } from '@/lib/note-templates';
import type { PersonalNote, Workspace } from '@/lib/model';

type HomeView='home'|'board';
const templateIcons={character:UserRound,world:Globe2,logline:BookOpen,scene:Clapperboard,brainstorm:Lightbulb};
const VIEW_KEY='kosmos-notes-home-view';
function storedView():HomeView{try{return localStorage.getItem(VIEW_KEY)==='board'?'board':'home';}catch{return 'home';}}

/** 노트 공간의 첫 화면. 최근·고정·수집함과 템플릿을 보여주고, 보드에서는 최상위 폴더별 카드로 펼친다. */
export function NotesHome({state,readonly,onOpen,onNew,onTemplate,onMove,onFolderWork}:{state:Workspace;readonly:boolean;onOpen:(id:string)=>void;onNew:(to?:NoteDestination)=>void;onTemplate:(id:string)=>void;onMove:(id:string,to:NoteDestination)=>void;onFolderWork:(folderId:string,anchor:HTMLElement|null)=>void}){
  const [view,setView]=useState<HomeView>(storedView);
  const notes=state.notes||[];
  const recent=useMemo(()=>[...notes].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),[notes]);
  const pinned=recent.filter(n=>n.pinned),inbox=recent.filter(n=>n.box==='inbox');
  function choose(next:HomeView){setView(next);try{localStorage.setItem(VIEW_KEY,next);}catch{}}
  return <div className="plot-board notes-home">
    <div className="board-bar"><div className="segmented" role="group" aria-label="노트 첫 화면 보기"><button type="button" aria-pressed={view==='home'} onClick={()=>choose('home')}>최근</button><button type="button" aria-pressed={view==='board'} onClick={()=>choose('board')}>보드</button></div><span>노트 {notes.length} · 수집함 {inbox.length}</span><button type="button" className="button" disabled={readonly} onClick={()=>onNew()}><Plus size={15}/>새 노트</button></div>
    {view==='board'?<NotesBoard state={state} readonly={readonly} onOpen={onOpen} onNew={onNew} onMove={onMove} onFolderWork={onFolderWork}/>
    :<div className="notes-home-body">
      {pinned.length>0&&<section aria-label="고정한 노트"><h3>고정한 노트 {pinned.length}</h3><div className="notes-home-grid">{pinned.map(n=><NoteCard key={n.id} note={n} onOpen={onOpen}/>)}</div></section>}
      <section aria-label="최근 수정"><h3>최근 수정</h3>{recent.length?<div className="notes-home-grid">{recent.slice(0,12).map(n=><NoteCard key={n.id} note={n} onOpen={onOpen}/>)}</div>:<p className="muted">아직 노트가 없습니다.</p>}</section>
      {inbox.length>0&&<section aria-label="수집함"><h3>수집함 {inbox.length} · 정리하거나 아이스박스로 옮길 노트</h3><div className="notes-home-grid">{inbox.slice(0,6).map(n=><NoteCard key={n.id} note={n} onOpen={onOpen}/>)}</div></section>}
      <section aria-label="템플릿"><h3>템플릿으로 시작</h3><div className="notes-home-grid">{noteTemplates.map(t=>{const Icon=templateIcons[t.id];return <button type="button" className="reference-card" key={t.id} disabled={readonly} onClick={()=>onTemplate(t.id)}><Icon size={16}/><span><strong>{t.title}</strong><small>{t.description}</small></span></button>;})}</div></section>
    </div>}
  </div>;
}

/** 최상위 폴더마다 한 열. 카드를 다른 열에 놓으면 그 폴더의 맨 뒤로 옮긴다(하위 노트도 함께). */
function NotesBoard({state,readonly,onOpen,onNew,onMove,onFolderWork}:{state:Workspace;readonly:boolean;onOpen:(id:string)=>void;onNew:(to?:NoteDestination)=>void;onMove:(id:string,to:NoteDestination)=>void;onFolderWork:(folderId:string,anchor:HTMLElement|null)=>void}){
  const columns=useMemo(()=>noteBoardColumns(state),[state]);
  const [dragging,setDragging]=useState(''),[over,setOver]=useState<string|null>(null);
  function drop(e:DragEvent,folderId:string|null){e.preventDefault();const id=e.dataTransfer.getData('text/kosmos-note')||dragging;setOver(null);setDragging('');if(id&&!readonly)onMove(id,{parentId:folderId});}
  return <div className="board-columns">
    {columns.map(column=><section className={`board-column ${over===(column.folderId??'root')?'is-drop':''}`} key={column.folderId??'root'} aria-label={column.title}
      onDragOver={e=>{if(!dragging||readonly)return;e.preventDefault();setOver(column.folderId??'root');}} onDragLeave={()=>setOver(o=>o===(column.folderId??'root')?null:o)} onDrop={e=>drop(e,column.folderId)}>
      <header>{column.folderId?<Folder size={14}/>:null}<strong>{column.title}</strong><span>{column.notes.length}</span>{column.folderId&&<IconButton label={`${column.title} 폴더로 새 작품 만들기`} disabled={readonly||!column.notes.length} onClick={e=>onFolderWork(column.folderId!,e.currentTarget)}><BookPlus size={14}/></IconButton>}</header>
      {column.notes.map(note=><BoardCard key={note.id} note={note} readonly={readonly} onOpen={onOpen} onDrag={setDragging}/>)}
      <button type="button" className="board-add" disabled={readonly} onClick={()=>onNew(column.folderId?{parentId:column.folderId}:undefined)}><Plus size={14}/>{column.folderId?'이 폴더에 노트 추가':'노트 추가'}</button>
    </section>)}
  </div>;
}
function BoardCard({note,readonly,onOpen,onDrag}:{note:PersonalNote;readonly:boolean;onOpen:(id:string)=>void;onDrag:(id:string)=>void}){
  const snippet=noteSnippet(note);
  return <button type="button" className="plot-card note-board-card" draggable={!readonly} onDragStart={e=>{e.dataTransfer.setData('text/kosmos-note',note.id);e.dataTransfer.effectAllowed='move';onDrag(note.id);}} onDragEnd={()=>onDrag('')} onClick={()=>onOpen(note.id)}>
    <span className="plot-card-meta">{note.box==='icebox'?<Snowflake size={12}/>:<Inbox size={12}/>}<span>{note.box==='icebox'?'아이스박스':'수집함'}</span><span>{noteDate(note.updatedAt)}</span></span>
    <strong>{noteTitle(note)}</strong>{snippet?<span className="plot-card-summary">{snippet}</span>:<span className="plot-card-summary empty">내용 없음</span>}
    {note.tags.length>0&&<span className="plot-card-chips">{note.tags.slice(0,3).map(t=><span className="chip soft" key={t}>#{t}</span>)}{note.tags.length>3&&<span className="chip soft">+{note.tags.length-3}</span>}</span>}
  </button>;
}
