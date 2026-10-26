import { documentTitle, plainText, type RichNode, type Workspace } from './model';
import { noteTitle, resolveNoteNavigation } from './note-navigation';
import { resolveNavigation } from './document-navigation';
import { internalReferences, type InternalReference } from './internal-reference-node';
import { workShelves, workShelfTitle } from './work-shelves';

export type ReferenceTarget=InternalReference&{path:string;category:string;parentKey:string|null;order:number;content?:RichNode};

export const referenceGroups=[
  {id:'note',label:'노트 연결'},
  {id:'document',label:'문서 연결'},
  {id:'folder',label:'폴더 멘션'},
  {id:'work',label:'작품 멘션'},
  {id:'shelf',label:'책장 멘션'},
] as const;

export function referenceGroup(ref:InternalReference){return ref.kind.endsWith('-folder')?'folder':ref.kind;}

export function referenceKey(ref:Pick<InternalReference,'kind'|'targetId'|'workId'>){return `${ref.kind}:${ref.workId||''}:${ref.targetId}`;}

export function referenceTargets(state:Workspace):ReferenceTarget[]{
  const result:ReferenceTarget[]=[],notes=resolveNoteNavigation(state),noteNodes=new Map(notes.nodes.map(node=>[node.id,node])),noteById=new Map((state.notes||[]).map(note=>[note.id,note]));
  const noteOrder=new Map(notes.nodes.map((node,i)=>[node.id,i]));
  const shelves=workShelves(state),workShelf=new Map(shelves.flatMap(shelf=>shelf.workIds.map(id=>[id,shelf] as const)));

  function notePath(id:string){const path:string[]=[];let node=noteNodes.get(id);const seen=new Set<string>();

while(node?.parentId&&!seen.has(node.id)){seen.add(node.id);node=noteNodes.get(node.parentId);

if(node)path.unshift(node.type==='folder'?node.title:noteTitle(noteById.get(node.id)!));}

return ['노트',...path].join(' / ');}

  function noteParent(id:string){const parentId=noteNodes.get(id)?.parentId,parent=parentId?noteNodes.get(parentId):undefined;

return parent?referenceKey({kind:parent.type==='folder'?'note-folder':'note',targetId:parent.id,workId:null}):null;}

  for(const note of state.notes||[])result.push({kind:'note',targetId:note.id,workId:null,label:noteTitle(note),path:notePath(note.id),category:'노트',order:noteOrder.get(note.id)!,parentKey:noteParent(note.id),content:note.content});

  for(const node of notes.nodes)if(node.type==='folder')result.push({kind:'note-folder',targetId:node.id,workId:null,label:node.title,path:notePath(node.id),category:'노트 폴더',order:noteOrder.get(node.id)!,parentKey:noteParent(node.id)});

  for(const work of state.works){
    const nav=resolveNavigation(work),nodes=new Map(nav.nodes.map(node=>[node.id,node])),docs=new Map(work.documents.map(doc=>[doc.id,doc]));
    const shelf=workShelf.get(work.id)!,order=new Map(nav.nodes.map((node,i)=>[node.id,nav.sections.findIndex(section=>section.id===node.sectionId)*nav.nodes.length+i]));
    result.push({kind:'work',targetId:work.id,workId:null,label:work.title,path:workShelfTitle(shelf),category:'작품',order:shelf.workIds.indexOf(work.id),parentKey:referenceKey({kind:'shelf',targetId:shelf.id,workId:null})});

    function path(id:string){const parts:string[]=[];let node=nodes.get(id);const seen=new Set<string>();const section=nav.sections.find(section=>section.id===node?.sectionId);

      while(node?.parentId&&!seen.has(node.id)){seen.add(node.id);node=nodes.get(node.parentId);

if(node)parts.unshift(node.type==='folder'?node.title:documentTitle(docs.get(node.id)!));}

      return [work.title,section?.title,...parts].filter(Boolean).join(' / ');
    }

    function parent(id:string){const parentId=nodes.get(id)?.parentId,node=parentId?nodes.get(parentId):undefined;

return node?referenceKey({kind:node.type==='folder'?'document-folder':'document',targetId:node.id,workId:work.id}):referenceKey({kind:'work',targetId:work.id,workId:null});}

    for(const doc of work.documents)result.push({kind:'document',targetId:doc.id,workId:work.id,label:documentTitle(doc),path:path(doc.id),category:doc.kind==='wiki'?'설정집':doc.kind==='memo'?'메모':'원고',order:order.get(doc.id)!,parentKey:parent(doc.id),content:doc.content});

    for(const node of nav.nodes)if(node.type==='folder')result.push({kind:'document-folder',targetId:node.id,workId:work.id,label:node.title,path:path(node.id),category:'작품 폴더',order:order.get(node.id)!,parentKey:parent(node.id)});
  }

  for(const shelf of shelves)result.push({kind:'shelf',targetId:shelf.id,workId:null,label:workShelfTitle(shelf),path:'집필실',category:'책장',order:shelves.indexOf(shelf),parentKey:null});

  return result;
}

/** Resolve chips without building the entire searchable tree for every inline node. */
export function referenceLabel(state:Workspace,ref:InternalReference):string|null{
  if(ref.kind==='note'){const note=state.notes?.find(note=>note.id===ref.targetId);

return note?noteTitle(note):null;}

  if(ref.kind==='shelf'){const shelf=workShelves(state).find(shelf=>shelf.id===ref.targetId);

return shelf?workShelfTitle(shelf):null;}

  if(ref.kind==='note-folder'){const node=state.noteNavigation?.nodes.find(node=>node.id===ref.targetId);

return node?.type==='folder'?node.title:null;}

  const work=state.works.find(work=>work.id===(ref.kind==='work'?ref.targetId:ref.workId));

  if(!work)return null;

  if(ref.kind==='work')return work.title;

  if(ref.kind==='document-folder'){const node=resolveNavigation(work).nodes.find(node=>node.id===ref.targetId);

return node?.type==='folder'?node.title:null;}

  const doc=work.documents.find(doc=>doc.id===ref.targetId);

  return doc?documentTitle(doc):null;
}

export function searchReferences(targets:ReferenceTarget[],sourceId:string,query:string):ReferenceTarget[]{
  const words=query.trim().normalize('NFC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const found=targets.filter(target=>target.targetId!==sourceId&&words.every(word=>`${target.label} ${target.path} ${target.category}`.normalize('NFC').toLocaleLowerCase().includes(word)));

  return referenceGroups.flatMap(group=>found.filter(target=>referenceGroup(target)===group.id).slice(0,30));
}

export function referenceChildren(targets:ReferenceTarget[],ref:InternalReference){return targets.filter(target=>target.parentKey===referenceKey(ref)).sort((a,b)=>a.order-b.order);}

export function referenceSnippet(targets:ReferenceTarget[],target:ReferenceTarget){
  if(target.content)return plainText(target.content).trim().slice(0,160);
  const children=referenceChildren(targets,target);

  return target.kind==='shelf'?`작품 ${children.length}개`:`항목 ${children.length}개`;
}

export function referenceBacklinks(targets:ReferenceTarget[],ref:InternalReference){return targets.filter(target=>referenceKey(target)!==referenceKey(ref)&&target.content&&internalReferences(target.content).some(value=>referenceKey(value)===referenceKey(ref)));}

export function referenceConnections(targets:ReferenceTarget[],sourceId:string){
  const source=targets.find(target=>target.targetId===sourceId),byKey=new Map(targets.map(target=>[referenceKey(target),target]));
  const outgoing=source?.content?[...new Map(internalReferences(source.content).map(ref=>[referenceKey(ref),byKey.get(referenceKey(ref))||ref])).values()]:[];
  const incoming=source?referenceBacklinks(targets,source):[];

  return {outgoing,incoming};
}
