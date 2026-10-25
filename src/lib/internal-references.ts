import { documentTitle, type RichNode, type Workspace } from './model';
import { noteTitle, resolveNoteNavigation } from './note-navigation';
import { resolveNavigation } from './document-navigation';
import { internalReferences, type InternalReference } from './internal-reference-node';

export type ReferenceTarget=InternalReference&{path:string;category:string;content:RichNode};

export function referenceTargets(state:Workspace):ReferenceTarget[]{
  const result:ReferenceTarget[]=[];
  const notes=resolveNoteNavigation(state),noteNodes=new Map(notes.nodes.map(node=>[node.id,node]));

  function notePath(id:string){const path:string[]=[];let node=noteNodes.get(id);const seen=new Set<string>();

while(node?.parentId&&!seen.has(node.id)){seen.add(node.id);node=noteNodes.get(node.parentId);

if(node?.type==='folder')path.unshift(node.title);}

return ['노트',...path].join(' / ');}

  for(const note of state.notes||[])result.push({kind:'note',targetId:note.id,workId:null,label:noteTitle(note),path:notePath(note.id),category:'노트',content:note.content});

  for(const work of state.works){
    const nav=resolveNavigation(work),nodes=new Map(nav.nodes.map(node=>[node.id,node]));

    for(const doc of work.documents){
      const path:string[]=[];let node=nodes.get(doc.id);const seen=new Set<string>();

      while(node?.parentId&&!seen.has(node.id)){seen.add(node.id);node=nodes.get(node.parentId);

if(node?.type==='folder')path.unshift(node.title);}

      result.push({kind:'document',targetId:doc.id,workId:work.id,label:documentTitle(doc),path:[work.title,...path].join(' / '),category:doc.kind==='wiki'?'설정집':doc.kind==='memo'?'메모':'원고',content:doc.content});
    }
  }

  return result;
}

export function referenceKey(ref:Pick<InternalReference,'kind'|'targetId'|'workId'>){return `${ref.kind}:${ref.workId||''}:${ref.targetId}`;}

export function searchReferences(targets:ReferenceTarget[],sourceId:string,query:string):ReferenceTarget[]{
  const words=query.trim().normalize('NFC').toLocaleLowerCase().split(/\s+/).filter(Boolean);

  return targets.filter(target=>target.targetId!==sourceId&&words.every(word=>`${target.label} ${target.path} ${target.category}`.normalize('NFC').toLocaleLowerCase().includes(word))).slice(0,30);
}

export function referenceConnections(targets:ReferenceTarget[],sourceId:string){
  const source=targets.find(target=>target.targetId===sourceId),byKey=new Map(targets.map(target=>[referenceKey(target),target]));
  const outgoing=source?[...new Map(internalReferences(source.content).map(ref=>[referenceKey(ref),byKey.get(referenceKey(ref))||ref])).values()]:[];
  const incoming=source?targets.filter(target=>target.targetId!==sourceId&&internalReferences(target.content).some(ref=>referenceKey(ref)===referenceKey(source))):[];

  return {outgoing,incoming};
}
