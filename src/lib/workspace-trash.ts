import { documentTitle } from './model';
import { newDocument, workspaceSchema, type TrashItem, type Workspace, type Work } from './model';
import { noteTitle, removeNote } from './personal-notes';
import { applyNoteNavigation, noteTreeWork, resolveNoteNavigation } from './note-navigation';
import { removeDocument } from './document-deletion';
import { applyNavigation, descendantsOf, resolveNavigation } from './document-navigation';

export function trashTitle(item:TrashItem){return item.type==='note'?noteTitle(item.note):item.type==='work'?item.work.title:documentTitle(item.document);}

/** Every attachment a trash item still holds. A work also owns attachments no document references any more. */
function heldAssets(item:TrashItem,state:Workspace){
  if(item.type==='note')return item.note.assetIds;

  if(item.type==='document')return item.document.assetIds;

  return [...item.work.documents.flatMap(d=>d.assetIds),...state.assets.filter(a=>a.workId===item.id).map(a=>a.id)];
}

export function materializeTrash(state:Workspace):Workspace{return {...state,trash:state.trash||[]};}

function checked(state:Workspace):Workspace{const result=workspaceSchema.safeParse(state);

if(!result.success)throw new Error(result.error.issues[0].message);

return result.data;}

function append(state:Workspace,item:TrashItem):Workspace{
  if((state.trash?.length||0)>=5000)throw new Error('휴지통이 가득 찼습니다. 일부 항목을 비운 뒤 다시 시도하세요.');

  return checked({...state,trash:[...(state.trash||[]),item]});
}

export function trashNote(state:Workspace,id:string):Workspace{
  const note=state.notes?.find(n=>n.id===id);

if(!note)throw new Error('휴지통으로 옮길 노트를 찾지 못했습니다.');
  const nav=resolveNoteNavigation(state),node=nav.nodes.find(n=>n.id===id)!,siblings=nav.nodes.filter(n=>n.parentId===node.parentId);
  const beforeId=siblings[siblings.findIndex(n=>n.id===id)+1]?.id;
  const item:TrashItem={id,type:'note',deletedAt:new Date().toISOString(),note:structuredClone(note),placement:{parentId:node.parentId,childIds:nav.nodes.filter(n=>n.parentId===id).map(n=>n.id)}};

  if(beforeId)item.placement.beforeId=beforeId;

  return append({...removeNote(state,id),assets:state.assets},item);
}

export function trashDocument(state:Workspace,workId:string,id:string):Workspace{
  const work=state.works.find(w=>w.id===workId),document=work?.documents.find(d=>d.id===id);

if(!work||!document)throw new Error('휴지통으로 옮길 문서를 찾지 못했습니다.');
  const nav=resolveNavigation(work),node=nav.nodes.find(n=>n.id===id)!,siblings=nav.nodes.filter(n=>n.parentId===node.parentId&&n.sectionId===node.sectionId);
  const beforeId=siblings[siblings.findIndex(n=>n.id===id)+1]?.id,messages=work.aiConversations?.find(c=>c.docId===id)?.messages;
  const item:TrashItem={id,type:'document',workId,workTitle:work.title,deletedAt:new Date().toISOString(),document:structuredClone(document),placement:{parentId:node.parentId,childIds:nav.nodes.filter(n=>n.parentId===id).map(n=>n.id),section:structuredClone(nav.sections.find(s=>s.id===node.sectionId)!)}};

  if(messages!==undefined)item.aiMessages=structuredClone(messages);

  if(beforeId)item.placement.beforeId=beforeId;

  return append({...removeDocument(state,workId,id),assets:state.assets},item);
}

/** Delete a folder tree in one update; its documents remain individually recoverable in the existing trash. */
export function trashDocumentFolder(state:Workspace,workId:string,folderId:string):Workspace{
  const work=state.works.find(w=>w.id===workId);

  if(!work)throw new Error('폴더가 있는 작품을 찾지 못했습니다.');
  const nav=resolveNavigation(work),folder=nav.nodes.find(n=>n.id===folderId&&n.type==='folder');

  if(!folder)throw new Error('삭제할 폴더를 찾지 못했습니다.');
  const removed=descendantsOf(nav,folderId),documents=work.documents.filter(d=>removed.has(d.id));

  if((state.trash?.length||0)+documents.length>5000)throw new Error('휴지통이 가득 찼습니다. 일부 항목을 비운 뒤 다시 시도하세요.');
  const siblings=nav.nodes.filter(n=>n.parentId===folder.parentId&&n.sectionId===folder.sectionId),beforeId=siblings[siblings.findIndex(n=>n.id===folderId)+1]?.id;
  const section=nav.sections.find(s=>s.id===folder.sectionId)!,deletedAt=new Date().toISOString();
  const conversations=new Map((work.aiConversations||[]).map(c=>[c.docId,c.messages]));

  const items:TrashItem[]=documents.map(document=>({id:document.id,type:'document',workId,workTitle:work.title,deletedAt,document:structuredClone(document),
    placement:{parentId:folder.parentId,childIds:[],section:structuredClone(section),...beforeId&&{beforeId}},
    ...conversations.has(document.id)&&{aiMessages:structuredClone(conversations.get(document.id)!)}}));

  const remaining=work.documents.filter(d=>!removed.has(d.id)),nodes=nav.nodes.filter(n=>!removed.has(n.id));

  if(!remaining.length){const document=newDocument('scene','새 장면');remaining.push(document);nodes.push({id:document.id,type:'document',parentId:null,sectionId:nav.sections.find(s=>s.defaultKind==='scene')?.id||nav.sections[0].id});}

  const next=applyNavigation({...work,documents:remaining,...work.aiConversations&&{aiConversations:work.aiConversations.filter(c=>!removed.has(c.docId))}},{...nav,nodes});

  return checked({...state,works:state.works.map(w=>w.id===workId?next:w),trash:[...(state.trash||[]),...items]});
}

/** Note folders use the same atomic deletion; no replacement note is needed when the notes space becomes empty. */
export function trashNoteFolder(state:Workspace,folderId:string):Workspace{
  const nav=resolveNoteNavigation(state),folder=nav.nodes.find(n=>n.id===folderId&&n.type==='folder');

  if(!folder)throw new Error('삭제할 폴더를 찾지 못했습니다.');
  const removed=descendantsOf(noteTreeWork(state).navigation!,folderId),notes=(state.notes||[]).filter(n=>removed.has(n.id));

  if((state.trash?.length||0)+notes.length>5000)throw new Error('휴지통이 가득 찼습니다. 일부 항목을 비운 뒤 다시 시도하세요.');
  const siblings=nav.nodes.filter(n=>n.parentId===folder.parentId),beforeId=siblings[siblings.findIndex(n=>n.id===folderId)+1]?.id,deletedAt=new Date().toISOString();
  const items:TrashItem[]=notes.map(note=>({id:note.id,type:'note',deletedAt,note:structuredClone(note),placement:{parentId:folder.parentId,childIds:[],...beforeId&&{beforeId}}}));

  return checked(applyNoteNavigation({...state,notes:(state.notes||[]).filter(n=>!removed.has(n.id)),trash:[...(state.trash||[]),...items]},{...nav,nodes:nav.nodes.filter(n=>!removed.has(n.id))}));
}

/** Move a whole work to the trash. The caller withdraws its public edition first; the last work stays. */
export function trashWork(state:Workspace,id:string):Workspace{
  const index=state.works.findIndex(w=>w.id===id);

  if(index<0)throw new Error('휴지통으로 옮길 작품을 찾지 못했습니다.');

  if(state.works.length<=1)throw new Error('마지막 작품은 휴지통으로 옮길 수 없습니다.');
  const linked=(state.notes||[]).filter(n=>n.linkedWorkIds.includes(id));
  const item:TrashItem={id,type:'work',deletedAt:new Date().toISOString(),work:{...structuredClone(state.works[index]),activePublicationId:null},index,noteIds:linked.map(n=>n.id)};
  const next={...state,works:state.works.filter(w=>w.id!==id)};

  if(state.notes)next.notes=state.notes.map(n=>n.linkedWorkIds.includes(id)?{...n,linkedWorkIds:n.linkedWorkIds.filter(w=>w!==id)}:n);

  return append(next,item);
}

export function restoreTrash(state:Workspace,id:string):Workspace{
  const item=state.trash?.find(t=>t.id===id);

if(!item)throw new Error('복원할 항목을 찾지 못했습니다.');
  const base={...state,trash:state.trash!.filter(t=>t.id!==id)},workIds=new Set(state.works.map(w=>w.id));

  if(item.type==='work'){
    if(state.works.length>=100)throw new Error('작품은 최대 100개입니다. 다른 작품을 정리한 뒤 복원하세요.');
    const works=[...base.works];works.splice(Math.min(item.index,works.length),0,structuredClone(item.work));
    const relink=new Set(item.noteIds),notes=base.notes?.map(n=>relink.has(n.id)&&!n.linkedWorkIds.includes(id)&&n.linkedWorkIds.length<100?{...n,linkedWorkIds:[...n.linkedWorkIds,id]}:n);

    return checked({...base,works,...notes&&{notes}});
  }

  if(item.type==='note'){
    if((state.notes?.length||0)>=5000)throw new Error('노트 보관 한도를 초과해 복원할 수 없습니다.');
    const nav=resolveNoteNavigation(state),parentId=nav.nodes.some(n=>n.id===item.placement.parentId)?item.placement.parentId:null;
    const children=nav.nodes.filter(n=>item.placement.childIds.includes(n.id)&&n.parentId===parentId),childIds=new Set(children.map(n=>n.id));
    const before=nav.nodes.findIndex(n=>n.id===item.placement.beforeId&&n.parentId===parentId);
    nav.nodes.splice(before<0?nav.nodes.length:before,0,{id,type:'note',parentId});nav.nodes=nav.nodes.map(n=>childIds.has(n.id)?{...n,parentId:id}:n);
    const next={...base,notes:[...(state.notes||[]),{...structuredClone(item.note),linkedWorkIds:item.note.linkedWorkIds.filter(id=>workIds.has(id))}]};

    try{return checked(applyNoteNavigation(next,nav));}catch(error){if(!(error instanceof Error)||!error.message.includes('24단계'))throw error;

return checked(applyNoteNavigation(next,{...nav,nodes:nav.nodes.map(n=>n.id===id?{...n,parentId:null}:n)}));}
  }

  const work=state.works.find(w=>w.id===item.workId);

if(!work)throw new Error('원래 작품이 없습니다. 작품을 복원한 뒤 다시 시도하세요.');

  if(work.documents.length>=5000)throw new Error('작품의 문서 보관 한도를 초과해 복원할 수 없습니다.');
  const nav=resolveNavigation(work);

  if(!nav.sections.some(s=>s.id===item.placement.section.id)&&nav.sections.length<40)nav.sections.push(structuredClone(item.placement.section));
  const section=nav.sections.find(s=>s.id===item.placement.section.id)||nav.sections.find(s=>s.defaultKind===item.document.kind)||nav.sections[0];
  const parentId=nav.nodes.some(n=>n.id===item.placement.parentId&&n.sectionId===section.id)?item.placement.parentId:null;
  const children=nav.nodes.filter(n=>item.placement.childIds.includes(n.id)&&n.parentId===parentId&&n.sectionId===section.id),childIds=new Set(children.map(n=>n.id));
  const before=nav.nodes.findIndex(n=>n.id===item.placement.beforeId&&n.parentId===parentId&&n.sectionId===section.id);
  nav.nodes.splice(before<0?nav.nodes.length:before,0,{id,type:'document',sectionId:section.id,parentId});nav.nodes=nav.nodes.map(n=>childIds.has(n.id)?{...n,parentId:id}:n);
  const next:Work={...work,documents:[...work.documents,structuredClone(item.document)]};

  if(item.aiMessages)next.aiConversations=[...(work.aiConversations||[]),{docId:id,messages:structuredClone(item.aiMessages)}];
  let restored;

try{restored=applyNavigation(next,nav);}catch(error){if(!(error instanceof Error)||!error.message.includes('24단계'))throw error;restored=applyNavigation(next,{...nav,nodes:nav.nodes.map(n=>n.id===id?{...n,parentId:null}:n)});}

  return checked({...base,works:base.works.map(w=>w.id===item.workId?restored:w)});
}

export function purgeTrash(state:Workspace,ids:string[]):Workspace{
  const selected=new Set(ids),removed=(state.trash||[]).filter(t=>selected.has(t.id)),trash=(state.trash||[]).filter(t=>!selected.has(t.id));
  const assetIds=(item:TrashItem)=>heldAssets(item,state);
  const used=new Set([...state.works.flatMap(w=>w.documents.flatMap(d=>d.assetIds)),...(state.notes||[]).flatMap(n=>n.assetIds),...trash.flatMap(assetIds)]),discarded=new Set(removed.flatMap(assetIds).filter(id=>!used.has(id)));

  return checked({...state,trash,assets:state.assets.filter(a=>!discarded.has(a.id))});
}

/** Old backups omit trash. Keep its records and assets unless the same ID is restored live. */
export function preserveTrash(candidate:Workspace,previous:Workspace):Workspace{
  if(candidate.trash!==undefined||previous.trash===undefined)return candidate;
  const active=new Set([...candidate.works.map(w=>w.id),...candidate.works.flatMap(w=>w.documents.map(d=>d.id)),...(candidate.notes||[]).map(n=>n.id)]),trash=previous.trash.filter(t=>!active.has(t.id));
  const assetIds=new Set(trash.flatMap(t=>heldAssets(t,previous))),present=new Set(candidate.assets.map(a=>a.id));

  return {...candidate,trash:structuredClone(trash),assets:[...candidate.assets,...previous.assets.filter(a=>assetIds.has(a.id)&&!present.has(a.id))]};
}
