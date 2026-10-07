import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../src/lib/seed';
import { uid,fromText } from '../src/lib/model';
import { applyNavigation, resolveNavigation } from '../src/lib/document-navigation';
import { activatePromptPreset,DEFAULT_PROMPT_ID,savePromptPreset } from '../src/lib/ai-prompt-presets';

test('PostgreSQL: 권한, 버전 충돌, 재전송, 공개 분리, AI 호출 한도',async()=>{
 const pg=new PGlite();

 try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema public,storage to anon,authenticated;create publication supabase_realtime;`);
 await pg.exec(await readFile(new URL('../supabase/migrations/001_studio.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/002_document_navigation_guard.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/002_document_navigation_guard.sql',import.meta.url),'utf8'));
 assert.equal((await pg.query("select tgname from pg_trigger where tgname='preserve_document_navigation'")).rows.length,1);
 await pg.exec(await readFile(new URL('../supabase/migrations/003_ai_preferences_guard.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/003_ai_preferences_guard.sql',import.meta.url),'utf8'));
 assert.equal((await pg.query("select tgname from pg_trigger where tgname='preserve_ai_preferences'")).rows.length,1);
 const author=uid(),other=uid();await pg.query('insert into auth.users values ($1),($2)',[author,other]);await pg.query('insert into public.authors values ($1)',[author]);
 await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[author]);
 const state=seedWorkspace();const init=await pg.query<{r:{id:string;version:number}}>('select public.initialize_workspace($1::jsonb) r',[JSON.stringify(state)]);const id=init.rows[0].r.id;
 const request=uid();state.works[0].documents[0].summary='수정';
 const saved=await pg.query<{r:{status:string;version:number}}>('select public.save_workspace($1,0,$2::jsonb,$3) r',[id,JSON.stringify(state),request]);assert.equal(saved.rows[0].r.version,1);
 const duplicate=await pg.query<{r:{version:number}}>('select public.save_workspace($1,0,$2::jsonb,$3) r',[id,JSON.stringify(state),request]);assert.equal(duplicate.rows[0].r.version,1);
 const conflict=await pg.query<{r:{status:string;version:number}}>('select public.save_workspace($1,0,$2::jsonb,$3) r',[id,JSON.stringify(state),uid()]);assert.equal(conflict.rows[0].r.status,'conflict');
 const work=state.works[0];const publish=await pg.query<{r:unknown}>('select public.publish_work($1,$2,$3::uuid[]) r',[id,work.id,[work.documents[0].id]]);const snapshot=JSON.stringify(publish.rows[0].r);assert(!snapshot.includes('結末'));assert(!snapshot.includes('결말에서'));assert(!snapshot.includes('제7항구'));
 work.documents[0].content=fromText('아직 공개하지 않은 초안');await pg.query('select public.save_workspace($1,1,$2::jsonb,$3)',[id,JSON.stringify(state),uid()]);
 state.works[0]=applyNavigation(work,resolveNavigation(work));await pg.query('select public.save_workspace($1,2,$2::jsonb,$3)',[id,JSON.stringify(state),uid()]);
 const legacy=structuredClone(state);delete legacy.works[0].navigation;
 await assert.rejects(()=>pg.query('select public.save_workspace($1,3,$2::jsonb,$3)',[id,JSON.stringify(legacy),uid()]),/새로고침/);
 const protectedRow=await pg.query<{version:number;payload:typeof state}>('select version,payload from public.workspaces');assert.equal(protectedRow.rows[0].version,3);assert.deepEqual(protectedRow.rows[0].payload.works[0].navigation,state.works[0].navigation);
 legacy.works[0]=applyNavigation(legacy.works[0],resolveNavigation(legacy.works[0]));await pg.query('select public.save_workspace($1,3,$2::jsonb,$3)',[id,JSON.stringify(legacy),uid()]);
 legacy.aiPreferences=savePromptPreset(undefined,{id:uid(),title:'합성 지침',prompt:'비공개 지침'});await pg.query('select public.save_workspace($1,4,$2::jsonb,$3)',[id,JSON.stringify(legacy),uid()]);
 const noPreferences=structuredClone(legacy);delete noPreferences.aiPreferences;await assert.rejects(()=>pg.query('select public.save_workspace($1,5,$2::jsonb,$3)',[id,JSON.stringify(noPreferences),uid()]),/AI 프리셋/);
 const promptRow=await pg.query<{version:number;payload:typeof state}>('select version,payload from public.workspaces');assert.equal(promptRow.rows[0].version,5);assert.deepEqual(promptRow.rows[0].payload.aiPreferences,legacy.aiPreferences);
 legacy.aiPreferences=activatePromptPreset(legacy.aiPreferences,DEFAULT_PROMPT_ID);await pg.query('select public.save_workspace($1,5,$2::jsonb,$3)',[id,JSON.stringify(legacy),uid()]);

 for(let i=0;i<10;i++)await pg.query('select public.reserve_ai_call()');await assert.rejects(()=>pg.query('select public.reserve_ai_call()'),/limit/);
 await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);const hidden=await pg.query('select id from public.workspaces');assert.equal(hidden.rows.length,0);await assert.rejects(()=>pg.query('select public.save_workspace($1,2,$2::jsonb,$3)',[id,JSON.stringify(state),uid()]),/access/);
 await pg.exec('reset role;set role anon');await pg.query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(()=>pg.query('select payload from public.workspaces'),/permission/);
 const publicRows=await pg.query<{payload:unknown}>('select payload from public.publications where active');assert.equal(publicRows.rows.length,1);assert.equal(JSON.stringify(publicRows.rows[0].payload),snapshot);
 await assert.rejects(()=>pg.query('select public.publish_work($1,$2,$3::uuid[])',[id,work.id,[work.documents[0].id]]),/permission/);
 }finally{await pg.close();}
});
