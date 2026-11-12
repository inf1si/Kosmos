import { z } from 'zod';
import { documentSchema, noteSchema, workspaceSchema, plainText, fromText, newDocument, type Workspace, type RichNode } from './model';
import { applySuggestion } from './ai';
import { insertDocument, insertFolder, moveNavigation, resolveNavigation } from './document-navigation';
import { addNote, newNote } from './personal-notes';
import { applyNoteNavigation, editNoteTree, moveNote, notesInSpace, resolveNoteNavigation } from './note-navigation';
import { providerSchema,vertexModelIdSchema } from './ai-provider';

export const agentScopeSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('work'),id:z.uuid()}),
  z.object({kind:z.literal('notes'),id:z.union([z.literal('default'),z.uuid()])}),
]);

export type AgentScope=z.infer<typeof agentScopeSchema>;

export const agentModeSchema=z.enum(['discuss','review','execute']);

export type AgentMode=z.infer<typeof agentModeSchema>;

export const agentStateSchema=z.enum(['queued','running','completed','failed','cancelled']);

export const agentSessionInputSchema=z.object({id:z.uuid(),title:z.string().trim().min(1).max(300),scope:agentScopeSchema,mode:agentModeSchema,provider:providerSchema,web:z.boolean()}).strict();

export const agentMessageInputSchema=z.object({id:z.uuid(),message:z.string().trim().min(1),model:vertexModelIdSchema.optional(),mode:agentModeSchema,provider:providerSchema,web:z.boolean()}).strict();

const destination={parentId:z.uuid().nullable(),sectionId:z.string().min(1),beforeId:z.uuid().nullable()};

export const agentOperationSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('create'),id:z.uuid(),kind:z.enum(['scene','wiki','memo']),title:z.string().max(300),text:z.string(),...destination}),
  z.object({type:z.literal('folder'),id:z.uuid(),title:z.string().trim().min(1).max(300),...destination}),
  z.object({type:z.literal('replace'),id:z.uuid(),quote:z.string().min(1),replacement:z.string()}),
  z.object({type:z.literal('rename'),id:z.uuid(),title:z.string().max(300)}),
  z.object({type:z.literal('move'),id:z.uuid(),...destination}),
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

export const agentChangesSchema=z.object({rows:z.array(z.object({id:z.uuid(),title:z.string(),before:z.string(),after:z.string(),created:z.boolean()})),structure:z.number()});

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
  return snapshot.work?snapshot.work.documents.map(doc=>({id:doc.id,title:doc.title||'제목 없음',kind:doc.kind,text:plainText(doc.content),content:doc.content})):snapshot.notes.map(note=>({id:note.id,title:note.title||'제목 없음',kind:'note',text:plainText(note.content),content:note.content}));
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
        changed={...work,documents:work.documents.map(d=>d.id!==op.id?d:op.type==='rename'?{...d,title:op.title,updatedAt:now}:{...d,content:applySuggestion(d.content,op.quote,op.replacement),updatedAt:now})};
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
        next.notes=next.notes!.map(n=>n.id!==op.id?n:op.type==='rename'?{...n,title:op.title,updatedAt:now}:{...n,content:applySuggestion(n.content,op.quote,op.replacement),updatedAt:now});
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
    const previous=old.find(p=>p.id===d.id);

    return previous&&previous.title===d.title&&previous.text===d.text?[]:[{id:d.id,title:d.title,before:previous?.text||'',after:d.text,created:!previous}];
  });

  return {rows,structure:operations.filter(op=>op.type==='move'||op.type==='folder').length};
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
