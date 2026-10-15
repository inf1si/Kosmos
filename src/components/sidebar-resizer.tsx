'use client';

import { useRef, type CSSProperties, type RefObject } from 'react';
import { sidebarWidthRange, sidebarWidthStyle } from '@/lib/app-preferences';
import { useAppPreferences } from './use-app-preferences';

const step=16;

// The panel must stay usable on a narrow desktop window, so the drag stops at 40% of the window (the same cap as the CSS).
const maxWidth=()=>Math.max(sidebarWidthRange.min,Math.min(sidebarWidthRange.max,Math.floor(window.innerWidth*.4)));

const clamp=(n:number)=>Math.round(Math.max(sidebarWidthRange.min,Math.min(maxWidth(),n)));

/** Saved width for the sidebar's `style`; empty until the edge has been dragged. */
export function useSidebarStyle(){
  const [preferences]=useAppPreferences();

  // SAFETY: React forwards CSS custom properties whose values here are strings.
  return sidebarWidthStyle(preferences) as CSSProperties;
}

/** Drag handle in the gap right of the studio/notes sidebar. The width is saved when the pointer is released; double-click restores the default. */
export function SidebarResizer({target}:{target:RefObject<HTMLElement|null>}){
  const [{sidebarWidth},update]=useAppPreferences();
  // Where the press started; width stays null until the pointer moves, so a plain click saves nothing.
  const dragging=useRef<{x:number;from:number;width:number|null}|null>(null);
  const current=()=>Math.round(target.current?.getBoundingClientRect().width??sidebarWidth??264);

  // While dragging only the CSS variable moves; one write on release keeps other tabs from re-rendering on every pixel.
  const preview=(width:number)=>{target.current?.style.setProperty('--sidebar-width',`${width}px`);dragging.current!.width=width;};

  return <div className="sidebar-resizer" role="separator" aria-label="사이드바 폭" aria-orientation="vertical" aria-valuenow={sidebarWidth??264} aria-valuemin={sidebarWidthRange.min} aria-valuemax={sidebarWidthRange.max} tabIndex={0}
    onPointerDown={e=>{if(e.button)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);dragging.current={x:e.clientX,from:current(),width:null};}}
    onPointerMove={e=>{if(dragging.current)preview(clamp(dragging.current.from+e.clientX-dragging.current.x));}}
    onLostPointerCapture={()=>{const width=dragging.current?.width;dragging.current=null;

if(width!=null&&width!==sidebarWidth)update({sidebarWidth:width});}}
    onDoubleClick={()=>{target.current?.style.removeProperty('--sidebar-width');update({sidebarWidth:null});}}
    onKeyDown={e=>{const next=e.key==='ArrowLeft'?current()-step:e.key==='ArrowRight'?current()+step:e.key==='Home'?sidebarWidthRange.min:e.key==='End'?maxWidth():null;

if(next===null)return;e.preventDefault();update({sidebarWidth:clamp(next)});}}/>;
}
