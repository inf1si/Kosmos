import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../src/lib/seed';
import { fromText,plainText,uid,workspaceSchema } from '../src/lib/model';
import { addNote,newNote } from '../src/lib/personal-notes';
import { addNoteSpace,moveNote,noteSpaceFor,resolveNoteNavigation } from '../src/lib/note-navigation';
import { resolveNavigation } from '../src/lib/document-navigation';
import { captureAgentScope,agentHash,agentOverlay,agentDiff,applyAgentOperations,restoreAgentScope,agentRunSchema,agentRunView,agentContext,agentCommitJoiner,type AgentOperation } from '../src/lib/writing-agent';
import { AgentLanguageModel } from '../src/lib/agent-language-model';
import { WORKFLOW_SERIALIZE } from '@workflow/serde';
import { asSchema } from 'ai';
import { writingAgentTools } from '../src/lib/agent-tools';
import { publicAgentUrl } from '../src/lib/agent-web';

function fixture(){
  const state=seedWorkspace(),work=state.works[0],doc=work.documents[0];doc.content=fromText('달에는 낡은 관측소가 있었다.');
  const scope={kind:'work' as const,id:work.id},sectionId=resolveNavigation(work).sections[0].id;

  return {state,work,doc,scope,sectionId};
}

test('에이전트 작업본은 원본을 바꾸지 않고 생성한 문서를 다시 읽어 수정한다',()=>{
  const {state,work,scope,sectionId}=fixture(),before=structuredClone(state),id=uid(),snapshot=captureAgentScope(state,scope);
  const ops:AgentOperation[]=[{type:'create',id,kind:'memo',title:'개요',text:'관측소에 도착한다.',parentId:null,sectionId,beforeId:null},{type:'replace',id,quote:'도착한다',replacement:'돌아온다'}];
  const overlay=agentOverlay(snapshot,ops);assert.equal(plainText(overlay.work!.documents.find(d=>d.id===id)!.content),'관측소에 돌아온다.');assert.deepEqual(state,before);
  const diff=agentDiff(snapshot,ops);assert.equal(diff.rows.length,1);assert.equal(diff.rows[0].created,true);
  const applied=workspaceSchema.parse(applyAgentOperations(state,scope,ops));assert.equal(applied.works.find(w=>w.id===work.id)!.documents.length,work.documents.length+1);assert.deepEqual(applied.works.slice(1),state.works.slice(1));assert.equal(restoreAgentScope(applied,snapshot).works[0].documents[0].updatedAt,state.works[0].documents[0].updatedAt);
});

test('부분 치환은 서식·각주·다른 문서를 보존하고 모호한 인용을 거절한다',()=>{
  const {state,doc,scope}=fixture();doc.content={type:'doc',content:[{type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:'관측소',marks:[{type:'bold'}]},{type:'footnote',attrs:{id:uid(),text:'시험 각주'}},{type:'text',text:'가 보였다.'}]}]};
  const next=applyAgentOperations(state,scope,[{type:'replace',id:doc.id,quote:'관측소',replacement:'우주항'}]);
  const content=next.works[0].documents[0].content;assert.deepEqual(content.content![0].content![0].marks,[{type:'bold'}]);assert.deepEqual(content.content![0].content![1],doc.content.content![0].content![1]);assert.deepEqual(next.works[0].documents.slice(1),state.works[0].documents.slice(1));
  assert.throws(()=>applyAgentOperations(state,scope,[{type:'replace',id:doc.id,quote:'없는 인용',replacement:'다른 글'}]),/확인/);
  const repeated=structuredClone(state);repeated.works[0].documents[0].content=fromText('같은 글 같은 글');assert.throws(()=>applyAgentOperations(repeated,scope,[{type:'replace',id:doc.id,quote:'같은 글',replacement:'글'}]),/확인/);
});

test('폴더·문서를 함께 만들고 이동해도 ID와 계층을 유지한다',()=>{
  const {state,scope,doc,sectionId}=fixture(),folder=uid();
  const ops:AgentOperation[]=[{type:'folder',id:folder,title:'초안',parentId:null,sectionId,beforeId:null},{type:'move',id:doc.id,parentId:folder,sectionId,beforeId:null},{type:'rename',id:doc.id,title:''}];
  const next=workspaceSchema.parse(applyAgentOperations(state,scope,ops)),nav=resolveNavigation(next.works[0]);assert.equal(nav.nodes.find(n=>n.id===doc.id)!.parentId,folder);assert.equal(next.works[0].documents.find(d=>d.id===doc.id)!.title,'');
  assert.throws(()=>applyAgentOperations(state,scope,[{type:'move',id:doc.id,parentId:doc.id,sectionId,beforeId:null}]));
});

test('노트 공간 작업본·생성·복원은 다른 공간과 원고를 보존한다',()=>{
  let {state}=fixture();const a=newNote(),b=newNote(),spaceId=uid();state=addNote(addNote(state,a),b);state=addNoteSpace(state,'구상',spaceId);const sectionId=resolveNoteNavigation(state).spaces.find(s=>s.id===spaceId)!.sections[0].id;state=moveNote(state,a.id,{spaceId,parentId:null,sectionId});
  const scope={kind:'notes' as const,id:spaceId},snapshot=captureAgentScope(state,scope),created=uid(),folder=uid();
  const ops:AgentOperation[]=[{type:'folder',id:folder,title:'재구상',parentId:null,sectionId,beforeId:null},{type:'create',id:created,kind:'memo',title:'새 아이디어',text:'달을 떠나는 이유',parentId:folder,sectionId,beforeId:null},{type:'rename',id:a.id,title:'다시 생각한 제목'}];
  assert.equal(agentOverlay(snapshot,ops).notes.length,2);const next=workspaceSchema.parse(applyAgentOperations(state,scope,ops));assert.equal(noteSpaceFor(next,created),spaceId);assert.deepEqual(next.works,state.works);assert.deepEqual(next.notes!.find(n=>n.id===b.id),b);
  const restored=restoreAgentScope(next,snapshot);assert.equal(restored.notes!.length,state.notes!.length);assert.deepEqual(restored.notes!.find(n=>n.id===b.id),b);assert.deepEqual(restored.works,state.works);
  assert.throws(()=>applyAgentOperations(state,scope,[{type:'rename',id:b.id,title:'침범'}]),/허용/);
  assert.throws(()=>applyAgentOperations(state,scope,[{type:'create',id:uid(),kind:'memo',title:'침범',text:'',parentId:null,sectionId:'notes',beforeId:null}]),/다른 작업공간/);
});

test('원고 변경은 해시를 바꾸며 공개판·AI 기록은 자료와 응답에서 제외한다',async()=>{
  const {state,scope}=fixture(),snapshot=captureAgentScope(state,scope),hash=await agentHash(snapshot);
  assert.equal(snapshot.work!.publications.length,0);assert.equal(snapshot.work!.activePublicationId,null);assert.equal(snapshot.work!.aiConversations,undefined);
  assert.equal(await agentHash(JSON.parse(JSON.stringify(snapshot))),hash);assert.equal(await agentHash({attrs:{b:2,a:1}}),await agentHash({attrs:{a:1,b:2}}));state.works[0].documents[0].content=fromText('새로운 본문');assert.notEqual(await agentHash(captureAgentScope(state,scope)),hash);
  const run=agentRunSchema.parse({id:uid(),session_id:uid(),owner_id:uid(),workspace_id:uid(),message:'질문',provider:'gemini',model:'fixture',mode:'review',web:false,status:'completed',workflow_id:null,snapshot,base_hash:hash,operations:[],events:[],answer:'대답',error:'',usage:null,applied_version:null,applied_hash:null,reverted:false,created_at:'2026-11-09',updated_at:'2026-11-09'});
  assert(!('snapshot' in agentRunView(run)));assert(!JSON.stringify(agentRunView(run)).includes('낡은 관측소'));
});

test('모델 직렬화에는 제공자·모델만 남고 키나 클라이언트가 없다',()=>{
  const model=new AgentLanguageModel('gemini','fixture-model');assert.deepEqual(AgentLanguageModel[WORKFLOW_SERIALIZE](model),{vendor:'gemini',modelId:'fixture-model'});
});

test('공개 페이지 도구는 로컬·IP·인증정보·다른 프로토콜을 거절한다',()=>{
  assert.equal(publicAgentUrl('https://example.com/paper'),'https://example.com/paper');

  for(const url of ['http://example.com','https://localhost','https://localhost.','https://foo.internal.','https://127.0.0.1','https://[::1]','file:///etc/passwd','https://secret@example.com','https://foo.internal','https://example.com:8080'])assert.throws(()=>publicAgentUrl(url));
});

test('실제 SQL은 원고 반영·복구 지점·중복 요청·충돌·취소·소유자 권한을 검사한다',async()=>{
  const db=new PGlite(),owner=uid(),other=uid(),workspaceId=uid(),sessionId=uid(),runId=uid(),{state,scope,doc}=fixture();

  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table public.authors(user_id uuid primary key);create table public.workspaces(id uuid primary key,owner_id uuid not null,payload jsonb not null,version bigint not null default 0,updated_at timestamptz default now());create table public.workspace_revisions(id uuid default gen_random_uuid(),workspace_id uuid,owner_id uuid,payload jsonb,created_at timestamptz default now());grant usage on schema public,auth to authenticated,service_role;grant select on public.authors to authenticated;grant all on public.authors,public.workspaces,public.workspace_revisions to service_role;`);
    await db.exec(await readFile('supabase/migrations/20261109135502_personal_writing_agent.sql','utf8'));
    await db.query('insert into public.authors values ($1),($2)',[owner,other]);await db.query('insert into public.workspaces(id,owner_id,payload) values($1,$2,$3)',[workspaceId,owner,JSON.stringify(state)]);
    await db.query("insert into public.agent_sessions(id,owner_id,workspace_id,title,scope,mode,provider) values($1,$2,$3,'시험',$4,'review','gemini')",[sessionId,owner,workspaceId,JSON.stringify(scope)]);
    await db.query("insert into public.agent_runs(id,session_id,owner_id,workspace_id,message,provider,model,mode,web,snapshot,base_hash) values($1,$2,$3,$4,'질문','gemini','fixture','review',false,$5,'before')",[runId,sessionId,owner,workspaceId,JSON.stringify(captureAgentScope(state,scope))]);
    await db.exec('set role anon');await assert.rejects(db.query('select * from public.agent_runs'),/permission/);await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');assert.equal((await db.query('select * from public.agent_runs')).rows.length,0);await assert.rejects(db.query("select public.agent_claim_run($1,'workflow')",[runId]),/permission/);await assert.rejects(db.query("update public.agent_runs set mode='execute'"),/permission/);await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');assert.equal((await db.query('select * from public.agent_runs')).rows.length,1);await db.exec('reset role');
    await db.exec('set role service_role');assert.equal((await db.query<{ok:boolean}>("select public.agent_claim_run($1,'workflow') as ok",[runId])).rows[0].ok,true);assert.equal((await db.query<{ok:boolean}>("select public.agent_claim_run($1,'other-workflow') as ok",[runId])).rows[0].ok,false);
    await db.query("select public.agent_record_step($1,'workflow',$2,$3)",[runId,JSON.stringify({id:'step-1',title:'수정'}),JSON.stringify({type:'rename',id:doc.id,title:'새 이름'})]);await db.query("select public.agent_record_step($1,'workflow',$2,$3)",[runId,JSON.stringify({id:'step-1',title:'수정'}),JSON.stringify({type:'rename',id:doc.id,title:'새 이름'})]);assert.equal((await db.query<{n:number}>('select jsonb_array_length(operations) n from public.agent_runs where id=$1',[runId])).rows[0].n,1);
    const next=applyAgentOperations(state,scope,[{type:'rename',id:doc.id,title:'새 이름'}]);const commit=(version:number)=>db.query<{result:{status:string;version:number}}>('select public.agent_commit_workspace($1,$2,$3,$4,false) as result',[runId,version,JSON.stringify(next),'after']);
    await db.query('update public.agent_runs set reverted=true where id=$1',[runId]);await assert.rejects(commit(0),/discarded|reverted/);await db.query('update public.agent_runs set reverted=false where id=$1',[runId]);
    assert.equal((await commit(99)).rows[0].result.status,'conflict');assert.equal((await commit(0)).rows[0].result.version,1);assert.equal((await commit(0)).rows[0].result.version,1);assert.equal((await db.query('select * from public.workspace_revisions')).rows.length,1);
    await db.query("update public.agent_runs set status='cancelled' where id=$1",[runId]);
    await db.query('select public.agent_commit_workspace($1,1,$2,$3,true)',[runId,JSON.stringify(state),'before']);assert.equal((await db.query<{version:number}>('select version from public.workspaces')).rows[0].version,2);await assert.rejects(db.query('select public.agent_commit_workspace($1,2,$2,$3,true)',[runId,JSON.stringify(state),'before']),/revert/);
    await db.query("update public.agent_runs set status='cancelled',applied_version=null where id=$1",[runId]);await assert.rejects(commit(2),/cannot write/);await assert.rejects(db.query("select public.agent_record_step($1,'workflow',$2,null)",[runId,JSON.stringify({id:'step-2',title:'취소 후'})]),/stopped/);
    await db.query("update public.agent_runs set status='queued',workflow_id=null where id=$1",[runId]);
    await db.query('delete from public.authors where user_id=$1',[owner]);assert.equal((await db.query('select * from public.agent_runs where id=$1',[runId])).rows.length,1);
    assert.equal((await db.query<{ok:boolean}>("select public.agent_claim_run($1,'workflow') as ok",[runId])).rows[0].ok,false);
    await db.exec('reset role;set role authenticated');assert.equal((await db.query('select * from public.agent_runs')).rows.length,0);await db.exec('reset role');
  }finally{await db.close();}
});

test('모델 문맥은 최근 대화만 담고 과거 이력은 보존하며 삭제된 출처를 기억에서 제외한다',()=>{
  const {state,scope,doc}=fixture(),snapshot=captureAgentScope(state,scope),id=uid();
  const make=(message:string)=>agentRunView(agentRunSchema.parse({id:uid(),session_id:uid(),owner_id:uid(),workspace_id:uid(),message,provider:'gemini',model:'fixture',mode:'discuss',web:false,status:'completed',workflow_id:null,snapshot,base_hash:'hash',operations:[],events:[],answer:'응답',error:'',usage:null,applied_version:null,applied_hash:null,reverted:false,created_at:'2026-11-09',updated_at:'2026-11-09'}));
  const runs=[make('이전 질문'),make('최근 질문')],memory={id:uid(),session_id:uid(),title:'기억',content:'내용',sources:[{id,title:'삭제됨'}],updated_at:'2026-11-09'};
  const context=agentContext(runs,[memory],new Set([doc.id]),8);
  assert.equal(context.runs.length,1);assert.equal(context.runs[0].message,'최근 질문');assert.equal(context.allRuns.length,2);assert.equal(context.memories.length,0);assert.equal(runs.length,2);
});

test('에이전트 변경 도구는 제공자가 받는 최상위 object 명세를 사용한다',async()=>{
  const tools=writingAgentTools(uid(),'schema-fixture','review',true);
  const schema=await asSchema(tools.stageChange!.inputSchema!).jsonSchema;
  assert.equal(schema.type,'object');assert.equal(schema.oneOf,undefined);assert.equal(schema.anyOf,undefined);assert(!JSON.stringify(schema).includes('\"oneOf\"'));
  assert.equal(writingAgentTools(uid(),'schema-fixture','discuss',true).stageChange,undefined);
});

async function committed(scopeKind:'work'|'notes'){
  const {state:seeded,work,sectionId}=fixture(),note={...newNote(),title:'관측 노트',content:fromText('관측은 새벽에 시작한다.')},base=addNote(seeded,note),id=uid();
  const scope=scopeKind==='work'?{kind:'work' as const,id:work.id}:{kind:'notes' as const,id:'default' as const};
  const ops:AgentOperation[]=scopeKind==='work'?[{type:'create',id,kind:'memo',title:'개요',text:'관측소에 도착한다.',parentId:null,sectionId,beforeId:null},{type:'replace',id:work.documents[0].id,quote:'낡은',replacement:'버려진'}]:[{type:'replace',id:note.id,quote:'새벽',replacement:'자정'}];
  const remote=workspaceSchema.parse(applyAgentOperations(base,scope,ops));
  const commit={workspace_id:base.id,scope,base_hash:await agentHash(captureAgentScope(base,scope)),applied_hash:await agentHash(captureAgentScope(remote,scope)),applied_version:2};

  return {base,remote,commit,work,note,created:id};
}

test('맡겨 실행이 반영한 작품과 다른 곳에서 쓴 글은 충돌 없이 합쳐진다',async()=>{
  const {base,remote,commit,work,note,created}=await committed('work');
  const local=structuredClone(base);local.notes!.find(n=>n.id===note.id)!.content=fromText('관측은 새벽에 시작한다. 이 기기에서 이어 쓴 문장.');
  const join=await agentCommitJoiner(local,remote,commit);assert(join);
  const later=structuredClone(local);later.notes!.find(n=>n.id===note.id)!.content=fromText('합치는 사이에 한 글자 더.');
  const joined=join(later);assert(joined);
  const joinedWork=joined.state.works.find(w=>w.id===work.id)!;

  assert.equal(plainText(joined.state.notes!.find(n=>n.id===note.id)!.content),'합치는 사이에 한 글자 더.','the newest local text outside the scope stays');
  assert.equal(plainText(joinedWork.documents.find(d=>d.id===created)!.content),'관측소에 도착한다.');assert.equal(plainText(joinedWork.documents.find(d=>d.id===work.documents[0].id)!.content),'달에는 버려진 관측소가 있었다.');
  assert.deepEqual(new Set(joined.changed),new Set([work.id,created,work.documents[0].id]),'only the tree and the documents the agent changed are reloaded');
  assert.equal(await agentHash(captureAgentScope(joined.state,commit.scope)),commit.applied_hash,'the joined scope can still be reverted');
});

test('에이전트가 본 범위를 이 기기에서도 고쳤으면 합치지 않는다',async()=>{
  const {base,remote,commit,work}=await committed('work');
  const edited=structuredClone(base);edited.works.find(w=>w.id===work.id)!.documents[1].title='이 기기에서 바꾼 제목';
  assert.equal(await agentCommitJoiner(edited,remote,commit),null);

  const join=await agentCommitJoiner(base,remote,commit);assert(join);assert.equal(join(edited),null,'an edit inside the scope after the check also stops the join');
  const other=structuredClone(remote);other.works.find(w=>w.id===work.id)!.documents[1].title='다른 기기에서 바꾼 제목';
  assert.equal(await agentCommitJoiner(base,other,commit),null,'a cloud scope that is not exactly the agent result is left to the conflict dialog');
});

test('노트 공간을 맡긴 동안 작품에서 쓴 글도 합쳐진다',async()=>{
  const {base,remote,commit,work,note}=await committed('notes');
  const local=structuredClone(base);local.works.find(w=>w.id===work.id)!.documents[0].content=fromText('이 기기에서 고친 본문.');
  const join=await agentCommitJoiner(local,remote,commit);assert(join);
  const joined=join(local);assert(joined);

  assert.equal(plainText(joined.state.works.find(w=>w.id===work.id)!.documents[0].content),'이 기기에서 고친 본문.');assert.equal(plainText(joined.state.notes!.find(n=>n.id===note.id)!.content),'관측은 자정에 시작한다.');
  assert.deepEqual(new Set(joined.changed),new Set(['default',note.id]));assert.equal(await agentHash(captureAgentScope(joined.state,commit.scope)),commit.applied_hash);
});
