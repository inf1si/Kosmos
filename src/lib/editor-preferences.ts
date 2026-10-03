import { countMetrics, type CountMetric } from './text-statistics';
export const manuscriptFonts=[
  {id:'gowun',label:'고운바탕',family:'var(--font-gowun), serif'},
  {id:'noto-serif',label:'본명조',family:'var(--font-noto-serif), serif'},
  {id:'nanum-myeongjo',label:'나눔명조',family:'var(--font-nanum-myeongjo), serif'},
  {id:'ibm-plex',label:'IBM Plex 고딕',family:'var(--font-plex), sans-serif'},
  {id:'noto-sans',label:'본고딕',family:'var(--font-noto-sans), sans-serif'},
  {id:'nanum-gothic',label:'나눔고딕',family:'var(--font-nanum-gothic), sans-serif'},
  {id:'hahmlet',label:'함렛',family:'var(--font-hahmlet), serif'},
  {id:'gowun-dodum',label:'고운돋움',family:'var(--font-gowun-dodum), sans-serif'},
  {id:'gothic-a1',label:'고딕 A1',family:'var(--font-gothic-a1), sans-serif'},
  {id:'nanum-coding',label:'나눔고딕코딩',family:'var(--font-nanum-coding), monospace'},
  {id:'nanum-pen',label:'나눔손글씨 펜',family:'var(--font-nanum-pen), cursive'},
  {id:'nanum-brush',label:'나눔손글씨 붓',family:'var(--font-nanum-brush), cursive'},
  {id:'batang',label:'바탕 · 기기 글꼴',family:'Batang, "바탕", var(--font-gowun), serif'},
  {id:'malgun',label:'맑은 고딕 · 기기 글꼴',family:'"Malgun Gothic", "Apple SD Gothic Neo", sans-serif'},
  {id:'gulim',label:'굴림 · 기기 글꼴',family:'Gulim, "굴림", var(--font-noto-sans), sans-serif'},
  {id:'system',label:'시스템 글꼴',family:'system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'},
] as const;
export type EditorPreferences={font:string;size:number;countMetric:CountMetric};
export const defaultEditorPreferences:EditorPreferences={font:'gowun',size:18,countMetric:'charactersWithoutSpaces'};
export const fontSizes=[10,12,14,16,18,20,22,24,28,32,36,40,48,56,64,72];
export function validFontSize(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=10&&value<=72&&Number.isInteger(value*2);}
export function parseEditorPreferences(raw:string|null):EditorPreferences{
  try{const value=JSON.parse(raw||'null');return {font:manuscriptFonts.some(f=>f.id===value?.font)?value.font:'gowun',size:validFontSize(value?.size)?value.size:18,countMetric:countMetrics.some(m=>m.id===value?.countMetric)?value.countMetric:'charactersWithoutSpaces'};}catch{return defaultEditorPreferences;}
}
