import { documentTitle } from './model';
import { newDocument, trashFolderSchema, workspaceSchema, type TrashItem, type Workspace, type Work } from './model';
import { asDocumentNavigation, asNoteNavigation } from './note-navigation-schema';
import type { DocumentNavigation } from './document-navigation-schema';
import { noteTitle, removeNote } from './personal-notes';
import { applyNoteNavigation, noteTreeWork, resolveNoteNavigation } from './note-navigation';
import { removeDocument } from './document-deletion';
import { applyNavigation, descendantsOf, resolveNavigation } from './document-navigation';
import { preserveWorkShelves } from './work-shelves';

export function trashTitle(item:TrashItem){return item.type==='note'?noteTitle(item.note):item.type==='work'?item.work.title:documentTitle(item.document);}

export type TrashRow={id:string;ids:string[];title:string;first:TrashItem;deletedAt:string};

/** One folder-wide deletion is one visible item in the dialog and both sidebars. */
export function trashRows(items:readonly TrashItem[]=[]):TrashRow[]{
  const rows:TrashRow[]=[],folders=new Map<string,TrashRow>();

  for(const item of [...items].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt))){
    const folder=item.type==='work'?undefined:item.folder,row=folder&&folders.get(folder.id);

    if(row){row.ids.push(item.id);continue;}

    const next={id:folder?.id||item.id,ids:[item.id],title:folder?.title||trashTitle(item),first:item,deletedAt:item.deletedAt};

    if(folder)folders.set(folder.id,next);
    rows.push(next);
  }

  return rows;
}

/** Every attachment a trash item still holds. A work also owns attachments no document references any more. */
function heldAssets(item:TrashItem,state:Workspace){
  if(item.type==='note')return item.note.assetIds;

  if(item.type==='document')return item.document.assetIds;

  return [...item.work.documents.flatMap(d=>d.assetIds),...state.assets.filter(a=>a.workId===item.id).map(a=>a.id)];
}

export function materializeTrash(state:Workspace):Workspace{return {...state,trash:state.trash||[]};}

function checked(state:Workspace):Workspace{const result=workspaceSchema.safeParse(preserveWorkShelves(state,state));

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

type FolderItem=Extract<TrashItem,{type:'document'|'note'}>;

/** The deleted tree in sibling order, root first under its old parent. A title marks a folder. */
function folderTree(nodes:DocumentNavigation['nodes'],removed:Set<string>){return nodes.filter(n=>removed.has(n.id)).map(n=>({id:n.id,parentId:n.parentId,...n.type==='folder'&&{title:n.title}}));}

/** Delete a folder tree in one update. Each document stays a trash item; together they restore as the folder. */
export function trashDocumentFolder(state:Workspace,workId:string,folderId:string):Workspace{
  const work=state.works.find(w=>w.id===workId);

  if(!work)throw new Error('폴더가 있는 작품을 찾지 못했습니다.');
  const nav=resolveNavigation(work),folder=nav.nodes.find(n=>n.id===folderId&&n.type==='folder');

  if(!folder)throw new Error('삭제할 폴더를 찾지 못했습니다.');
  const removed=descendantsOf(nav,folderId),documents=work.documents.filter(d=>removed.has(d.id));

  if((state.trash?.length||0)+documents.length>5000)throw new Error('휴지통이 가득 찼습니다. 일부 항목을 비운 뒤 다시 시도하세요.');
  const siblings=nav.nodes.filter(n=>n.parentId===folder.parentId&&n.sectionId===folder.sectionId),beforeId=siblings[siblings.findIndex(n=>n.id===folderId)+1]?.id;
  const section=nav.sections.find(s=>s.id===folder.sectionId)!,deletedAt=new Date().toISOString();
  const conversations=new Map((work.aiConversations||[]).map(c=>[c.docId,c.messages])),title=folder.type==='folder'?folder.title:'',tree=folderTree(nav.nodes,removed);

  const items:TrashItem[]=documents.map((document,i)=>({id:document.id,type:'document',workId,workTitle:work.title,deletedAt,document:structuredClone(document),
    placement:{parentId:folder.parentId,childIds:[],section:structuredClone(section),...beforeId&&{beforeId}},folder:{id:folderId,title,...i===0&&{nodes:tree}},
    ...conversations.has(document.id)&&{aiMessages:structuredClone(conversations.get(document.id)!)}}));

  const remaining=work.documents.filter(d=>!removed.has(d.id)),nodes=nav.nodes.filter(n=>!removed.has(n.id));

  if(!remaining.length){const document=newDocument('scene','새 문서');remaining.push(document);nodes.push({id:document.id,type:'document',parentId:null,sectionId:nav.sections.find(s=>s.defaultKind==='scene')?.id||nav.sections[0].id});}

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
  const title=folder.type==='folder'?folder.title:'',tree=folderTree(asDocumentNavigation(nav).nodes,removed);
  const items:TrashItem[]=notes.map((note,i)=>({id:note.id,type:'note',deletedAt,note:structuredClone(note),placement:{parentId:folder.parentId,childIds:[],...beforeId&&{beforeId}},folder:{id:folderId,title,...i===0&&{nodes:tree}}}));

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

/** Retry at the top level when the old place would pass the depth limit. */
function placeOrTop<T>(place:(parentId:string|null)=>T,parentId:string|null):T{
  try{return place(parentId);}catch(error){if(parentId===null||!(error instanceof Error)||!error.message.includes('24단계'))throw error;

return place(null);}
}

/** Put a deleted folder tree back before its old next sibling. Items purged since drop out and their children move up. */
function insertTree(nav:DocumentNavigation,group:FolderItem[],sectionId:string,parentId:string|null):DocumentNavigation{
  const parsed=trashFolderSchema.safeParse(group.find(t=>t.folder?.nodes)?.folder||group[0].folder);

  if(!parsed.success)throw new Error('휴지통 폴더 구조가 손상되어 복원할 수 없습니다.');
  const folder=parsed.data,live=new Set(nav.nodes.map(n=>n.id)),present=new Set(group.map(t=>t.id));
  const saved=folder.nodes||[{id:folder.id,parentId:null,title:folder.title}];
  const tree:{id:string;parentId:string|null;title?:string}[]=[...saved,...group.flatMap(t=>saved.some(n=>n.id===t.id)?[]:[{id:t.id,parentId:folder.id}])],byId=new Map(tree.map(n=>[n.id,n]));
  const kept=tree.filter(n=>n.title?!live.has(n.id):present.has(n.id)),keep=new Set(kept.map(n=>n.id));

  const up=(id:string|null)=>{const seen=new Set<string>();

    while(id&&byId.has(id)&&!keep.has(id)){
      if(seen.has(id))throw new Error('휴지통 폴더 구조가 손상되어 복원할 수 없습니다.');
      seen.add(id);id=byId.get(id)!.parentId;
    }

return id&&keep.has(id)?id:parentId;};

  const nodes=kept.map(n=>n.title?{id:n.id,type:'folder' as const,title:n.title,sectionId,parentId:up(n.parentId)}:{id:n.id,type:'document' as const,sectionId,parentId:up(n.parentId)});
  const next=[...nav.nodes],before=next.findIndex(n=>n.id===group[0].placement.beforeId&&n.parentId===parentId&&n.sectionId===sectionId);
  next.splice(before<0?next.length:before,0,...nodes);

  return {...nav,nodes:next};
}

/** One restore for a folder-wide deletion: the folder, its subfolders and every document or note still in the trash. */
function restoreFolder(state:Workspace,group:FolderItem[]):Workspace{
  const ids=new Set(group.map(t=>t.id)),base={...state,trash:state.trash!.filter(t=>!ids.has(t.id))},workIds=new Set(state.works.map(w=>w.id)),first=group[0];

  if(first.type==='note'){
    const notes=group.filter(t=>t.type==='note');

    if((state.notes?.length||0)+notes.length>5000)throw new Error('노트 보관 한도를 초과해 복원할 수 없습니다.');
    const nav=noteTreeWork(state).navigation!,parentId=nav.nodes.some(n=>n.id===first.placement.parentId)?first.placement.parentId:null;
    const next={...base,notes:[...(state.notes||[]),...notes.map(t=>({...structuredClone(t.note),linkedWorkIds:t.note.linkedWorkIds.filter(id=>workIds.has(id))}))]};

    return checked(placeOrTop(p=>applyNoteNavigation(next,asNoteNavigation(insertTree(nav,notes,'notes',p))),parentId));
  }

  const docs=group.filter(t=>t.type==='document'),work=state.works.find(w=>w.id===first.workId);

  if(!work)throw new Error('원래 작품이 없습니다. 작품을 복원한 뒤 다시 시도하세요.');

  if(work.documents.length+docs.length>5000)throw new Error('작품의 문서 보관 한도를 초과해 복원할 수 없습니다.');
  const nav=resolveNavigation(work),placement=docs[0].placement;

  if(!nav.sections.some(s=>s.id===placement.section.id)&&nav.sections.length<40)nav.sections.push(structuredClone(placement.section));
  const section=nav.sections.find(s=>s.id===placement.section.id)||nav.sections.find(s=>s.defaultKind===docs[0].document.kind)||nav.sections[0];
  const parentId=nav.nodes.some(n=>n.id===placement.parentId&&n.sectionId===section.id)?placement.parentId:null;
  const next:Work={...work,documents:[...work.documents,...docs.map(t=>structuredClone(t.document))]},messages=docs.flatMap(t=>t.aiMessages?[{docId:t.id,messages:structuredClone(t.aiMessages)}]:[]);

  if(messages.length)next.aiConversations=[...(work.aiConversations||[]),...messages];
  const restored=placeOrTop(p=>applyNavigation(next,insertTree(nav,docs,section.id,p)),parentId);

  return checked({...base,works:base.works.map(w=>w.id===work.id?restored:w)});
}

/** Restores one trash item, or every item of a folder-wide deletion when given that folder's ID. */
export function restoreTrash(state:Workspace,id:string):Workspace{
  const item=state.trash?.find(t=>t.id===id);

  if(!item){const group=(state.trash||[]).filter((t):t is FolderItem=>t.type!=='work'&&t.folder?.id===id);

    if(group.length)return restoreFolder(state,group);

    throw new Error('복원할 항목을 찾지 못했습니다.');
  }

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
