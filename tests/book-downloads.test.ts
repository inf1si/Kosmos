import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {bookAttachment,bookDownloadSchema,storedBookDownloadSchema} from '../src/lib/book-downloads';
import {GET as listBooks} from '../src/app/api/books/route';
import {GET as downloadBook} from '../src/app/api/books/[workId]/[format]/route';
import {uid} from '../src/lib/model';

const owner=uid(),other=uid(),work=uid(),fileId=uid();

const file={work_id:work,format:'pdf',file_id:fileId,filename:'별들의 책.pdf',size:9,updated_at:'2026-11-02T15:00:00Z',owner_id:owner,object_path:`${owner}/${fileId}.pdf`};

test('책 다운로드 정보는 형식·파일명·소유 경로를 검사하며 한글 첨부 이름을 보존한다',()=>{
 assert(storedBookDownloadSchema.safeParse(file).success);
 assert(!storedBookDownloadSchema.safeParse({...file,object_path:`${other}/${fileId}.pdf`}).success);

 for(const filename of ['../book.pdf','<book>.pdf','book\r\nX-Test:yes.pdf','book.html'])assert(!bookDownloadSchema.safeParse({...file,filename}).success);
 assert(!bookDownloadSchema.safeParse({...file,format:'exe'}).success);
 assert.match(bookAttachment(file.filename),/filename="book.pdf"; filename\*=UTF-8''%EB/);
 assert(!bookAttachment("별's 책.pdf").includes("별's"));
});

test('익명 목록·첨부 API는 현재 공개된 파일만 내려주며 경로 위조·잘못된 형식·누락을 차단한다',async()=>{
 const before={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,fetch:globalThis.fetch};
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-anon';
 let registered=true,storageAllowed=true,invalidPath=false,queries=0,objects=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input)),headers=new Headers(input instanceof Request?input.headers:init?.headers);
  assert.equal(headers.get('Authorization'),'Bearer synthetic-anon');

  if(url.pathname.includes('/rest/v1/book_downloads')){queries++;const selected=invalidPath?{...file,object_path:`${other}/${fileId}.pdf`}:file;

   return Response.json(registered?[selected]:[]);
  }

  assert(url.pathname.includes(`/book-downloads/${file.object_path}`));objects++;

  return storageAllowed?new Response('%PDF-test',{headers:{'Content-Type':'application/pdf'}}):Response.json({message:'not found'},{status:404});
 };

 const request=new Request('https://example.invalid/api/books/unused',{headers:{Authorization:'Bearer never-forward-visitor-token'}});
 const download=(format='pdf',id=work)=>downloadBook(request,{params:Promise.resolve({workId:id,format})});

 try{
  const listed=await listBooks();assert.equal(listed.status,200);const rows=await listed.json();assert.equal(rows.length,1);assert(!('owner_id' in rows[0]));assert(!('object_path' in rows[0]));
  const response=await download();assert.equal(response.status,200);assert.equal(await response.text(),'%PDF-test');assert.match(response.headers.get('Content-Disposition')!,/attachment/);assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.match(response.headers.get('Cache-Control')!,/no-store/);assert.match(response.headers.get('Content-Security-Policy')!,/sandbox/);
  const count=queries;assert.equal((await download('exe')).status,404);assert.equal((await download('pdf','../private')).status,404);assert.equal(queries,count);
  invalidPath=true;assert.equal((await download()).status,502);assert.equal(objects,1);invalidPath=false;
  storageAllowed=false;assert.equal((await download()).status,404);registered=false;assert.equal((await download()).status,404);assert.deepEqual(await (await listBooks()).json(),[]);
 }finally{globalThis.fetch=before.fetch;

  if(before.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=before.url;

  if(before.key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=before.key;
 }
});

test('운영 SQL은 작가만 파일을 등록·교체·해제하며 익명은 활성 작품에 연결된 현재 파일만 읽는다',async()=>{
 const pg=new PGlite(),pub=uid(),otherWork=uid(),newId=uid(),orphanId=uid();

 try{
  await pg.exec(`create role anon;create role authenticated;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;
   create table authors(user_id uuid primary key);alter table authors enable row level security;
   create policy author_self on authors for select to authenticated using(user_id=auth.uid());grant select on authors to authenticated;
   create table publications(id uuid primary key,owner_id uuid,work_id uuid,active boolean);
   alter table publications enable row level security;create policy active_read on publications for select to anon,authenticated using(active);
   grant select(id,work_id,active) on publications to anon,authenticated;
   create schema storage;grant usage on schema storage to anon,authenticated;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));alter table storage.objects enable row level security;
   grant select,insert,update,delete on storage.objects to anon,authenticated;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
  await pg.query('insert into authors values($1),($2)',[owner,other]);
  await pg.query('insert into publications values($1,$2,$3,true),($4,$5,$6,true)',[pub,owner,work,uid(),other,otherWork]);
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261102154315_library_book_downloads.sql',import.meta.url),'utf8'));
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261102161150_protect_registered_book_files.sql',import.meta.url),'utf8'));
  assert.equal((await pg.query<{public:boolean}>("select public from storage.buckets where id='book-downloads'")).rows[0].public,false);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await pg.exec('set role authenticated');
  const object=async(id:string)=>pg.query("insert into storage.objects values('book-downloads',$1)",[`${owner}/${id}.pdf`]);
  await object(fileId);await object(newId);await object(orphanId);
  const insert=()=>pg.query('insert into book_downloads(work_id,format,owner_id,file_id,object_path,filename,size) values($1,$2,$3,$4,$5,$6,$7)',[work,'pdf',owner,fileId,file.object_path,file.filename,file.size]);
  await insert();
  assert.equal((await pg.query('delete from storage.objects where name=$1 returning name',[file.object_path])).rows.length,0,'cleanup cannot delete a registration whose successful response was lost');
  // No UPDATE policy: even the owner cannot mutate a registered object in place.
  assert.equal((await pg.query("update storage.objects set name=name where bucket_id='book-downloads' returning name")).rows.length,0);
  await assert.rejects(()=>pg.query('update book_downloads set owner_id=$1',[other]),/row-level|check constraint/);
  await pg.exec('reset role;set role anon');
  assert.equal((await pg.query('select * from book_downloads')).rows.length,1);
  assert.deepEqual((await pg.query<{name:string}>('select name from storage.objects')).rows.map(row=>row.name),[file.object_path]);
  await assert.rejects(()=>insert(),/permission denied/);
  await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await pg.exec('set role authenticated');
  assert.equal((await pg.query('delete from book_downloads returning file_id')).rows.length,0);
  assert.equal((await pg.query('update book_downloads set size=1 returning file_id')).rows.length,0);
  await assert.rejects(()=>pg.query("insert into storage.objects values('book-downloads',$1)",[`${owner}/${uid()}.pdf`]),/row-level/);
  await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await pg.exec('set role authenticated');
  const replace=()=>pg.query('update book_downloads set file_id=$1,object_path=$2 where work_id=$3 and format=$4 and file_id=$5 returning file_id',[newId,`${owner}/${newId}.pdf`,work,'pdf',fileId]);
  assert.equal((await replace()).rows.length,1);assert.equal((await replace()).rows.length,0);
  assert.equal((await pg.query('delete from storage.objects where name=$1 returning name',[file.object_path])).rows.length,1,'a replaced file can be cleaned up');
  await pg.exec('reset role;set role anon');assert.deepEqual((await pg.query<{name:string}>('select name from storage.objects')).rows.map(row=>row.name),[`${owner}/${newId}.pdf`]);
  await pg.exec('reset role');await pg.query('update publications set active=false where id=$1',[pub]);await pg.exec('set role anon');
  assert.equal((await pg.query('select * from book_downloads')).rows.length,0);assert.equal((await pg.query('select * from storage.objects')).rows.length,0);
  await pg.exec('reset role;set role authenticated');assert.equal((await pg.query('select * from book_downloads')).rows.length,1);
  await pg.exec('reset role');await pg.query('update publications set active=true where id=$1',[pub]);await pg.exec('set role authenticated');
  await pg.query('delete from book_downloads where file_id=$1',[newId]);await pg.exec('reset role;set role anon');assert.equal((await pg.query('select * from storage.objects')).rows.length,0);
 }finally{await pg.close();}
});
