import { workspaceSchema, type TrashItem, type Workspace } from './model';
import { noteTitle, removeNote } from './personal-notes';
import { applyNoteNavigation, resolveNoteNavigation } from './note-navigation';
import { removeDocument } from './document-deletion';
import { applyNavigation, resolveNavigation } from './document-navigation';

export function trashTitle(item:TrashItem){return item.type==='note'?noteTitle(item.note):item.document.title;}
export function materializeTrash(state:Workspace):Workspace{return {...state,trash:state.trash||[]};}
function checked(state:Workspace):Workspace{const result=workspaceSchema.safeParse(state);if(!result.success)throw new Error(result.error.issues[0].message);return result.data;}
function append(state:Workspace,item:TrashItem):Workspace{
  if((state.trash?.length||0)>=5000)throw new Error('휴지통이 가득 찼습니다. 일부 항목을 비운 뒤 다시 시도하세요.');
  return checked({...state,trash:[...(state.trash||[]),item]});
}
export function trashNote(state:Workspace,id:string):Workspace{
  const note=state.notes?.find(n=>n.id===id);if(!note)throw new Error('휴지통으로 옮길 노트를 찾지 못했습니다.');
  const nav=resolveNoteNavigation(state),node=nav.nodes.find(n=>n.id===id)!,siblings=nav.nodes.filter(n=>n.parentId===node.parentId);
  const beforeId=siblings[siblings.findIndex(n=>n.id===id)+1]?.id;
  const item:TrashItem={id,type:'note',deletedAt:new Date().toISOString(),note:structuredClone(note),placement:{parentId:node.parentId,...(beforeId?{beforeId}:{}),childIds:nav.nodes.filter(n=>n.parentId===id).map(n=>n.id)}};
  return append({...removeNote(state,id),assets:state.assets},item);
}
export function trashDocument(state:Workspace,workId:string,id:string):Workspace{
  const work=state.works.find(w=>w.id===workId),document=work?.documents.find(d=>d.id===id);if(!work||!document)throw new Error('휴지통으로 옮길 문서를 찾지 못했습니다.');
  const nav=resolveNavigation(work),node=nav.nodes.find(n=>n.id===id)!,siblings=nav.nodes.filter(n=>n.parentId===node.parentId&&n.sectionId===node.sectionId);
  const beforeId=siblings[siblings.findIndex(n=>n.id===id)+1]?.id,messages=work.aiConversations?.find(c=>c.docId===id)?.messages;
  const item:TrashItem={id,type:'document',workId,workTitle:work.title,deletedAt:new Date().toISOString(),document:structuredClone(document),...(messages!==undefined?{aiMessages:structuredClone(messages)}:{}),placement:{parentId:node.parentId,...(beforeId?{beforeId}:{}),childIds:nav.nodes.filter(n=>n.parentId===id).map(n=>n.id),section:structuredClone(nav.sections.find(s=>s.id===node.sectionId)!)}};
  return append({...removeDocument(state,workId,id),assets:state.assets},item);
}
export function restoreTrash(state:Workspace,id:string):Workspace{
  const item=state.trash?.find(t=>t.id===id);if(!item)throw new Error('복원할 항목을 찾지 못했습니다.');
  const base={...state,trash:state.trash!.filter(t=>t.id!==id)},workIds=new Set(state.works.map(w=>w.id));
  if(item.type==='note'){
    if((state.notes?.length||0)>=5000)throw new Error('노트 보관 한도를 초과해 복원할 수 없습니다.');
    const nav=resolveNoteNavigation(state),parentId=nav.nodes.some(n=>n.id===item.placement.parentId)?item.placement.parentId:null;
    const children=nav.nodes.filter(n=>item.placement.childIds.includes(n.id)&&n.parentId===parentId),childIds=new Set(children.map(n=>n.id));
    const before=nav.nodes.findIndex(n=>n.id===item.placement.beforeId&&n.parentId===parentId);
    nav.nodes.splice(before<0?nav.nodes.length:before,0,{id,type:'note',parentId});nav.nodes=nav.nodes.map(n=>childIds.has(n.id)?{...n,parentId:id}:n);
    const next={...base,notes:[...(state.notes||[]),{...structuredClone(item.note),linkedWorkIds:item.note.linkedWorkIds.filter(id=>workIds.has(id))}]};
    try{return checked(applyNoteNavigation(next,nav));}catch(error){if(!(error instanceof Error)||!error.message.includes('24단계'))throw error;return checked(applyNoteNavigation(next,{...nav,nodes:nav.nodes.map(n=>n.id===id?{...n,parentId:null}:n)}));}
  }
  const work=state.works.find(w=>w.id===item.workId);if(!work)throw new Error('원래 작품이 없습니다. 작품을 복원한 뒤 다시 시도하세요.');
  if(work.documents.length>=5000)throw new Error('작품의 문서 보관 한도를 초과해 복원할 수 없습니다.');
  const nav=resolveNavigation(work);
  if(!nav.sections.some(s=>s.id===item.placement.section.id)&&nav.sections.length<40)nav.sections.push(structuredClone(item.placement.section));
  const section=nav.sections.find(s=>s.id===item.placement.section.id)||nav.sections.find(s=>s.defaultKind===item.document.kind)||nav.sections[0];
  const parentId=nav.nodes.some(n=>n.id===item.placement.parentId&&n.sectionId===section.id)?item.placement.parentId:null;
  const children=nav.nodes.filter(n=>item.placement.childIds.includes(n.id)&&n.parentId===parentId&&n.sectionId===section.id),childIds=new Set(children.map(n=>n.id));
  const before=nav.nodes.findIndex(n=>n.id===item.placement.beforeId&&n.parentId===parentId&&n.sectionId===section.id);
  nav.nodes.splice(before<0?nav.nodes.length:before,0,{id,type:'document',sectionId:section.id,parentId});nav.nodes=nav.nodes.map(n=>childIds.has(n.id)?{...n,parentId:id}:n);
  const next={...work,documents:[...work.documents,structuredClone(item.document)],...(item.aiMessages?{aiConversations:[...(work.aiConversations||[]),{docId:id,messages:structuredClone(item.aiMessages)}]}:{})};
  let restored;try{restored=applyNavigation(next,nav);}catch(error){if(!(error instanceof Error)||!error.message.includes('24단계'))throw error;restored=applyNavigation(next,{...nav,nodes:nav.nodes.map(n=>n.id===id?{...n,parentId:null}:n)});}
  return checked({...base,works:base.works.map(w=>w.id===item.workId?restored:w)});
}
export function purgeTrash(state:Workspace,ids:string[]):Workspace{
  const selected=new Set(ids),removed=(state.trash||[]).filter(t=>selected.has(t.id)),trash=(state.trash||[]).filter(t=>!selected.has(t.id));
  const assetIds=(item:TrashItem)=>item.type==='note'?item.note.assetIds:item.document.assetIds;
  const used=new Set([...state.works.flatMap(w=>w.documents.flatMap(d=>d.assetIds)),...(state.notes||[]).flatMap(n=>n.assetIds),...trash.flatMap(assetIds)]),discarded=new Set(removed.flatMap(assetIds).filter(id=>!used.has(id)));
  return checked({...state,trash,assets:state.assets.filter(a=>!discarded.has(a.id))});
}
/** Old backups omit trash. Keep its records and assets unless the same ID is restored live. */
export function preserveTrash(candidate:Workspace,previous:Workspace):Workspace{
  if(candidate.trash!==undefined||previous.trash===undefined)return candidate;
  const active=new Set([...candidate.works.flatMap(w=>w.documents.map(d=>d.id)),...(candidate.notes||[]).map(n=>n.id)]),trash=previous.trash.filter(t=>!active.has(t.id));
  const assetIds=new Set(trash.flatMap(t=>t.type==='note'?t.note.assetIds:t.document.assetIds)),present=new Set(candidate.assets.map(a=>a.id));
  return {...candidate,trash:structuredClone(trash),assets:[...candidate.assets,...previous.assets.filter(a=>assetIds.has(a.id)&&!present.has(a.id))]};
}
