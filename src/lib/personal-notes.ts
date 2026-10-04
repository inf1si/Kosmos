import { fromText, newDocument, noteSchema, plainText, uid, workspaceSchema, type NovelDocument, type PersonalNote, type Workspace } from './model';
import { applySuggestion } from './ai';
import type { ChatMessage } from './ai-conversation';
import { materializeNoteNavigation, moveNote, noteDocument, noteTitle, type NoteDestination } from './note-navigation';
export { noteTitle, noteDocument } from './note-navigation';
import { insertDocument } from './document-navigation';

export function newNote():PersonalNote {
  const now=new Date().toISOString();
  return {id:uid(),title:'',content:fromText(''),tags:[],box:'inbox',linkedWorkIds:[],assetIds:[],createdAt:now,updatedAt:now};
}
export function addNote(state:Workspace,note=newNote(),to?:NoteDestination):Workspace {
  if((state.notes?.length||0)>=5000)throw new Error('노트는 최대 5,000개까지 보관할 수 있습니다.');
  const base=materializeNoteNavigation(state),next=materializeNoteNavigation({...base,notes:[...(state.notes||[]),noteSchema.parse(note)]});
  return moveNote(next,note.id,to||{parentId:null,beforeId:base.noteNavigation?.nodes.find(n=>n.parentId===null)?.id});
}
export function patchNote(state:Workspace,id:string,patch:Partial<Pick<PersonalNote,'title'|'content'|'tags'|'box'|'linkedWorkIds'>>):Workspace {
  if(!state.notes?.some(note=>note.id===id))throw new Error('노트를 찾지 못했습니다.');
  if(patch.linkedWorkIds?.some(id=>!state.works.some(work=>work.id===id)))throw new Error('연결할 작품을 찾지 못했습니다.');
  return {...state,notes:state.notes.map(note=>note.id===id?noteSchema.parse({...note,...patch,updatedAt:new Date().toISOString()}):note)};
}
export function filterNotes(notes:PersonalNote[],filter:{query?:string;box?:PersonalNote['box']|'all';tag?:string;workId?:string}):PersonalNote[] {
  const words=(filter.query||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return notes.filter(note=>{
    if(filter.box&&filter.box!=='all'&&note.box!==filter.box)return false;
    if(filter.tag&&!note.tags.includes(filter.tag))return false;
    if(filter.workId&&!note.linkedWorkIds.includes(filter.workId))return false;
    const text=[note.title,plainText(note.content),...note.tags].join('\n').toLocaleLowerCase();
    return words.every(word=>text.includes(word));
  }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
}
/** Older backups omit notes. Preserve them and their assets without keeping dangling work links. */
export function preserveNotes(candidate:Workspace,previous:Workspace):Workspace {
  if(candidate.notes!==undefined||previous.notes===undefined)return candidate;
  const works=new Set(candidate.works.map(work=>work.id));
  const notes=structuredClone(previous.notes).map(note=>({...note,linkedWorkIds:note.linkedWorkIds.filter(id=>works.has(id))}));
  const noteIds=new Set(notes.map(note=>note.id));
  const assets=previous.assets.filter(asset=>asset.noteId&&noteIds.has(asset.noteId));
  return {...candidate,notes,noteNavigation:previous.noteNavigation,assets:[...candidate.assets.filter(asset=>!assets.some(old=>old.id===asset.id)),...structuredClone(assets)]};
}
/** Copy content and attachments into a new private work document; the independent source stays intact. */
export function prepareNoteCopy(state:Workspace,noteId:string,workId:string,kind:NovelDocument['kind']) {
  const note=state.notes?.find(n=>n.id===noteId),work=state.works.find(w=>w.id===workId);
  if(!note||!work)throw new Error('노트와 대상 작품을 확인하세요.');
  if(work.documents.length>=5000)throw new Error('작품의 문서는 최대 5,000개까지 추가할 수 있습니다.');
  const doc=newDocument(kind,noteTitle(note));doc.content=structuredClone(note.content);
  const allowed=new Set(work.documents.filter(d=>d.kind==='wiki').map(d=>d.id));
  function renew(node:typeof doc.content){
    if(node.attrs?.blockId)node.attrs.blockId=uid();
    if(node.type==='footnote'&&node.attrs)node.attrs.noteId=uid();
    if(node.marks)node.marks=node.marks.filter(mark=>mark.type!=='wikiLink'||allowed.has(String(mark.attrs?.targetId)));
    node.content?.forEach(renew);
  }
  renew(doc.content);
  if(kind==='scene')doc.chapter=work.documents.findLast(d=>d.kind==='scene')?.chapter||'제1부';
  const copies=note.assetIds.map(sourceId=>({sourceId,id:uid()}));doc.assetIds=copies.map(copy=>copy.id);
  const assets=copies.map(copy=>{const meta=state.assets.find(a=>a.id===copy.sourceId&&a.noteId===note.id);if(!meta)throw new Error('노트 첨부를 찾지 못했습니다.');return {id:copy.id,workId,name:meta.name,type:meta.type,size:meta.size};});
  const result={...state,assets:[...state.assets,...assets],works:state.works.map(w=>w.id===workId?insertDocument(w,doc):w),notes:(state.notes||[]).map(n=>n.id===noteId?{...n,linkedWorkIds:[...new Set([...n.linkedWorkIds,workId])],updatedAt:new Date().toISOString()}:n)};
  return {state:workspaceSchema.parse(result),docId:doc.id,copies};
}

/** Old backups retain matching notes' organization and AI records; explicit fields restore exactly. */
export function preserveNoteDetails(candidate:Workspace,previous:Workspace):Workspace {
  const old=new Map((previous.notes||[]).map(n=>[n.id,n]));
  let result={...candidate,notes:candidate.notes?.map(n=>n.aiMessages===undefined&&old.get(n.id)?.aiMessages!==undefined?{...n,aiMessages:structuredClone(old.get(n.id)!.aiMessages)}:n)};
  if(candidate.noteNavigation===undefined&&previous.noteNavigation&&candidate.notes?.some(n=>old.has(n.id))){
    const ids=new Set((candidate.notes||[]).map(n=>n.id));
    const nav=structuredClone(previous.noteNavigation);nav.nodes=nav.nodes.filter(n=>n.type==='folder'||ids.has(n.id));
    const kept=new Set(nav.nodes.map(n=>n.id));for(const n of nav.nodes)if(n.parentId&&!kept.has(n.parentId))n.parentId=null;
    result={...result,noteNavigation:nav};
  }
  return materializeNoteNavigation(result);
}

export function noteAISources(state:Workspace,noteId:string):NovelDocument[] {
  const note=state.notes?.find(n=>n.id===noteId);if(!note)throw new Error('노트를 찾지 못했습니다.');
  return [...(state.notes||[]).filter(n=>n.id!==noteId).map(noteDocument),...state.works.filter(w=>note.linkedWorkIds.includes(w.id)).flatMap(w=>w.documents.map(d=>({...d,title:`${w.title} / ${d.title}`.slice(0,300)})))];
}
export function appendNoteExchange(state:Workspace,id:string,expectedCount:number,question:string,answer:Extract<ChatMessage,{role:'assistant'}>):Workspace {
  const note=state.notes?.find(n=>n.id===id);if(!note)throw new Error('대화 중 노트를 찾지 못했습니다.');
  if((note.aiMessages?.length||0)!==expectedCount)throw new Error('다른 창에서 대화가 바뀌었습니다. 다시 보내세요.');
  if(!note.aiMessages?.length&&(state.notes||[]).filter(n=>n.aiMessages?.length).length>=200)throw new Error('노트 대화는 최대 200개입니다. 대화를 노트로 보관하고 새 대화를 시작하세요.');
  const aiMessages=[...(note.aiMessages||[]),{id:uid(),role:'user' as const,text:question,createdAt:new Date().toISOString()},answer];
  return {...state,notes:state.notes!.map(n=>n.id===id?noteSchema.parse({...n,aiMessages}):n)};
}
export function applyNoteSuggestion(state:Workspace,id:string,message:Extract<ChatMessage,{role:'assistant'}>,index:number):Workspace {
  const note=state.notes?.find(n=>n.id===id);if(!note)throw new Error('노트를 찾지 못했습니다.');
  if(note.updatedAt!==message.version)throw new Error('답변 이후 노트가 바뀌었습니다. 새로 질문하거나 직접 비교하세요.');
  const suggestion=message.result.suggestions[index];if(!suggestion)throw new Error('수정안을 찾지 못했습니다.');
  return patchNote(state,id,{content:applySuggestion(note.content,suggestion.quote,suggestion.replacement)});
}
export function clearNoteConversation(state:Workspace,id:string):Workspace {return {...state,notes:(state.notes||[]).map(n=>n.id===id?{...n,aiMessages:[]}:n)};}
