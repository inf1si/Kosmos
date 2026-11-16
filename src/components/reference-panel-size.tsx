'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { referenceWidthRange, referenceWidthStyle } from '@/lib/app-preferences';
import { useAppPreferences } from './use-app-preferences';
import { IconButton } from './primitives';

const step=16;

// The writing area beside the panel must stay usable, so the drag stops at 70% of the row the panel sits in.
const maxWidth=(panel:HTMLElement|null)=>Math.max(referenceWidthRange.min,Math.min(referenceWidthRange.max,Math.floor((panel?.parentElement?.getBoundingClientRect().width??window.innerWidth)*.7)));

const clamp=(n:number,panel:HTMLElement|null)=>Math.round(Math.max(referenceWidthRange.min,Math.min(maxWidth(panel),n)));

/**
 * Size of the studio/notes reference panel: the saved width for its `style`, and whether it is shown large in place of the editor.
 * Large view ends when the panel closes, so the editor always comes back with the next opening.
 */
export function useReferencePanelSize(open:boolean){
  const [preferences]=useAppPreferences(),[expanded,setExpanded]=useState(false);
  useEffect(()=>{if(!open)setExpanded(false);},[open]);

  // SAFETY: React forwards CSS custom properties whose values here are strings.
  return {expanded,toggle:()=>setExpanded(v=>!v),style:referenceWidthStyle(preferences) as CSSProperties};
}

/** 크게 보기 toggle in the reference panel's tab row. */
export function ReferenceExpandButton({expanded,onToggle}:{expanded:boolean;onToggle:()=>void}){
  return <IconButton label={expanded?'원래 크기로':'크게 보기'} aria-pressed={expanded} className="icon-button reference-expand" onClick={onToggle}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</IconButton>;
}

/** Drag handle on the panel's left edge. The width is saved when the pointer is released; double-click restores the default. */
export function ReferenceResizer({target}:{target:RefObject<HTMLElement|null>}){
  const [{referenceWidth},update]=useAppPreferences();
  // Where the press started; width stays null until the pointer moves, so a plain click saves nothing.
  const dragging=useRef<{x:number;from:number;width:number|null}|null>(null);
  const current=()=>Math.round(target.current?.getBoundingClientRect().width??referenceWidth??360);

  // While dragging only the CSS variable moves; one write on release keeps other tabs from re-rendering on every pixel.
  const preview=(raw:number)=>{const width=clamp(raw,target.current);

target.current?.style.setProperty('--reference-width',`${width}px`);dragging.current={...dragging.current!,width};};

  return <div className="reference-resizer" role="separator" aria-label="참고 패널 폭" aria-orientation="vertical" aria-valuenow={referenceWidth??current()} aria-valuemin={referenceWidthRange.min} aria-valuemax={referenceWidthRange.max} tabIndex={0}
    onPointerDown={e=>{if(e.button)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);dragging.current={x:e.clientX,from:current(),width:null};}}
    onPointerMove={e=>{if(dragging.current)preview(dragging.current.from-(e.clientX-dragging.current.x));}}
    onLostPointerCapture={()=>{const drag=dragging.current;dragging.current=null;

if(drag?.width!=null&&drag.width!==referenceWidth)update({referenceWidth:drag.width});}}
    onDoubleClick={()=>{target.current?.style.removeProperty('--reference-width');update({referenceWidth:null});}}
    onKeyDown={e=>{const next=e.key==='ArrowLeft'?current()+step:e.key==='ArrowRight'?current()-step:e.key==='Home'?referenceWidthRange.min:e.key==='End'?maxWidth(target.current):null;

if(next===null)return;e.preventDefault();update({referenceWidth:clamp(next,target.current)});}}/>;
}
