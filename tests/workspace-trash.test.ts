import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { seedWorkspace } from '../src/lib/seed';
import { fromText, makePublication, uid, workspaceSchema, type Workspace } from '../src/lib/model';
import { addNote, newNote } from '../src/lib/personal-notes';
import { editNoteTree, moveNote } from '../src/lib/note-navigation';
import { applyNavigation, insertFolder, moveNavigation, resolveNavigation } from '../src/lib/document-navigation';
import { materializeTrash, preserveTrash, purgeTrash, restoreTrash, trashDocument, trashNote } from '../src/lib/workspace-trash';
import { createBackup, readBackup } from '../src/lib/backup';

function treeOrder(nav:{nodes:{id:string;parentId:string|null;sectionId?:string}[]}){
 const visit=(parentId:string|null,sectionId?:string):unknown[]=>nav.nodes.filter(n=>n.parentId===parentId&&n.sectionId===sectionId).map(n=>({id:n.id,children:visit(n.id,sectionId)}));

 return [...new Set(nav.nodes.map(n=>n.sectionId))].map(sectionId=>({sectionId,nodes:visit(null,sectionId)}));
}

function notes(){
 const parent={...newNote(),title:'생각',content:fromText('복원할 본문'),aiMessages:[]},child={...newNote(),title:'자료'},neighbor=newNote();
 const blob=new Blob(['png'],{type:'image/png'}),asset={id:uid(),noteId:parent.id,name:'자료.png',type:'image/png' as const,size:blob.size};parent.assetIds=[asset.id];
 let state=addNote(addNote(addNote({...seedWorkspace(),assets:[asset]},parent),child,{parentId:parent.id}),neighbor);
 state=editNoteTree(state,w=>insertFolder(w,'하위 폴더',{sectionId:'notes',parentId:parent.id}));

 return {state:materializeTrash(state),parent,child,neighbor,asset,blob,folder:state.noteNavigation!.nodes.find(n=>n.type==='folder')!};
}

function documents(){
 const state=seedWorkspace(),work=state.works[0],[parent,child]=work.documents;
 let tree=moveNavigation(work,child.id,{sectionId:'scene',parentId:parent.id});tree=insertFolder(tree,'하위 폴더',{sectionId:'scene',parentId:parent.id});
 const exclusive={id:uid(),workId:work.id,name:'첨부.png',type:'image/png' as const,size:3},shared={...exclusive,id:uid(),name:'공유.png'};
 tree.documents[0].assetIds=[exclusive.id,shared.id];tree.documents.find(d=>d.id===child.id)!.assetIds=[shared.id];
 tree.aiConversations=[{docId:parent.id,messages:[]},{docId:child.id,messages:[]}];tree.publications=[makePublication(tree,[parent.id])];tree.activePublicationId=tree.publications[0].id;
 state.works[0]=tree;state.assets=[exclusive,shared];

return {state:materializeTrash(state),work:tree,parent:tree.documents[0],child,exclusive,shared};
}

test('노트 휴지통 이동·복원은 단일 항목과 AI·첨부·원래 하위 관계를 보존한다',()=>{
 const {state,parent,child,folder}=notes(),before=structuredClone(state),next=trashNote(state,parent.id);
 assert(!next.notes!.some(n=>n.id===parent.id));assert.equal(next.noteNavigation!.nodes.find(n=>n.id===child.id)!.parentId,null);
 assert.deepEqual(next.trash![0].type==='note'&&next.trash![0].note,parent);assert.deepEqual(next.assets,state.assets);assert.deepEqual(next.works,state.works);assert.deepEqual(state,before);
 const restored=restoreTrash(next,parent.id);assert.equal(restored.trash!.length,0);assert.deepEqual(restored.notes!.find(n=>n.id===parent.id),parent);

 for(const id of [child.id,folder.id])assert.equal(restored.noteNavigation!.nodes.find(n=>n.id===id)!.parentId,parent.id);
 assert.deepEqual(treeOrder(restored.noteNavigation!),treeOrder(state.noteNavigation!));
});

test('휴지통 복원은 그 사이 수정한 노트·이동한 하위 항목을 덮어쓰지 않는다',()=>{
 const {state,parent,child,neighbor}=notes();let next=moveNote(trashNote(state,parent.id),child.id,{parentId:neighbor.id});
 next.notes!.find(n=>n.id===neighbor.id)!.content=fromText('후속 수정');const edited=structuredClone(next.notes!.find(n=>n.id===neighbor.id));
 next=restoreTrash(next,parent.id);assert.equal(next.noteNavigation!.nodes.find(n=>n.id===child.id)!.parentId,neighbor.id);assert.deepEqual(next.notes!.find(n=>n.id===neighbor.id),edited);
});

test('없어진 상위 폴더는 최상위로 복원하며 없어진 작품에는 안전하게 복원을 거절한다',()=>{
 const {state,parent}=notes();const folder=uid();state.noteNavigation!.nodes.push({id:folder,type:'folder',title:'원래 위치',parentId:null});state.noteNavigation!.nodes.find(n=>n.id===parent.id)!.parentId=folder;
 const moved=trashNote(state,parent.id);moved.noteNavigation!.nodes=moved.noteNavigation!.nodes.filter(n=>n.id!==folder).map(n=>n.parentId===folder?{...n,parentId:null}:n);
 assert.equal(restoreTrash(moved,parent.id).noteNavigation!.nodes.find(n=>n.id===parent.id)!.parentId,null);
 const docs=documents(),deleted=trashDocument(docs.state,docs.work.id,docs.parent.id);deleted.works=deleted.works.filter(w=>w.id!==docs.work.id);
 assert.throws(()=>restoreTrash(deleted,docs.parent.id),/원래 작품/);assert.equal(deleted.trash!.length,1);
});

test('문서 휴지통은 속성·AI·공개 판본·공유 첨부를 보존하며 복원 시 대분류를 다시 만든다',()=>{
 const {state,work,parent,child}=documents(),before=structuredClone(state);let next=trashDocument(state,work.id,parent.id);
 assert.deepEqual(state,before);assert.deepEqual(next.assets,state.assets);assert.deepEqual(next.works[0].publications,work.publications);
 assert.deepEqual(next.works[0].aiConversations,[{docId:child.id,messages:[]}]);assert.equal(next.works[0].navigation!.nodes.find(n=>n.id===child.id)!.parentId,work.navigation!.nodes.find(n=>n.id===parent.id)!.parentId);
 const restored=restoreTrash(next,parent.id);assert.deepEqual(restored.works[0].documents.find(d=>d.id===parent.id),parent);assert(restored.works[0].aiConversations!.some(c=>c.docId===parent.id));
 assert.deepEqual(treeOrder(restored.works[0].navigation!),treeOrder(work.navigation!));
 // A custom section that becomes empty can be removed while its document is in trash.
 const memo=work.documents.find(d=>d.kind==='memo')!;work.navigation!.sections.push({id:'research',title:'자료',defaultKind:'memo'});state.works[0]=moveNavigation(work,memo.id,{sectionId:'research',parentId:null});
 next=trashDocument(state,work.id,memo.id);next.works[0].navigation!.sections=next.works[0].navigation!.sections.filter(s=>s.id!=='research');
 const recovered=restoreTrash(next,memo.id);assert(recovered.works[0].navigation!.sections.some(s=>s.id==='research'));assert.equal(recovered.works[0].navigation!.nodes.find(n=>n.id===memo.id)!.sectionId,'research');
});

test('영구 삭제는 선택 항목과 미사용 첨부 목록만 지우고 다른 휴지통·공유 첨부는 유지한다',()=>{
 const docs=documents(),note=notes();let state:Workspace={...docs.state,notes:note.state.notes,noteNavigation:note.state.noteNavigation,assets:[...docs.state.assets,...note.state.assets]};
 state=trashNote(trashDocument(state,docs.work.id,docs.parent.id),note.parent.id);const next=purgeTrash(state,[docs.parent.id]);
 assert.deepEqual(next.trash!.map(t=>t.id),[note.parent.id]);assert(!next.assets.some(a=>a.id===docs.exclusive.id));assert(next.assets.some(a=>a.id===docs.shared.id));assert(next.assets.some(a=>a.id===note.asset.id));assert.equal(state.trash!.length,2);
});

test('휴지통은 백업에서 본문·대화·첨부 실제 바이트를 왕복 복원한다',async()=>{
 const {state,parent,asset,blob}=notes(),moved=trashNote(state,parent.id),zip=await createBackup(moved,[],[{id:asset.id,blob}]),backup=await readBackup(zip);
 assert.deepEqual(backup.data,moved);assert.equal(await backup.assets[0].blob.text(),'png');assert.deepEqual(restoreTrash(backup.data,parent.id).notes!.find(n=>n.id===parent.id),parent);
 const files=await JSZip.loadAsync(await zip.arrayBuffer());assert((await files.file(`text/trash/${parent.id}.md`)!.async('string')).includes('복원할 본문'));
});

test('이전 백업의 필드 누락은 현재 휴지통과 첨부를 유지하고 명시적 빈 목록은 그대로 복원한다',()=>{
 const {state,parent,asset}=notes(),moved=trashNote(state,parent.id),legacy=seedWorkspace();
 const preserved=preserveTrash(legacy,moved);assert.equal(preserved.trash!.length,1);assert(preserved.assets.some(a=>a.id===asset.id));assert(workspaceSchema.safeParse(preserved).success);
 assert.deepEqual(preserveTrash({...legacy,trash:[]},moved).trash,[]);assert.deepEqual(preserveTrash(state,moved).trash,[]);
 const original=structuredClone(state);delete original.trash;assert.deepEqual(preserveTrash(original,moved).trash,[]);
});

test('마지막 노트는 휴지통으로 이동 가능하고 마지막 작품 문서·중복 ID·손상 첨부는 거절한다',()=>{
 const {state,parent}=notes();let next=trashNote(state,parent.id);

for(const note of next.notes!)next=trashNote(next,note.id);assert.deepEqual(next.notes,[]);
 const last=state.works[1];assert.throws(()=>trashDocument(state,last.id,last.documents[0].id),/최소 1개/);
 const duplicate={...trashNote(state,parent.id),notes:state.notes};assert(!workspaceSchema.safeParse(duplicate).success);
 const damaged=trashNote(state,parent.id);damaged.assets=[];assert(!workspaceSchema.safeParse(damaged).success);
});

test('운영 보호 SQL은 휴지통 왕복·비우기를 허용하며 이전 클라이언트의 누락·손상·중복을 막는다',async()=>{
 const pg=new PGlite();

try{
  await pg.exec('create role anon; create role authenticated; create table public.workspaces (id integer primary key,payload jsonb not null);');

  for(const file of ['002_document_navigation_guard.sql','003_ai_preferences_guard.sql','20261004063340_independent_notes_guard.sql','20261004074609_note_hierarchy_ai_guard.sql','20261004104045_workspace_trash_guard.sql'])await pg.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const {state,parent}=notes();state.works=state.works.map(w=>applyNavigation(w,resolveNavigation(w)));await pg.query('insert into workspaces values (1,$1)',[JSON.stringify(state)]);
  const next=trashNote(state,parent.id);await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(next)]);
  const legacy=structuredClone(next);delete legacy.trash;await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(legacy)]),/휴지통을 보호/);

  for(const damage of [{...next,trash:null},{...next,trash:[...next.trash!,...next.trash!]},{...next,notes:state.notes},{...next,trash:[{...next.trash![0],placement:null}]},{...next,assets:[]}])await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(damage)]),/휴지통/);
  await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(restoreTrash(next,parent.id))]);
  const work=state.works[0],doc=trashDocument(state,work.id,work.documents[0].id);await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(doc)]);
  const purged=purgeTrash(doc,doc.trash!.map(t=>t.id));await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(purged)]);
  assert.deepEqual((await pg.query<{payload:typeof state}>('select payload from workspaces where id=1')).rows[0].payload,purged);
 }finally{await pg.close();}
});
