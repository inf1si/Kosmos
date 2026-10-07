import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { seedWorkspace } from '../src/lib/seed';
import { fromText, uid, withdrawPublication, workspaceSchema } from '../src/lib/model';
import { addNote, newNote } from '../src/lib/personal-notes';
import { applyNavigation, resolveNavigation } from '../src/lib/document-navigation';
import { materializeTrash, preserveTrash, purgeTrash, restoreTrash, trashDocument, trashWork } from '../src/lib/workspace-trash';
import { createBackup, readBackup } from '../src/lib/backup';

/** Seed works (the first is published) plus a note linking both, and two attachments of the first work. */
function fixture(){
 let state=seedWorkspace();const [first,second]=state.works;
 const used={id:uid(),workId:first.id,name:'지도.png',type:'image/png' as const,size:3},orphan={...used,id:uid(),name:'남은.png'};
 first.documents[0].assetIds=[used.id];state.assets=[used,orphan];
 const note={...newNote(),title:'두 작품 메모',content:fromText('연결'),linkedWorkIds:[first.id,second.id]};state=addNote(state,note);
 state.works=state.works.map(w=>applyNavigation(w,resolveNavigation(w)));

 return {state:materializeTrash(state),first:state.works[0],second,note,used,orphan};
}

test('작품 휴지통 이동은 작품 전체를 보관하고 노트 연결을 떼며 복원 시 같은 자리·연결로 되돌린다',()=>{
 const {state,first,second,note}=fixture(),before=structuredClone(state),next=trashWork(state,first.id);
 assert.deepEqual(state,before);assert.deepEqual(next.works.map(w=>w.id),[second.id]);
 assert.deepEqual(next.notes!.find(n=>n.id===note.id)!.linkedWorkIds,[second.id]);assert.deepEqual(next.assets,state.assets);
 const item=next.trash![0];assert(item.type==='work');assert.equal(item.index,0);assert.deepEqual(item.noteIds,[note.id]);
 assert.equal(item.work.activePublicationId,null,'휴지통 사본은 게시 중이 아니다');assert.deepEqual(item.work.publications,first.publications);
 const restored=restoreTrash(next,first.id);assert.deepEqual(restored.works.map(w=>w.id),[first.id,second.id]);
 assert.deepEqual(restored.works[0],{...first,activePublicationId:null});assert.deepEqual(restored.notes!.find(n=>n.id===note.id)!.linkedWorkIds,[second.id,first.id]);
 assert.equal(restored.trash!.length,0);assert(workspaceSchema.safeParse(restored).success);
});

test('마지막 작품은 옮기지 않고, 휴지통에 있는 작품의 문서는 작품을 먼저 복원하라고 알린다',()=>{
 const {state,first,second}=fixture();assert.throws(()=>trashWork(trashWork(state,first.id),second.id),/마지막 작품/);
 assert.throws(()=>trashWork(state,uid()),/찾지 못했습니다/);
 const doc=trashDocument(state,first.id,first.documents[1].id),both=trashWork(doc,first.id);
 assert.throws(()=>restoreTrash(both,first.documents[1].id),/작품을 복원한 뒤/);
 assert(restoreTrash(restoreTrash(both,first.id),first.documents[1].id).works[0].documents.some(d=>d.id===first.documents[1].id));
});

test('작품 영구 삭제는 그 작품의 첨부만 지우고, 휴지통 사본의 첨부가 사라지면 거절한다',()=>{
 const {state,first,used,orphan}=fixture(),moved=trashWork(state,first.id),purged=purgeTrash(moved,[first.id]);
 assert.deepEqual(purged.trash,[]);assert(!purged.assets.some(a=>a.id===used.id||a.id===orphan.id));
 assert(!workspaceSchema.safeParse({...moved,assets:[]}).success);
 // An old backup without trash keeps the trashed work and its attachments.
 const legacy=structuredClone(seedWorkspace());delete legacy.trash;legacy.works=moved.works;legacy.assets=[];
 const kept=preserveTrash(legacy,moved);assert.equal(kept.trash!.length,1);assert(kept.assets.some(a=>a.id===used.id)&&kept.assets.some(a=>a.id===orphan.id));
});

test('휴지통 작품은 백업에서 왕복하고 읽기용 사본에 문서별 본문을 남긴다',async()=>{
 const {state,first}=fixture(),moved=trashWork(state,first.id);moved.assets=[];moved.trash![0].type==='work'&&(moved.trash![0].work.documents[0].assetIds=[]);
 const backup=await readBackup(await createBackup(moved,[],[]));assert.deepEqual(backup.data,moved);
 const files=await JSZip.loadAsync(await (await createBackup(moved,[],[])).arrayBuffer()),text=await files.file(`text/trash/${first.id}.md`)!.async('string');
 assert(text.startsWith(`# ${first.title}`));assert(text.includes(`## ${first.documents[0].title}`));
});

test('게시 철회는 공개 판본 연결만 끊고 판본 기록은 남긴다',()=>{
 const {state,first}=fixture(),next=withdrawPublication(state,first.id);
 assert.equal(next.works[0].activePublicationId,null);assert.deepEqual(next.works[0].publications,first.publications);assert.deepEqual(next.works[1],state.works[1]);
});

test('운영 SQL은 작품 휴지통을 저장하고 손상을 거절하며 게시 철회는 본인 판본만 내린다',async()=>{
 const pg=new PGlite();

 try{
  await pg.exec(`create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create table public.workspaces (id integer primary key,payload jsonb not null);create table public.authors (user_id uuid primary key);
   create table public.publications (id uuid primary key,owner_id uuid not null,work_id uuid not null,active boolean not null default true,payload jsonb not null default '{}');`);

  for(const file of ['002_document_navigation_guard.sql','003_ai_preferences_guard.sql','20261004063340_independent_notes_guard.sql','20261004074609_note_hierarchy_ai_guard.sql','20261004104045_workspace_trash_guard.sql']) await pg.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const {state,first}=fixture(),moved=trashWork(state,first.id);await pg.query('insert into workspaces values (1,$1)',[JSON.stringify(state)]);
  await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(moved)]),/휴지통 항목/,'이전 보호 함수는 작품 항목을 모른다');
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261007081500_work_trash_unpublish.sql',import.meta.url),'utf8'));
  await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(moved)]);
  const item=moved.trash![0];assert(item.type==='work');

  for(const damage of [{...moved,assets:[]},{...moved,trash:[{...item,work:{...item.work,id:uid()}}]},{...moved,trash:[{...item,work:{...item.work,documents:[]}}]},{...moved,trash:[{...item,noteIds:null}]},{...moved,works:[...moved.works,first]}])await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(damage)]),/휴지통/);
  const back=restoreTrash(moved,first.id);await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(back)]);
  await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(purgeTrash(trashWork(back,first.id),[first.id]))]);

  const me=uid(),other=uid(),work=uid();await pg.query('insert into authors values ($1),($2)',[me,other]);
  await pg.query('insert into publications(id,owner_id,work_id) values ($1,$2,$3),($4,$5,$3)',[uid(),me,work,uid(),other]);
  await assert.rejects(()=>pg.query('select unpublish_work($1)',[work]),/Author access/);
  await pg.exec(`set test.uid='${me}'`);
  assert.equal((await pg.query<{n:number}>('select unpublish_work($1) n',[work])).rows[0].n,1);assert.equal((await pg.query<{n:number}>('select unpublish_work($1) n',[work])).rows[0].n,0);
  assert.deepEqual((await pg.query<{owner_id:string;active:boolean}>('select owner_id,active from publications order by active')).rows.map(r=>[r.owner_id,r.active]),[[me,false],[other,true]]);
 }finally{await pg.close();}
});
