import { vertexTestEnvironment,vertexAuthResponse,vertexReviewResponse } from './fixtures/vertex';
import { test } from 'node:test';
import type { JsonValue } from '../src/lib/json-value';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { POST as chat } from '../src/app/api/ai/chat/route';
import { POST as review } from '../src/app/api/review/route';
import { aiWorkspaceFixture } from './fixtures/ai-workspace';
import { fromText,newDocument,uid,workspaceSchema } from '../src/lib/model';
import { newNote,appendNoteExchange } from '../src/lib/personal-notes';
import { appendEditorExchange } from '../src/lib/editor-ai-conversation';
import { createBackup,readBackup } from '../src/lib/backup';
import type { ChatMessage } from '../src/lib/ai-conversation';

test('Vertex 두 모델의 대화·검토는 10회 뒤에도 긴 원고와 참고 전문을 보내고 작가·버전 검사를 유지한다',async()=>{
  const state=aiWorkspaceFixture(),work=state.works[0],doc=work.documents[0];
  doc.content=fromText('긴 원고 '.repeat(5000));
  const sources=Array.from({length:10},(_,i)=>({...newDocument('wiki',`자료 ${i}`),content:fromText('참고 전문 '.repeat(600))}));
  work.documents.push(...sources);
  const note={...newNote(),content:doc.content};state.notes=[note];
  const environment={NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',...vertexTestEnvironment};
  const previous=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]])),fetcher=globalThis.fetch;
  let reservations=0,calls=0,author=true,captured='';
  Object.assign(process.env,environment);
  globalThis.fetch=async(input,init)=>{
    const url=input instanceof Request?input.url:String(input);

    if(url.endsWith('/auth/v1/user'))return Response.json({id:state.id,aud:'authenticated',role:'authenticated'});

    if(url.includes('/rest/v1/authors'))return Response.json(author?[{user_id:state.id}]:[]);

    if(url.includes('/rest/v1/workspaces'))return Response.json({payload:state});

    if(url.includes('/rpc/')){reservations++;

return Response.json({message:'legacy daily limit'},{status:429});}

    const authResponse=vertexAuthResponse(url);

if(authResponse)return authResponse;
    assert.equal(new URL(url).hostname,'aiplatform.googleapis.com');
    const body=JSON.parse(String(init?.body)),result={review:'합성 답변',suggestions:[]},provider=url.includes('/anthropic/')?'anthropic':'gemini';calls++;
    captured=provider==='anthropic'?body.messages.at(-1).content[0].text:body.contents.at(-1).parts[0].text;

    return Response.json(vertexReviewResponse(provider,result));
  };

  const request=(path:string,body:JsonValue,token=true)=>{const headers=new Headers({'Content-Type':'application/json'});

if(token)headers.set('Authorization','Bearer synthetic');

return new Request(`http://localhost${path}`,{method:'POST',headers,body:JSON.stringify(body)});};

  try{
    for(const provider of ['anthropic','gemini']){
      const body={workId:work.id,docId:doc.id,version:doc.updatedAt,provider,message:'긴 질문 '.repeat(2000),includeManuscript:true,sourceIds:sources.map(s=>s.id),history:[]};

      for(let i=0;i<12;i++){const response=await chat(request('/api/ai/chat',body));assert.equal(response.status,200);const result=await response.json();assert.equal(result.sources.length,10);assert(!('dailyCalls' in result));}

      const sent=JSON.parse(captured);assert.equal(sent.manuscript,'긴 원고 '.repeat(5000));assert.equal(sent.question,body.message.trim());assert.equal(sent.references.length,10);assert.equal(sent.references[0].text,'참고 전문 '.repeat(600));
      const legacy={workId:work.id,docId:doc.id,version:doc.updatedAt,provider,goal:'style'};

      for(let i=0;i<12;i++)assert.equal((await review(request('/api/review',legacy))).status,200);
      assert.equal(JSON.parse(captured).manuscript,'긴 원고 '.repeat(5000));
      const {workId:originalWork,...noteBody}=body;void originalWork;const noteRequest={...noteBody,noteId:note.id,docId:note.id,version:note.updatedAt,sourceIds:[]};
      assert.equal((await chat(request('/api/ai/chat',noteRequest))).status,200);
      assert.equal(JSON.parse(captured).manuscript,'긴 원고 '.repeat(5000));
      const before=calls;
      assert.equal((await chat(request('/api/ai/chat',{...body,version:'stale'}))).status,409);
      assert.equal((await review(request('/api/review',{...legacy,version:'stale'}))).status,409);
      assert.equal((await chat(request('/api/ai/chat',body,false))).status,401);
      author=false;assert.equal((await review(request('/api/review',legacy))).status,401);author=true;
      assert.equal(calls,before);
    }

    assert.equal(reservations,0);assert.equal(calls,50);
  }finally{globalThis.fetch=fetcher;

for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('긴 질문과 20회 넘는 문서·노트 대화가 작업 공간과 ZIP에서 보존된다',async()=>{
  let state=aiWorkspaceFixture();const work=state.works[0],doc=work.documents[0],note=newNote();state.notes=[note];work.aiConversations=[];
  const answer:Extract<ChatMessage,{role:'assistant'}>={id:uid(),role:'assistant',provider:'gemini',model:'synthetic',createdAt:doc.updatedAt,version:doc.updatedAt,sources:[],result:{review:'답변',suggestions:[]}};

  for(let i=0;i<24;i++){state=appendEditorExchange(state,{workId:work.id,docId:doc.id},i*2,'가'.repeat(3001),{...answer,id:uid()});state=appendNoteExchange(state,note.id,i*2,'나'.repeat(3001),{...answer,id:uid()});}

  const saved=workspaceSchema.parse(state),restored=await readBackup(await createBackup(saved,[],[]));
  assert.equal(restored.data.works[0].aiConversations![0].messages.length,48);assert.equal(restored.data.notes![0].aiMessages!.length,48);
  assert.deepEqual(restored.data,saved);
});

test('새 SQL은 이전 탭의 일일 예약과 노트 대화 제한을 없애고 권한·대화 순서를 유지한다',async()=>{
  const pg=new PGlite(),owner=uid();

  try{
    await pg.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.authors(user_id uuid primary key);create table public.ai_usage(owner_id uuid references public.authors(user_id),day date,calls integer not null,primary key(owner_id,day));alter table ai_usage enable row level security;create table public.workspaces(id integer primary key,payload jsonb not null);`);
    await pg.query('insert into authors values($1)',[owner]);
    await pg.exec(readFileSync(new URL('../supabase/migrations/20261004074609_note_hierarchy_ai_guard.sql',import.meta.url),'utf8'));
    const state=aiWorkspaceFixture(),note=newNote(),messages:ChatMessage[]=[];state.notes=[note];

    for(let i=0;i<24;i++)messages.push({id:uid(),role:'user',text:'가'.repeat(3001),createdAt:note.updatedAt},{id:uid(),role:'assistant',provider:'gemini',model:'synthetic',createdAt:note.updatedAt,version:note.updatedAt,sources:[],result:{review:'답변',suggestions:[]}});
    note.aiMessages=messages;
    await assert.rejects(()=>pg.query('insert into workspaces values(1,$1)',[JSON.stringify(state)]),/20회/);
    await pg.exec(readFileSync(new URL('../supabase/migrations/20261102064805_remove_ai_conversation_caps.sql',import.meta.url),'utf8'));
    await pg.query('insert into workspaces values(1,$1)',[JSON.stringify(state)]);
    const odd=structuredClone(state);odd.notes![0].aiMessages!.pop();await assert.rejects(()=>pg.query('update workspaces set payload=$1',[JSON.stringify(odd)]),/질문·답변/);
    const stripped=structuredClone(state);delete stripped.notes![0].aiMessages;await assert.rejects(()=>pg.query('update workspaces set payload=$1',[JSON.stringify(stripped)]),/AI 대화/);
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);

    for(let i=1;i<=12;i++)assert.equal((await pg.query<{reserve_ai_call:number}>('select public.reserve_ai_call()')).rows[0].reserve_ai_call,i);
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid()]);await assert.rejects(()=>pg.query('select public.reserve_ai_call()'),/Author access/);
    assert.equal((await pg.query<{allowed:boolean}>("select has_function_privilege('anon','public.reserve_ai_call()','execute') allowed")).rows[0].allowed,false);
  }finally{await pg.close();}
});
