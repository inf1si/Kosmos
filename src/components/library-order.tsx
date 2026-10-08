'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Book, GripVertical } from 'lucide-react';
import { librarySort, librarySorts, moveLibraryItem, sortPublications, type LibraryItem } from '@/lib/library-order';
import { useStudio } from './studio-provider';
import { IconButton, Modal } from './primitives';
import treeStyles from './document-tree.module.css';

type Drop={id:string;edge:'before'|'after'};

type Drag={id:string;pointerId:number;startX:number;startY:number;x:number;y:number;active:boolean;drop?:Drop};

const shortTitle=(title='')=>title.length>24?`${title.slice(0,24)}…`:title;

export function LibraryOrder({readonly,onClose,onReturnFocus}:{readonly:boolean;onClose:()=>void;onReturnFocus:()=>void}){
  const s=useStudio(),[items,setItems]=useState<LibraryItem[]>([]),[saved,setSaved]=useState<LibraryItem[]>([]);
  const [sort,setSort]=useState('titleAsc'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const list=useRef<HTMLOListElement>(null),dragRef=useRef<Drag|null>(null);
  const [drag,setDrag]=useState<Drag|null>(null),[notice,setNotice]=useState('');
  const disabled=readonly||busy||loading||!!s.conflict;
  const locked=disabled||!!drag;
  useEffect(()=>{let active=true;void s.libraryPublications().then(data=>{if(active){setItems(data);setSaved(data);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'서재를 불러오지 못했습니다.');}).finally(()=>{if(active)setLoading(false);});

return()=>{active=false;};},[s.namespace]);
  const changed=items.some((p,i)=>p.id!==saved[i]?.id);

  function move(index:number,direction:number){
    if(disabled||dragRef.current||!items[index+direction])return;
    const item=items[index],next=moveLibraryItem(items,item.id,items[index+direction].id,direction<0?'before':'after');
    setItems(next);setNotice(`${item.title}, ${index+direction+1}번째로 이동했습니다.`);
  }

  function detectDrop(id:string,x:number,y:number):Drop|undefined{
    const root=list.current,rect=root?.getBoundingClientRect();

    if(!root||!rect||x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return;
    const rows=[...root.querySelectorAll<HTMLElement>('[data-library-id]')],target=rows.find(row=>y<=row.getBoundingClientRect().bottom)||rows.at(-1);

    if(!target||target.dataset.libraryId===id)return;
    const position=target.getBoundingClientRect();

    return {id:target.dataset.libraryId!,edge:y<position.top+position.height/2?'before':'after'};
  }

  function pointerMove(e:PointerEvent<HTMLButtonElement>){
    const previous=dragRef.current;

    if(!previous||previous.pointerId!==e.pointerId)return;
    const active=previous.active||Math.hypot(e.clientX-previous.startX,e.clientY-previous.startY)>6;
    const next={...previous,x:e.clientX,y:e.clientY,active,drop:active?detectDrop(previous.id,e.clientX,e.clientY):undefined};
    dragRef.current=next;setDrag(next);
  }

  function finishDrag(cancel=false){
    const current=dragRef.current;dragRef.current=null;setDrag(null);

    if(cancel||disabled||!current?.active||!current.drop)return;
    const next=moveLibraryItem(items,current.id,current.drop.id,current.drop.edge),index=next.findIndex(p=>p.id===current.id);
    setItems(next);setNotice(`${next[index].title}, ${index+1}번째로 이동했습니다.`);
  }

  // Keep scrolling when the mouse or finger waits near the list's edge.
  useEffect(()=>{
    if(!drag?.active)return;
    let frame:number;

    const scroll=()=>{const current=dragRef.current,root=list.current;

      if(!current?.active||!root)return;
      const rect=root.getBoundingClientRect(),old=root.scrollTop;

      if(current.x>=rect.left&&current.x<=rect.right&&current.y>=rect.top-24&&current.y<=rect.bottom+24)
        root.scrollTop+=current.y<rect.top+28?-10:current.y>rect.bottom-28?10:0;

      if(root.scrollTop!==old){const next={...current,drop:detectDrop(current.id,current.x,current.y)};dragRef.current=next;setDrag(next);}

      frame=requestAnimationFrame(scroll);
    };

    frame=requestAnimationFrame(scroll);

    return()=>cancelAnimationFrame(frame);
  },[drag?.active]);
  useEffect(()=>{if(disabled){dragRef.current=null;setDrag(null);}},[disabled]);

  async function save(){setBusy(true);setError('');

try{const result=await s.setLibraryOrder(items.map(p=>p.id));setItems(result);setSaved(result);}catch(e){setError(e instanceof Error?e.message:'서재 순서를 저장하지 못했습니다.');}finally{setBusy(false);}}

  return <><Modal open onReturnFocus={onReturnFocus} onClose={()=>{if(dragRef.current)finishDrag(true);else if(!busy)onClose();}} title="서재 순서 편집" wide>
    <div className="library-order-controls"><label>자동 정렬 기준<select aria-label="자동 정렬 기준" value={sort} disabled={locked} onChange={e=>setSort(e.target.value)}>{Object.entries(librarySorts).filter(([key])=>key!=='author').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button type="button" className="button" disabled={locked||items.length<2} onClick={()=>{setItems(sortPublications(items,librarySort(sort)));}}>자동 정렬</button></div>
    {loading?<p className="muted" role="status">서재를 불러오는 중입니다.</p>:items.length?<ol className="library-order-list" ref={list} aria-label="서재 순서">{items.map((p,i)=><li className={`reference-card library-order-row${drag?.active&&drag.id===p.id?' is-dragging':''}`} data-library-id={p.id} data-drop-edge={drag?.active&&drag.drop?.id===p.id?drag.drop.edge:undefined} key={p.id}>
      <button type="button" aria-label={`${p.title} 순서 이동`} title="드래그로 순서 변경 · ↑↓로 이동" className="icon-button library-order-grip" aria-description="드래그하거나 위아래 방향키로 순서를 바꿉니다." disabled={disabled||items.length<2}
        onPointerDown={e=>{if(e.button!==0||!e.isPrimary||dragRef.current)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);const value={id:p.id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false};dragRef.current=value;setDrag(value);}}
        onPointerMove={pointerMove} onPointerUp={()=>finishDrag()} onPointerCancel={()=>finishDrag(true)} onLostPointerCapture={()=>finishDrag(true)}
        onKeyDown={e=>{if(e.key==='Escape'&&dragRef.current){finishDrag(true);e.preventDefault();e.stopPropagation();}else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(i,e.key==='ArrowUp'?-1:1);}}}><GripVertical size={16}/></button>
      <Book size={16}/><span><strong title={p.title}>{p.title}</strong><small>{new Date(p.publishedAt).toLocaleDateString('ko-KR')} 게시</small></span><div><IconButton label={`${p.title} 위로`} disabled={locked||i===0} onClick={()=>move(i,-1)}><ArrowUp size={15}/></IconButton><IconButton label={`${p.title} 아래로`} disabled={locked||i===items.length-1} onClick={()=>move(i,1)}><ArrowDown size={15}/></IconButton></div></li>)}</ol>:!error&&<p className="muted">게시된 작품이 없습니다.</p>}
    <div className="library-order-announcement" role="status">{notice}</div>
    {error&&<p className="error-message" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button" disabled={locked||!changed} onClick={()=>{setItems(saved);setNotice('저장된 순서로 되돌렸습니다.');}}>저장된 순서로</button><button type="button" className="button primary" disabled={locked||!changed} onClick={()=>void save()}>{busy?'저장 중':'서재 순서 저장'}</button></div>
  </Modal>{drag?.active&&createPortal(<div className={`${treeStyles.ghost} library-order-ghost`} style={{left:Math.max(4,Math.min(drag.x+12,window.innerWidth-190)),top:Math.max(4,Math.min(drag.y+15,window.innerHeight-90))}}>{shortTitle(items.find(p=>p.id===drag.id)?.title)}<small>{drag.drop?`${shortTitle(items.find(p=>p.id===drag.drop?.id)?.title)} ${drag.drop.edge==='before'?'앞':'뒤'}에 놓기`:'놓을 위치를 선택하세요.'}</small></div>,document.body)}</>;
}
