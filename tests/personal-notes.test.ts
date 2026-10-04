import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { addNote, filterNotes, newNote, noteTitle, patchNote, prepareNoteCopy, preserveNotes } from '../src/lib/personal-notes';
import { fromText, makePublication, uid, workspaceSchema } from '../src/lib/model';
import { seedWorkspace } from '../src/lib/seed';
import { createBackup, readBackup } from '../src/lib/backup';

function fixture(){
  const state=seedWorkspace(),note=newNote();note.content=fromText('기억을 세금으로 내는 도시\n\n시민은 무엇을 감추는가?');
  const other=structuredClone(state.works[0]);other.id=uid();other.title='두 번째 작품';other.documents=other.documents.map(d=>({...d,id:uid(),assetIds:[]}));delete other.navigation;other.publications=[];other.activePublicationId=null;other.aiConversations=[];
  state.works.push(other);return {state:addNote(state,note),note};
}
test('제목 없는 독립 노트는 첫 줄로 표시하고 작품 없이 생성·검색·보관된다',()=>{
  const {state,note}=fixture();assert.equal(noteTitle(note),'기억을 세금으로 내는 도시');assert.deepEqual(note.linkedWorkIds,[]);
  const tagged=patchNote(state,note.id,{tags:['사회','기억'],box:'icebox'});
  assert.equal(filterNotes(tagged.notes!,{query:'세금 시민',box:'all'})[0].id,note.id);
  assert.equal(filterNotes(tagged.notes!,{query:'사회',tag:'기억',box:'icebox'}).length,1);
  assert.equal(filterNotes(tagged.notes!,{box:'inbox'}).length,0);
  assert.equal(filterNotes(tagged.notes!,{workId:state.works[0].id}).length,0);
  assert.deepEqual(state.notes![0].tags,[]);assert.equal(noteTitle({...note,title:'독립 제목'}),'독립 제목');
});
test('여러 작품 연결은 원본을 공유하고 잘못된 ID·중복·첨부 소속을 거절한다',()=>{
  const {state,note}=fixture();const linked=patchNote(state,note.id,{linkedWorkIds:state.works.map(w=>w.id)});
  assert.equal(linked.notes!.length,1);assert.equal(filterNotes(linked.notes!,{workId:state.works[1].id}).length,1);
  assert.throws(()=>patchNote(state,note.id,{linkedWorkIds:[uid()]}),/작품/);
  assert.throws(()=>patchNote(state,note.id,{tags:['중복','중복']}));
  assert.throws(()=>patchNote(state,note.id,{linkedWorkIds:[state.works[0].id,state.works[0].id]}));
  const invalid=structuredClone(linked);invalid.notes![0].id=invalid.works[0].documents[0].id;assert(!workspaceSchema.safeParse(invalid).success);
  const id=uid();linked.assets.push({id,workId:state.works[0].id,name:'다른소속.png',type:'image/png',size:1});linked.notes![0].assetIds=[id];assert(!workspaceSchema.safeParse(linked).success);
});
test('작품 가져오기는 비공개 사본과 새 첨부 ID를 만들고 원본·다른 작품을 보존한다',()=>{
  const {state,note}=fixture();const assetId=uid();state.assets.push({id:assetId,noteId:note.id,name:'자료.png',type:'image/png',size:4});state.notes![0].assetIds=[assetId];
  const original=structuredClone(state.notes![0]),other=structuredClone(state.works[1]);
  for(const kind of ['scene','wiki','memo'] as const){const copy=prepareNoteCopy(state,note.id,state.works[0].id,kind),doc=copy.state.works[0].documents.find(d=>d.id===copy.docId)!;
    assert.equal(doc.kind,kind);assert.equal(doc.isPublic,false);assert.notEqual(doc.content,state.notes![0].content);assert.equal(doc.title,noteTitle(note));
    assert.deepEqual(copy.copies.map(c=>c.sourceId),[assetId]);assert.notEqual(doc.assetIds[0],assetId);assert.equal(copy.state.assets.find(a=>a.id===doc.assetIds[0])!.workId,state.works[0].id);
    assert.deepEqual(copy.state.works[1],other);doc.content=fromText('사본만 편집');assert.deepEqual(state.notes![0],original);
    assert.deepEqual(copy.state.notes![0].assetIds,[assetId]);assert.deepEqual(copy.state.notes![0].linkedWorkIds,[state.works[0].id]);assert(workspaceSchema.safeParse(copy.state).success);
  }
});
test('전체 ZIP과 이력은 노트·태그·관계·첨부 바이트를 보존하고 공개판은 노트를 제외한다',async()=>{
  const {state,note}=fixture(),id=uid(),blob=new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});
  state.notes![0]={...state.notes![0],tags:['비공개'],box:'icebox',linkedWorkIds:state.works.map(w=>w.id),assetIds:[id]};state.assets.push({id,noteId:note.id,name:'개인자료.png',type:'image/png',size:4});
  const data=workspaceSchema.parse(state),archive=await createBackup(data,[{id:uid(),namespace:'test',label:'노트 이력',createdAt:new Date().toISOString(),data}],[{id,blob}]);
  const restored=await readBackup(archive);assert.deepEqual(restored.data,data);assert.deepEqual(restored.revisions[0].data.notes,data.notes);assert.deepEqual(new Uint8Array(await restored.assets[0].blob.arrayBuffer()),new Uint8Array(await blob.arrayBuffer()));
  const zip=await JSZip.loadAsync(await archive.arrayBuffer());assert((await zip.file(`text/notes/${note.id}.md`)!.async('string')).includes('기억을 세금'));
  assert(!JSON.stringify(makePublication(state.works[0],[state.works[0].documents[0].id])).includes('기억을 세금'));
});
test('노트 필드가 없는 이전 백업 복원은 현재 노트와 첨부를 보존하며 사라진 작품 연결을 정리한다',()=>{
  const {state,note}=fixture(),id=uid();state.notes![0].assetIds=[id];state.notes![0].linkedWorkIds=state.works.map(w=>w.id);state.assets.push({id,noteId:note.id,name:'현재첨부.png',type:'image/png',size:4});
  const legacy=structuredClone(state);delete legacy.notes;delete legacy.noteNavigation;legacy.assets=[];legacy.works=legacy.works.slice(0,1);assert(workspaceSchema.safeParse(legacy).success);
  const kept=preserveNotes(legacy,state);assert.equal(kept.notes!.length,1);assert.deepEqual(kept.notes![0].linkedWorkIds,[legacy.works[0].id]);assert.equal(kept.assets[0].noteId,note.id);assert(workspaceSchema.safeParse(kept).success);
  assert.equal(preserveNotes({...legacy,notes:[]},state).notes!.length,0);
});
test('서버 트리거는 이전 클라이언트의 노트 누락을 막고 정상 변경·명시적 복원을 허용한다',async()=>{
  const pg=new PGlite();try{
    await pg.exec('create role anon; create role authenticated; create table public.workspaces (id integer primary key, payload jsonb not null);');
    await pg.exec(readFileSync(new URL('../supabase/migrations/20261004063340_independent_notes_guard.sql',import.meta.url),'utf8'));
    const {state}=fixture();await pg.query('insert into public.workspaces values (1, $1)',[JSON.stringify(state)]);
    const legacy={...state};delete legacy.notes;await assert.rejects(()=>pg.query('update public.workspaces set payload=$1 where id=1',[JSON.stringify(legacy)]),/노트/);
    await pg.query('update public.workspaces set payload=$1 where id=1',[JSON.stringify({...state,notes:[]})]);
    await pg.query('update public.workspaces set payload=$1 where id=1',[JSON.stringify(state)]);
    const broken=structuredClone(state);broken.notes![0].linkedWorkIds=[uid()];await assert.rejects(()=>pg.query('update public.workspaces set payload=$1 where id=1',[JSON.stringify(broken)]),/작품/);
    assert.equal((await pg.query<{payload:typeof state}>('select payload from workspaces')).rows[0].payload.notes!.length,1);
  }finally{await pg.close();}
});
