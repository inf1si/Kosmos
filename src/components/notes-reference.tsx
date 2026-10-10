'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { ArrowLeft, NotebookPen, Pin, Search, StickyNote, X } from 'lucide-react';
import { IconButton } from './primitives';
import { useStudio } from './studio-provider';
import { QuickNoteForm } from './quick-note';
import { filterNotes, noteDate, noteSnippet, noteTitle } from '@/lib/personal-notes';
import { plainText, type PersonalNote } from '@/lib/model';

const EMPTY:PersonalNote[]=[];

/** 노트 목록 한 줄: 제목, 날짜 · 첫 줄. 참고 패널·노트 첫 화면·목록 보기·통합 검색이 같은 카드를 쓴다. */
export function NoteCard({note,onOpen,current=false}:{note:PersonalNote;onOpen:(id:string)=>void;current?:boolean}){
  const snippet=noteSnippet(note);

  return <button type="button" className="reference-card note-card" aria-current={current||undefined} onClick={()=>onOpen(note.id)}>
    {note.pinned?<Pin size={16} aria-label="고정"/>:<StickyNote size={16}/>}
    <span><strong>{noteTitle(note)}</strong><small>{noteDate(note.updatedAt)}{snippet&&` · ${snippet}`}</small></span>
  </button>;
}

/** 집필실 참고 패널의 노트 탭. 원고를 떠나지 않고 메모·검색·읽기를 하고, 편집은 노트 공간에서 연다. */
export function NotesReference({workId,readonly,onOpenNote}:{workId:string;readonly:boolean;onOpenNote:(id:string)=>void}){
  const s=useStudio(),notes=s.state?.notes||EMPTY,[query,setQuery]=useState(''),[previewId,setPreviewId]=useState('');
  const search=useDeferredValue(query);
  const linked=useMemo(()=>filterNotes(notes,{workId}),[notes,workId]);
  const found=useMemo(()=>filterNotes(notes,{query:search}).slice(0,30),[notes,search]);
  const preview=notes.find(n=>n.id===previewId);

  if(preview)return <div className="notes-reference">
    <div className="notes-reference-bar"><IconButton label="노트 목록으로" onClick={()=>setPreviewId('')}><ArrowLeft size={15}/></IconButton><span>{noteDate(preview.updatedAt)}</span><button type="button" className="button" onClick={()=>onOpenNote(preview.id)}><NotebookPen size={14}/>노트에서 열기</button></div>
    <h3 className="notes-reference-title">{noteTitle(preview)}</h3>
    {preview.tags.length>0&&<div className="doc-chips">{preview.tags.map(tag=><span className="chip soft" key={tag}>#{tag}</span>)}</div>}
    <div className="notes-reference-body">{plainText(preview.content).split('\n').filter(line=>line.trim()).map((line,i)=><p key={i}>{line}</p>)}</div>
  </div>;

  return <div className="notes-reference">
    <h3>빠른 메모</h3>
    <QuickNoteForm disabled={readonly} rows={3} onOpenNote={onOpenNote}/>
    <div className="sidebar-search notes-reference-search"><Search size={15}/><input aria-label="노트 검색" placeholder="노트 제목 · 본문 · 태그" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<IconButton label="노트 검색 지우기" onClick={()=>setQuery('')}><X size={14}/></IconButton>}</div>
    {!search.trim()&&<><h3>이 작품에 연결된 노트</h3>{linked.length?linked.map(note=><NoteCard key={note.id} note={note} onOpen={setPreviewId}/>):<p className="muted">연결된 노트가 없습니다.</p>}</>}
    <h3>{search.trim()?`검색 결과 ${found.length}개`:'최근 노트'}</h3>
    {found.length?found.map(note=><NoteCard key={note.id} note={note} onOpen={setPreviewId}/>):<p className="muted">{search.trim()?'일치하는 노트가 없습니다.':'노트가 없습니다.'}</p>}
  </div>;
}
