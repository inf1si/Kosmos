'use client';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { CassetteTape, Cpu, Moon, Sun } from 'lucide-react';
import { PALETTE_KEY, THEME_KEY, preferredPalette, preferredTheme, type SitePalette, type SiteTheme } from '@/lib/theme';

/** Names and buttons of the colour families, in picker order. */
export const paletteOptions:{id:SitePalette;name:string}[]=[{id:'violet',name:'보라'},{id:'cassette',name:'카세트'},{id:'cyber',name:'사이버'}];

function attribute(name:string){return document.documentElement.getAttribute(name);}
function subscribe(onChange:()=>void){const observer=new MutationObserver(onChange);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-palette']});return()=>observer.disconnect();}
function stored(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function save(key:string,value:string){try{localStorage.setItem(key,value);}catch{}}
// React's development remount clears attributes the head script set; put them back before paint. No-op in production.
function useRestoredAttributes(){useLayoutEffect(()=>{const root=document.documentElement;if(!root.hasAttribute('data-theme'))root.setAttribute('data-theme',preferredTheme(stored(THEME_KEY),matchMedia('(prefers-color-scheme: dark)').matches));if(!root.hasAttribute('data-palette'))root.setAttribute('data-palette',preferredPalette(stored(PALETTE_KEY)));},[]);}

/** The public site's light/dark mode, kept on <html data-theme> by the head script in the root layout. */
export function useSiteTheme():[SiteTheme,(theme:SiteTheme)=>void]{
  const theme=useSyncExternalStore(subscribe,()=>attribute('data-theme')==='dark'?'dark':'light',():SiteTheme=>'light');
  useRestoredAttributes();
  return [theme,next=>{document.documentElement.setAttribute('data-theme',next);save(THEME_KEY,next);}];
}
/** The public site's colour family, kept on <html data-palette>. */
export function useSitePalette():[SitePalette,(palette:SitePalette)=>void]{
  const palette=useSyncExternalStore(subscribe,()=>preferredPalette(attribute('data-palette')),():SitePalette=>'violet');
  useRestoredAttributes();
  return [palette,next=>{document.documentElement.setAttribute('data-palette',next);save(PALETTE_KEY,next);}];
}

export function ThemeControls(){
  const [theme,setTheme]=useSiteTheme();const [palette,setPalette]=useSitePalette();
  const label=theme==='dark'?'라이트 모드로 전환':'다크 모드로 전환';
  return <div className="theme-controls"><div className="palette-picker" role="group" aria-label="테마">
    {paletteOptions.map(({id,name})=><button type="button" key={id} aria-pressed={palette===id} aria-label={`${name} 테마`} title={`${name} 테마`} onClick={()=>setPalette(id)}>{id==='violet'?<span className="palette-swatch" aria-hidden="true"/>:id==='cassette'?<CassetteTape size={15}/>:<Cpu size={15}/>}</button>)}
  </div><button type="button" className="theme-toggle" aria-label={label} title={label} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button></div>;
}
