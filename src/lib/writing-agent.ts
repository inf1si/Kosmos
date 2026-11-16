import { z } from 'zod';
import { documentSchema, noteSchema, workspaceSchema, plainText, fromText, newDocument, statuses, wikiReferences, type Workspace, type RichNode } from './model';
import { internalReferences } from './internal-reference-node';
import { referenceTargets } from './internal-references';
import { applySuggestion } from './ai';
import { insertDocument, insertFolder, moveNavigation, resolveNavigation } from './document-navigation';
import { addNote, newNote } from './personal-notes';
import { applyNoteNavigation, editNoteTree, moveNote, notesInSpace, resolveNoteNavigation } from './note-navigation';
import { providerSchema,vertexModelIdSchema } from './ai-provider';
import { reasoningLevelSchema } from './ai-reasoning';

export const agentScopeSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('work'),id:z.uuid()}),
  z.object({kind:z.literal('notes'),id:z.union([z.literal('default'),z.uuid()])}),
]);

export type AgentScope=z.infer<typeof agentScopeSchema>;

export const agentModeSchema=z.enum(['discuss','review','execute']);

export type AgentMode=z.infer<typeof agentModeSchema>;

export const agentStateSchema=z.enum(['queued','running','completed','failed','cancelled']);

export const agentSessionInputSchema=z.object({id:z.uuid(),title:z.string().trim().min(1).max(300),scope:agentScopeSchema,mode:agentModeSchema,provider:providerSchema,web:z.boolean().optional()}).strict();

export const agentMessageInputSchema=z.object({id:z.uuid(),message:z.string().trim().min(1),focusId:z.uuid().optional(),sourceIds:z.array(z.uuid()).max(50).optional(),previous:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(20000)})).max(12).optional(),model:vertexModelIdSchema.optional(),reasoning:reasoningLevelSchema.optional(),mode:agentModeSchema,provider:providerSchema,web:z.boolean().optional()}).strict();

const destination={parentId:z.uuid().nullable(),sectionId:z.string().min(1),beforeId:z.uuid().nullable()};

export const agentOperationSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('create'),id:z.uuid(),kind:z.enum(['scene','wiki','memo']),title:z.string().max(300),text:z.string(),...destination}),
  z.object({type:z.literal('folder'),id:z.uuid(),title:z.string().trim().min(1).max(300),...destination}),
  z.object({type:z.literal('replace'),id:z.uuid(),quote:z.string().min(1),replacement:z.string()}),
  z.object({type:z.literal('insert'),id:z.uuid(),after:z.string().min(1).nullable(),text:z.string().trim().min(1)}),
  z.object({type:z.literal('rename'),id:z.uuid(),title:z.string().max(300)}),
  z.object({type:z.literal('move'),id:z.uuid(),...destination}),
  // null leaves a property as it is. Work documents have no tags and notes have only tags.
  z.object({type:z.literal('properties'),id:z.uuid(),summary:z.string().max(20000).nullable(),status:z.enum(['idea','draft','review','done']).nullable(),pov:z.string().max(200).nullable(),storyTime:z.string().max(300).nullable(),category:z.string().max(200).nullable(),tags:z.array(z.string().trim().min(1).max(40)).max(20).nullable()}),
]);

export type AgentOperation=z.infer<typeof agentOperationSchema>;

export const agentSnapshotSchema=z.object({workspaceId:z.uuid(),scope:agentScopeSchema,work:workspaceSchema.shape.works.element.nullable(),notes:z.array(noteSchema),navigation:workspaceSchema.shape.noteNavigation.unwrap().nullable()});

export type AgentSnapshot=z.infer<typeof agentSnapshotSchema>;

export const agentCitationSchema=z.object({id:z.string(),title:z.string(),url:z.string().url().refine(value=>/^https?:\/\//.test(value)).optional(),quote:z.string().optional()});

export const agentEventSchema=z.object({id:z.string(),title:z.string(),detail:z.string().optional(),sources:z.array(agentCitationSchema).optional(),searchHtml:z.string().optional()});

export type AgentEvent=z.infer<typeof agentEventSchema>;

export const agentRunSchema=z.object({id:z.uuid(),session_id:z.uuid(),owner_id:z.uuid(),workspace_id:z.uuid(),message:z.string(),provider:providerSchema,model:z.string(),mode:agentModeSchema,web:z.boolean(),status:agentStateSchema,workflow_id:z.string().nullable(),snapshot:agentSnapshotSchema,base_hash:z.string(),operations:z.array(agentOperationSchema),events:z.array(agentEventSchema),answer:z.string(),error:z.string(),usage:z.object({input:z.number(),output:z.number()}).nullable(),applied_version:z.number().nullable(),applied_hash:z.string().nullable(),reverted:z.boolean(),created_at:z.string(),updated_at:z.string()});

export type AgentRun=z.infer<typeof agentRunSchema>;

export const agentRunViewSchema=agentRunSchema.omit({snapshot:true});

export type AgentRunView=z.infer<typeof agentRunViewSchema>;

export const agentPropertyChangeSchema=z.object({name:z.string(),before:z.string(),after:z.string()});

export const agentChangesSchema=z.object({rows:z.array(z.object({id:z.uuid(),title:z.string(),before:z.string(),after:z.string(),created:z.boolean(),properties:z.array(agentPropertyChangeSchema).optional()})),structure:z.number()});

export function agentRunView(run:AgentRun):AgentRunView{const {snapshot:_snapshot,...view}=run;

return view;}

export const agentSourceOpenSchema=z.object({scope:agentScopeSchema,id:z.uuid()});

export const agentSessionSchema=agentSessionInputSchema.extend({owner_id:z.uuid(),workspace_id:z.uuid(),created_at:z.string(),updated_at:z.string()});

export type AgentSession=z.infer<typeof agentSessionSchema>;

export const agentMemorySchema=z.object({id:z.uuid(),session_id:z.uuid(),title:z.string().max(300),content:z.string(),sources:z.array(agentCitationSchema),updated_at:z.string()});

export type AgentMemory=z.infer<typeof agentMemorySchema>;

export function captureAgentScope(state:Workspace,scope:AgentScope):AgentSnapshot{
  if(scope.kind==='work'){
    const work=state.works.find(w=>w.id===scope.id);

    if(!work)throw new Error('작품을 찾지 못했습니다.');

    // Public editions and unrelated chat histories are not agent inputs.
    return {workspaceId:state.id,scope,work:{...structuredClone(work),navigation:resolveNavigation(work),publications:[],activePublicationId:null,aiConversations:undefined},notes:[],navigation:null};
  }

  const nav=resolveNoteNavigation(state),space=nav.spaces.find(s=>s.id===scope.id);

  if(!space)throw new Error('노트 작업공간을 찾지 못했습니다.');
  const sections=new Set(space.sections.map(s=>s.id));

  const spaces=scope.id==='default'?[space]:[nav.spaces.find(s=>s.id==='default')!,space];

  return {workspaceId:state.id,scope,work:null,notes:notesInSpace(state,scope.id).map(n=>({...structuredClone(n),aiMessages:undefined})),navigation:{version:1,spaces:structuredClone(spaces),nodes:structuredClone(nav.nodes.filter(n=>sections.has(n.sectionId)))}};
}

const jsonValueSchema=z.json();

function canonicalAgentJson(value:z.infer<typeof jsonValueSchema>):string{
  if(Array.isArray(value))return '['+value.map(canonicalAgentJson).join(',')+']';

  const object=z.record(z.string(),jsonValueSchema).safeParse(value);

  if(object.success)return '{'+Object.keys(object.data).sort().map(key=>JSON.stringify(key)+':'+canonicalAgentJson(object.data[key])).join(',')+'}';

  return JSON.stringify(value);
}

export async function agentHash<T>(value:T){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalAgentJson(jsonValueSchema.parse(JSON.parse(JSON.stringify(value))))));

  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}

export function agentDocuments(snapshot:AgentSnapshot){
  return snapshot.work?snapshot.work.documents.map(doc=>({id:doc.id,title:doc.title||'제목 없음',kind:doc.kind,text:plainText(doc.content),content:doc.content,properties:{chapter:doc.chapter,status:doc.status,category:doc.category,pov:doc.pov,storyTime:doc.storyTime,summary:doc.summary}})):snapshot.notes.map(note=>({id:note.id,title:note.title||'제목 없음',kind:'note',text:plainText(note.content),content:note.content,properties:{tags:note.tags.join(', ')}}));
}

/** Every other work and note space, read-only. Trashed items have left the workspace arrays, so they never appear. */
export function agentLibrary(state:Workspace,scope:AgentScope){
  const works=state.works.filter(w=>!(scope.kind==='work'&&w.id===scope.id)).flatMap(work=>agentDocuments(captureAgentScope(state,{kind:'work',id:work.id})).map(d=>({...d,place:`작품 ${work.title||'제목 없음'}`})));
  const spaces=resolveNoteNavigation(state).spaces.filter(space=>!(scope.kind==='notes'&&space.id===scope.id)).flatMap(space=>agentDocuments(captureAgentScope(state,{kind:'notes',id:space.id})).map(d=>({...d,place:`노트 ${space.title.trim()||'이름 없는 작업공간'}`})));

  return [...works,...spaces];
}

/** IDs the writer still has anywhere. Past turns and memories whose sources left the workspace stay out of the next context. */
export function agentLiveIds(state:Workspace){
  return new Set([...state.works.flatMap(w=>w.documents.map(d=>d.id)),...(state.notes||[]).map(n=>n.id)]);
}

/** One line per other work and note space, so the agent knows what it can look up outside its scope. */
export function agentLibraryMap(state:Workspace,scope:AgentScope,budget=3000){
  const lines=[...state.works.filter(w=>!(scope.kind==='work'&&w.id===scope.id)).map(w=>`- 작품 ${w.title||'제목 없음'} (${w.form}) · 문서 ${w.documents.length}개`),...resolveNoteNavigation(state).spaces.filter(s=>!(scope.kind==='notes'&&s.id===scope.id)).map(s=>`- 노트 ${s.title.trim()||'이름 없는 작업공간'} · 노트 ${notesInSpace(state,s.id).length}개`)];
  const kept:string[]=[];let used=0;

  for(const line of lines){if(used+line.length>budget)break;kept.push(line);used+=line.length+1;}

  if(kept.length<lines.length)kept.push(`(목록에 싣지 못한 곳 ${lines.length-kept.length}개는 searchLibrary로 찾는다.)`);

  return kept.join('\n')||'(다른 작품이나 노트 작업공간이 없다.)';
}

/** New paragraphs go after the one block that holds the quote, or at the end. Existing blocks keep their formatting. */
function insertBlocks(content:RichNode,after:string|null,text:string):RichNode{
  const blocks=content.content||[],added=fromText(text).content||[];

  if(after===null)return {...content,content:blocks.every(b=>b.type==='paragraph'&&!b.content?.length)?added:[...blocks,...added]};
  const hits=blocks.flatMap((block,index)=>plainText(block).includes(after)?[index]:[]);

  if(hits.length!==1)throw new Error('이어 쓸 위치의 인용이 한 문단에서만 확인되지 않습니다. 더 길게 인용하세요.');

  return {...content,content:[...blocks.slice(0,hits[0]+1),...added,...blocks.slice(hits[0]+1)]};
}

type PropertiesOperation=Extract<AgentOperation,{type:'properties'}>;

/** The document properties a properties change sets; null fields are left out. */
function documentProperties(op:PropertiesOperation){
  return Object.fromEntries((['summary','status','pov','storyTime','category'] as const).flatMap(key=>op[key]===null?[]:[[key,op[key]]]));
}

const propertyNames=new Map([['summary','요약'],['status','상태'],['pov','시점 인물'],['storyTime','작중 시각'],['category','분류'],['tags','태그']]);

const statusNames=new Map<string,string>(Object.entries(statuses));

function propertyChanges(before:Record<string,string>|undefined,after:Record<string,string>){
  return Object.keys(after).flatMap(key=>{const old=before?.[key]??'',value=after[key];

return old===value?[]:[{name:propertyNames.get(key)||key,before:key==='status'?statusNames.get(old)||old:old,after:key==='status'?statusNames.get(value)||value:value}];});
}

function scopedState(snapshot:AgentSnapshot):Workspace{
  // The temporary work is only a validator requirement for notes; it is never stored.
  const work=snapshot.work||{id:snapshot.workspaceId,title:'노트',subtitle:'',description:'',form:'단편' as const,documents:[],publications:[],activePublicationId:null};

  return {formatVersion:1,id:snapshot.workspaceId,updatedAt:'',works:[work],assets:[],notes:snapshot.notes,...snapshot.navigation&&{noteNavigation:snapshot.navigation}};
}

export function applyAgentOperations(state:Workspace,scope:AgentScope,operations:readonly AgentOperation[],now=new Date().toISOString()):Workspace{
  let next=structuredClone(state);

  for(const raw of operations){
    const op=agentOperationSchema.parse(raw);

    if(scope.kind==='work'){
      const work=next.works.find(w=>w.id===scope.id);

      if(!work)throw new Error('작품을 찾지 못했습니다.');
      const nav=resolveNavigation(work),doc=work.documents.find(d=>d.id===op.id);
      let changed=work;

      if(op.type==='create'){
        if(next.works.some(w=>w.documents.some(d=>d.id===op.id))||next.notes?.some(n=>n.id===op.id))throw new Error('이미 있는 문서입니다.');
        changed=insertDocument(work,{...newDocument(op.kind,op.title),id:op.id,content:fromText(op.text),updatedAt:now},{parentId:op.parentId,sectionId:op.sectionId,beforeId:op.beforeId||undefined});
      }else if(op.type==='folder'){
        changed=insertFolder(work,op.title,{parentId:op.parentId,sectionId:op.sectionId,beforeId:op.beforeId||undefined});
        const generated=changed.navigation!.nodes.find(n=>!nav.nodes.some(old=>old.id===n.id));

        if(!generated)throw new Error('폴더를 만들지 못했습니다.');
        changed={...changed,navigation:{...changed.navigation!,nodes:changed.navigation!.nodes.map(n=>n.id===generated.id?{...n,id:op.id}:n)}};
      }else if(op.type==='move')changed=moveNavigation(work,op.id,{parentId:op.parentId,sectionId:op.sectionId,beforeId:op.beforeId||undefined});
      else{
        if(!doc)throw new Error('허용한 문서 안에서만 수정할 수 있습니다.');

        if(op.type==='properties'&&op.tags!==null)throw new Error('작품 문서에는 태그가 없습니다. 노트에서만 태그를 고칩니다.');
        changed={...work,documents:work.documents.map(d=>d.id!==op.id?d:op.type==='rename'?{...d,title:op.title,updatedAt:now}:op.type==='properties'?{...d,...documentProperties(op),updatedAt:now}:{...d,content:op.type==='insert'?insertBlocks(d.content,op.after,op.text):applySuggestion(d.content,op.quote,op.replacement),updatedAt:now})};
      }

      next.works=next.works.map(w=>w.id===work.id?changed:w);
    }else{
      const snapshot=captureAgentScope(next,scope),note=next.notes?.find(n=>n.id===op.id);

      if('sectionId' in op&&!snapshot.navigation!.spaces!.find(s=>s.id===scope.id)!.sections.some(s=>s.id===op.sectionId))throw new Error('다른 작업공간을 수정할 수 없습니다.');

      if('parentId' in op&&op.parentId&&!snapshot.navigation!.nodes.some(n=>n.id===op.parentId))throw new Error('허용한 위치에만 문서를 만들 수 있습니다.');

      if(op.type==='create')next=addNote(next,{...newNote(),id:op.id,title:op.title,content:fromText(op.text),createdAt:now,updatedAt:now},{spaceId:scope.id,parentId:op.parentId,sectionId:op.sectionId,beforeId:op.beforeId||undefined});
      else if(op.type==='folder'){
        const before=new Set(snapshot.navigation!.nodes.map(n=>n.id));
        next=editNoteTree(next,w=>insertFolder(w,op.title,{parentId:op.parentId,sectionId:op.sectionId,beforeId:op.beforeId||undefined}),scope.id);
        const nav=resolveNoteNavigation(next),created=nav.nodes.find(n=>!before.has(n.id)&&n.type==='folder'&&n.sectionId===op.sectionId);

        if(!created)throw new Error('폴더를 만들지 못했습니다.');
        next=applyNoteNavigation(next,{...nav,nodes:nav.nodes.map(n=>n.id===created.id?{...n,id:op.id}:n)});
      }else if(op.type==='move'){
        if(!snapshot.navigation!.nodes.some(n=>n.id===op.id))throw new Error('허용한 문서 안에서만 이동할 수 있습니다.');
        const sectionIds=new Set(snapshot.navigation!.spaces!.find(s=>s.id===scope.id)!.sections.map(s=>s.id));

        if(!sectionIds.has(op.sectionId))throw new Error('다른 작업공간으로 이동할 수 없습니다.');
        next=moveNote(next,op.id,{spaceId:scope.id,parentId:op.parentId,sectionId:op.sectionId,beforeId:op.beforeId||undefined});
      }else{
        if(!note||!snapshot.notes.some(n=>n.id===op.id))throw new Error('허용한 노트 안에서만 수정할 수 있습니다.');

        if(op.type==='properties'&&Object.keys(documentProperties(op)).length)throw new Error('노트에서는 태그만 고칩니다.');
        next.notes=next.notes!.map(n=>n.id!==op.id?n:op.type==='rename'?{...n,title:op.title,updatedAt:now}:op.type==='properties'?{...n,...op.tags&&{tags:[...new Set(op.tags)]},updatedAt:now}:{...n,content:op.type==='insert'?insertBlocks(n.content,op.after,op.text):applySuggestion(n.content,op.quote,op.replacement),updatedAt:now});
      }
    }
  }

  return {...next,updatedAt:now};
}

export function agentOverlay(snapshot:AgentSnapshot,operations:readonly AgentOperation[]):AgentSnapshot{
  const state=applyAgentOperations(scopedState(snapshot),snapshot.scope,operations,'agent-preview');

  return captureAgentScope(state,snapshot.scope);
}

export function restoreAgentScope(state:Workspace,before:AgentSnapshot):Workspace{
  if(before.scope.kind==='work'){
    const current=state.works.find(w=>w.id===before.scope.id);

    if(!current||!before.work)throw new Error('작품을 찾지 못했습니다.');
    const old=before.work;

    return workspaceSchema.parse({...state,updatedAt:new Date().toISOString(),works:state.works.map(w=>w.id===old.id?{...w,documents:old.documents,navigation:old.navigation}:w)});
  }

  const current=notesInSpace(state,before.scope.id),ids=new Set(current.map(n=>n.id)),nav=resolveNoteNavigation(state),sections=new Set(before.navigation!.spaces!.find(s=>s.id===before.scope.id)!.sections.map(s=>s.id));

  return workspaceSchema.parse({...state,updatedAt:new Date().toISOString(),notes:[...(state.notes||[]).filter(n=>!ids.has(n.id)),...before.notes.map(n=>({...n,aiMessages:state.notes?.find(old=>old.id===n.id)?.aiMessages}))],noteNavigation:{...nav,nodes:[...nav.nodes.filter(n=>!sections.has(n.sectionId)),...before.navigation!.nodes]}});
}

export function validateAgentWorkspace(state:Workspace){return workspaceSchema.parse(state);}

export function agentDiff(before:AgentSnapshot,operations:readonly AgentOperation[]){
  const old=agentDocuments(before),next=agentDocuments(agentOverlay(before,operations)),rows=next.flatMap(d=>{
    // A new document is compared with a fresh one of its kind, so only the properties the agent set show.
    const previous=old.find(p=>p.id===d.id),fresh=d.kind==='note'?{tags:''}:(({chapter,status,category,pov,storyTime,summary})=>({chapter,status,category,pov,storyTime,summary}))(newDocument(d.kind==='wiki'||d.kind==='memo'?d.kind:'scene','')),properties=propertyChanges(previous?.properties||fresh,d.properties);

    return previous&&previous.title===d.title&&previous.text===d.text&&!properties.length?[]:[{id:d.id,title:d.title,before:previous?.text||'',after:d.text,created:!previous,...properties.length&&{properties}}];
  });

  return {rows,structure:operations.filter(op=>op.type==='move'||op.type==='folder').length};
}

type AgentDocument=ReturnType<typeof agentDocuments>[number];

/** Every term must occur in the title or text. Hits carry the passages around the matches so the model can read from there. */
export function agentSearch(docs:AgentDocument[],query:string,offset:number,size=30){
  const fold=(value:string)=>value.normalize('NFC').toLocaleLowerCase(),terms=fold(query).split(/\s+/).filter(Boolean);

  const hits=docs.flatMap((d,index)=>{
    const title=fold(d.title),text=fold(d.text),at:number[]=[];

    if(!terms.every(term=>title.includes(term)||text.includes(term)))return [];
    // Offsets are only handed out when folding kept the text length, so readSource can start at them.
    const exact=text.length===d.text.length,source=exact?d.text:text;

    for(const term of terms)for(let pos=text.indexOf(term);pos>=0;pos=text.indexOf(term,pos+term.length))at.push(pos);

    at.sort((a,b)=>a-b);
    const matches=at.filter((pos,i)=>i===0||pos-at[i-1]>160).slice(0,3).map(pos=>({offset:exact?Math.max(0,pos-60):null,text:source.slice(Math.max(0,pos-60),pos+160)}));

    // An empty query lists every document in its stored order.
    return [{rank:terms.length?(terms.some(term=>title.includes(term))?1e9:0)+at.length:-index,hit:{id:d.id,title:d.title,kind:d.kind,excerpt:matches[0]?.text??d.text.slice(0,240),characters:d.text.length,count:at.length,matches}}];
  }).sort((a,b)=>b.rank-a.rank).map(item=>item.hit);

  return {total:hits.length,nextOffset:offset+size<hits.length?offset+size:null,documents:hits.slice(offset,offset+size)};
}

/** The tree the writer sees, with the IDs the tools take. Long works are cut at the budget and the rest is left to search. */
export function agentMap(snapshot:AgentSnapshot,budget=16000){
  const docs=new Map(agentDocuments(snapshot).map(d=>[d.id,d])),space=snapshot.navigation?.spaces?.find(s=>s.id===snapshot.scope.id);
  const sections=snapshot.work?.navigation?.sections||space?.sections||[],nodes=snapshot.work?.navigation?.nodes||snapshot.navigation?.nodes||[];
  const lines=[snapshot.work?`작품: ${snapshot.work.title} (${snapshot.work.form})${snapshot.work.description.trim()?' · '+snapshot.work.description.trim().slice(0,300):''}`:`노트 작업공간: ${space?.title.trim()||'이름 없는 작업공간'}`],listed=new Set<string>();

  let used=lines[0].length,cut=false;

  const add=(line:string)=>{
    cut||=used+line.length>budget;

    if(!cut){lines.push(line);used+=line.length+1;}
  };

  const describe=(id:string,depth:number)=>{
    const d=docs.get(id);

    if(!d)return;
    const extra=Object.entries({시점:'pov' in d.properties?d.properties.pov:'','작중 시각':'storyTime' in d.properties?d.properties.storyTime:'',요약:'summary' in d.properties?d.properties.summary.replace(/\s+/g,' ').slice(0,80):'',태그:'tags' in d.properties?d.properties.tags:''}).filter(([,value])=>value).map(([key,value])=>` · ${key}: ${value}`).join('');
    const before=lines.length;add(`${'  '.repeat(depth)}- ${d.title} · ${d.kind} · ${d.text.length}자 · id ${d.id}${extra}`);

if(lines.length>before)listed.add(id);
  };

  const walk=(sectionId:string,parentId:string|null,depth:number)=>{
    for(const node of nodes.filter(n=>n.sectionId===sectionId&&n.parentId===parentId)){
      if(node.type==='folder'){add(`${'  '.repeat(depth)}- 폴더 ${node.title} · id ${node.id}`);walk(sectionId,node.id,depth+1);}
      else describe(node.id,depth);
    }
  };

  for(const section of sections){add(`[섹션 ${section.title} · sectionId ${section.id}]`);walk(section.id,null,0);}

  for(const id of docs.keys())if(!listed.has(id)&&!cut)describe(id,0);

  if(docs.size>listed.size)lines.push(`(지도에 싣지 못한 문서 ${docs.size-listed.size}개는 searchSources로 찾는다.)`);

  return lines.join('\n');
}

/**
 * Links out of and into one document anywhere in the workspace: wiki links inside its work and @ references across works and notes.
 * Folders, works and shelves an @ reference points at are named but have no text to read.
 */
export function agentReferences(state:Workspace,id:string){
  const targets=referenceTargets(state),readable=targets.filter(t=>(t.kind==='document'||t.kind==='note')&&t.content),source=readable.find(t=>t.targetId===id);

  if(!source)throw new Error('문서를 찾지 못했습니다. 휴지통에 있거나 지워진 문서일 수 있습니다.');
  const describe=(t:(typeof targets)[number],how:string)=>({id:t.targetId,title:t.label,place:t.path,kind:t.category,how});
  const work=state.works.find(w=>w.id===source.workId),wiki=new Set(wikiReferences(source.content!));
  const linked=(work?.documents||[]).filter(d=>wiki.has(d.id)).flatMap(d=>readable.filter(t=>t.targetId===d.id).map(t=>describe(t,'설정 연결')));

  const mentioned=internalReferences(source.content!).map(ref=>{const t=targets.find(r=>r.kind===ref.kind&&r.targetId===ref.targetId);

return t?describe(t,'@ 참조'):{id:ref.targetId,title:ref.label,place:'',kind:'찾지 못한 대상',how:'@ 참조'};});

  const outgoing=[...linked,...mentioned];

  const incoming=readable.filter(t=>t.targetId!==id).flatMap(t=>{const how=[...(t.workId&&t.workId===source.workId&&wikiReferences(t.content!).includes(id)?['설정 연결']:[]),...(internalReferences(t.content!).some(ref=>ref.targetId===id)?['@ 참조']:[])];

return how.length?[describe(t,how.join(' · '))]:[];});

  return {id,title:source.label,place:source.path,outgoing,incoming};
}

/**
 * Checks a run's staged result with code before the writer sees it: links that lead nowhere, empty new documents,
 * a point of view with no setting document, titles shared by two documents. These are warnings, not proof the work is right.
 */
export function agentValidate(state:Workspace,snapshot:AgentSnapshot,operations:readonly AgentOperation[]){
  const after=agentOverlay(snapshot,operations),docs=agentDocuments(after),before=new Map(agentDocuments(snapshot).map(d=>[d.id,d]));
  const changed=new Set(operations.flatMap(op=>'id' in op?[op.id]:[])),issues:{id:string;title:string;issue:string}[]=[];
  const live=new Set([...state.works.flatMap(w=>w.documents.map(d=>d.id)),...(state.notes||[]).map(n=>n.id),...docs.map(d=>d.id)]);
  const wikiTitles=new Set(docs.filter(d=>d.kind==='wiki').map(d=>d.title));

  for(const d of docs.filter(doc=>changed.has(doc.id))){
    const add=(issue:string)=>issues.push({id:d.id,title:d.title,issue});

    if(!before.has(d.id)&&!d.text.trim())add('새 문서의 본문이 비어 있다.');

    for(const target of wikiReferences(d.content))if(!live.has(target))add('설정 연결이 없는 문서를 가리킨다.');

    for(const ref of internalReferences(d.content))if((ref.kind==='document'||ref.kind==='note')&&!live.has(ref.targetId))add(`@ 참조 "${ref.label}"가 없는 문서를 가리킨다.`);

    if('pov' in d.properties&&d.properties.pov.trim()&&!wikiTitles.has(d.properties.pov.trim()))add(`시점 인물 "${d.properties.pov}"과 같은 제목의 설정 문서가 없다.`);

    if(d.title!=='제목 없음'&&docs.some(other=>other.id!==d.id&&other.title===d.title))add('같은 제목의 문서가 범위 안에 또 있다.');
  }

  return {checked:changed.size,issues};
}

export function richBlocks(content:RichNode){return content.content?.map((node,index)=>({index,id:z.string().safeParse(node.attrs?.blockId).data||null,text:plainText(node)}))||[];}

export const agentDocumentSchema=documentSchema;

/** Stored history is complete; only the next model context is bounded. Older turns stay readable by tool. */
export function agentContext(runs:AgentRunView[],memories:AgentMemory[],ids:Set<string>,budget=60000){
  const available=(sources:{id:string;url?:string}[])=>sources.every(source=>source.url||ids.has(source.id));
  const safeRuns=runs.filter(run=>run.status==='completed'&&run.events.every(event=>available(event.sources||[])));
  const recent:AgentRunView[]=[];let used=0;

  for(const run of safeRuns.toReversed()){const size=run.message.length+run.answer.length;

if(used+size>budget)break;recent.unshift(run);used+=size;}

  const safeMemories=memories.filter(memory=>available(memory.sources));

  return {runs:recent,allRuns:safeRuns,memories:safeMemories};
}

export const agentCommitSchema=z.object({workspace_id:z.uuid(),scope:agentScopeSchema,base_hash:z.string(),applied_hash:z.string(),applied_version:z.number()});

export type AgentCommit=z.infer<typeof agentCommitSchema>;

/**
 * Joins unsent edits on this device with the one agent commit that made the cloud copy newer.
 * Resolves to null unless the agent's scope is untouched here and the cloud scope is exactly the agent's result.
 * The returned function is synchronous so the caller can join against the newest local state in the same tick it stores it;
 * it returns null when the scope was edited in the meantime.
 */
export async function agentCommitJoiner(local:Workspace,remote:Workspace,commit:AgentCommit){
  try{
    const before=captureAgentScope(local,commit.scope),after=captureAgentScope(remote,commit.scope);

    if(await agentHash(before)!==commit.base_hash||await agentHash(after)!==commit.applied_hash)return null;

    // Revert compares against applied_hash, so the joined scope must still hash to it.
    if(await agentHash(captureAgentScope(restoreAgentScope(local,after),commit.scope))!==commit.applied_hash)return null;
    const untouched=canonicalAgentJson(jsonValueSchema.parse(JSON.parse(JSON.stringify(before)))),body=(d:{title:string;content:RichNode})=>JSON.stringify([d.title,d.content]);

    return (latest:Workspace)=>{
      try{
        const current=captureAgentScope(latest,commit.scope);

        if(canonicalAgentJson(jsonValueSchema.parse(JSON.parse(JSON.stringify(current))))!==untouched)return null;
        const old=new Map(agentDocuments(current).map(d=>[d.id,body(d)]));

        return {state:restoreAgentScope(latest,after),changed:[commit.scope.id,...agentDocuments(after).filter(d=>old.get(d.id)!==body(d)).map(d=>d.id)]};
      }catch{return null;}
    };
  }catch{return null;}
}

export const agentMemoryEditSchema=z.object({title:z.string().trim().min(1).max(300),content:z.string().trim().min(1).max(20000)}).strict();

export const agentBranchInputSchema=z.object({id:z.uuid(),from:z.uuid()}).strict();

/**
 * The memory a branched session starts with: the source conversation up to the chosen request, newest turns first kept within budget.
 * Only completed turns count, so a failed or cancelled request is not carried over as a decision.
 */
export function agentBranchMemory(title:string,runs:Pick<AgentRunView,'id'|'message'|'answer'|'status'>[],from:string,budget=8000){
  const end=runs.findIndex(run=>run.id===from);

  if(end<0)throw new Error('분기할 요청을 찾지 못했습니다.');
  const turns:string[]=[];let used=0;

  for(const run of runs.slice(0,end+1).filter(item=>item.status==='completed').toReversed()){
    const turn=`작가: ${run.message.slice(0,2000)}\n\nAI: ${run.answer.slice(0,4000)}`;

    if(turns.length&&used+turn.length>budget)break;turns.unshift(turn);used+=turn.length;
  }

  return {title:`분기 전 대화: ${title}`.slice(0,300),content:turns.join('\n\n---\n\n').slice(-budget)||'완료한 요청이 없습니다.'};
}

/** Token totals of the runs that reported usage, and how many finished runs did not. */
export function agentUsageTotal(runs:Pick<AgentRunView,'usage'|'status'>[]){
  const finished=runs.filter(run=>run.status!=='queued'&&run.status!=='running');

  return {input:finished.reduce((sum,run)=>sum+(run.usage?.input||0),0),output:finished.reduce((sum,run)=>sum+(run.usage?.output||0),0),unknown:finished.filter(run=>!run.usage).length};
}
