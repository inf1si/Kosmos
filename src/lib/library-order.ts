import { publicationSchema, type Publication, type Workspace } from './model';

export const libraryItemSchema=publicationSchema.pick({id:true,workId:true,title:true,publishedAt:true,libraryPosition:true});

export type LibraryItem=ReturnType<typeof libraryItemSchema.parse>;

export const librarySorts={author:'작가 지정순',titleAsc:'제목 오름차순',titleDesc:'제목 내림차순',newest:'최신 게시순',oldest:'오래된 게시순'} as const;

export type LibrarySort=keyof typeof librarySorts;

export const LIBRARY_SORT_KEY='kosmos-library-sort';

const collator=new Intl.Collator('ko',{numeric:true,sensitivity:'base'});

const date=(p:LibraryItem)=>Date.parse(p.publishedAt)||0;

export function librarySort(value:string|null):LibrarySort{return value==='author'||value==='titleAsc'||value==='titleDesc'||value==='newest'||value==='oldest'?value:'author';}

export function sortPublications<T extends LibraryItem>(items:T[],sort:LibrarySort='author'):T[]{
  const fallback=(a:LibraryItem,b:LibraryItem)=>(a.libraryPosition??Number.MAX_SAFE_INTEGER)-(b.libraryPosition??Number.MAX_SAFE_INTEGER)||date(b)-date(a)||a.workId.localeCompare(b.workId);

  return [...items].sort((a,b)=>(sort==='titleAsc'?collator.compare(a.title,b.title):sort==='titleDesc'?collator.compare(b.title,a.title):sort==='newest'?date(b)-date(a):sort==='oldest'?date(a)-date(b):0)||fallback(a,b));
}

/** Move a publication before/after another without changing its edition or saved rank. */
export function moveLibraryItem<T extends LibraryItem>(items:T[],id:string,targetId:string,edge:'before'|'after'):T[]{
  const item=items.find(p=>p.id===id);

  if(!item||id===targetId||!items.some(p=>p.id===targetId))return items;
  const next=items.filter(p=>p.id!==id),index=next.findIndex(p=>p.id===targetId)+(edge==='after'?1:0);
  next.splice(index,0,item);

  return next;
}

export function previewPublications(state:Workspace):Publication[]{return sortPublications(state.works.flatMap(w=>w.publications.filter(p=>p.id===w.activePublicationId)));}

/** Materialize legacy preview editions once, including withdrawn works' reserved positions. */
export function previewPositions(state:Workspace):Workspace{
  const active=previewPublications(state),rest=state.works.filter(w=>!active.some(p=>p.workId===w.id));
  const used=state.works.flatMap(w=>w.publications.flatMap(p=>p.libraryPosition===undefined?[]:[p.libraryPosition]));
  let last=Math.max(0,...used);
  const positions=new Map<string,number>();

  for(const id of [...active.map(p=>p.workId),...rest.map(w=>w.id)]){
    const publications=state.works.find(w=>w.id===id)!.publications;

    if(!publications.length)continue;
    const known=publications.find(p=>p.libraryPosition!==undefined)?.libraryPosition;
    positions.set(id,known??++last);
  }

  return {...state,works:state.works.map(w=>({...w,publications:w.publications.map(p=>({...p,libraryPosition:positions.get(w.id)!}))}))};
}

export function previewPublicationPosition(state:Workspace,workId:string):number{
  return state.works.find(w=>w.id===workId)?.publications[0]?.libraryPosition??Math.max(0,...state.works.flatMap(w=>w.publications.map(p=>p.libraryPosition||0)))+1;
}

export function reorderPreviewLibrary(state:Workspace,ids:string[]):Workspace{
  const next=previewPositions(state),active=previewPublications(next);

  if(ids.length!==active.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!active.some(p=>p.id===id)))throw new Error('게시된 작품이 바뀌었습니다. 순서 편집을 다시 열어주세요.');
  const slots=active.map(p=>p.libraryPosition!).sort((a,b)=>a-b);
  const positions=new Map(ids.map((id,index)=>[active.find(p=>p.id===id)!.workId,slots[index]]));

  return {...next,works:next.works.map(w=>positions.has(w.id)?{...w,publications:w.publications.map(p=>({...p,libraryPosition:positions.get(w.id)!}))}:w)};
}
