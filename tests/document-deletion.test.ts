import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../src/lib/seed';
import { fromText, makePublication, uid, workspaceSchema } from '../src/lib/model';
import { addNote, newNote, removeNote } from '../src/lib/personal-notes';
import { editNoteTree } from '../src/lib/note-navigation';
import { applyNavigation, insertFolder, moveNavigation, resolveNavigation } from '../src/lib/document-navigation';
import { removeDocument } from '../src/lib/document-deletion';
import { createBackup, readBackup } from '../src/lib/backup';

function noteFixture(){
  const parent={...newNote(),title:'상위 생각',content:fromText('보관할 내용')},child={...newNote(),title:'하위 자료'},neighbor={...newNote(),title:'다음 생각'};
  let state=addNote(addNote(addNote(seedWorkspace(),neighbor),parent,{parentId:null,beforeId:neighbor.id}),child,{parentId:parent.id});
  state=editNoteTree(state,w=>insertFolder(w,'하위 폴더',{sectionId:'notes',parentId:parent.id}));

  return {state,parent,child,neighbor,folder:state.noteNavigation!.nodes.find(n=>n.type==='folder')!};
}

test('노트 삭제는 선택 노트만 제거하고 하위 항목을 기존 형제 위치에 보존한다',()=>{
  const {state,parent,child,neighbor,folder}=noteFixture(),before=structuredClone(state);
  const next=removeNote(state,parent.id),nav=next.noteNavigation!;
  assert.deepEqual(nav.nodes.filter(n=>n.parentId===null).map(n=>n.id),[child.id,folder.id,neighbor.id]);
  assert.deepEqual(next.notes,state.notes!.filter(n=>n.id!==parent.id));assert.deepEqual(next.works,state.works);
  assert.deepEqual(state,before);assert(workspaceSchema.safeParse(next).success);
  const nested=addNote(state,newNote(),{parentId:child.id}),removed=removeNote(nested,parent.id);
  assert.equal(removed.noteNavigation!.nodes.find(n=>n.id===nested.notes!.at(-1)!.id)!.parentId,child.id);
});

test('마지막 노트 삭제 후에도 빈 notes와 계층을 명시하며 삭제 전 첨부는 ZIP 이력에서 복원된다',async()=>{
  const note=newNote(),blob=new Blob(['png']),asset={id:uid(),noteId:note.id,name:'첨부.png',type:'image/png' as const,size:blob.size};note.assetIds=[asset.id];
  const before=addNote({...seedWorkspace(),assets:[asset]},note),next=removeNote(before,note.id);
  assert.deepEqual(next.notes,[]);assert.deepEqual(next.noteNavigation,{version:1,nodes:[]});assert.deepEqual(next.assets,[]);
  const revision={id:uid(),namespace:'test',createdAt:before.updatedAt,label:'노트 삭제 전',data:before};
  const backup=await readBackup(await createBackup(next,[revision],[{id:asset.id,blob}]));
  assert.deepEqual(backup.data.notes,[]);assert.deepEqual(backup.revisions[0].data,before);assert.equal(await backup.assets[0].blob.text(),'png');
});

test('문서 삭제는 하위 순서·공개 판본·공유 첨부를 보존하고 해당 AI 대화만 제거한다',()=>{
  const state=seedWorkspace(),work=state.works[0],[parent,child,neighbor]=work.documents.filter(d=>d.kind==='scene');
  let tree=moveNavigation(work,child.id,{sectionId:'scene',parentId:parent.id});tree=moveNavigation(tree,neighbor.id,{sectionId:'scene',parentId:tree.navigation!.nodes.find(n=>n.id===parent.id)!.parentId});tree=insertFolder(tree,'자료',{sectionId:'scene',parentId:parent.id});
  const folder=tree.navigation!.nodes.find(n=>n.type==='folder'&&n.title==='자료')!;
  const exclusive={id:uid(),workId:work.id,name:'원본.png',type:'image/png' as const,size:3},shared={...exclusive,id:uid(),name:'공유.png'};
  tree.documents.find(d=>d.id===parent.id)!.assetIds=[exclusive.id,shared.id];tree.documents.find(d=>d.id===child.id)!.assetIds=[shared.id];
  tree.aiConversations=[{docId:parent.id,messages:[]},{docId:child.id,messages:[]}];
  const publication=makePublication(tree,[parent.id]);tree.publications=[publication];tree.activePublicationId=publication.id;
  state.works[0]=tree;state.assets=[exclusive,shared];const before=structuredClone(state),next=removeDocument(state,work.id,parent.id),updated=next.works[0];
  assert.deepEqual(updated.navigation!.nodes.filter(n=>n.parentId===tree.navigation!.nodes.find(n=>n.id===parent.id)!.parentId).map(n=>n.id),[child.id,folder.id,neighbor.id]);
  assert.deepEqual(updated.documents.find(d=>d.id===child.id),tree.documents.find(d=>d.id===child.id));
  assert.deepEqual(updated.publications,[publication]);assert.equal(updated.activePublicationId,publication.id);
  assert.deepEqual(updated.aiConversations,[{docId:child.id,messages:[]}]);assert.deepEqual(next.assets,[shared]);
  assert.deepEqual(next.works[1],state.works[1]);assert.deepEqual(state,before);assert(workspaceSchema.safeParse(next).success);
});

test('마지막 문서 삭제는 빈 원고를 남기고 없는 대상은 거절한다',()=>{
  const state=seedWorkspace(),last=state.works[1],before=structuredClone(state),removed=removeDocument(state,last.id,last.documents[0].id),replacement=removed.works[1].documents[0];
  assert.equal(removed.works[1].documents.length,1);assert.notEqual(replacement.id,last.documents[0].id);assert.equal(replacement.title,'새 장면');assert.equal(replacement.chapter,'');assert.equal(replacement.content.content?.[0].content?.length||0,0);
  assert.equal(resolveNavigation(removed.works[1]).nodes.find(n=>n.id===replacement.id)?.parentId,null);assert(workspaceSchema.safeParse(removed).success);assert.deepEqual(state,before);
  assert.throws(()=>removeDocument(state,uid(),uid()),/찾지/);assert.throws(()=>removeNote(state,uid()),/찾지/);
  const work=state.works[0],deleted=removeDocument(state,work.id,work.documents.find(d=>d.kind==='wiki')!.id);
  assert(workspaceSchema.safeParse(deleted).success);assert(resolveNavigation(deleted.works[0]).nodes.every(n=>n.type==='folder'||deleted.works[0].documents.some(d=>d.id===n.id)));
});

test('운영과 같은 보호 SQL에서 노트·문서 삭제와 삭제 전 상태 복원을 허용한다',async()=>{
  const pg=new PGlite();

try{
    await pg.exec('create role anon; create role authenticated; create table public.workspaces (id integer primary key,payload jsonb not null);');

    for(const file of ['002_document_navigation_guard.sql','003_ai_preferences_guard.sql','20261004063340_independent_notes_guard.sql','20261004074609_note_hierarchy_ai_guard.sql'])await pg.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    const {state,parent}=noteFixture();state.works=state.works.map(w=>applyNavigation(w,resolveNavigation(w)));
    const before=workspaceSchema.parse(state);await pg.query('insert into workspaces values (1,$1)',[JSON.stringify(before)]);
    const notesDeleted=removeNote(before,parent.id),work=notesDeleted.works[0],next=removeDocument(notesDeleted,work.id,work.documents[0].id);
    await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(next)]);
    await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(before)]);
    assert.deepEqual((await pg.query<{payload:typeof before}>('select payload from workspaces where id=1')).rows[0].payload,before);
  }finally{await pg.close();}
});
