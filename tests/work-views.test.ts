import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {POST as recordView} from '../src/app/api/views/route';
import {uid} from '../src/lib/model';
import {automatedAgent,firstViewToday,seoulDay,viewsLabel,workViewRowsSchema,workViewTotals} from '../src/lib/work-views';

const browser='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('조회 날짜는 한국 날짜이고 자동 접속은 독자로 세지 않는다',()=>{
  assert.equal(seoulDay(new Date('2026-11-15T14:59:59Z')),'2026-11-15');
  assert.equal(seoulDay(new Date('2026-11-15T15:00:00Z')),'2026-11-16');

  for(const agent of ['','Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)','Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)','facebookexternalhit/1.1; kakaotalk-scrap/1.0','curl/8.5.0','Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0'])assert.equal(automatedAgent(agent),true,agent);

  for(const agent of [browser,'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36','Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 KAKAOTALK 11.0.0'])assert.equal(automatedAgent(agent),false,agent);
});

test('같은 브라우저는 작품마다 하루에 한 번만 센다',()=>{
  const saved=new Map<string,string>(),storage=()=>({getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value);}});
  const a=uid(),b=uid();

  assert.equal(firstViewToday(a,'2026-11-15',storage),true);
  assert.equal(firstViewToday(a,'2026-11-15',storage),false);
  assert.equal(firstViewToday(b,'2026-11-15',storage),true);
  assert.equal(firstViewToday(a,'2026-11-16',storage),true);
  assert.equal(firstViewToday(a,'2026-11-16',()=>{throw new Error('blocked');}),true);
});

test('조회 표시는 합계를 읽은 뒤에만 나온다',()=>{
  const work=uid(),totals=workViewTotals(workViewRowsSchema.parse([{work_id:work,total:'1234',recent:56}]));

  assert.equal(viewsLabel(null,work,true),'');
  assert.equal(viewsLabel(totals,work),' · 조회 1,234');
  assert.equal(viewsLabel(totals,work,true),' · 조회 1,234 · 최근 7일 56');
  assert.equal(viewsLabel(totals,uid(),true),' · 조회 0 · 최근 7일 0');
  assert.equal(workViewRowsSchema.safeParse([{work_id:work,total:-1,recent:0}]).success,false);
});

test('조회 기록 요청은 같은 사이트의 독자 브라우저만 서버 권한으로 기록한다',async()=>{
  const originalFetch=globalThis.fetch,env={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY},work=uid(),calls:{path:string;key:string|null;body:string}[]=[];

  process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init);

    calls.push({path:new URL(request.url).pathname,key:request.headers.get('apikey'),body:await request.text()});

    return new Response(null,{status:204});
  };

  const send=(body:string,headers:Record<string,string>={})=>recordView(new Request('https://site.example/api/views',{method:'POST',body,headers:{'content-type':'application/json',host:'site.example',origin:'https://site.example','user-agent':browser,...headers}}));

  try{
    const ok=await send(JSON.stringify({workId:work}));

    assert.equal(ok.status,204);
    assert.deepEqual(calls,[{path:'/rest/v1/rpc/record_work_view',key:'synthetic-service',body:JSON.stringify({p_work_id:work})}]);

    for(const [body,headers] of [
      [JSON.stringify({workId:work}),{'user-agent':'Googlebot/2.1'}],
      [JSON.stringify({workId:work}),{origin:'https://other.example'}],
      [JSON.stringify({workId:'not-a-work'}),{}],
      ['{',{}],
      [JSON.stringify({workId:work,padding:'x'.repeat(500)}),{}],
    ] as const)assert.equal((await send(body,headers)).status,204);

    assert.equal(calls.length,1);

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await send(JSON.stringify({workId:work}))).status,204);
    assert.equal(calls.length,1);

    process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';

    globalThis.fetch=async()=>{throw new Error('offline');};

    assert.equal((await send(JSON.stringify({workId:work}))).status,204);
  }finally{
    globalThis.fetch=originalFetch;

    for(const [name,value] of [['NEXT_PUBLIC_SUPABASE_URL',env.url],['SUPABASE_SERVICE_ROLE_KEY',env.key]] as const){
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  }
});

test('조회수 테이블은 서버만 기록하고 작가는 자기 작품의 합계만 읽는다',async()=>{
  const pg=new PGlite(),owner=uid(),other=uid(),work=uid(),withdrawn=uid(),otherWork=uid();
  const as=async(role:string,user='')=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await pg.exec(`set role ${role}`);};

  try{
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create table authors(user_id uuid primary key);
      create table publications(id uuid primary key default gen_random_uuid(),owner_id uuid,work_id uuid,active boolean);`);
    await pg.exec(readFileSync(new URL('../supabase/migrations/20261115143500_work_views.sql',import.meta.url),'utf8'));
    await pg.query('insert into authors values($1),($2)',[owner,other]);
    await pg.query('insert into publications(owner_id,work_id,active) values($1,$2,true),($1,$2,false),($1,$3,false),($4,$5,true)',[owner,work,withdrawn,other,otherWork]);

    await as('service_role');

    for(const id of [work,work,work,withdrawn,uid(),otherWork])await pg.query('select public.record_work_view($1)',[id]);

    await pg.exec('reset role');
    assert.deepEqual((await pg.query('select work_id,views,owner_id from work_views order by views desc')).rows,[{work_id:work,views:3,owner_id:owner},{work_id:otherWork,views:1,owner_id:other}]);
    await pg.query("insert into work_views(work_id,day,owner_id,views) values($1,(now() at time zone 'Asia/Seoul')::date-7,$2,10),($1,(now() at time zone 'Asia/Seoul')::date-6,$2,5)",[work,owner]);

    for(const role of ['anon','authenticated']){
      await as(role,role==='authenticated'?owner:'');
      await assert.rejects(pg.query('select public.record_work_view($1)',[work]),/permission denied/);
      await assert.rejects(pg.query("insert into work_views(work_id,day,owner_id,views) values($1,current_date,$2,99)",[work,owner]),/permission denied/);
      await assert.rejects(pg.query('update work_views set views=99'),/permission denied/);
    }

    await as('anon');
    await assert.rejects(pg.query('select * from work_views'),/permission denied/);
    await assert.rejects(pg.query('select * from public.work_view_totals()'),/permission denied/);

    await as('authenticated',owner);
    assert.deepEqual((await pg.query('select * from public.work_view_totals()')).rows,[{work_id:work,total:18,recent:8}]);
    assert.deepEqual((await pg.query('select count(*)::int as n from work_views')).rows,[{n:3}]);

    await as('authenticated',other);
    assert.deepEqual((await pg.query('select * from public.work_view_totals()')).rows,[{work_id:otherWork,total:1,recent:1}]);

    await as('authenticated',uid());
    assert.deepEqual((await pg.query('select * from public.work_view_totals()')).rows,[]);
  }finally{await pg.close();}
});
