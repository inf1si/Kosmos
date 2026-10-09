'use client';

import * as ContextMenu from '@radix-ui/react-context-menu';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, GlobeOff, LibraryBig, Settings2, Star, Trash2 } from 'lucide-react';
import { workSchema, type Work, type Workspace } from '@/lib/model';
import { IconButton, Modal } from './primitives';
import { useStudio } from './studio-provider';
import { moveWorkToShelf, shelfForWork, workShelves, workShelfTitle } from '@/lib/work-shelves';
import { toggleWorkFavorite } from '@/lib/work-favorites';

export type WorkConfirm={type:'unpublish'|'trash';workId:string};

const lastWork='마지막 작품은 유지해야 합니다';

export function WorkFavoriteButton({work,readonly}:{work:Work;readonly:boolean}){
  const s=useStudio(),label=work.favorite?'즐겨찾기 해제':'즐겨찾기 추가';

  return <IconButton className="icon-button work-favorite" label={label} aria-label={`${work.title} ${label}`} aria-pressed={!!work.favorite} disabled={readonly} onClick={e=>{
    const home=e.currentTarget.closest('.studio-home'),fromFavorites=!!e.currentTarget.closest('[data-favorite-work]');
    s.update(state=>toggleWorkFavorite(state,work.id));

    if(fromFavorites)requestAnimationFrame(()=>{const target=home?.querySelector<HTMLButtonElement>(`[data-work-id="${work.id}"] .work-favorite`)||home?.querySelector<HTMLButtonElement>('.board-bar button');target?.focus();});
  }}><Star size={15} fill={work.favorite?'currentColor':'none'}/></IconButton>;
}

const editionDate=(work:Work)=>{const at=work.publications.find(p=>p.id===work.activePublicationId)?.publishedAt;

return at?new Date(at).toLocaleDateString('ko-KR'):'';};

/** Right-click (long press on touch, Shift+F10 on a keyboard) on a work card: the same actions as the work settings. */
export function WorkContextMenu({work,canTrash,readonly,onOpen,onEdit,onConfirm,onMove,children}:{work:Work;canTrash:boolean;readonly:boolean;onOpen:()=>void;onEdit:()=>void;onConfirm:(confirm:WorkConfirm)=>void;onMove?:()=>void;children:ReactNode}){
  const s=useStudio(),returnFavoriteFocus=useRef(false),keepMenuFocus=useRef(false);

  return <ContextMenu.Root modal={false}>
    <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className="menu work-context-menu" collisionPadding={12} aria-label={`${work.title} 작품 메뉴`} onCloseAutoFocus={e=>{
      if(returnFavoriteFocus.current){e.preventDefault();returnFavoriteFocus.current=false;const target=document.querySelector<HTMLButtonElement>(`.studio-home [data-work-id="${work.id}"] .reference-card`)||document.querySelector<HTMLButtonElement>('.studio-home .board-bar button');target?.focus();}
      // 책장 이동 opens a popover; returning focus after it opened would close it as focus outside.
      else if(keepMenuFocus.current){e.preventDefault();keepMenuFocus.current=false;}
    }}>
      <ContextMenu.Item className="menu-item" onSelect={onOpen}><BookOpen size={15}/>열기</ContextMenu.Item>
      <ContextMenu.Item className="menu-item" onSelect={onEdit}><Settings2 size={15}/>작품 정보 편집</ContextMenu.Item>
      <ContextMenu.Item className="menu-item" disabled={readonly} onSelect={()=>{returnFavoriteFocus.current=!!work.favorite;s.update(state=>toggleWorkFavorite(state,work.id));}}><Star size={15} fill={work.favorite?'currentColor':'none'}/>{work.favorite?'즐겨찾기 해제':'즐겨찾기 추가'}</ContextMenu.Item>
      {onMove&&<ContextMenu.Item className="menu-item" disabled={readonly} onSelect={()=>{keepMenuFocus.current=true;onMove();}}><LibraryBig size={15}/>책장 이동</ContextMenu.Item>}
      {work.activePublicationId&&<ContextMenu.Item className="menu-item" disabled={readonly} onSelect={()=>onConfirm({type:'unpublish',workId:work.id})}><GlobeOff size={15}/>게시 철회</ContextMenu.Item>}
      <ContextMenu.Separator className="menu-separator"/>
      <ContextMenu.Item className="menu-item" disabled={readonly||!canTrash} title={canTrash?undefined:lastWork} onSelect={()=>onConfirm({type:'trash',workId:work.id})}><Trash2 size={15}/>휴지통으로 이동</ContextMenu.Item>
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}

/** Work settings (info, form, public edition, trash) and the two confirmations. Both settings and the card menu open these. */
export function WorkDialogs({state,settingsId,confirm,readonly,onSettings,onConfirm,onTrashed}:{state:Workspace;settingsId:string|null;confirm:WorkConfirm|null;readonly:boolean;onSettings:(id:string|null)=>void;onConfirm:(confirm:WorkConfirm|null)=>void;onTrashed:(id:string)=>void}){
  const s=useStudio(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const work=state.works.find(w=>w.id===settingsId),target=state.works.find(w=>w.id===confirm?.workId),canTrash=state.works.length>1;
  useEffect(()=>{setError('');},[confirm]);
  useEffect(()=>{setDone('');setError('');},[settingsId]);

  function patch(id:string,value:Partial<Pick<Work,'title'|'subtitle'|'description'|'form'>>){s.update(next=>({...next,works:next.works.map(w=>w.id===id?{...w,...value}:w)}));}

  async function run(){
    if(!confirm||!target||busy)return;setBusy(true);setError('');

    try{
      if(confirm.type==='unpublish'){await s.unpublish(target.id);setDone('게시를 철회했습니다. 다시 게시하면 새 판본을 만듭니다.');}
      else{await s.trashWork(target.id);onSettings(null);onTrashed(target.id);}

      onConfirm(null);
    }catch(e){setError(e instanceof Error?e.message:'작업을 마치지 못했습니다.');}
    finally{setBusy(false);}
  }

  const docs=target?.documents.length||0;

  return <>
    <Modal open={!!work} onClose={()=>onSettings(null)} title="작품 정보">{work&&<>
      <div className="form-grid">
        <label>작품명<input value={work.title} onChange={e=>{if(e.target.value)patch(work.id,{title:e.target.value});}}/></label>
        <label>형식<select value={work.form} onChange={e=>patch(work.id,{form:workSchema.shape.form.parse(e.target.value)})}>{['단편','중편','장편'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>책장<select aria-label="책장" disabled={readonly} value={shelfForWork(state,work.id)} onChange={e=>{const shelfId=e.target.value;

try{s.update(next=>moveWorkToShelf(next,work.id,shelfId));setError('');}catch(cause){setError(cause instanceof Error?cause.message:'책장을 옮기지 못했습니다.');}}}>{workShelves(state).map(shelf=><option key={shelf.id} value={shelf.id}>{workShelfTitle(shelf)}</option>)}</select></label>
        <label>부제<input value={work.subtitle} onChange={e=>patch(work.id,{subtitle:e.target.value})}/></label>
        <label>작품 소개<textarea rows={4} value={work.description} onChange={e=>patch(work.id,{description:e.target.value})}/></label>
      </div>
      <div className="modal-actions work-settings-actions">
        <span className="work-public-state">{work.activePublicationId?`공개 서재에 게시 중 · ${editionDate(work)} 판본`:'공개 서재에 게시하지 않음'}</span>
        <button type="button" className="button" disabled={readonly} aria-pressed={!!work.favorite} onClick={()=>s.update(state=>toggleWorkFavorite(state,work.id))}><Star size={15} fill={work.favorite?'currentColor':'none'}/>{work.favorite?'즐겨찾기 해제':'즐겨찾기 추가'}</button>
        {work.activePublicationId&&<button type="button" className="button" disabled={readonly} onClick={()=>onConfirm({type:'unpublish',workId:work.id})}><GlobeOff size={15}/>게시 철회</button>}
        <button type="button" className="button" disabled={readonly||!canTrash} title={canTrash?undefined:lastWork} onClick={()=>onConfirm({type:'trash',workId:work.id})}><Trash2 size={15}/>휴지통으로 이동</button>
      </div>
      {error&&<p className="error-message" role="alert">{error}</p>}{done&&<p className="field-help work-settings-done" role="status">{done}</p>}
    </>}</Modal>
    <Modal className="trash-confirm" open={!!target} onClose={()=>{if(!busy)onConfirm(null);}} title={confirm?.type==='unpublish'?'게시 철회':'작품을 휴지통으로 이동'}
      description={target?confirm?.type==='unpublish'?`‘${target.title}’를 공개 서재에서 내릴까요?`:`‘${target.title}’와 문서 ${docs}개를 휴지통으로 옮길까요?`:undefined}>
      <p className="field-help">{confirm?.type==='unpublish'?'독서·설정집 화면도 바로 닫힙니다. 원고와 이전 판본 기록은 남습니다.':`휴지통에서 복원할 수 있습니다.${target?.activePublicationId?' 공개 서재의 판본은 게시를 철회합니다.':''}`}</p>
      {error&&<p className="error-message" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={()=>onConfirm(null)}>취소</button><button type="button" className="button danger" disabled={busy||readonly} onClick={()=>void run()}>{busy?'처리 중':confirm?.type==='unpublish'?'게시 철회':'휴지통으로 이동'}</button></div>
    </Modal>
  </>;
}
