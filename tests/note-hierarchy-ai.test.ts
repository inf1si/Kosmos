import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../src/lib/seed';
import { fromText, plainText, uid, workspaceSchema } from '../src/lib/model';
import { addNote, newNote, patchNote, appendNoteExchange, applyNoteSuggestion, clearNoteConversation, preserveNotes, preserveNoteDetails } from '../src/lib/personal-notes';
import { applyNoteNavigation, editNoteTree, materializeNoteNavigation, moveNote, noteTreeWork, resolveNoteNavigation } from '../src/lib/note-navigation';
import { insertFolder, navigationSnapshot, restoreNavigation } from '../src/lib/document-navigation';
import { chatContext, ChatContextError } from '../src/lib/ai-chat-context';
import { chatInputSchema, type ChatMessage } from '../src/lib/ai-conversation';
import { createBackup, readBackup } from '../src/lib/backup';

function fixture(){let state=seedWorkspace();const a={...newNote(),title:'생각',content:fromText('기억을 세금으로 내는 도시')},b={...newNote(),title:'자료',content:fromText('다른 노트 자료')};state=addNote(addNote(state,a),b,{parentId:a.id});state=editNoteTree(state,w=>insertFolder(w,'참고',{sectionId:'notes',parentId:a.id}));const folder=state.noteNavigation!.nodes.find(n=>n.type==='folder')!;return {state,a,b,folder};}
function answer(version:string):Extract<ChatMessage,{role:'assistant'}>{return {id:uid(),role:'assistant',createdAt:new Date().toISOString(),version,provider:'openai',model:'synthetic-model',sources:[],result:{review:'합성 답변',suggestions:[{quote:'기억',replacement:'시간',reason:'합성 수정'}]}};}
test('노트·폴더 이동과 형제 순서는 본문·작품 소속을 바꾸지 않고 자기 하위·없는 위치를 막는다',()=>{
  let {state,a,b,folder}=fixture();const notes=structuredClone(state.notes),works=structuredClone(state.works);
  state=moveNote(state,b.id,{parentId:folder.id});state=moveNote(state,a.id,{parentId:null});assert.equal(state.noteNavigation!.nodes.find(n=>n.id===b.id)!.parentId,folder.id);
  assert.deepEqual(state.notes,notes);assert.deepEqual(state.works,works);assert.throws(()=>moveNote(state,a.id,{parentId:b.id}),/자신/);assert.throws(()=>moveNote(state,a.id,{parentId:uid()}),/위치/);
  state=moveNote(state,folder.id,{parentId:null,beforeId:a.id});assert.deepEqual(state.noteNavigation!.nodes.filter(n=>n.parentId===null).map(n=>n.id),[folder.id,a.id]);assert(workspaceSchema.safeParse(state).success);
});
test('레거시 노트는 최근 순서로 고정하고 새 본문·노트는 정리 실행 취소에도 남는다',()=>{
  const {state,a,b}=fixture(),legacy={...state};delete legacy.noteNavigation;legacy.notes![0].updatedAt='2020';legacy.notes![1].updatedAt='2021';const nav=resolveNoteNavigation(legacy);assert.deepEqual(nav.nodes.map(n=>n.id),[b.id,a.id]);
  let next=materializeNoteNavigation(legacy),snapshot=navigationSnapshot(noteTreeWork(next));next=moveNote(next,b.id,{parentId:a.id});next=patchNote(next,a.id,{content:fromText('정리 후 문장')});const c=newNote();next=addNote(next,c,{parentId:b.id});next=editNoteTree(next,w=>restoreNavigation(w,snapshot));assert.equal(plainText(next.notes![0].content),'정리 후 문장');assert(next.noteNavigation!.nodes.some(n=>n.id===c.id));assert.equal(next.noteNavigation!.nodes.find(n=>n.id===b.id)!.parentId,null);
});
test('노트 정리 스키마는 중복·유실·순환·작품 ID 충돌·25단계를 거절한다',()=>{
  const {state,a,b}=fixture();for(const mutate of [(s:typeof state)=>s.noteNavigation!.nodes.push({...s.noteNavigation!.nodes[0]}),(s:typeof state)=>{s.noteNavigation!.nodes[0].parentId=b.id;},(s:typeof state)=>{s.noteNavigation!.nodes[0].id=uid();},(s:typeof state)=>{s.noteNavigation!.nodes[0].parentId=uid();}]){const s=structuredClone(state);mutate(s);assert(!workspaceSchema.safeParse(s).success);}
  const deep={version:1 as const,nodes:Array.from({length:25},()=>({id:uid(),type:'folder' as const,title:'깊이',parentId:null as string|null}))};deep.nodes.forEach((n,i)=>n.parentId=i?deep.nodes[i-1].id:null);assert.throws(()=>applyNoteNavigation(state,deep),/24단계/);
  const collision=structuredClone(state);collision.noteNavigation!.nodes.push({id:state.works[0].id,type:'folder',title:'겹침',parentId:null});assert(!workspaceSchema.safeParse(collision).success);
});
test('노트 AI는 선택한 다른 노트·연결 작품 자료만 보내고 소속 위조·시점·길이를 검사한다',()=>{
  const {state,a,b}=fixture(),work=state.works[0],input={noteId:a.id,docId:a.id,version:a.updatedAt,provider:'openai' as const,message:'확장해줘',includeManuscript:true,sourceIds:[],history:[]};assert(chatInputSchema.safeParse(input).success);
  assert(!chatInputSchema.safeParse({...input,workId:work.id}).success);assert(!chatInputSchema.safeParse({...input,docId:b.id}).success);assert(!chatInputSchema.safeParse({...input,noteId:undefined}).success);
  assert.equal(chatContext(state,input).sources.length,0);assert.equal(chatContext(state,{...input,sourceIds:[b.id]}).input.references[0].kind,'note');assert.throws(()=>chatContext(state,{...input,sourceIds:[work.documents[0].id]}),(e:unknown)=>e instanceof ChatContextError&&e.status===400);
  const linked=patchNote(state,a.id,{linkedWorkIds:[work.id]}),updated=linked.notes!.find(n=>n.id===a.id)!;const ctx=chatContext(linked,{...input,version:updated.updatedAt,sourceIds:[b.id,work.documents[0].id]});assert.equal(ctx.sources.length,2);assert.deepEqual(ctx.sources.map(d=>d.id),[b.id,work.documents[0].id]);
  assert.throws(()=>chatContext(state,{...input,version:'stale'}),(e:unknown)=>e instanceof ChatContextError&&e.status===409);const long=structuredClone(state);long.notes![0].content=fromText('x'.repeat(12001));long.notes![1].content=fromText('r'.repeat(2000));assert.throws(()=>chatContext(long,input),(e:unknown)=>e instanceof ChatContextError&&e.status===413);const excluded=chatContext(long,{...input,includeManuscript:false,sourceIds:[b.id]});assert.equal(excluded.input.manuscript,'');assert.equal(excluded.input.references[0].text.length,1800);
});
test('노트 AI 질문·답변은 한 쌍으로 저장하며 정확한 시점만 적용하고 명시적으로 비운다',()=>{
  const {state,a}=fixture(),reply=answer(a.updatedAt),next=appendNoteExchange(state,a.id,0,'질문',reply);assert.equal(next.notes![0].updatedAt,a.updatedAt);assert.equal(next.notes![0].aiMessages!.length,2);assert.equal(next.notes![1].aiMessages,undefined);
  assert.throws(()=>appendNoteExchange(next,a.id,0,'질문',reply),/다른 창/);const applied=applyNoteSuggestion(next,a.id,reply,0);assert.equal(plainText(applied.notes![0].content),'시간을 세금으로 내는 도시');assert.equal(plainText(applied.notes![1].content),'다른 노트 자료');assert.throws(()=>applyNoteSuggestion(patchNote(next,a.id,{content:fromText('다른 내용')}),a.id,reply,0),/바뀌/);assert.deepEqual(clearNoteConversation(next,a.id).notes![0].aiMessages,[]);assert(workspaceSchema.safeParse(next).success);
});
test('이전 백업은 공통 노트의 계층·AI를 유지하며 새 ZIP·이력은 정확히 왕복한다',async()=>{
  const {state,a,b}=fixture(),saved=appendNoteExchange(state,a.id,0,'질문',answer(a.updatedAt));const legacy=structuredClone(saved);delete legacy.noteNavigation;delete legacy.notes![0].aiMessages;legacy.notes=legacy.notes!.filter(n=>n.id===a.id);const kept=preserveNoteDetails(legacy,saved);assert.deepEqual(kept.notes![0].aiMessages,saved.notes![0].aiMessages);assert(kept.noteNavigation!.nodes.some(n=>n.type==='folder'));assert(!kept.noteNavigation!.nodes.some(n=>n.id===b.id));
  const old={...saved};delete old.notes;delete old.noteNavigation;const preserved=preserveNoteDetails(preserveNotes(old,saved),saved);assert.deepEqual(preserved.noteNavigation,saved.noteNavigation);
  const zip=await createBackup(saved,[{id:uid(),namespace:'test',label:'노트',createdAt:saved.updatedAt,data:saved}],[]),roundtrip=await readBackup(zip);assert.deepEqual(roundtrip.data,saved);assert.deepEqual(roundtrip.revisions[0].data.noteNavigation,saved.noteNavigation);assert.deepEqual(roundtrip.revisions[0].data.notes![0].aiMessages,saved.notes![0].aiMessages);
});
test('실제 보호 SQL은 이전 탭의 계층·AI 누락과 순환을 막고 정상 저장·명시적 복원을 허용한다',async()=>{
  const pg=new PGlite();try{await pg.exec('create role anon; create role authenticated; create table public.workspaces (id integer primary key, payload jsonb not null);');await pg.exec(readFileSync(new URL('../supabase/migrations/20261004074609_note_hierarchy_ai_guard.sql',import.meta.url),'utf8'));const {state,a}=fixture(),saved=appendNoteExchange(state,a.id,0,'질문',answer(a.updatedAt));await pg.query('insert into workspaces values (1,$1)',[JSON.stringify(saved)]);
  const missing={...saved};delete missing.noteNavigation;await assert.rejects(()=>pg.query('update workspaces set payload=$1',[JSON.stringify(missing)]),/정리 구조/);const missingAI=structuredClone(saved);delete missingAI.notes![0].aiMessages;await assert.rejects(()=>pg.query('update workspaces set payload=$1',[JSON.stringify(missingAI)]),/AI 대화/);const cycle=structuredClone(saved);cycle.noteNavigation!.nodes[0].parentId=a.id;await assert.rejects(()=>pg.query('update workspaces set payload=$1',[JSON.stringify(cycle)]),/자신/);await pg.query('update workspaces set payload=$1',[JSON.stringify({...saved,notes:[],noteNavigation:{version:1,nodes:[]}})]);await pg.query('update workspaces set payload=$1',[JSON.stringify(saved)]);assert.deepEqual((await pg.query<{payload:typeof saved}>('select payload from workspaces')).rows[0].payload,saved);
  }finally{await pg.close();}
});

test('노트 대화 API는 인증·서버 노트·선택 자료·공유 예산·제공자 응답을 연결한다',async()=>{
  const { POST }=await import('../src/app/api/ai/chat/route');
  const {state,a,b}=fixture(),environment={NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon-key',OPENAI_API_KEY:'synthetic-key',OPENAI_MODEL:'synthetic-model'};
  const before=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]])),previousFetch=globalThis.fetch;
  let budget=0,captured:Record<string,unknown>|undefined;
  Object.assign(process.env,environment);
  globalThis.fetch=(async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url.endsWith('/auth/v1/user'))return Response.json({id:state.id,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid'});
    if(url.includes('/rest/v1/authors'))return Response.json([{user_id:state.id}]);
    if(url.includes('/rest/v1/workspaces'))return Response.json({payload:state});
    if(url.endsWith('/rpc/reserve_ai_call')){budget++;return Response.json(budget);}
    if(url==='https://api.openai.com/v1/responses'){const body=JSON.parse(String(init?.body));captured=JSON.parse(body.input.at(-1).content);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer(a.updatedAt).result)}]}]});}
    throw new Error('Unexpected synthetic request');
  }) as typeof fetch;
  const input={noteId:a.id,docId:a.id,version:a.updatedAt,provider:'openai',message:'아이디어 확장',includeManuscript:true,sourceIds:[b.id],history:[]};
  const request=(patch={})=>new Request('http://localhost/api/ai/chat',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify({...input,...patch})});
  try{
    const response=await POST(request());assert.equal(response.status,200);const body=await response.json();assert.equal(body.version,a.updatedAt);assert.equal(body.sources[0].id,b.id);assert.equal(budget,1);assert.equal(captured!.form,'개인 노트');assert.equal(captured!.manuscript,'기억을 세금으로 내는 도시');assert.equal((captured!.references as unknown[]).length,1);
    assert.equal((await POST(request({sourceIds:[state.works[0].documents[0].id]}))).status,400);assert.equal(budget,1);
    const excluded=await POST(request({includeManuscript:false}));assert.equal(excluded.status,200);assert.deepEqual((await excluded.json()).result.suggestions,[]);assert.equal(captured!.manuscript,'');assert.equal(budget,2);
  }finally{globalThis.fetch=previousFetch;for(const [key,value] of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
