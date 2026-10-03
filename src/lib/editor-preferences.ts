export const manuscriptFonts=[
  {id:'gowun',label:'고운바탕',family:'var(--font-gowun), serif'},
  {id:'noto-serif',label:'본명조',family:'var(--font-noto-serif), serif'},
  {id:'nanum-myeongjo',label:'나눔명조',family:'var(--font-nanum-myeongjo), serif'},
  {id:'ibm-plex',label:'IBM Plex 고딕',family:'var(--font-plex), sans-serif'},
  {id:'noto-sans',label:'본고딕',family:'var(--font-noto-sans), sans-serif'},
  {id:'nanum-gothic',label:'나눔고딕',family:'var(--font-nanum-gothic), sans-serif'},
  {id:'system',label:'시스템 글꼴',family:'system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'},
] as const;
export type EditorPreferences={font:string;size:number};
export const defaultEditorPreferences:EditorPreferences={font:'gowun',size:18};
export function parseEditorPreferences(raw:string|null):EditorPreferences{
  try{const value=JSON.parse(raw||'null');return {font:manuscriptFonts.some(f=>f.id===value?.font)?value.font:'gowun',size:[16,18,20,22,24].includes(value?.size)?value.size:18};}catch{return defaultEditorPreferences;}
}
