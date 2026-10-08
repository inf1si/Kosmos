'use client';

import { documentTitle, workShelfSchema } from '@/lib/model';
import { z } from 'zod';

import { ArrowDown, ArrowUp, Book, ChevronDown, ChevronRight, LibraryBig, MoreHorizontal, Pencil, Plus, ListOrdered, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LibraryOrder } from './library-order';
import { DocIcon } from './studio-icons';
import { WorkContextMenu, type WorkConfirm } from './work-actions';
import { countChars } from '@/lib/outline';
import { noteDate } from '@/lib/personal-notes';
import { recentDocuments, workUpdatedAt } from '@/lib/studio-position';
import type { NovelDocument, Work, Workspace } from '@/lib/model';
import { addWorkShelf, DEFAULT_WORK_SHELF, moveWorkShelf, moveWorkToShelf, removeWorkShelf, renameWorkShelf, shelfForWork, workShelves, workShelfTitle } from '@/lib/work-shelves';
import { IconButton, Modal, Popover } from './primitives';
import { useStudio } from './studio-provider';
import { useWorkShelfDrag } from './work-shelf-drag';

const kinds={scene:'원고',wiki:'설정집',memo:'메모'} as const;

const workChars=(work:Work)=>work.documents.filter(d=>d.kind==='scene').reduce((n,d)=>n+countChars(d),0);

const place=(doc:NovelDocument)=>doc.kind==='scene'?doc.chapter.trim()||'부 미지정':doc.kind==='wiki'?doc.category.trim()||kinds.wiki:kinds.memo;

type ShelfForm={type:'create'}|{type:'rename';id:string}|{type:'move';id:string};

function collapsedShelves(key:string):Set<string>{
  try{const value=z.array(workShelfSchema.shape.id).max(40).safeParse(JSON.parse(localStorage.getItem(key)||'[]'));

    return new Set(value.success?value.data:[]);
  }catch{return new Set();}
}

/** The studio's first screen: where the writer left off, every work, and recent edits across works. Layout matches the notes home. */
export function StudioHome({state,resume,currentWorkId,readonly,onOpen,onOpenWork,onNewWork,onEditWork,onConfirmWork}:{state:Workspace;resume:{work:Work;doc:NovelDocument};currentWorkId:string;readonly:boolean;onOpen:(workId:string,docId:string)=>void;onOpenWork:(workId:string)=>void;onNewWork:(shelfId?:string)=>void;onEditWork:(workId:string)=>void;onConfirmWork:(confirm:WorkConfirm)=>void}){
  const s=useStudio(),shelves=workShelves(state),works=new Map(state.works.map(w=>[w.id,w]));
  const scenes=state.works.reduce((n,w)=>n+w.documents.filter(d=>d.kind==='scene').length,0);
  const recent=recentDocuments(state);
  const [orderOpen,setOrderOpen]=useState(false);
  const orderTrigger=useRef<HTMLButtonElement>(null);
  const [form,setForm]=useState<ShelfForm|null>(null),[name,setName]=useState(''),[destination,setDestination]=useState(DEFAULT_WORK_SHELF),[error,setError]=useState('');
  const [deleting,setDeleting]=useState<string|null>(null);
  const collapseKey=`kosmos-work-shelf-collapse:${s.namespace}`;
  const [closed,setClosed]=useState(()=>collapsedShelves(collapseKey));
  const root=useRef<HTMLDivElement>(null),anchor=useRef<HTMLElement|null>(null),returnFocus=useRef<HTMLElement|null>(null),focusWork=useRef<string|null>(null),newShelfTrigger=useRef<HTMLButtonElement>(null);
  const moveTarget=form?.type==='move'?works.get(form.id):undefined,deleteTarget=shelves.find(shelf=>shelf.id===deleting);

  function apply(fn:(latest:Workspace)=>Workspace){
    if(readonly)return false;

    try{s.update(fn);setError('');

return true;}catch(e){setError(e instanceof Error?e.message:'책장을 바꾸지 못했습니다.');

return false;}
  }

  function openForm(next:ShelfForm,at:HTMLElement|null){
    // Finish the previous popover's outside-click dismissal before opening the next form.
    window.setTimeout(()=>{
      anchor.current=at;returnFocus.current=at;focusWork.current=next.type==='move'?next.id:null;setError('');
      setName(next.type==='rename'?shelves.find(shelf=>shelf.id===next.id)?.title||'':'');

      if(next.type==='move')setDestination(shelfForWork(state,next.id));
      setForm(next);
    },0);
  }

  function restoreFocus(){
    const work=focusWork.current&&root.current?.querySelector<HTMLButtonElement>(`[data-work-id="${focusWork.current}"] .reference-card`);

    if(returnFocus.current?.isConnected)returnFocus.current.focus();
    else if(work){work.scrollIntoView({block:'nearest'});work.focus();}
    else newShelfTrigger.current?.focus();
  }

  function toggle(id:string,collapse?:boolean){setClosed(previous=>{const next=new Set(previous);

    if(collapse??!next.has(id))next.add(id);else next.delete(id);

    try{localStorage.setItem(collapseKey,JSON.stringify([...next]));}catch{/* Collapsing stays usable if device preferences cannot be saved. */}

    return next;
  });}

  function submit(){
    if(!form)return;
    const next=form.type==='create'?(latest:Workspace)=>addWorkShelf(latest,name):form.type==='rename'?(latest:Workspace)=>renameWorkShelf(latest,form.id,name):(latest:Workspace)=>moveWorkToShelf(latest,form.id,destination);

    if(apply(next)){if(form.type==='move')toggle(destination,false);setForm(null);}
  }

  const dragging=useWorkShelfDrag({root,state,disabled:readonly||!!form||!!deleting||orderOpen,apply,expand:id=>toggle(id,false)});

  return <div ref={root} className="plot-board notes-home studio-home">
    <div className="board-bar"><span>작품 {state.works.length} · 원고 {scenes} · {state.works.reduce((n,w)=>n+workChars(w),0).toLocaleString()}자</span><button type="button" className="button" ref={orderTrigger} disabled={readonly} onClick={()=>setOrderOpen(true)}><ListOrdered size={15}/>서재 순서 편집</button><button type="button" className="button" ref={newShelfTrigger} disabled={readonly||shelves.length>=40} onClick={e=>openForm({type:'create'},e.currentTarget)}><LibraryBig size={15}/>새 책장</button><button type="button" className="button" disabled={readonly} onClick={()=>onNewWork()}><Plus size={15}/>새 작품</button></div>
    <div className="notes-home-body">
      <section aria-label="이어 쓰기"><h3>이어 쓰기</h3><div className="notes-home-grid">
        <button type="button" className="reference-card" onClick={()=>onOpen(resume.work.id,resume.doc.id)}><DocIcon doc={resume.doc} size={16}/><span><strong>{documentTitle(resume.doc)}</strong><small>{resume.work.title} · {place(resume.doc)} · {noteDate(resume.doc.updatedAt)} 수정</small></span></button>
      </div></section>
      {shelves.map((shelf,index)=>{const items=shelf.workIds.map(id=>works.get(id)).filter((work):work is Work=>!!work),collapsed=closed.has(shelf.id),title=workShelfTitle(shelf);

        return <section key={shelf.id} aria-label={`${title} 책장`} data-work-shelf={shelf.id} {...dragging.shelfProps(shelf.id)}>
          <div className="work-shelf-heading">{dragging.grip('shelf',shelf.id,title)}<h3><button type="button" aria-label={`${title} ${collapsed?'펼치기':'접기'}`} aria-expanded={!collapsed} onClick={()=>toggle(shelf.id)}>{collapsed?<ChevronRight size={13}/>:<ChevronDown size={13}/>}<LibraryBig size={14}/><span>{title}</span><small>{items.length}개</small></button></h3>
            <IconButton label="새 작품" aria-label={`${title} 새 작품`} disabled={readonly} onClick={()=>onNewWork(shelf.id)}><Plus size={15}/></IconButton>
            <DropdownMenu.Root modal={false}><DropdownMenu.Trigger asChild><IconButton label="책장 메뉴" aria-label={`${title} 책장 메뉴`} data-shelf-menu><MoreHorizontal size={15}/></IconButton></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu" align="end" collisionPadding={12}>
              <DropdownMenu.Item className="menu-item" disabled={readonly} onSelect={()=>{const at=root.current?.querySelector<HTMLElement>(`[data-work-shelf="${shelf.id}"] [data-shelf-menu]`)||null;openForm({type:'rename',id:shelf.id},at);}}><Pencil size={15}/>이름 변경</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={readonly||index===0} onSelect={()=>apply(latest=>moveWorkShelf(latest,shelf.id,-1))}><ArrowUp size={15}/>책장 위로</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={readonly||index===shelves.length-1} onSelect={()=>apply(latest=>moveWorkShelf(latest,shelf.id,1))}><ArrowDown size={15}/>책장 아래로</DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator"/>
              <DropdownMenu.Item className="menu-item" disabled={readonly||shelf.id===DEFAULT_WORK_SHELF} onSelect={()=>{setError('');returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;focusWork.current=null;setDeleting(shelf.id);}}><Trash2 size={15}/>책장 삭제</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
          </div>
          {!collapsed&&(items.length?<div className="notes-home-grid">{items.map(work=>{const updated=noteDate(workUpdatedAt(work)),move=(at:HTMLElement|null)=>openForm({type:'move',id:work.id},at);

            return <div className="work-shelf-card" key={work.id} data-work-id={work.id} {...dragging.workProps(work.id)}>{dragging.grip('work',work.id,work.title)}<WorkContextMenu work={work} canTrash={state.works.length>1} readonly={readonly} onOpen={()=>onOpenWork(work.id)} onEdit={()=>onEditWork(work.id)} onConfirm={onConfirmWork} onMove={()=>{const at=root.current?.querySelector<HTMLElement>(`[data-work-id="${work.id}"] .reference-card`)||null;move(at);}}><button type="button" className="reference-card" aria-current={work.id===currentWorkId||undefined} onClick={()=>onOpenWork(work.id)}><Book size={16}/><span><strong>{work.title}</strong><small>{work.form} · 원고 {work.documents.filter(d=>d.kind==='scene').length} · {workChars(work).toLocaleString()}자{work.activePublicationId&&' · 게시 중'}{updated&&` · ${updated} 수정`}</small></span></button></WorkContextMenu><IconButton label="책장 이동" aria-label={`${work.title} 책장 이동`} disabled={readonly} onClick={e=>move(e.currentTarget)}><LibraryBig size={15}/></IconButton></div>;
          })}</div>:<p className="field-help">아직 작품이 없습니다.</p>)}
        </section>;
      })}
      {!form&&!deleting&&error&&<p className="error-message" role="alert">{error}</p>}
      <section aria-label="최근 수정"><h3>최근 수정 문서</h3><div className="notes-home-grid">{recent.map(({work,doc})=><button type="button" className="reference-card" key={doc.id} onClick={()=>onOpen(work.id,doc.id)}><DocIcon doc={doc} size={16}/><span><strong>{documentTitle(doc)}</strong><small>{state.works.length>1?`${work.title} · `:''}{place(doc)} · {noteDate(doc.updatedAt)}</small></span></button>)}</div></section>
    </div>{dragging.feedback}{orderOpen&&<LibraryOrder onReturnFocus={()=>orderTrigger.current?.focus()} readonly={readonly} onClose={()=>setOrderOpen(false)}/>}
    <Popover open={!!form} onOpenChange={open=>{if(!open)setForm(null);}} anchor={anchor} title={form?.type==='move'?'책장 이동':form?.type==='rename'?'책장 이름 변경':'새 책장'} width={300} onReturnFocus={restoreFocus}>
      <form className="account-login" onSubmit={e=>{e.preventDefault();submit();}}>{form?.type==='move'?<><p>{moveTarget?.title}</p><label>옮길 책장<select aria-label="옮길 책장" value={destination} disabled={readonly} onChange={e=>setDestination(e.target.value)}>{shelves.map(shelf=><option key={shelf.id} value={shelf.id}>{workShelfTitle(shelf)}</option>)}</select></label></>:<label>책장 이름<input autoFocus value={name} maxLength={80} disabled={readonly} placeholder="이름 없는 책장" onChange={e=>setName(e.target.value)}/></label>}{error&&<p className="error-message" role="alert">{error}</p>}<button type="submit" className="button primary" disabled={readonly||form?.type==='move'&&(!moveTarget||destination===shelfForWork(state,moveTarget.id))}>{form?.type==='move'?'옮기기':form?.type==='rename'?'이름 저장':'책장 만들기'}</button></form>
    </Popover>
    <Modal open={!!deleteTarget} onClose={()=>setDeleting(null)} title="책장 삭제" description={deleteTarget?`‘${workShelfTitle(deleteTarget)}’를 삭제할까요?`:undefined} onReturnFocus={restoreFocus}>
      <p className="field-help">작품은 ‘{workShelfTitle(shelves.find(shelf=>shelf.id===DEFAULT_WORK_SHELF)!)}’ 책장에 옮깁니다.</p>{error&&<p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button" onClick={()=>setDeleting(null)}>취소</button><button type="button" className="button danger" disabled={readonly} onClick={()=>{if(deleting&&apply(latest=>removeWorkShelf(latest,deleting)))setDeleting(null);}}>책장 삭제</button></div>
    </Modal>
  </div>;
}
