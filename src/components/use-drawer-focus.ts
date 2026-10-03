'use client';
import { useEffect, type RefObject } from 'react';
/** Keyboard containment for an overlay only; inline desktop panels retain ordinary focus order. */
export function useDrawerFocus(open:boolean,container:RefObject<HTMLElement|null>,onClose:()=>void,triggerId:string){
  useEffect(()=>{
    const box=container.current;if(!open||!box)return;
    const previous=document.activeElement as HTMLElement|null;
    const controls=()=>[...box.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length>0);
    (box.querySelector<HTMLElement>('[data-drawer-close]')||controls()[0])?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.defaultPrevented||!box.contains(document.activeElement))return;
      if(e.key==='Escape'){e.preventDefault();onClose();}
      if(e.key==='Tab'){const items=controls();const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    };
    window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('keydown',key);const target=document.getElementById(triggerId)||previous;if(target?.isConnected)target.focus();};
  },[open,container,triggerId,onClose]);
}
