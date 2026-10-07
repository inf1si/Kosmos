import { plainText, type PersonalNote, type NovelDocument, type Work, type Workspace } from './model';
import { moveNavigation, type DocumentDestination } from './document-navigation';
import { asDocumentNavigation, asNoteNavigation, noteNavigationIssues, noteNavigationSchema, type NoteNavigation } from './note-navigation-schema';

export type NoteDestination={parentId:string|null;beforeId?:string};

export function noteTitle(note:PersonalNote):string {
  return note.title.trim()||plainText(note.content).split('\n').map(line=>line.trim()).find(Boolean)?.slice(0,80)||'새 노트';
}

export function noteDocument(note:PersonalNote):NovelDocument {
  return {id:note.id,kind:'memo',title:noteTitle(note),content:note.content,chapter:'',summary:'',status:'idea',category:'',pov:'',storyTime:'',isPublic:false,publicSummary:'',assetIds:note.assetIds,updatedAt:note.updatedAt};
}

export function resolveNoteNavigation(state:Pick<Workspace,'notes'|'noteNavigation'>):NoteNavigation {
  const nav=state.noteNavigation?structuredClone(state.noteNavigation):{version:1 as const,nodes:[]};
  const placed=new Set(nav.nodes.map(n=>n.id));
  // Preserve the old recent-first list once, then retain explicit sibling order through edits.
  const notes=state.noteNavigation?state.notes||[]:[...(state.notes||[])].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));

  for(const note of notes)if(!placed.has(note.id))nav.nodes.push({id:note.id,type:'note',parentId:null});

  return noteNavigationSchema.parse(nav);
}

export function materializeNoteNavigation(state:Workspace):Workspace {return {...state,noteNavigation:resolveNoteNavigation(state)};}

export function applyNoteNavigation(state:Workspace,nav:NoteNavigation):Workspace {
  const parsed=noteNavigationSchema.parse(nav),issue=noteNavigationIssues(parsed,(state.notes||[]).map(n=>n.id))[0];

if(issue)throw new Error(issue);

  return materializeNoteNavigation({...state,noteNavigation:parsed});
}

/** Transient presentation adapter for the existing document tree, never inserted into works[]. */
export function noteTreeWork(state:Workspace):Work {
  return {id:state.id,title:'노트',subtitle:'',description:'',form:'단편',documents:(state.notes||[]).map(noteDocument),navigation:asDocumentNavigation(resolveNoteNavigation(state)),publications:[],activePublicationId:null};
}

export function editNoteTree(state:Workspace,edit:(work:Work)=>Work):Workspace {
  return applyNoteNavigation(state,asNoteNavigation(edit(noteTreeWork(state)).navigation!));
}

export function moveNote(state:Workspace,id:string,to:NoteDestination):Workspace {return editNoteTree(state,work=>moveNavigation(work,id,{...to,sectionId:'notes'}));}

export function treeDestination(to:DocumentDestination):NoteDestination {if(to.sectionId!=='notes')throw new Error('노트의 위치를 확인하세요.');

return {parentId:to.parentId,beforeId:to.beforeId};}
