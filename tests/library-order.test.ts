import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {seedWorkspace} from '../src/lib/seed';
import {makePublication,newDocument,uid,workspaceSchema} from '../src/lib/model';
import {librarySort,previewPositions,previewPublicationPosition,previewPublications,reorderPreviewLibrary,sortPublications} from '../src/lib/library-order';

function fixture(){const state=seedWorkspace();

for(const [index,work] of state.works.entries()){const p=makePublication(work,[work.documents.find(d=>d.kind==='scene')!.id]);p.title=index?'가나다 10':'가나다 2';p.publishedAt=index?'2026-10-01T00:00:00Z':'2026-10-02T00:00:00Z';work.publications=[p];work.activePublicationId=p.id;}

return state;}

test('서재 사전순·게시일순·작가순은 독립적이고 숫자 제목과 동률도 안정적으로 정렬한다',()=>{
 const state=fixture(),[a,b]=previewPublications(state);a.libraryPosition=2;b.libraryPosition=1;
 assert.deepEqual(sortPublications([a,b]).map(p=>p.id),[b.id,a.id]);
 assert.deepEqual(sortPublications([b,a],'titleAsc').map(p=>p.id),[a.id,b.id]);
 assert.deepEqual(sortPublications([a,b],'titleDesc').map(p=>p.id),[b.id,a.id]);
 assert.deepEqual(sortPublications([b,a],'newest').map(p=>p.id),[a.id,b.id]);
 assert.deepEqual(sortPublications([a,b],'oldest').map(p=>p.id),[b.id,a.id]);
 const tied={...a,title:b.title,publishedAt:b.publishedAt};assert.deepEqual(sortPublications([tied,b],'titleAsc').map(p=>p.id),[b.id,a.id]);
 assert.equal(librarySort('invalid'),'author');assert.equal(librarySort(null),'author');assert.equal(librarySort('oldest'),'oldest');assert.equal(librarySort('toString'),'author');
 assert.equal(a.libraryPosition,2);
});

test('미리보기 순서 저장은 판본·게시일·원고를 유지하고 재게시·첫 게시·철회 위치를 보존한다',()=>{
 const state=fixture(),before=structuredClone(state),active=previewPublications(state),next=reorderPreviewLibrary(state,active.map(p=>p.id).reverse());
 assert.deepEqual(previewPublications(next).map(p=>p.id),active.map(p=>p.id).reverse());assert.deepEqual(state,before);assert(workspaceSchema.safeParse(next).success);

 for(const w of next.works){const old=state.works.find(o=>o.id===w.id)!;assert.deepEqual(w.documents,old.documents);assert.equal(w.activePublicationId,old.activePublicationId);assert.equal(w.publications[0].publishedAt,old.publications[0].publishedAt);assert.deepEqual(w.publications[0].scenes,old.publications[0].scenes);}

 const position=previewPublicationPosition(next,next.works[0].id);const repub=makePublication(next.works[0],[next.works[0].documents[0].id]);repub.libraryPosition=position;next.works[0].publications.push(repub);next.works[0].activePublicationId=repub.id;
 assert.equal(previewPublications(next).at(-1)!.workId,next.works[0].id);assert.throws(()=>reorderPreviewLibrary(next,active.map(p=>p.id)),/바뀌었습니다/);
 const newWorkId=uid();assert.equal(previewPublicationPosition(next,newWorkId),3);
 next.works[0].activePublicationId=null;const reordered=reorderPreviewLibrary(next,previewPublications(next).map(p=>p.id));assert.equal(previewPublicationPosition(reordered,next.works[0].id),position);
 assert.deepEqual(previewPositions(reordered),reordered);assert.throws(()=>reorderPreviewLibrary(state,[active[0].id,active[0].id]),/바뀌었습니다/);
});

test('운영 SQL은 작가만 순서를 바꾸며 기존 판본·시간·다른 작가와 재게시 위치를 보존한다',async()=>{
 const pg=new PGlite(),owner=uid(),other=uid(),outsider=uid(),wid=uid(),state=fixture(),active=previewPublications(state);

 const newWork={...structuredClone(state.works[1]),id:uid(),title:'처음 게시',documents:[newDocument('scene','첫 원고')],publications:[],activePublicationId:null};state.works.push(newWork);

 try{
 await pg.exec("create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table public.authors(user_id uuid primary key);create table public.workspaces(id uuid primary key,owner_id uuid unique,payload jsonb);create table public.publications(id uuid primary key,owner_id uuid,work_id uuid,active boolean not null default true,payload jsonb,published_at timestamptz not null default now());alter table public.publications enable row level security;create policy active_read on public.publications for select to anon,authenticated using(active);grant select(id,work_id,active,payload,published_at) on public.publications to anon,authenticated;");
 await pg.query('insert into authors values($1),($2)',[owner,other]);await pg.query('insert into workspaces values($1,$2,$3),($4,$5,$6)',[wid,owner,JSON.stringify(state),uid(),other,'{"works":[]}']);

 for(const p of active)await pg.query('insert into publications(id,owner_id,work_id,payload,published_at) values($1,$2,$3,$4,$5)',[p.id,owner,p.workId,JSON.stringify(p),p.publishedAt]);
 const otherPub={...active[0],id:uid()};await pg.query('insert into publications(id,owner_id,work_id,payload,published_at) values($1,$2,$3,$4,$5)',[otherPub.id,other,otherPub.workId,JSON.stringify(otherPub),otherPub.publishedAt]);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261007150655_library_order.sql',import.meta.url),'utf8'));
 const original=(await pg.query('select id,payload,published_at from publications order by id')).rows;
 const sql=readFileSync(new URL('../supabase/migrations/001_studio.sql',import.meta.url),'utf8');await pg.exec(sql.match(/create function public.publish_work[\s\S]*?end \$\$;/)![0]);await pg.exec('revoke all on function public.publish_work(uuid,uuid,uuid[]) from public,anon;grant execute on function public.publish_work(uuid,uuid,uuid[]) to authenticated;');
 await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await pg.exec('set role authenticated');
 const list=async()=>(await pg.query<{items:typeof active}>('select get_author_library() as items')).rows[0].items;
 assert.deepEqual((await list()).map(p=>p.id),active.map(p=>p.id));assert.equal('scenes' in (await list())[0],false);
 const reverse=active.map(p=>p.id).reverse();const saved=(await pg.query<{items:typeof active}>('select set_library_order($1::uuid[]) as items',[reverse])).rows[0].items;assert.deepEqual(saved.map(p=>p.id),reverse);
 await assert.rejects(()=>pg.query('select set_library_order($1::uuid[])',[[active[0].id,otherPub.id]]),/바뀌었습니다/);await assert.rejects(()=>pg.query('select set_library_order($1::uuid[])',[[active[0].id,active[0].id]]),/바뀌었습니다/);
 await assert.rejects(()=>pg.exec('update publications set library_position=1'),/permission denied/);
 await pg.exec('reset role');assert.deepEqual((await pg.query('select id,payload,published_at from publications order by id')).rows,original);
 await pg.exec('set role authenticated');const repub=(await pg.query<{p:typeof active[0]}>('select publish_work($1,$2,$3::uuid[]) as p',[wid,state.works[0].id,[state.works[0].documents[0].id]])).rows[0].p;
 assert.equal((await list()).find(p=>p.workId===repub.workId)!.libraryPosition,2);await assert.rejects(()=>pg.query('select set_library_order($1::uuid[])',[reverse]),/바뀌었습니다/);
 const firstPub=(await pg.query<{p:typeof active[0]}>('select publish_work($1,$2,$3::uuid[]) as p',[wid,newWork.id,[newWork.documents[0].id]])).rows[0].p;assert.equal((await list()).at(-1)!.id,firstPub.id);assert.equal((await list()).at(-1)!.libraryPosition,3);
 await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.deepEqual((await list()).map(p=>p.id),[otherPub.id]);
 await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);await assert.rejects(()=>list(),/Author access required/);
 await pg.exec('reset role');assert.equal((await pg.query<{allowed:boolean}>("select has_function_privilege('anon','public.set_library_order(uuid[])','EXECUTE') as allowed")).rows[0].allowed,false);
 await pg.exec('set role anon');await assert.rejects(()=>list(),/permission denied/);const rows=(await pg.query('select library_position from publications where active')).rows;assert.equal(rows.length,4);
 }finally{await pg.close();}
});
