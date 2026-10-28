'use client';

import {useEffect,useRef,useState,type ReactNode,type PointerEvent} from 'react';
import {X,ArrowLeft,ArrowRight,Columns2} from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';

type Tab={id:string;title:string;icon:ReactNode;canSplit?:boolean};

type Drop={id:string;edge:'before'|'after'};

type Drag={id:string;pointerId:number;touch:boolean;startX:number;x:number;y:number;active:boolean;drop?:Drop};

/** Tab order is local view state; moving a tab never opens or edits its document. */
export function EditorTabs({items,activeId,onSelect,onClose,onCloseMany,onSplit,onReorder}:{items:Tab[];activeId:string;onSelect:(id:string)=>void;onClose:(id:string)=>void;onCloseMany:(ids:string[],preferred:string)=>void;onSplit:(id:string)=>void;onReorder:(ids:string[])=>void}){
  const root=useRef<HTMLDivElement>(null),pending=useRef<Drag|null>(null),blockClick=useRef(false);
  const [drag,setDrag]=useState<Drag|null>(null),[notice,setNotice]=useState('');

  function destination(x:number,y:number,id:string):Drop|undefined{
    const list=root.current,rect=list?.getBoundingClientRect();

    if(!list||!rect||x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return;
    const rows=[...list.querySelectorAll<HTMLElement>('[data-tab-id]')],target=rows.find(row=>x<=row.getBoundingClientRect().right)||rows.at(-1);

    if(!target||target.dataset.tabId===id)return;
    const bounds=target.getBoundingClientRect();

    return {id:target.dataset.tabId!,edge:x<bounds.left+bounds.width/2?'before':'after'};
  }

  function focusTab(id:string){requestAnimationFrame(()=>{if(pending.current)return;const row=[...root.current?.querySelectorAll<HTMLElement>('[data-tab-id]')||[]].find(row=>row.dataset.tabId===id),button=row?.querySelector<HTMLButtonElement>('[role=tab]')||root.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]');button?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest',inline:'nearest'});});}

  function place(id:string,drop:Drop){
    const ids=items.map(item=>item.id);

    if(id===drop.id||!ids.includes(id)||!ids.includes(drop.id))return;
    const next=ids.filter(value=>value!==id);next.splice(next.indexOf(drop.id)+(drop.edge==='after'?1:0),0,id);

    if(next.every((value,index)=>value===ids[index]))return;
    onReorder(next);setNotice(`${items.find(item=>item.id===id)!.title} 탭, ${items.length}개 중 ${next.indexOf(id)+1}번째`);
    focusTab(id);
  }

  function finish(cancel=false){
    const current=pending.current;pending.current=null;setDrag(null);

    if(!current?.active)return;
    blockClick.current=true;

    if(!cancel&&current.drop)place(current.id,current.drop);
  }

  function move(event:PointerEvent<HTMLButtonElement>){
    const current=pending.current;

    if(!current||current.pointerId!==event.pointerId||current.touch)return;
    const active=current.active||Math.abs(event.clientX-current.startX)>6;

    if(active)event.preventDefault();
    const next={...current,x:event.clientX,y:event.clientY,active,drop:active?destination(event.clientX,event.clientY,current.id):undefined};pending.current=next;setDrag(next);
  }

  useEffect(()=>{
    const cancel=()=>{if(pending.current?.active)blockClick.current=true;pending.current=null;setDrag(null);};

    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&pending.current){event.preventDefault();event.stopPropagation();cancel();}};

    window.addEventListener('keydown',escape,true);window.addEventListener('blur',cancel);

    return()=>{pending.current=null;window.removeEventListener('keydown',escape,true);window.removeEventListener('blur',cancel);};
  },[]);
  useEffect(()=>{
    if(!drag?.active)return;
    let frame:number;

    const scroll=()=>{
      const current=pending.current,list=root.current;

      if(!current?.active||!list)return;
      const rect=list.getBoundingClientRect(),before=list.scrollLeft;

      if(current.y>=rect.top&&current.y<=rect.bottom&&current.x>=rect.left&&current.x<=rect.right)list.scrollLeft+=current.x<rect.left+24?-8:current.x>rect.right-24?8:0;

      if(list.scrollLeft!==before){const next={...current,drop:destination(current.x,current.y,current.id)};pending.current=next;setDrag(next);}

      frame=requestAnimationFrame(scroll);
    };

    frame=requestAnimationFrame(scroll);

    return()=>cancelAnimationFrame(frame);
  },[drag?.active]);

  return <><div ref={root} className={`tab-list ${drag?.active?'is-reordering':''}`} role="tablist" aria-label="열린 문서" data-editor-tabs="" onPointerDownCapture={()=>{blockClick.current=false;}} onMouseDownCapture={event=>{if(blockClick.current&&event.button===0)event.preventDefault();}} onClickCapture={event=>{if(blockClick.current&&event.detail>0){event.preventDefault();event.stopPropagation();blockClick.current=false;}}}>
    {items.map((item,index)=><ContextMenu.Root key={item.id} modal={false} onOpenChange={open=>{if(open){finish(true);blockClick.current=true;}}}><ContextMenu.Trigger asChild><div className={`doc-tab ${item.id===activeId?'active':''}`} data-tab-id={item.id} data-tab-dragging={drag?.active&&drag.id===item.id||undefined} data-drop-edge={drag?.active&&drag.drop?.id===item.id?drag.drop.edge:undefined} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onAuxClick={event=>{if(event.button!==1||items.length<2)return;event.preventDefault();onClose(item.id);}}>
      {item.icon}<button type="button" role="tab" aria-selected={item.id===activeId} aria-description="드래그 또는 Alt와 좌우 방향키로 탭 순서 변경, Shift+F10으로 탭 메뉴" title={item.title} onClick={()=>onSelect(item.id)}
        onPointerDown={event=>{if(event.button!==0||!event.isPrimary||pending.current)return;

if(event.pointerType!=='touch')event.currentTarget.setPointerCapture(event.pointerId);const next={id:item.id,pointerId:event.pointerId,touch:event.pointerType==='touch',startX:event.clientX,x:event.clientX,y:event.clientY,active:false};pending.current=next;}}
        onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)}
        onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const bounds=event.currentTarget.getBoundingClientRect();event.currentTarget.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:bounds.left+bounds.width/2,clientY:bounds.bottom}));

return;}

if(!event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const direction=event.key==='ArrowLeft'?-1:1,target=items[items.findIndex(tab=>tab.id===item.id)+direction];

if(target)place(item.id,{id:target.id,edge:direction<0?'before':'after'});}}>{item.title}</button>
      {items.length>1&&<button type="button" className="tab-close" aria-label={`${item.title} 탭 닫기`} onClick={()=>onClose(item.id)}><X size={12}/></button>}
    </div></ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="menu" collisionPadding={12} aria-label={`${item.title} 탭 메뉴`} onCloseAutoFocus={event=>{event.preventDefault();const focused=document.activeElement;

if(focused&&focused!==document.body&&event.target instanceof Node&&!event.target.contains(focused))return;focusTab(item.id);}}>
      {item.canSplit!==undefined&&<ContextMenu.Item className="menu-item" disabled={!item.canSplit} onSelect={()=>onSplit(item.id)}><Columns2 size={15}/>옆에 열기</ContextMenu.Item>}
      <ContextMenu.Item className="menu-item" disabled={index===0} onSelect={()=>place(item.id,{id:items[index-1].id,edge:'before'})}><ArrowLeft size={15}/>왼쪽으로 이동</ContextMenu.Item>
      <ContextMenu.Item className="menu-item" disabled={index===items.length-1} onSelect={()=>place(item.id,{id:items[index+1].id,edge:'after'})}><ArrowRight size={15}/>오른쪽으로 이동</ContextMenu.Item>
      <ContextMenu.Separator className="menu-separator"/>
      <ContextMenu.Item className="menu-item" disabled={items.length===1} onSelect={()=>onClose(item.id)}><X size={15}/>탭 닫기</ContextMenu.Item>
      <ContextMenu.Item className="menu-item" disabled={items.length===1} onSelect={()=>onCloseMany(items.flatMap(tab=>tab.id!==item.id?[tab.id]:[]),item.id)}><X size={15}/>다른 탭 닫기</ContextMenu.Item>
      <ContextMenu.Item className="menu-item" disabled={index===items.length-1} onSelect={()=>onCloseMany(items.slice(index+1).map(tab=>tab.id),item.id)}><X size={15}/>오른쪽 탭 닫기</ContextMenu.Item>
    </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>)}
  </div><span className="library-order-announcement" role="status">{notice}</span></>;
}
