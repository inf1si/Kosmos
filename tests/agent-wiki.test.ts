import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { asSchema } from 'ai';
import { seedWorkspace } from '../src/lib/seed';
import { fromText,uid } from '../src/lib/model';
import { addNote,newNote } from '../src/lib/personal-notes';
import { buildAgentInstructions } from '../src/lib/agent-instructions';
import { DEFAULT_AI_SYSTEM_PROMPT } from '../src/lib/ai-settings';
import { writingAgentTools } from '../src/lib/agent-tools';
import { wikiDocuments,wikiFingerprint,wikiImportRows,wikiIndex,wikiReadableKeys,wikiRoleHints,wikiScopeKey,wikiSearch,wikiView,type WikiPage } from '../src/lib/agent-wiki';

function fixture(){
  let state=seedWorkspace();const work=state.works[0],doc=work.documents[0];doc.content=fromText('달에는 낡은 관측소가 있었다.');
  const note={...newNote(),title:'관측 노트',content:fromText('관측은 새벽에 시작한다.')};state=addNote(state,note);

  return {state,work,doc,note};
}

function page(sources:WikiPage['sources'],overrides:Partial<WikiPage>={}):WikiPage{
  const now=new Date().toISOString();

  return {id:uid(),owner_id:uid(),workspace_id:uid(),scope_key:'common',title:'관측소',category:'place',content:'달 관측소는 비어 있다.',sources,run_id:null,created_at:now,updated_at:now,...overrides};
}

test('위키 페이지는 출처가 그대로면 최신, 바뀌거나 사라지면 오래된 것으로 보인다',()=>{
  const {state,doc,note}=fixture(),docs=wikiDocuments(state);
  assert(docs.has(doc.id)&&docs.has(note.id),'every work and note space is a possible source');
  const hash=wikiFingerprint(docs.get(doc.id)!),noteHash=wikiFingerprint(docs.get(note.id)!);
  assert.equal(hash,wikiFingerprint(wikiDocuments(structuredClone(state)).get(doc.id)!),'the fingerprint is stable');
  const written=page([{id:doc.id,title:'옛 제목',hash},{id:note.id,title:note.title,hash:noteHash}]);
  const fresh=wikiView(written,docs);assert.equal(fresh.stale,false);assert.deepEqual(fresh.sources.map(source=>source.status),['current','current']);assert.equal(fresh.sources[0].title,doc.title||'제목 없음','a renamed source shows its current title');

  const edited=structuredClone(state);edited.works[0].documents[0].content=fromText('달에는 새 관측소가 있었다.');
  const changed=wikiView(written,wikiDocuments(edited));assert.equal(changed.stale,true);assert.equal(changed.sources[0].status,'changed');

  const removed=structuredClone(state);removed.notes=removed.notes!.filter(item=>item.id!==note.id);
  const gone=wikiView(written,wikiDocuments(removed));assert.equal(gone.stale,true);assert.equal(gone.sources[1].status,'gone');
});

test('위키 범위: 작품은 자기 페이지와 공통 페이지를 읽고, 노트는 공통 페이지만 쓴다',()=>{
  const id=uid();
  assert.equal(wikiScopeKey({kind:'work',id}),`work:${id}`);assert.equal(wikiScopeKey({kind:'notes',id:'default'}),'common');assert.equal(wikiScopeKey({kind:'notes',id:uid()}),'common');
  assert.deepEqual(wikiReadableKeys({kind:'work',id}),[`work:${id}`,'common']);assert.deepEqual(wikiReadableKeys({kind:'notes',id:'default'}),['common']);
});

test('위키 검색·목차·자료 역할은 에이전트 지침에 짧게 실린다',()=>{
  const {state,doc,note}=fixture(),docs=wikiDocuments(state);
  const views=[page([],{title:'관측소',content:'달 관측소는 비어 있다. 누가 비웠는지는 모른다.'}),page([{id:doc.id,title:doc.title,hash:'old'}],{title:'주인공',category:'character',content:'관측소를 찾는 사람이다.',scope_key:`work:${state.works[0].id}`})].map(item=>wikiView(item,docs));
  const found=wikiSearch(views,'누가 비웠',0);assert.equal(found.total,1);assert.equal(found.pages[0].title,'관측소');assert(found.pages[0].excerpt.includes('누가 비웠'));assert.equal(found.pages[0].scope,'공통');
  assert.equal(wikiSearch(views,'',0).total,2,'an empty query lists the index');
  const index=wikiIndex(views);assert(index.includes(`- "관측소" (장소·조직 · 공통) id ${views[0].id}`));assert(index.includes('"주인공" (인물 · 출처 바뀜)'));
  assert.equal(wikiIndex([]),'(아직 위키 페이지가 없다.)');assert(wikiIndex(views,60).endsWith('(목록에 싣지 못한 페이지 1개는 searchWiki로 찾는다.)'));
  const roles=wikiRoleHints({[doc.id]:'canon',[note.id]:'idea',[uid()]:'canon'},docs);assert.equal(roles,`확정 설정: ${JSON.stringify([doc.title||'제목 없음'])}\n아이디어: ["관측 노트"]`,'a document that left the workspace is left out');

  const base={mode:'review' as const,web:false,today:'2026-11-17',persona:DEFAULT_AI_SYSTEM_PROMPT,skills:[],map:'작품: 합성 (단편)',library:'',focus:null,memories:[]};
  const withWiki=buildAgentInstructions({...base,wiki:{index,roles}});assert(withWiki.includes('## 위키 목차')&&withWiki.includes(index)&&withWiki.includes('## 자료 역할')&&withWiki.includes(roles));assert(withWiki.includes('readWiki로 먼저 보고'));assert(withWiki.includes('확정 설정인 자료만 확정으로 적고'));
  assert(buildAgentInstructions({...base,wiki:{index,roles:''}}).includes('(정한 역할이 없다.)'));
  const without=buildAgentInstructions({...base,wiki:null});assert(!without.includes('위키'),'without the wiki migration the agent is not told about a wiki');
});

test('위키 도구는 모든 실행 방식에 있고 인자 최상위가 객체다',()=>{
  for(const mode of ['discuss','review','execute'] as const){const tools=writingAgentTools(uid(),'wf',mode,false,false);assert('searchWiki' in tools&&'readWiki' in tools&&'writeWiki' in tools,mode);}

  const tools=writingAgentTools(uid(),'wf','review',false,false);
  assert.deepEqual([asSchema(tools.searchWiki.inputSchema).jsonSchema.type,asSchema(tools.readWiki.inputSchema).jsonSchema.type,asSchema(tools.writeWiki.inputSchema).jsonSchema.type],['object','object','object']);
});

test('AI 자료 가져오기는 위키 페이지와 자료 역할의 소유자·작업공간을 바꾸고 형식이 틀린 행을 뺀다',()=>{
  const owner=uid(),workspace=uid(),written=JSON.parse(JSON.stringify(page([{id:uid(),title:'출처',hash:'h'}])));
  const rows=wikiImportRows({wikiPages:[written,{id:'틀린 값'}],wikiScopes:[{owner_id:uid(),scope_key:'common',source_roles:{[uid()]:'canon'},updated_at:new Date().toISOString()},{owner_id:uid(),scope_key:'work:없음',source_roles:{},updated_at:''}]},owner,workspace);
  assert.equal(rows.pages.length,1);assert.equal(rows.pages[0].owner_id,owner);assert.equal(rows.pages[0].workspace_id,workspace);assert.equal(rows.scopes.length,1);assert.equal(rows.scopes[0].owner_id,owner);
});

test('위키 마이그레이션: 범위·종류·길이를 검사하고 작가는 자기 페이지만 읽는다',async()=>{
  const pg=new PGlite();
  await pg.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table public.authors(user_id uuid primary key);grant select on public.authors to authenticated;create table public.workspaces(id uuid primary key,owner_id uuid not null);grant usage on schema public to authenticated;");
  await pg.exec(await readFile('supabase/migrations/20261117040000_agent_wiki.sql','utf8'));
  const me=uid(),other=uid(),workspace=uid(),otherWorkspace=uid();
  await pg.query('insert into public.authors values($1),($2)',[me,other]);await pg.query('insert into public.workspaces values($1,$2),($3,$4)',[workspace,me,otherWorkspace,other]);
  const insert=(owner:string,ws:string,scope:string,category='place',content='내용')=>pg.query("insert into public.agent_wiki_pages(id,owner_id,workspace_id,scope_key,title,category,content) values($1,$2,$3,$4,'제목',$5,$6)",[uid(),owner,ws,scope,category,content]);
  await insert(me,workspace,'common');await insert(me,workspace,`work:${uid()}`);await insert(other,otherWorkspace,'common');
  await assert.rejects(insert(me,workspace,'work:없음'),/check/);await assert.rejects(insert(me,workspace,'common','people'),/check/);await assert.rejects(insert(me,workspace,'common','place',''),/check/);
  await pg.query("insert into public.agent_wiki_scopes(owner_id,scope_key,source_roles) values($1,'common','{}')",[me]);await assert.rejects(pg.query("insert into public.agent_wiki_scopes(owner_id,scope_key,source_roles) values($1,'common','[]')",[other]),/check/);
  await pg.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${me}',false);`);
  assert.equal((await pg.query('select * from public.agent_wiki_pages')).rows.length,2,'an author reads only their own pages');
  await assert.rejects(pg.query("update public.agent_wiki_pages set title='바뀜'"),/permission denied/);await assert.rejects(pg.query("delete from public.agent_wiki_scopes"),/permission denied/);
  await pg.exec('reset role;');await pg.query('delete from public.workspaces where id=$1',[workspace]);
  assert.equal((await pg.query('select * from public.agent_wiki_pages where owner_id=$1',[me])).rows.length,0,'pages go with their workspace');
  await pg.close();
});
