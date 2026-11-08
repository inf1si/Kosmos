'use client';

import { useEffect, useRef } from 'react';

/** Closes a popover on a click outside it or Escape, returning focus to its toggle. */
export function useDismiss(open:boolean,setOpen:(open:boolean)=>void){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const down=(e:PointerEvent)=>{if(!ref.current?.contains(e.target instanceof Node?e.target:null))setOpen(false);};

const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);ref.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus();}};

document.addEventListener('pointerdown',down);document.addEventListener('keydown',key);

return()=>{document.removeEventListener('pointerdown',down);document.removeEventListener('keydown',key);};},[open,setOpen]);

  return ref;
}
