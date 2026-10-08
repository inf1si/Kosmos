import { uid, workShelfSchema, type WorkShelf, type Workspace } from './model';

export const DEFAULT_WORK_SHELF='default';

export function workShelfTitle(shelf:Pick<WorkShelf,'title'>){return shelf.title.trim()||'이름 없는 책장';}

/** Trash keeps a work's shelf until it is restored or permanently removed. */
function retainedWorkIds(state:Workspace){return [...state.works.map(w=>w.id),...(state.trash||[]).filter(t=>t.type==='work').map(t=>t.id)];}

/** Old workspaces and newly imported works start on the default shelf. */
export function workShelves(state:Workspace):WorkShelf[]{
  const shelves=structuredClone(state.workShelves||[]),retained=retainedWorkIds(state),valid=new Set(retained);

  for(const shelf of shelves)shelf.workIds=shelf.workIds.filter(id=>valid.has(id));

  if(!shelves.some(s=>s.id===DEFAULT_WORK_SHELF))shelves.unshift({id:DEFAULT_WORK_SHELF,title:'기본 책장',workIds:[]});
  const placed=new Set(shelves.flatMap(s=>s.workIds)),fallback=shelves.find(s=>s.id===DEFAULT_WORK_SHELF)!;
  fallback.workIds.push(...retained.filter(id=>!placed.has(id)));

  return shelves;
}

export function shelfForWork(state:Workspace,workId:string){return workShelves(state).find(s=>s.workIds.includes(workId))?.id||DEFAULT_WORK_SHELF;}

function shelfTitle(shelves:WorkShelf[],title:string,except?:string){
  const parsed=workShelfSchema.shape.title.safeParse(title);

  if(!parsed.success)throw new Error('책장 이름은 80자까지 입력할 수 있습니다.');

  if(parsed.data&&shelves.some(s=>s.id!==except&&s.title.toLocaleLowerCase()===parsed.data.toLocaleLowerCase()))throw new Error('같은 이름의 책장이 있습니다.');

  return parsed.data;
}

export function addWorkShelf(state:Workspace,title:string):Workspace{
  const shelves=workShelves(state);

  if(shelves.length>=40)throw new Error('책장은 최대 40개까지 만들 수 있습니다.');
  const shelf={id:uid(),title:shelfTitle(shelves,title),workIds:[]};

  return {...state,workShelves:[...shelves,shelf]};
}

export function renameWorkShelf(state:Workspace,id:string,title:string):Workspace{
  const shelves=workShelves(state),nextTitle=shelfTitle(shelves,title,id);

  if(!shelves.some(s=>s.id===id))throw new Error('책장을 찾지 못했습니다.');

  return {...state,workShelves:shelves.map(s=>s.id===id?{...s,title:nextTitle}:s)};
}

export function moveWorkShelf(state:Workspace,id:string,direction:-1|1):Workspace{
  const shelves=workShelves(state),index=shelves.findIndex(s=>s.id===id),next=index+direction;

  if(index<0)throw new Error('책장을 찾지 못했습니다.');

  if(next<0||next>=shelves.length)return state;
  [shelves[index],shelves[next]]=[shelves[next],shelves[index]];

  return {...state,workShelves:shelves};
}

export function reorderWorkShelf(state:Workspace,id:string,targetId:string,edge:'before'|'after'):Workspace{
  const shelves=workShelves(state);

  if(!shelves.some(s=>s.id===id)||!shelves.some(s=>s.id===targetId))throw new Error('책장을 찾지 못했습니다.');

  if(id===targetId)return state;
  const moved=shelves.find(s=>s.id===id)!,next=shelves.filter(s=>s.id!==id),index=next.findIndex(s=>s.id===targetId);
  next.splice(index+(edge==='after'?1:0),0,moved);

  return next.every((s,i)=>s.id===shelves[i].id)?state:{...state,workShelves:next};
}

/** Only shelf membership changes. Work content and public library order remain independent. */
export function placeWorkOnShelf(state:Workspace,workId:string,shelfId:string,position?:{id:string;edge:'before'|'after'}):Workspace{
  const shelves=workShelves(state),destination=shelves.find(s=>s.id===shelfId);

  if(!state.works.some(w=>w.id===workId))throw new Error('옮길 작품을 찾지 못했습니다.');

  if(!destination)throw new Error('옮길 책장을 찾지 못했습니다.');

  if(position&&(!destination.workIds.includes(position.id)||!state.works.some(w=>w.id===position.id)))throw new Error('옮길 위치를 찾지 못했습니다.');

  if(position?.id===workId)return state;
  const next=shelves.map(s=>({...s,workIds:s.workIds.filter(id=>id!==workId)})),target=next.find(s=>s.id===shelfId)!;
  const index=position?target.workIds.indexOf(position.id)+(position.edge==='after'?1:0):target.workIds.length;
  target.workIds.splice(index,0,workId);

  return next.every((s,i)=>s.workIds.join()===shelves[i].workIds.join())?state:{...state,workShelves:next};
}

/** Removing a shelf rehomes its works; it never deletes or unpublishes them. */
export function removeWorkShelf(state:Workspace,id:string):Workspace{
  if(id===DEFAULT_WORK_SHELF)throw new Error('기본 책장은 유지해야 합니다.');
  const shelves=workShelves(state),removed=shelves.find(s=>s.id===id);

  if(!removed)throw new Error('책장을 찾지 못했습니다.');

  return {...state,workShelves:shelves.filter(s=>s.id!==id).map(s=>s.id===DEFAULT_WORK_SHELF?{...s,workIds:[...s.workIds,...removed.workIds]}:s)};
}

export function moveWorkToShelf(state:Workspace,workId:string,shelfId:string):Workspace{
  const shelves=workShelves(state);

  if(!state.works.some(w=>w.id===workId))throw new Error('옮길 작품을 찾지 못했습니다.');

  if(!shelves.some(s=>s.id===shelfId))throw new Error('옮길 책장을 찾지 못했습니다.');

  if(shelfForWork(state,workId)===shelfId)return state;

  return {...state,workShelves:shelves.map(s=>({...s,workIds:s.id===shelfId?[...s.workIds.filter(id=>id!==workId),workId]:s.workIds.filter(id=>id!==workId)}))};
}

/** Missing fields in older backups retain current shelves for surviving work IDs. Explicit arrays replace them. */
export function preserveWorkShelves(candidate:Workspace,previous:Workspace):Workspace{
  const shelves=candidate.workShelves??previous.workShelves;

  if(shelves===undefined)return candidate;

  return {...candidate,workShelves:workShelves({...candidate,workShelves:shelves})};
}
