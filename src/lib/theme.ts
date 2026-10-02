export type SiteTheme='light'|'dark';
export type SitePalette='violet'|'cassette'|'cyber';
/** Every colour family, the default first. */
export const PALETTES:readonly SitePalette[]=['violet','cassette','cyber'];
export const THEME_KEY='orbis-theme';
export const PALETTE_KEY='orbis-palette';

/** The reader's saved choice, else the device setting. */
export function preferredTheme(stored:string|null,systemDark:boolean):SiteTheme{return stored==='light'||stored==='dark'?stored:systemDark?'dark':'light';}
/** The reader's saved colour family, else violet. */
export function preferredPalette(stored:string|null):SitePalette{return PALETTES.find(p=>p===stored)??'violet';}

/** Runs in <head> before the first paint so a page never flashes the other theme. Same rules as preferredTheme and preferredPalette. */
export const themeScript=`(function(){try{var r=document.documentElement;var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});r.setAttribute("data-theme",s==="light"||s==="dark"?s:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});r.setAttribute("data-palette",${JSON.stringify(PALETTES.slice(1))}.indexOf(p)>=0?p:"violet")}catch(e){}})()`;
