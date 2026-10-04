import { fromText, newDocument, noteSchema, plainText, uid, wikiReferences, workspaceSchema, type AssetMeta, type NovelDocument, type PersonalNote, type RichNode, type Work, type Workspace } from './model';
import { applySuggestion } from './ai';
import type { ChatMessage } from './ai-conversation';
import { applyNoteNavigation, materializeNoteNavigation, moveNote, noteDocument, noteTitle, resolveNoteNavigation, type NoteDestination } from './note-navigation';
import { noteTemplates, templateContent } from './note-templates';
export { noteTitle, noteDocument } from './note-navigation';
import { applyNavigation, defaultSections, insertDocument, type DocumentNavigation } from './document-navigation';
import type { ImportBundle } from './interchange';

export function newNote():PersonalNote {
  const now=new Date().toISOString();
  return {id:uid(),title:'',content:fromText(''),tags:[],box:'inbox',linkedWorkIds:[],assetIds:[],createdAt:now,updatedAt:now};
}
/** A quick capture keeps each non-empty line as its own paragraph; the first line becomes the list title. */
export function noteFromText(text:string):PersonalNote {
  const note=newNote(),lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  note.content={type:'doc',content:(lines.length?lines:['']).map(line=>({type:'paragraph',attrs:{blockId:uid()},content:line?[{type:'text',text:line}]:[]}))};
  return note;
}
/** The first body line that is not already shown as the list title. */
export function noteSnippet(note:PersonalNote):string {
  const lines=plainText(note.content).split('\n').map(line=>line.trim()).filter(Boolean);
  const rest=note.title.trim()?lines:lines.slice(1);
  return (rest[0]||'').slice(0,120);
}
/** Same-year dates drop the year: "10월 4일"; older ones keep it: "2025. 3. 2.". */
export function noteDate(iso:string,now=new Date()):string {
  const date=new Date(iso);if(Number.isNaN(date.getTime()))return '';
  return date.getFullYear()===now.getFullYear()?`${date.getMonth()+1}월 ${date.getDate()}일`:`${date.getFullYear()}. ${date.getMonth()+1}. ${date.getDate()}.`;
}
export function noteFromTemplate(id:string):PersonalNote {
  const template=noteTemplates.find(t=>t.id===id);if(!template)throw new Error('템플릿을 찾지 못했습니다.');
  return {...newNote(),title:template.title,content:templateContent(template)};
}
export type NoteBoardColumn={folderId:string|null;title:string;notes:PersonalNote[]};
/** One column per top-level folder plus notes outside folders; each column lists its notes in tree order. */
export function noteBoardColumns(state:Workspace):NoteBoardColumn[] {
  const nav=resolveNoteNavigation(state),byId=new Map((state.notes||[]).map(n=>[n.id,n]));
  const children=new Map<string|null,typeof nav.nodes>();for(const node of nav.nodes)children.set(node.parentId,[...(children.get(node.parentId)||[]),node]);
  const collect=(id:string,out:PersonalNote[])=>{for(const child of children.get(id)||[]){const note=byId.get(child.id);if(note)out.push(note);collect(child.id,out);}return out;};
  const root:NoteBoardColumn={folderId:null,title:'폴더 밖',notes:[]},folders:NoteBoardColumn[]=[];
  for(const node of children.get(null)||[]){
    if(node.type==='folder')folders.push({folderId:node.id,title:node.title,notes:collect(node.id,[])});
    else{const note=byId.get(node.id);if(note)root.notes.push(note);collect(node.id,root.notes);}
  }
  return [...folders,root];
}
/** Notes whose body links to this note, most recently edited first. */
export function noteBacklinks(notes:PersonalNote[],id:string):PersonalNote[] {
  return notes.filter(n=>n.id!==id&&wikiReferences(n.content).includes(id)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function addNote(state:Workspace,note=newNote(),to?:NoteDestination):Workspace {
  if((state.notes?.length||0)>=5000)throw new Error('노트는 최대 5,000개까지 보관할 수 있습니다.');
  const base=materializeNoteNavigation(state),next=materializeNoteNavigation({...base,notes:[...(state.notes||[]),noteSchema.parse(note)]});
  return moveNote(next,note.id,to||{parentId:null,beforeId:base.noteNavigation?.nodes.find(n=>n.parentId===null)?.id});
}
export function patchNote(state:Workspace,id:string,patch:Partial<Pick<PersonalNote,'title'|'content'|'tags'|'box'|'linkedWorkIds'|'pinned'>>):Workspace {
  if(!state.notes?.some(note=>note.id===id))throw new Error('노트를 찾지 못했습니다.');
  if(patch.linkedWorkIds?.some(id=>!state.works.some(work=>work.id===id)))throw new Error('연결할 작품을 찾지 못했습니다.');
  // Pinning is a view preference and keeps the note's edit time.
  const touched=Object.keys(patch).some(key=>key!=='pinned');
  return {...state,notes:state.notes.map(note=>note.id===id?noteSchema.parse({...note,...patch,updatedAt:touched?new Date().toISOString():note.updatedAt}):note)};
}
/** Remove only this note; promote its direct children into its previous sibling position. */
export function removeNote(state:Workspace,id:string):Workspace {
  if(!state.notes?.some(note=>note.id===id))throw new Error('삭제할 노트를 찾지 못했습니다.');
  const base=materializeNoteNavigation(state),nav=base.noteNavigation!,node=nav.nodes.find(n=>n.id===id)!;
  const children=nav.nodes.filter(n=>n.parentId===id).map(n=>({...n,parentId:node.parentId}));
  const nodes=nav.nodes.flatMap(n=>n.id===id?children:n.parentId===id?[]:[n]);
  return applyNoteNavigation({...base,notes:base.notes!.filter(note=>note.id!==id),assets:base.assets.filter(asset=>asset.noteId!==id)},{...nav,nodes});
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
/**
 * A work document cannot hold note-only blocks: links stay only when they point at the work's settings,
 * checklists become bullet lists and body images become a text line (the image itself is copied as an attachment).
 */
export function noteContentForWork(content:RichNode,allowedWiki:Set<string>,assets:Workspace['assets']):RichNode {
  const copy=structuredClone(content);
  function convert(node:RichNode):RichNode {
    if(node.type==='noteImage'){const name=assets.find(a=>a.id===node.attrs?.assetId)?.name||'이미지';return {type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:`[이미지: ${name}]`}]};}
    const next:RichNode={...node,type:node.type==='taskList'?'bulletList':node.type==='taskItem'?'listItem':node.type};
    if(node.type==='taskItem'){const {checked:_,...attrs}=node.attrs||{};next.attrs=Object.keys(attrs).length?attrs:undefined;}
    if(next.attrs?.blockId)next.attrs={...next.attrs,blockId:uid()};
    if(next.type==='footnote'&&next.attrs)next.attrs={...next.attrs,noteId:uid()};
    if(next.marks)next.marks=next.marks.filter(mark=>mark.type!=='wikiLink'||allowedWiki.has(String(mark.attrs?.targetId)));
    if(next.content)next.content=next.content.map(convert);
    return next;
  }
  return convert(copy);
}
/** Copy content and attachments into a new private work document; the independent source stays intact. */
export function prepareNoteCopy(state:Workspace,noteId:string,workId:string,kind:NovelDocument['kind']) {
  const note=state.notes?.find(n=>n.id===noteId),work=state.works.find(w=>w.id===workId);
  if(!note||!work)throw new Error('노트와 대상 작품을 확인하세요.');
  if(work.documents.length>=5000)throw new Error('작품의 문서는 최대 5,000개까지 추가할 수 있습니다.');
  const doc=newDocument(kind,noteTitle(note));
  doc.content=noteContentForWork(note.content,new Set(work.documents.filter(d=>d.kind==='wiki').map(d=>d.id)),state.assets);
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

/**
 * A folder of ideas becomes a new work: each note is copied to a memo document and sub-folders stay folders under
 * 메모 · 리서치. Notes keep their originals and gain a link to the new work.
 */
export function prepareFolderWork(state:Workspace,folderId:string,target:{title:string;form:Work['form']}) {
  const nav=resolveNoteNavigation(state),folder=nav.nodes.find(n=>n.id===folderId&&n.type==='folder');
  if(!folder||folder.type!=='folder')throw new Error('폴더를 찾지 못했습니다.');
  if(state.works.length>=100)throw new Error('작품은 최대 100개까지 만들 수 있습니다.');
  const title=target.title.trim();if(!title)throw new Error('작품 제목을 입력하세요.');
  const byId=new Map((state.notes||[]).map(n=>[n.id,n])),workId=uid(),ids=new Map<string,string>(),copies:{sourceId:string;id:string}[]=[];
  const documents:NovelDocument[]=[],assets:AssetMeta[]=[],workNav:DocumentNavigation={version:1,sections:structuredClone(defaultSections),nodes:[]};
  const visit=(parentId:string,parent:string|null)=>{for(const node of nav.nodes.filter(n=>n.parentId===parentId)){
    const id=uid();ids.set(node.id,id);
    if(node.type==='folder')workNav.nodes.push({id,type:'folder',title:node.title,sectionId:'memo',parentId:parent});
    else{const note=byId.get(node.id);if(!note)continue;const doc=newDocument('memo',noteTitle(note));doc.id=id;doc.content=noteContentForWork(note.content,new Set(),state.assets);
      for(const sourceId of note.assetIds){const meta=state.assets.find(a=>a.id===sourceId);if(!meta)continue;const copy={sourceId,id:uid()};copies.push(copy);doc.assetIds.push(copy.id);assets.push({id:copy.id,workId,name:meta.name,type:meta.type,size:meta.size});}
      documents.push(doc);workNav.nodes.push({id,type:'document',sectionId:'memo',parentId:parent});}
    visit(node.id,id);
  }};
  visit(folderId,null);
  if(!documents.length)throw new Error('폴더에 노트가 없습니다.');
  const work=applyNavigation({id:workId,title:title.slice(0,300),form:target.form,subtitle:'',description:'',documents,publications:[],activePublicationId:null},workNav);
  const noteIds=new Set([...ids.keys()].filter(id=>byId.has(id)));
  const result={...state,works:[...state.works,work],assets:[...state.assets,...assets],notes:(state.notes||[]).map(n=>noteIds.has(n.id)?{...n,linkedWorkIds:[...new Set([...n.linkedWorkIds,workId])]}:n)};
  return {state:workspaceSchema.parse(result),workId,copies};
}

const enexDate=(value?:string)=>{const m=value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])).toISOString():undefined;};
const inlineText=(node:RichNode)=>(node.content||[]).map(c=>c.type==='text'?c.text||'':'').join('');
/**
 * Imported HTML/ENEX keeps checkboxes as ☐/☑ text and images as [첨부: name]. In notes they become a checklist and
 * in-body images again; block and footnote ids are renewed so repeated imports never collide.
 */
export function noteImportContent(content:RichNode,images:Map<string,string>):RichNode {
  const blocks=(nodes:RichNode[]):RichNode[]=>{
    const out:RichNode[]=[];
    for(const raw of nodes){
      const node=renew(raw),text=node.type==='paragraph'?inlineText(node).trim():'';
      const image=text.match(/^\[첨부: (.+)\]$/),todo=node.type==='paragraph'&&/^[☐☑] /.test(inlineText(node));
      if(image&&images.has(image[1])){out.push({type:'noteImage',attrs:{assetId:images.get(image[1]),alt:image[1]}});continue;}
      if(todo){
        const checked=inlineText(node).startsWith('☑');let cut=false;
        const inner=(node.content||[]).map(c=>{if(cut||c.type!=='text')return c;cut=true;const rest=(c.text||'').replace(/^[☐☑] /,'');return {...c,text:rest};}).filter(c=>c.type!=='text'||c.text);
        const item:RichNode={type:'taskItem',attrs:{checked},content:[{...node,content:inner.length?inner:undefined}]};
        const last=out.at(-1);if(last?.type==='taskList')last.content!.push(item);else out.push({type:'taskList',content:[item]});continue;
      }
      out.push(node.content&&node.type!=='paragraph'&&node.type!=='heading'?{...node,content:blocks(node.content)}:node);
    }
    return out;
  };
  const renew=(node:RichNode):RichNode=>{
    const next:RichNode={...node};
    if(next.attrs?.blockId)next.attrs={...next.attrs,blockId:uid()};
    if(next.type==='footnote'&&next.attrs)next.attrs={...next.attrs,noteId:uid()};
    if(next.marks)next.marks=next.marks.filter(mark=>mark.type!=='wikiLink');
    if(next.content&&(next.type==='paragraph'||next.type==='heading'))next.content=next.content.map(renew);
    return next;
  };
  // The editor keeps a paragraph after a trailing list or image; adding it here keeps opening a note from changing it.
  const result=blocks(content.content||[]);if(result.at(-1)?.type!=='paragraph')result.push({type:'paragraph',attrs:{blockId:uid()}});
  return {...content,content:result};
}
/** Imported pages become inbox notes in one new top-level folder; Evernote tags and dates are kept. */
export function prepareNoteImport(state:Workspace,bundle:ImportBundle,folderTitle:string) {
  const title=folderTitle.trim().slice(0,300)||'가져온 노트';
  if((state.notes?.length||0)+bundle.pages.length>5000)throw new Error('노트는 최대 5,000개까지 보관할 수 있습니다.');
  const folderId=uid(),assetIds=new Map<string,string>(),assets:AssetMeta[]=[],blobs:{id:string;blob:Blob}[]=[],now=new Date().toISOString();
  const notes:PersonalNote[]=bundle.pages.map(page=>{
    const id=uid(),tags=[...new Set((page.tags||[]).map(t=>t.trim().replace(/^#+/,'').slice(0,40)).filter(Boolean))].slice(0,20);
    const ownAssets:string[]=[],images=new Map<string,string>();
    for(const key of new Set(page.assetKeys)){const asset=bundle.assets.find(a=>a.key===key);if(!asset)continue;let assetId=assetIds.get(key);if(!assetId){assetId=uid();assetIds.set(key,assetId);assets.push({id:assetId,noteId:id,name:asset.name,type:asset.blob.type as AssetMeta['type'],size:asset.blob.size});blobs.push({id:assetId,blob:asset.blob});}ownAssets.push(assetId);if(!images.has(asset.name))images.set(asset.name,assetId);}
    const content=noteImportContent(page.content,images);
    return noteSchema.parse({id,title:page.title.slice(0,300),content,tags,box:'inbox',linkedWorkIds:[],assetIds:ownAssets,createdAt:enexDate(page.created)||now,updatedAt:enexDate(page.updated)||enexDate(page.created)||now});
  });
  if(assets.length+state.assets.length>2000)throw new Error('작업 공간 첨부는 최대 2,000개입니다. 이미지가 적은 파일로 나누어 가져오세요.');
  const base=materializeNoteNavigation(state),nav=structuredClone(base.noteNavigation!);
  nav.nodes.unshift({id:folderId,type:'folder',title,parentId:null},...notes.map(n=>({id:n.id,type:'note' as const,parentId:folderId})));
  const next=applyNoteNavigation({...base,notes:[...notes,...(base.notes||[])],assets:[...base.assets,...assets],updatedAt:now},nav);
  workspaceSchema.parse(next);
  if(new TextEncoder().encode(JSON.stringify(next)).length>19000000)throw new Error('작업 공간 저장 용량(20MB)을 넘습니다. 더 적은 노트를 가져오세요.');
  return {state:next,assets:blobs,folderId,count:notes.length};
}
