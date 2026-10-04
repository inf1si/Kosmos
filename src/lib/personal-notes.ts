import { fromText, newDocument, noteSchema, plainText, uid, workspaceSchema, type NovelDocument, type PersonalNote, type Workspace } from './model';
import { insertDocument } from './document-navigation';

export function newNote():PersonalNote {
  const now=new Date().toISOString();
  return {id:uid(),title:'',content:fromText(''),tags:[],box:'inbox',linkedWorkIds:[],assetIds:[],createdAt:now,updatedAt:now};
}
export function noteTitle(note:PersonalNote):string {
  return note.title.trim()||plainText(note.content).split('\n').map(line=>line.trim()).find(Boolean)?.slice(0,80)||'새 노트';
}
export function noteDocument(note:PersonalNote):NovelDocument {
  return {id:note.id,kind:'memo',title:noteTitle(note),content:note.content,chapter:'',summary:'',status:'idea',category:'',pov:'',storyTime:'',isPublic:false,publicSummary:'',assetIds:note.assetIds,updatedAt:note.updatedAt};
}
export function addNote(state:Workspace,note=newNote()):Workspace {
  if((state.notes?.length||0)>=5000)throw new Error('노트는 최대 5,000개까지 보관할 수 있습니다.');
  return {...state,notes:[...(state.notes||[]),noteSchema.parse(note)]};
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
  return {...candidate,notes,assets:[...candidate.assets.filter(asset=>!assets.some(old=>old.id===asset.id)),...structuredClone(assets)]};
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
