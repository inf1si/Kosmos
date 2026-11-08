import { plainText, uid, type PersonalNote, type NovelDocument, type Work, type Workspace } from './model';
import { descendantsOf, moveNavigation, type DocumentDestination } from './document-navigation';
import { asDocumentNavigation, DEFAULT_NOTE_SPACE, noteNavigationIssues, noteNavigationSchema, noteSpaceSchema, noteSpaceTitle, resolveNoteStructure, type NoteNavigation, type ResolvedNoteNavigation } from './note-navigation-schema';

export {DEFAULT_NOTE_SPACE,noteSpaceTitle} from './note-navigation-schema';

export type NoteDestination={parentId:string|null;beforeId?:string;spaceId?:string;sectionId?:string};

export function noteTitle(note:PersonalNote):string {
  return note.title.trim()||plainText(note.content).split('\n').map(line=>line.trim()).find(Boolean)?.slice(0,80)||'새 노트';
}

export function noteDocument(note:PersonalNote):NovelDocument {
  return {id:note.id,kind:'memo',title:noteTitle(note),content:note.content,chapter:'',summary:'',status:'idea',category:'',pov:'',storyTime:'',isPublic:false,publicSummary:'',assetIds:note.assetIds,updatedAt:note.updatedAt};
}

export function resolveNoteNavigation(state:Pick<Workspace,'notes'|'noteNavigation'>):ResolvedNoteNavigation {
  const nav=resolveNoteStructure(state.noteNavigation??{version:1,nodes:[]}),sectionId=nav.spaces.find(s=>s.id===DEFAULT_NOTE_SPACE)!.sections[0].id;
  const placed=new Set(nav.nodes.map(n=>n.id));
  // Preserve the old recent-first list once, then retain explicit sibling order through edits.
  const notes=state.noteNavigation?state.notes||[]:[...(state.notes||[])].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));

  for(const note of notes)if(!placed.has(note.id))nav.nodes.push({id:note.id,type:'note',parentId:null,sectionId});

  return nav;
}

export function materializeNoteNavigation(state:Workspace):Workspace {return {...state,noteNavigation:resolveNoteNavigation(state)};}

export function applyNoteNavigation(state:Workspace,nav:NoteNavigation):Workspace {
  const parsed=noteNavigationSchema.parse(nav),issue=noteNavigationIssues(parsed,(state.notes||[]).map(n=>n.id))[0];

if(issue)throw new Error(issue);

  return materializeNoteNavigation({...state,noteNavigation:parsed});
}

export function noteSpaceFor(state:Workspace,id:string):string {
  const nav=resolveNoteNavigation(state),section=nav.nodes.find(n=>n.id===id)?.sectionId;

  return nav.spaces.find(s=>s.sections.some(item=>item.id===section))?.id??DEFAULT_NOTE_SPACE;
}

export function notesInSpace(state:Workspace,spaceId:string):PersonalNote[]{
  const nav=resolveNoteNavigation(state),sections=new Set(nav.spaces.find(s=>s.id===spaceId)?.sections.map(s=>s.id)),ids=new Set(nav.nodes.filter(n=>sections.has(n.sectionId)).map(n=>n.id));

  return (state.notes??[]).filter(n=>ids.has(n.id));
}

export function noteDestination(state:Workspace,to:NoteDestination):DocumentDestination {
  const nav=resolveNoteNavigation(state),parent=to.parentId?nav.nodes.find(n=>n.id===to.parentId):undefined;

  if(to.parentId&&!parent)throw new Error('상위 노트·폴더의 위치를 확인하세요.');
  const space=nav.spaces.find(s=>s.id===(to.spaceId??(parent?noteSpaceFor(state,parent.id):DEFAULT_NOTE_SPACE)));
  const sectionId=to.sectionId??parent?.sectionId??space?.sections[0].id;

  if(!space||!space.sections.some(s=>s.id===sectionId)||parent&&parent.sectionId!==sectionId)throw new Error('노트의 작업공간·섹션을 확인하세요.');

  return {sectionId:sectionId!,parentId:to.parentId,beforeId:to.beforeId};
}

/** Presentation adapter for one space, never inserted into works[]. */
export function noteTreeWork(state:Workspace,spaceId=DEFAULT_NOTE_SPACE):Work {
  const nav=resolveNoteNavigation(state),space=nav.spaces.find(s=>s.id===spaceId);

  if(!space)throw new Error('노트 작업공간을 찾지 못했습니다.');

  return {id:space.id===DEFAULT_NOTE_SPACE?state.id:space.id,title:noteSpaceTitle(space),subtitle:'',description:'',form:'단편',documents:notesInSpace(state,spaceId).map(noteDocument),navigation:asDocumentNavigation(nav,spaceId),publications:[],activePublicationId:null};
}

export function editNoteTree(state:Workspace,edit:(work:Work)=>Work,spaceId=DEFAULT_NOTE_SPACE):Workspace {
  const nav=resolveNoteNavigation(state),space=nav.spaces.find(s=>s.id===spaceId);

  if(!space)throw new Error('노트 작업공간을 찾지 못했습니다.');
  const changed=edit(noteTreeWork(state,spaceId)).navigation!,oldSections=new Set(space.sections.map(s=>s.id));
  const nodes=changed.nodes.map(n=>n.type==='document'?{...n,type:'note' as const}:n);

  const changedIds=new Set(nodes.map(n=>n.id));

  return applyNoteNavigation(state,{...nav,spaces:nav.spaces.map(s=>s.id===spaceId?{...s,sections:changed.sections.map(({id,title})=>({id,title}))}:s),nodes:[...nav.nodes.filter(n=>!oldSections.has(n.sectionId)&&!changedIds.has(n.id)),...nodes]});
}

/** Moving a subtree changes placement only: note IDs, references, assets and conversations stay intact. */
export function moveNote(state:Workspace,id:string,to:NoteDestination):Workspace {
  const nav=resolveNoteNavigation(state),from=noteSpaceFor(state,id),destination=noteDestination(state,to),sectionOwner=nav.spaces.find(s=>s.sections.some(section=>section.id===destination.sectionId))!;

  if(from===sectionOwner.id)return editNoteTree(state,work=>moveNavigation(work,id,destination),from);
  const source=noteTreeWork(state,from),subtree=descendantsOf(source.navigation!,id),moving=nav.nodes.filter(n=>subtree.has(n.id));

  if(!moving.length)throw new Error('옮길 노트·폴더를 찾지 못했습니다.');

  if(destination.parentId&&subtree.has(destination.parentId))throw new Error('자신의 하위로 옮길 수 없습니다.');
  const remaining=nav.nodes.filter(n=>!subtree.has(n.id)),siblings=remaining.filter(n=>n.parentId===destination.parentId&&n.sectionId===destination.sectionId);

  if(destination.beforeId&&!siblings.some(n=>n.id===destination.beforeId))throw new Error('옮길 순서를 확인하세요.');
  const index=destination.beforeId?remaining.findIndex(n=>n.id===destination.beforeId):remaining.length;
  remaining.splice(index,0,...moving.map(n=>({...n,sectionId:destination.sectionId,parentId:n.id===id?destination.parentId:n.parentId})));

  return applyNoteNavigation(state,{...nav,nodes:remaining});
}

export function treeDestination(to:DocumentDestination,spaceId=DEFAULT_NOTE_SPACE):NoteDestination {return {...to,spaceId};}

export function addNoteSpace(state:Workspace,title:string,id=uid()):Workspace {
  const nav=resolveNoteNavigation(state),space=noteSpaceSchema.parse({id,title,sections:[{id:uid(),title:'노트'}]});

  return applyNoteNavigation(state,{...nav,spaces:[...nav.spaces,space]});
}

export function renameNoteSpace(state:Workspace,id:string,title:string):Workspace {
  const nav=resolveNoteNavigation(state),value=noteSpaceSchema.shape.title.parse(title);

  if(!nav.spaces.some(s=>s.id===id))throw new Error('작업공간을 찾지 못했습니다.');

  return applyNoteNavigation(state,{...nav,spaces:nav.spaces.map(s=>s.id===id?{...s,title:value}:s)});
}

/** Removing a space retains its sections and every note in the default space. */
export function removeNoteSpace(state:Workspace,id:string):Workspace {
  if(id===DEFAULT_NOTE_SPACE)throw new Error('기본 작업공간은 유지해야 합니다.');
  const nav=resolveNoteNavigation(state),space=nav.spaces.find(s=>s.id===id);

  if(!space)throw new Error('작업공간을 찾지 못했습니다.');

  if(nav.spaces.find(s=>s.id===DEFAULT_NOTE_SPACE)!.sections.length+space.sections.length>40)throw new Error('기본 작업공간의 섹션을 정리한 뒤 삭제하세요.');

  return applyNoteNavigation(state,{...nav,spaces:nav.spaces.filter(s=>s.id!==id).map(s=>s.id===DEFAULT_NOTE_SPACE?{...s,sections:[...s.sections,...space.sections]}:s)});
}
