'use client';
import { useSyncExternalStore } from 'react';
import { APP_PREFERENCES_KEY, defaultAppPreferences, parseAppPreferences, type AppPreferences } from '@/lib/app-preferences';
const event='kosmos-app-preferences-change';let fallback:string|null=null;
function subscribe(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener(event,callback);return()=>{window.removeEventListener('storage',callback);window.removeEventListener(event,callback);};}
function snapshot(){try{return localStorage.getItem(APP_PREFERENCES_KEY)??fallback;}catch{return fallback;}}
function write(raw:string|null){fallback=raw;try{if(raw===null)localStorage.removeItem(APP_PREFERENCES_KEY);else localStorage.setItem(APP_PREFERENCES_KEY,raw);}catch{/* The choice still applies until reload. */}window.dispatchEvent(new Event(event));}
/** Device preferences from the settings dialog; every surface re-renders when one changes. */
export function useAppPreferences(){
  const raw=useSyncExternalStore(subscribe,snapshot,()=>null);
  const update=(patch:Partial<AppPreferences>)=>write(JSON.stringify({...parseAppPreferences(snapshot()),...patch}));
  const reset=(keys:(keyof AppPreferences)[])=>update(Object.fromEntries(keys.map(k=>[k,defaultAppPreferences[k]])));
  return [parseAppPreferences(raw),update,reset] as const;
}

const choiceEvent='kosmos-stored-choice-change';
function subscribeChoice(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener(choiceEvent,callback);return()=>{window.removeEventListener('storage',callback);window.removeEventListener(choiceEvent,callback);};}
/** A single remembered choice under its own key (kept for values saved before the settings dialog existed). */
export function useStoredChoice<T extends string>(key:string,allowed:readonly T[],fallbackValue:T){
  const raw=useSyncExternalStore(subscribeChoice,()=>{try{return localStorage.getItem(key);}catch{return null;}},()=>null);
  const value=allowed.find(v=>v===raw)??fallbackValue;
  const set=(next:T)=>{try{localStorage.setItem(key,next);}catch{/* In-memory only. */}window.dispatchEvent(new Event(choiceEvent));};
  return [value,set] as const;
}
