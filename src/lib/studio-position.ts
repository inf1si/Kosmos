import { z } from 'zod';
import type { NovelDocument, Workspace } from './model';

/** Where the writer last worked on this device: the last work and, per work, the last open document. IDs only, never text. */
export const STUDIO_POSITION_KEY='kosmos-studio-position';

export type StudioPosition={workId:string;docs:Record<string,string>};

const empty:StudioPosition={workId:'',docs:{}};

const positionSchema=z.object({workId:z.string().max(100).catch(''),docs:z.record(z.string().max(100),z.string().max(100)).catch({})}).catch(empty);

export function parseStudioPosition(raw:string|null):StudioPosition{
  try{return positionSchema.parse(JSON.parse(raw||'null'));}catch{return {...empty,docs:{}};}
}

export function readStudioPosition():StudioPosition{
  try{return parseStudioPosition(localStorage.getItem(STUDIO_POSITION_KEY));}catch{return parseStudioPosition(null);}
}

export function rememberStudioPosition(workId:string,docId:string){
  const current=readStudioPosition();

if(current.workId===workId&&current.docs[workId]===docId)return;

  try{localStorage.setItem(STUDIO_POSITION_KEY,JSON.stringify({workId,docs:{...current.docs,[workId]:docId}}));}catch{/* Only the next visit loses its place. */}
}

/** Open tabs per work on this device, in their tab-bar order. IDs only; recent 50 works, 30 tabs each. */
export const STUDIO_TABS_KEY='kosmos-studio-tabs';

const tabsSchema=z.record(z.string().max(100),z.array(z.string().max(100)).max(30));

function studioTabs():Record<string,string[]>{
  try{const parsed=tabsSchema.safeParse(JSON.parse(localStorage.getItem(STUDIO_TABS_KEY)||'{}'));

return parsed.success?parsed.data:{};}catch{return {};}
}

export function readStudioTabs(workId:string):string[]{return studioTabs()[workId]??[];}

export function rememberStudioTabs(workId:string,ids:string[]){
  const all=studioTabs(),next=ids.slice(0,30);

  if(JSON.stringify(all[workId])===JSON.stringify(next))return;
  delete all[workId];

  try{localStorage.setItem(STUDIO_TABS_KEY,JSON.stringify(Object.fromEntries([...Object.entries(all).slice(-49),[workId,next]])));}catch{/* Only the next visit loses its tabs. */}
}

/** The document a work opens on: the requested one, the remembered one, its first scene, or its first document. */
export function openingDocument(docs:NovelDocument[],...preferred:string[]):NovelDocument{
  for(const id of preferred){const found=id&&docs.find(d=>d.id===id);

if(found)return found;}

  return docs.find(d=>d.kind==='scene')||docs[0];
}

/** Recently edited documents across every work, newest first. */
export function recentDocuments(state:Workspace,limit=8){
  return state.works.flatMap(work=>work.documents.map(doc=>({work,doc}))).sort((a,b)=>b.doc.updatedAt.localeCompare(a.doc.updatedAt)).slice(0,limit);
}

/** The newest document edit in a work; works have no timestamp of their own. */
export function workUpdatedAt(work:{documents:NovelDocument[]}){
  return work.documents.reduce((latest,d)=>d.updatedAt>latest?d.updatedAt:latest,'');
}
