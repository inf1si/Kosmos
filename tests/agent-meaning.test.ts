import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { uid } from '../src/lib/model';
import { meaningPassages,normalizeEmbedding,MEANING_DIMENSIONS } from '../src/lib/agent-meaning';
import { writingAgentTools } from '../src/lib/agent-tools';
import { buildAgentInstructions } from '../src/lib/agent-instructions';
import { DEFAULT_AI_SYSTEM_PROMPT } from '../src/lib/ai-settings';

test('의미 검색 대목은 문단 경계에서 나뉘고 위치가 원문과 맞는다',()=>{
  const paragraphs=Array.from({length:6},(_,i)=>`${i+1}번째 문단. `+'달의 관측소를 바라본다. '.repeat(20));
  const text=paragraphs.join('\n'),passages=meaningPassages(text,900,1500);
  assert(passages.length>1);

  for(const passage of passages){assert.equal(text.slice(passage.start,passage.start+passage.length),passage.text);assert(passage.length<=1500);assert(!passage.text.startsWith('\n'));}

  assert(passages.every((passage,index)=>index===0||passage.start>passages[index-1].start+passages[index-1].length-1),'passages do not overlap');
  const long='가'.repeat(4000),cut=meaningPassages(long,900,1500);assert.deepEqual(cut.map(passage=>passage.length),[1500,1500,1000]);
  assert.deepEqual(meaningPassages(''),[]);assert.deepEqual(meaningPassages('\n\n  \n'),[]);
});

test('임베딩은 길이 1로 맞춘다',()=>{
  const vector=normalizeEmbedding([3,4]);assert.deepEqual(vector,[0.6,0.8]);assert.throws(()=>normalizeEmbedding([0,0]),/비었습니다/);
});

test('의미 검색 도구는 Vertex 연결이 있을 때만 있고, 지침도 그때만 알린다',()=>{
  assert('searchMeaning' in writingAgentTools(uid(),'wf','discuss',false,true));assert(!('searchMeaning' in writingAgentTools(uid(),'wf','review',true,false)));
  const base={mode:'review' as const,web:false,today:'2026-11-17',persona:DEFAULT_AI_SYSTEM_PROMPT,skills:[],map:'',library:'',focus:null,memories:[]};
  assert(buildAgentInstructions({...base,meaning:true}).includes('searchMeaning으로 찾고'));assert(!buildAgentInstructions(base).includes('searchMeaning'));
});

test('의미 검색 마이그레이션: 요청한 문서·모델 안에서 가까운 순으로 돌려주고 서버만 쓴다',async()=>{
  const pg=new PGlite();
  await pg.exec("create role anon;create role authenticated;create role service_role bypassrls;create table public.workspaces(id uuid primary key,owner_id uuid not null);grant usage on schema public to authenticated;");
  await pg.exec(await readFile('supabase/migrations/20261117090000_agent_meaning_search.sql','utf8'));
  const me=uid(),other=uid(),workspace=uid(),otherWorkspace=uid(),near=uid(),far=uid(),outside=uid();
  await pg.query('insert into public.workspaces values($1,$2),($3,$4)',[workspace,me,otherWorkspace,other]);
  const axis=(i:number)=>Array.from({length:MEANING_DIMENSIONS},(_,j)=>j===i?1:0),blend=normalizeEmbedding(Array.from({length:MEANING_DIMENSIONS},(_,j)=>j===0?3:j===1?4:0));
  const insert=(owner:string,ws:string,doc:string,chunk:number,embedding:number[],model='gemini-embedding-001')=>pg.query('insert into public.agent_embeddings(owner_id,workspace_id,document_id,chunk_index,hash,model,start_offset,length,embedding) values($1,$2,$3,$4,$5,$6,0,10,$7)',[owner,ws,doc,chunk,'h',model,embedding]);
  await insert(me,workspace,near,0,axis(0));await insert(me,workspace,near,1,blend);await insert(me,workspace,far,0,axis(1));await insert(me,workspace,outside,0,axis(0));await insert(other,otherWorkspace,near,0,axis(0));await insert(me,workspace,far,1,axis(0),'other-model');
  await assert.rejects(insert(me,workspace,uid(),0,[1,0,0]),/check/);

  const rows=(await pg.query<{document_id:string;chunk_index:number;similarity:number}>('select * from public.agent_match_passages($1,$2,$3,$4,$5)',[me,[near,far],'gemini-embedding-001',axis(0),10])).rows;
  assert.deepEqual(rows.map(row=>[row.document_id,row.chunk_index]),[[near,0],[near,1],[far,0]],'only the asked documents of this owner and model, closest first');
  assert(Math.abs(rows[0].similarity-1)<1e-6&&Math.abs(rows[1].similarity-0.6)<1e-6&&Math.abs(rows[2].similarity)<1e-6);
  assert.equal((await pg.query('select * from public.agent_match_passages($1,$2,$3,$4,$5)',[me,[near,far],'gemini-embedding-001',axis(0),1])).rows.length,1);

  await pg.exec('set role authenticated;');
  await assert.rejects(pg.query('select * from public.agent_embeddings'),/permission denied/);await assert.rejects(pg.query('select * from public.agent_match_passages($1,$2,$3,$4,$5)',[me,[near],'gemini-embedding-001',axis(0),5]),/permission denied/);
  await pg.exec('reset role;');await pg.query('delete from public.workspaces where id=$1',[workspace]);
  assert.equal((await pg.query('select * from public.agent_embeddings where owner_id=$1',[me])).rows.length,0,'passages go with their workspace');
  await pg.close();
});
