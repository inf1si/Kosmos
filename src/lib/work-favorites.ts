import type { Workspace } from './model';

export function toggleWorkFavorite(state:Workspace,id:string):Workspace{
  return {...state,works:state.works.map(work=>work.id===id?{...work,favorite:!work.favorite}:work)};
}

/** Old backups omit the field; an explicit false still removes a favorite. */
export function preserveWorkFavorites(candidate:Workspace,previous:Workspace):Workspace{
  const originals=new Map([...previous.works,...(previous.trash||[]).filter(t=>t.type==='work').map(t=>t.work)].map(w=>[w.id,w]));

  const preserve=(work:Workspace['works'][number])=>{
    const favorite=originals.get(work.id)?.favorite;

    return work.favorite===undefined&&favorite!==undefined?{...work,favorite}:work;
  };

  return {...candidate,works:candidate.works.map(preserve),trash:candidate.trash?.map(item=>item.type==='work'?{...item,work:preserve(item.work)}:item)};
}
