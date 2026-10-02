export type SiteTheme='light'|'dark';
export type SitePalette='violet'|'cassette';
export const THEME_KEY='orbis-theme';
export const PALETTE_KEY='orbis-palette';

/** The reader's saved choice, else the device setting. */
export function preferredTheme(stored:string|null,systemDark:boolean):SiteTheme{return stored==='light'||stored==='dark'?stored:systemDark?'dark':'light';}
/** The reader's saved colour family, else violet. */
export function preferredPalette(stored:string|null):SitePalette{return stored==='cassette'?'cassette':'violet';}

/** Runs in <head> before the first paint so a page never flashes the other theme. Same rules as preferredTheme and preferredPalette. */
export const themeScript=`(function(){try{var r=document.documentElement;var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});r.setAttribute("data-theme",s==="light"||s==="dark"?s:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));r.setAttribute("data-palette",localStorage.getItem(${JSON.stringify(PALETTE_KEY)})==="cassette"?"cassette":"violet")}catch(e){}})()`;
