'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, Search, StickyNote, Trash2 } from 'lucide-react';
import { type TrashItem } from '@/lib/model';
import { trashTitle } from '@/lib/workspace-trash';
import { useStudio } from './studio-provider';
import { IconButton, Modal } from './primitives';

export function TrashDialog({open,onClose,onReturnFocus}:{open:boolean;onClose:()=>void;onReturnFocus:()=>void}){
  const s=useStudio(),search=useRef<HTMLInputElement>(null),confirmFocus=useRef<HTMLElement|null>(null);
  const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [confirm,setConfirm]=useState<{ids:string[];title?:string}|null>(null);
  useEffect(()=>{if(open){setQuery('');setError('');setMessage('');setConfirm(null);}},[open]);
  const items=[...(s.state?.trash||[])].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
  const scope=(item:TrashItem)=>item.type==='note'?`노트 · ${item.note.box==='icebox'?'아이스박스':'수집함'}`:`문서 · ${item.workTitle}`;
  const visible=items.filter(item=>`${trashTitle(item)} ${scope(item)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const readonly=busy||!!s.conflict;
  function requestPurge(ids:string[],at:HTMLElement,title?:string){confirmFocus.current=at;setError('');setConfirm({ids,title:title&&title.length>40?`${title.slice(0,40)}…`:title});}
  async function restore(item:TrashItem){
    setBusy(true);setError('');setMessage('');
    try{await s.restoreTrash(item.id);setMessage('복원했습니다.');search.current?.focus();}
    catch(error){setError(error instanceof Error?error.message:'복원하지 못했습니다.');}
    finally{setBusy(false);}
  }
  async function purge(){
    if(!confirm||readonly)return;setBusy(true);setError('');setMessage('');
    try{await s.purgeTrash(confirm.ids);setConfirm(null);setMessage('삭제했습니다.');}
    catch(error){setError(error instanceof Error?error.message:'삭제하지 못했습니다.');}
    finally{setBusy(false);}
  }
  return <>
    <Modal open={open} onClose={()=>{if(!busy&&!confirm)onClose();}} title="휴지통" description="자동으로 비우지 않습니다. 필요할 때 복원하세요." wide onReturnFocus={onReturnFocus}>
      <div className="trash-tools"><div className="sidebar-search"><Search size={15}/><input ref={search} autoFocus aria-label="휴지통 검색" placeholder="제목 · 작품 검색" value={query} onChange={e=>setQuery(e.target.value)}/></div><span className="field-help">{items.length}개</span><button type="button" className="button" disabled={readonly||!items.length} onClick={e=>requestPurge(items.map(item=>item.id),e.currentTarget)}>비우기</button></div>
      <div className="trash-list" aria-label="휴지통 목록">
        {visible.map(item=><div className="reference-card trash-row" key={item.id} data-trash-id={item.id}>
          {item.type==='note'?<StickyNote size={16}/>:<FileText size={16}/>}
          <span className="trash-title"><strong title={trashTitle(item)}>{trashTitle(item)}</strong><small>{scope(item)}</small><small>{new Date(item.deletedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></span>
          <button type="button" className="button" disabled={readonly} onClick={()=>void restore(item)}>복원</button><IconButton label={`${trashTitle(item)} 영구 삭제`} disabled={readonly} onClick={e=>requestPurge([item.id],e.currentTarget,trashTitle(item))}><Trash2 size={16}/></IconButton>
        </div>)}
        {!visible.length&&<p className="empty-text">{items.length?'검색 결과가 없습니다.':'휴지통이 비어 있습니다.'}</p>}
      </div>
      {message&&<p className="field-help" role="status">{message}</p>}{error&&!confirm&&<p className="error-message" role="alert">{error}</p>}
    </Modal>
    <Modal className="trash-confirm" open={open&&!!confirm} onClose={()=>{if(!busy)setConfirm(null);}} title={confirm?.title?'영구 삭제':'휴지통 비우기'} description={confirm?.title?`‘${confirm.title}’를 완전히 삭제할까요?`:'휴지통의 항목을 모두 지울까요?'} onReturnFocus={()=>{if(confirmFocus.current?.isConnected)confirmFocus.current.focus();else search.current?.focus();}}>
      <p className="field-help">복구 이력과 백업은 남습니다.</p>{error&&<p className="error-message" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={()=>setConfirm(null)}>취소</button><button type="button" className="button danger" disabled={readonly} onClick={()=>void purge()}>{busy?'삭제 중':confirm?.title?'삭제':'비우기'}</button></div>
    </Modal>
  </>;
}
