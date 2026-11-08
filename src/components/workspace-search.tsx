'use client';

import { useDeferredValue,useEffect,useId,useMemo,useRef,useState } from 'react';
import { Search,X } from 'lucide-react';
import {z} from 'zod';
import { uid } from '@/lib/model';
import { searchDocuments,searchTerms,searchWorkspace,type WorkspaceSearchHit,type WorkspaceSearchJump } from '@/lib/workspace-search';
import { referenceKey } from '@/lib/internal-references';
import { useStudio } from './studio-provider';
import { IconButton,Modal } from './primitives';
import { SearchResultContent } from './search-result';
import { Select } from './select';

export function openWorkspaceSearch(query?:string){window.dispatchEvent(new CustomEvent('workspace-search',{detail:query}));}

/** The last query and scope stay for this page only, so the next result is one reopen away. Never stored. */
const last={query:'',scope:'all'};

export function WorkspaceSearch({currentWorkId,onOpen}:{currentWorkId:string;onOpen:(hit:WorkspaceSearchHit,jump:WorkspaceSearchJump)=>void}){
  const [open,setOpen]=useState(false),origin=useRef<HTMLElement|null>(null),pending=useRef<WorkspaceSearchHit|null>(null),query=useRef('');
  useEffect(()=>{
    const show=(event?:Event)=>{if(document.querySelector('.modal:not(.workspace-search-dialog)'))return;

if(event instanceof CustomEvent){const value=z.string().safeParse(event.detail);

if(value.success){last.query=value.data.slice(0,500);last.scope='all';}}

if(!open){origin.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setOpen(true);}};

    const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&(event.code==='KeyK'||event.key.toLowerCase()==='k')){if(document.querySelector('.modal:not(.workspace-search-dialog)'))return;event.preventDefault();

if(open)setOpen(false);else show();}};

    window.addEventListener('workspace-search',show);window.addEventListener('keydown',key,true);

    return()=>{window.removeEventListener('workspace-search',show);window.removeEventListener('keydown',key,true);};
  },[open]);

  const returnFocus=()=>{const hit=pending.current;pending.current=null;

if(hit)onOpen(hit,{id:uid(),targetId:hit.document.targetId,terms:searchTerms(query.current)});else if(origin.current?.isConnected)origin.current.focus();else document.getElementById('sidebar-toggle')?.focus();};

  return <Modal open={open} onClose={()=>setOpen(false)} title="전체 검색" wide className="workspace-search-dialog" onReturnFocus={returnFocus}>{open&&<SearchContents currentWorkId={currentWorkId} onChoose={(hit,value)=>{pending.current=hit;query.current=value;setOpen(false);}}/>}</Modal>;
}

function SearchContents({currentWorkId,onChoose}:{currentWorkId:string;onChoose:(hit:WorkspaceSearchHit,query:string)=>void}){
  const state=useStudio().state!,[query,setQuery]=useState(last.query),[scope,setScope]=useState(()=>['all','current','notes'].includes(last.scope)||state.works.some(work=>work.id===last.scope)?last.scope:'all'),[index,setIndex]=useState(0),[limit,setLimit]=useState(50),listId=useId(),input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
  const deferred=useDeferredValue(query),busy=query!==deferred,documents=useMemo(()=>searchDocuments(state),[state]),found=useMemo(()=>searchWorkspace(documents,deferred,scope,currentWorkId),[documents,deferred,scope,currentWorkId]);
  const visible=found.slice(0,limit),chosen=Math.min(index,Math.max(0,visible.length-1)),terms=searchTerms(deferred);
  useEffect(()=>{list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[chosen,deferred,scope]);
  useEffect(()=>{last.query=query;last.scope=scope;},[query,scope]);
  useEffect(()=>{input.current?.select();},[]);

  return <><div className="workspace-search-controls"><div className="sidebar-search"><Search size={16}/><input ref={input} autoFocus type="text" inputMode="search" role="combobox" aria-label="전체 검색어" aria-autocomplete="list" aria-expanded={visible.length>0} aria-controls={listId} aria-activedescendant={visible.length?`${listId}-${chosen}`:undefined} placeholder="제목 · 본문 검색" maxLength={500} value={query} onChange={e=>{setQuery(e.target.value);setIndex(0);setLimit(50);}} onKeyDown={e=>{
    if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;

    if(!busy&&visible.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setIndex(i=>(i+(e.key==='ArrowDown'?1:-1)+visible.length)%visible.length);}

    if(!busy&&e.key==='Enter'&&visible.length){e.preventDefault();onChoose(visible[chosen],deferred);}
  }}/>{query&&<IconButton label="전체 검색어 지우기" onClick={()=>{setQuery('');setIndex(0);setLimit(50);input.current?.focus();}}><X size={14}/></IconButton>}</div><Select aria-label="검색 범위" value={scope} onChange={value=>{setScope(value);setIndex(0);setLimit(50);}}><option value="all">전체</option><option value="current">현재 작품 · {state.works.find(work=>work.id===currentWorkId)?.title}</option><option value="notes">노트</option><optgroup label="작품">{state.works.map(work=><option key={work.id} value={work.id}>{work.title}</option>)}</optgroup></Select></div>
  <p className="field-help" role="status">{found.length}개</p><div ref={list} className="workspace-search-results" role="listbox" id={listId} aria-label="전체 검색 결과" aria-busy={busy}>{visible.map((hit,i)=>{const target=hit.document;

return <button type="button" role="option" tabIndex={-1} id={`${listId}-${i}`} key={referenceKey(target)} aria-selected={chosen===i} className="reference-card" onPointerMove={()=>setIndex(i)} onMouseDown={e=>e.preventDefault()} disabled={busy} onClick={()=>onChoose(hit,deferred)}><SearchResultContent hit={hit} terms={terms}/></button>;})}</div>{deferred.trim()&&!found.length&&<p className="field-help">검색 결과가 없습니다.</p>}{found.length>limit&&<button type="button" className="button" onClick={()=>{setIndex(limit);setLimit(value=>value+50);input.current?.focus();}}>더 보기</button>}</>;
}
