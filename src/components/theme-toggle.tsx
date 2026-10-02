'use client';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEME_KEY, preferredTheme, type SiteTheme } from '@/lib/theme';

function current():SiteTheme{return document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';}
function subscribe(onChange:()=>void){const observer=new MutationObserver(onChange);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();}
function stored(){try{return localStorage.getItem(THEME_KEY);}catch{return null;}}

/** The public site's light/dark theme, kept on <html data-theme> by the head script in the root layout. */
export function useSiteTheme():[SiteTheme,(theme:SiteTheme)=>void]{
  const theme=useSyncExternalStore(subscribe,current,():SiteTheme=>'light');
  // React's development remount clears attributes the head script set; put it back before paint. No-op in production.
  useLayoutEffect(()=>{const root=document.documentElement;if(!root.hasAttribute('data-theme'))root.setAttribute('data-theme',preferredTheme(stored(),matchMedia('(prefers-color-scheme: dark)').matches));},[]);
  function setTheme(next:SiteTheme){document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem(THEME_KEY,next);}catch{}}
  return [theme,setTheme];
}

export function ThemeToggle(){
  const [theme,setTheme]=useSiteTheme();
  const label=theme==='dark'?'라이트 모드로 전환':'다크 모드로 전환';
  return <button type="button" className="theme-toggle" aria-label={label} title={label} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>;
}
