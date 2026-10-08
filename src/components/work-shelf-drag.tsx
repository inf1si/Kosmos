'use client';

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical } from 'lucide-react';
import type { Workspace } from '@/lib/model';
import { placeWorkOnShelf, reorderWorkShelf, shelfForWork, workShelves, workShelfTitle } from '@/lib/work-shelves';
import treeStyles from './document-tree.module.css';

type Kind='shelf'|'work';

type Drop={shelfId:string;id?:string;edge:'before'|'after'|'inside'};

type Drag={kind:Kind;id:string;pointerId:number;startX:number;startY:number;x:number;y:number;active:boolean;drop?:Drop};

const short=(title:string)=>title.length>24?`${title.slice(0,24)}…`:title;

function detectDrop(root:HTMLElement|null,drag:Drag,x:number,y:number):Drop|undefined{
  const element=document.elementFromPoint(x,y),scroller=root?.querySelector('.notes-home-body');
  let shelf=element?.closest<HTMLElement>('[data-work-shelf]');

  // The insertion line sits in the gap, which belongs to the scrolling body.
  if(!shelf&&root){const rows=[...root.querySelectorAll<HTMLElement>('[data-work-shelf]')],first=rows[0]?.getBoundingClientRect(),last=rows.at(-1)?.getBoundingClientRect();

    if(first&&last&&x>=first.left&&x<=first.right&&y>=first.top&&y<=last.bottom)shelf=rows.find(row=>y<=row.getBoundingClientRect().bottom);
  }

  if(!shelf||!root?.contains(shelf)||!scroller)return;
  const bounds=scroller.getBoundingClientRect();

  if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)return;
  const shelfId=shelf.dataset.workShelf!;

  if(drag.kind==='shelf'){
    if(shelfId===drag.id)return;
    const rect=shelf.getBoundingClientRect();

    return {shelfId,edge:y<rect.top+rect.height/2?'before':'after'};
  }

  const grid=element?.closest('.notes-home-grid'),cards=[...shelf.querySelectorAll<HTMLElement>('[data-work-id]')];

  if(!grid||!cards.length)return {shelfId,edge:'inside'};

  const target=cards.reduce((nearest,card)=>{
    const distance=(item:HTMLElement)=>{const rect=item.getBoundingClientRect();

return Math.hypot(Math.max(rect.left-x,0,x-rect.right),Math.max(rect.top-y,0,y-rect.bottom));};

    return distance(card)<distance(nearest)?card:nearest;
  });

  if(target.dataset.workId===drag.id)return;
  const rect=target.getBoundingClientRect(),columns=cards.some(card=>card!==target&&Math.abs(card.getBoundingClientRect().top-rect.top)<4);

  return {shelfId,id:target.dataset.workId,edge:columns?(x<rect.left+rect.width/2?'before':'after'):(y<rect.top+rect.height/2?'before':'after')};
}

/** Commit only on release; cancelled gestures never enter workspace autosave. */
export function useWorkShelfDrag({root,state,disabled,apply,expand}:{root:RefObject<HTMLDivElement|null>;state:Workspace;disabled:boolean;apply:(fn:(latest:Workspace)=>Workspace)=>boolean;expand:(id:string)=>void}){
  const dragRef=useRef<Drag|null>(null),[drag,setDrag]=useState<Drag|null>(null),[notice,setNotice]=useState('');
  const shelves=workShelves(state);

  function focus(kind:Kind,id:string){requestAnimationFrame(()=>{const handle=root.current?.querySelector<HTMLButtonElement>(`[data-${kind==='shelf'?'work-shelf':'work-id'}="${id}"] .work-${kind}-grip`);handle?.focus({preventScroll:true});handle?.scrollIntoView({block:'nearest'});});}

  function commit(kind:Kind,id:string,drop:Drop){
    const success=apply(latest=>kind==='shelf'?reorderWorkShelf(latest,id,drop.shelfId,drop.edge==='before'?'before':'after'):placeWorkOnShelf(latest,id,drop.shelfId,drop.id?{id:drop.id,edge:drop.edge==='before'?'before':'after'}:undefined));

    if(!success)return;

    if(kind==='work')expand(drop.shelfId);
    focus(kind,id);setNotice(kind==='shelf'?'책장 순서를 바꿨습니다.':`작품을 ${workShelfTitle(shelves.find(s=>s.id===drop.shelfId)!)}에 옮겼습니다.`);
  }

  function finish(cancel=false){
    const current=dragRef.current;dragRef.current=null;setDrag(null);

    if(cancel||disabled||!current?.active||!current.drop)return;
    commit(current.kind,current.id,current.drop);
  }

  function pointerMove(e:PointerEvent<HTMLButtonElement>){
    const previous=dragRef.current;

    if(!previous||previous.pointerId!==e.pointerId)return;
    const active=previous.active||Math.hypot(e.clientX-previous.startX,e.clientY-previous.startY)>6;
    const next={...previous,x:e.clientX,y:e.clientY,active,drop:active?detectDrop(root.current,previous,e.clientX,e.clientY):undefined};
    dragRef.current=next;setDrag(next);
  }

  useEffect(()=>{
    const cancel=()=>{dragRef.current=null;setDrag(null);};

    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&dragRef.current){e.preventDefault();e.stopPropagation();cancel();}};

    window.addEventListener('keydown',escape,true);window.addEventListener('blur',cancel);

    return()=>{dragRef.current=null;window.removeEventListener('keydown',escape,true);window.removeEventListener('blur',cancel);};
  },[]);
  useEffect(()=>{if(disabled){dragRef.current=null;setDrag(null);}},[disabled]);
  useEffect(()=>{
    if(!drag?.active)return;
    let frame:number;

    const scroll=()=>{
      const current=dragRef.current,scroller=root.current?.querySelector<HTMLElement>('.notes-home-body');

      if(!current?.active||!scroller)return;
      const rect=scroller.getBoundingClientRect(),old=scroller.scrollTop;

      if(current.x>=rect.left&&current.x<=rect.right&&current.y>=rect.top-24&&current.y<=rect.bottom+24)scroller.scrollTop+=current.y<rect.top+28?-10:current.y>rect.bottom-28?10:0;

      if(old!==scroller.scrollTop){const next={...current,drop:detectDrop(root.current,current,current.x,current.y)};dragRef.current=next;setDrag(next);}

      frame=requestAnimationFrame(scroll);
    };

    frame=requestAnimationFrame(scroll);

    return()=>cancelAnimationFrame(frame);
  },[drag?.active,root]);

  function grip(kind:Kind,id:string,title:string){return <button type="button" className={`icon-button work-drag-grip work-${kind}-grip`} aria-label={`${title} ${kind==='shelf'?'책장':'작품'} 순서 이동`} title={kind==='shelf'?'드래그 · ↑↓로 순서 변경':'드래그 · ↑↓로 순서 변경 · Alt+↑↓로 책장 이동'} disabled={disabled} aria-description={kind==='shelf'?'드래그하거나 위아래 방향키로 책장 순서를 바꿉니다.':'드래그하거나 위아래 방향키로 작품 순서를 바꿉니다. Alt와 위아래 방향키로 다른 책장에 옮깁니다.'}
    onPointerDown={e=>{if(e.button!==0||!e.isPrimary||disabled||dragRef.current)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);const next={kind,id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false};dragRef.current=next;setDrag(next);}}
    onPointerMove={pointerMove} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)}
    onKeyDown={e=>{
      if(disabled||dragRef.current||!['ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();const direction=e.key==='ArrowUp'?-1:1,shelfId=kind==='shelf'?id:shelfForWork(state,id),index=shelves.findIndex(s=>s.id===shelfId);

      if(kind==='shelf'||e.altKey){const target=shelves[index+direction];

if(target)commit(kind,id,{shelfId:target.id,edge:kind==='work'?'inside':direction<0?'before':'after'});}
      else {const items=shelves[index].workIds.filter(workId=>state.works.some(w=>w.id===workId)),target=items[items.indexOf(id)+direction];

if(target)commit(kind,id,{shelfId,id:target,edge:direction<0?'before':'after'});}
    }}><GripVertical size={15}/></button>;}

  const drop=drag?.active?drag.drop:undefined,dragTitle=drag?.kind==='shelf'?workShelfTitle(shelves.find(s=>s.id===drag.id)||{title:''}):state.works.find(w=>w.id===drag?.id)?.title||'';
  const targetTitle=drop?.id?state.works.find(w=>w.id===drop.id)?.title||'':drop?workShelfTitle(shelves.find(s=>s.id===drop.shelfId)||{title:''}):'';
  const feedback=<><span className="library-order-announcement" role="status">{notice}</span>{drag?.active&&createPortal(<div className={`${treeStyles.ghost} work-shelf-ghost`} style={{left:Math.max(4,Math.min(drag.x+12,window.innerWidth-190)),top:Math.max(4,Math.min(drag.y+15,window.innerHeight-90))}}>{short(dragTitle)}<small>{drop?`${short(targetTitle)} ${drop.edge==='inside'?'책장에 놓기':drop.edge==='before'?'앞에 놓기':'뒤에 놓기'}`:'놓을 위치를 선택하세요.'}</small></div>,document.body)}</>;

  return {grip,feedback,shelfProps:(id:string)=>({'data-dragging':drag?.active&&drag.kind==='shelf'&&drag.id===id||undefined,'data-drop-edge':drop?.shelfId===id&&(drag?.kind==='shelf'||drop.edge==='inside')?drop.edge:undefined}),workProps:(id:string)=>({'data-dragging':drag?.active&&drag.kind==='work'&&drag.id===id||undefined,'data-drop-edge':drop?.id===id?drop.edge:undefined})};
}
