import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { authorProfileSchema, publishedProfileSchema, sameProfile } from '../src/lib/author-profile';
import { seedWorkspace } from '../src/lib/seed';
import { createBackup, readBackup } from '../src/lib/backup';
import { uid } from '../src/lib/model';

test('개인 소개는 빈 초안을 허용하고 공개에는 본문이 필요하며 길이·문자열을 검사한다',()=>{
  assert.deepEqual(authorProfileSchema.parse({name:'',bio:''}),{name:'',bio:''});
  const publicData={name:'합성 필명',bio:'첫 문단\n\n둘째 문단',published_at:new Date().toISOString()};
  assert(sameProfile({name:' 합성 필명 ',bio:' '+publicData.bio+' '},publishedProfileSchema.parse(publicData)));
  assert(!sameProfile({name:'수정',bio:publicData.bio},publicData));
  assert(publishedProfileSchema.safeParse({...publicData,published_at:'2026-10-09T12:00:00+00:00'}).success,'PostgREST timestamptz offset');

  for(const bio of ['', ' ', 42, '가'.repeat(10001)])assert(!publishedProfileSchema.safeParse({...publicData,bio}).success);
  assert(!authorProfileSchema.safeParse({name:'가'.repeat(81),bio:'소개'}).success);
});

test('이름과 소개 초안은 전체 ZIP·복구 지점에서 왕복하고 원고는 보존한다',async()=>{
  const state={...seedWorkspace(),authorProfile:{name:'합성 필명',bio:'비공개 합성 초안'}};
  const restored=await readBackup(await createBackup(state,[{id:uid(),namespace:'synthetic',createdAt:new Date().toISOString(),label:'자기소개 초안',data:state}],[]));
  assert.deepEqual(restored.revisions[0].data.authorProfile,state.authorProfile);
  assert.deepEqual(restored.data.authorProfile,state.authorProfile);assert.deepEqual(restored.data.works,state.works);
});

test('공개 SQL은 작성자만 게시·갱신·삭제하고 익명은 공개 내용만 읽으며 다른 계정의 소유권 변경을 막는다',async()=>{
  const pg=new PGlite(),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',visitor='33333333-3333-4333-8333-333333333333';

  try{
    await pg.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated;
      create table public.authors(user_id uuid primary key);
      insert into public.authors values('${owner}'),('${other}');
      alter table public.authors enable row level security;
      create policy author_self on public.authors for select to authenticated using(user_id=auth.uid());
      grant select on public.authors to authenticated;`);
    await pg.exec(readFileSync(new URL('../supabase/migrations/20261009121112_author_profile.sql',import.meta.url),'utf8'));

    async function as(user:string|null,role='authenticated'){await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await pg.exec(`set role ${role}`);}

    await as(null,'anon');assert.deepEqual((await pg.query('select name,bio from author_profile')).rows,[]);
    await assert.rejects(()=>pg.query("insert into author_profile(name,bio) values('fake','fake')"),/permission denied/);
    await as(visitor);await assert.rejects(()=>pg.query("insert into author_profile(name,bio) values('fake','fake')"),/row-level security|foreign key/);
    await as(owner);await pg.query("insert into author_profile(id,name,bio) values(true,$1,$2) on conflict(id) do update set name=excluded.name,bio=excluded.bio returning name,bio",['합성 필명','공개 합성 소개']);
    await pg.query("insert into author_profile(id,name,bio) values(true,$1,$2) on conflict(id) do update set name=excluded.name,bio=excluded.bio returning name,bio",['새 필명','갱신된 공개 소개']);

    for(const bio of ['', '가'.repeat(10001)])await assert.rejects(()=>pg.query('update author_profile set bio=$1 where id=true',[bio]),/check constraint/);
    await as(null,'anon');assert.deepEqual((await pg.query('select name,bio from author_profile')).rows,[{name:'새 필명',bio:'갱신된 공개 소개'}]);
    await assert.rejects(()=>pg.query('select owner_id from author_profile'),/permission denied/);
    await assert.rejects(()=>pg.query("update author_profile set bio='hijack'"),/permission denied/);
    await as(other);await assert.rejects(()=>pg.query("insert into author_profile(id,name,bio) values(true,'other','hijack') on conflict(id) do update set bio=excluded.bio"),/row-level security/);
    await assert.rejects(()=>pg.query('update author_profile set owner_id=$1 where id=true',[other]),/permission denied/);
    assert.deepEqual((await pg.query('delete from author_profile where id=true returning name')).rows,[]);
    await as(owner);await pg.query('delete from author_profile where id=true');
    await as(null,'anon');assert.deepEqual((await pg.query('select name,bio from author_profile')).rows,[]);
  }finally{await pg.close();}
});
