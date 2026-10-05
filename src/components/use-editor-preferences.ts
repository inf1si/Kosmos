'use client';
import { useSyncExternalStore } from 'react';
import { editorCountMetricVersion,parseEditorPreferences, type EditorPreferences } from '@/lib/editor-preferences';
const key='orbis-editor-preferences';const event='orbis-editor-preferences-change';let fallback:string|null=null;
function subscribe(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener(event,callback);return()=>{window.removeEventListener('storage',callback);window.removeEventListener(event,callback);};}
function snapshot(){try{return localStorage.getItem(key)||fallback;}catch{return fallback;}}
export function useEditorPreferences(){
  const raw=useSyncExternalStore(subscribe,snapshot,()=>null);
  function update(patch:Partial<EditorPreferences>){fallback=JSON.stringify({...parseEditorPreferences(snapshot()),...patch,countMetricVersion:editorCountMetricVersion});try{localStorage.setItem(key,fallback);}catch{/* Display choices still work when storage is unavailable. */}window.dispatchEvent(new Event(event));}
  return [parseEditorPreferences(raw),update] as const;
}
