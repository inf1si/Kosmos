'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, FolderInput, Notebook, Pencil, Plus, Trash2 } from 'lucide-react';
import { uid } from '@/lib/model';
import { addNoteSpace, DEFAULT_NOTE_SPACE, moveNote, noteSpaceTitle, notesInSpace, removeNoteSpace, renameNoteSpace, resolveNoteNavigation } from '@/lib/note-navigation';
import { useStudio } from './studio-provider';
import { Popover } from './primitives';
import { Select } from './select';

export type NoteSpaceRequest={type:'new'|'rename'|'delete';spaceId:string;anchor:HTMLElement|null}|{type:'move';id:string;spaceId:string;anchor:HTMLElement|null};

export function NoteSpaceSwitcher({spaceId,readonly,onSelect,onRequest}:{spaceId:string;readonly:boolean;onSelect:(id:string)=>void;onRequest:(request:NoteSpaceRequest)=>void}){
  const s=useStudio(),spaces=useMemo(()=>resolveNoteNavigation(s.state!).spaces,[s.state]),[open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),pending=useRef<'new'|'rename'|'delete'|null>(null);
  const space=spaces.find(space=>space.id===spaceId)??spaces[0],notes=notesInSpace(s.state!,space.id);
  const request=(type:'new'|'rename'|'delete')=>{pending.current=type;setOpen(false);};

  return <div className="work-switcher"><Popover open={open} onOpenChange={setOpen} title="노트 작업공간" width={300} onReturnFocus={()=>{const type=pending.current;pending.current=null;

if(type)onRequest({type,spaceId:space.id,anchor:trigger.current});else trigger.current?.focus();}} trigger={<button ref={trigger} type="button" className="work-card" data-note-space-switcher aria-label={`작업공간 전환 · ${noteSpaceTitle(space)}`}><span className="work-cover" aria-hidden="true"><Notebook size={20}/></span><span><strong>{noteSpaceTitle(space)}</strong><small>섹션 {space.sections.length} · 노트 {notes.length}</small></span><ChevronsUpDown size={15}/></button>}>
    <div className="note-space-list">{spaces.map(item=><button type="button" className="reference-card" key={item.id} aria-current={item.id===space.id||undefined} onClick={()=>{setOpen(false);onSelect(item.id);}}><Notebook size={16}/><span><strong>{noteSpaceTitle(item)}</strong><small>노트 {notesInSpace(s.state!,item.id).length}</small></span></button>)}</div>
    <div className="popover-actions"><button type="button" className="button" disabled={readonly} onClick={()=>request('new')}><Plus size={14}/>새 작업공간</button><button type="button" className="button" disabled={readonly} onClick={()=>request('rename')}><Pencil size={14}/>이름 변경</button><button type="button" className="button" disabled={readonly||space.id===DEFAULT_NOTE_SPACE} onClick={()=>request('delete')}><Trash2 size={14}/>삭제</button></div>
  </Popover></div>;
}

export function NoteSpaceForm({request,onClose,onSelect,onMoved}:{request:NoteSpaceRequest;onClose:()=>void;onSelect:(id:string)=>void;onMoved:(id:string,spaceId:string)=>void}){
  const s=useStudio(),nav=useMemo(()=>resolveNoteNavigation(s.state!),[s.state]),space=nav.spaces.find(space=>space.id===request.spaceId);
  const [name,setName]=useState(request.type==='rename'?space?.title??'':''),[target,setTarget]=useState(nav.spaces.find(s=>s.id!==request.spaceId)?.id??DEFAULT_NOTE_SPACE),[section,setSection]=useState(''),[error,setError]=useState('');
  const anchor=useRef(request.anchor),readonly=!!s.conflict||!s.canUse;
  const destination=nav.spaces.find(s=>s.id===target)??nav.spaces[0],sectionId=destination.sections.some(s=>s.id===section)?section:destination.sections[0].id;
  const title=request.type==='new'?'새 작업공간':request.type==='rename'?'작업공간 이름 변경':request.type==='delete'?'작업공간 삭제':'작업공간으로 이동';

  function submit(){
    if(readonly)return;

    try{
      if(request.type==='new'){const id=uid();s.update(state=>addNoteSpace(state,name,id));onClose();onSelect(id);}
      else if(request.type==='rename'){s.update(state=>renameNoteSpace(state,request.spaceId,name));onClose();}
      else if(request.type==='delete'){s.update(state=>removeNoteSpace(state,request.spaceId));onClose();onSelect(DEFAULT_NOTE_SPACE);}
      else if(request.type==='move'){const id=request.id;s.update(state=>moveNote(state,id,{spaceId:destination.id,sectionId,parentId:null}));onClose();onMoved(id,destination.id);}
    }catch(error){setError(error instanceof Error?error.message:'작업공간을 변경하지 못했습니다.');}
  }

  return <Popover open onOpenChange={open=>{if(!open)onClose();}} anchor={anchor} title={title} width={320} onReturnFocus={()=>{if(anchor.current?.isConnected)anchor.current.focus();else document.getElementById('sidebar-toggle')?.focus();}}>
    <form className="notes-popover" onSubmit={e=>{e.preventDefault();submit();}}>
      {request.type==='move'?<><label>작업공간<Select aria-label="옮길 작업공간" value={destination.id} disabled={readonly} onChange={value=>{setTarget(value);setSection('');}}>{nav.spaces.map(s=><option key={s.id} value={s.id}>{noteSpaceTitle(s)}</option>)}</Select></label><label>섹션<Select aria-label="옮길 섹션" value={sectionId} disabled={readonly} onChange={setSection}>{destination.sections.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</Select></label></>:request.type==='delete'?<p>안의 섹션과 노트는 기본 작업공간으로 옮깁니다.</p>:<label>이름<input aria-label="작업공간 이름" autoFocus maxLength={80} value={name} disabled={readonly} placeholder="이름 없는 작업공간" onChange={e=>setName(e.target.value)}/></label>}
      {error&&<p className="error-message" role="alert">{error}</p>}
      <div className="popover-actions"><button type="button" className="button" onClick={onClose}>취소</button><button type="submit" className={`button ${request.type==='delete'?'danger':'primary'}`} disabled={readonly}>{request.type==='move'?<FolderInput size={14}/>:null}{request.type==='delete'?'삭제':request.type==='move'?'이동':request.type==='new'?'만들기':'저장'}</button></div>
    </form>
  </Popover>;
}
