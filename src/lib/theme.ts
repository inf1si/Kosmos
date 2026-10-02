export type SiteTheme='light'|'dark';
export const THEME_KEY='orbis-theme';

/** The reader's saved choice, else the device setting. */
export function preferredTheme(stored:string|null,systemDark:boolean):SiteTheme{return stored==='light'||stored==='dark'?stored:systemDark?'dark':'light';}

/** Runs in <head> before the first paint so a page never flashes the other theme. Same rule as preferredTheme. */
export const themeScript=`(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});var t=s==="light"||s==="dark"?s:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
