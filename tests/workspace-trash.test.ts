import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { seedWorkspace } from '../src/lib/seed';
import { fromText, makePublication, uid, workspaceSchema, type Workspace } from '../src/lib/model';
import { addNote, newNote } from '../src/lib/personal-notes';
import { editNoteTree, moveNote } from '../src/lib/note-navigation';
import { applyNavigation, insertFolder, moveNavigation, resolveNavigation } from '../src/lib/document-navigation';
import { materializeTrash, preserveTrash, purgeTrash, restoreTrash, trashDocument, trashDocumentFolder, trashNote, trashNoteFolder, trashRows, trashWork } from '../src/lib/workspace-trash';
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

function folderTree(){
 const state=seedWorkspace();let work=state.works[0];const [a,b,c]=work.documents,first=resolveNavigation(work).nodes.find(n=>n.parentId===null&&n.sectionId==='scene')!;
 const folderNamed=(title:string)=>resolveNavigation(work).nodes.find(n=>n.type==='folder'&&n.title===title)!.id;
 work=insertFolder(work,'1부',{sectionId:'scene',parentId:null});const folder=folderNamed('1부');work=moveNavigation(work,folder,{sectionId:'scene',parentId:null,beforeId:first.id});
 work=insertFolder(work,'1장',{sectionId:'scene',parentId:folder});const chapter=folderNamed('1장');work=insertFolder(work,'빈 폴더',{sectionId:'scene',parentId:folder});
 work=moveNavigation(work,a.id,{sectionId:'scene',parentId:folder,beforeId:chapter});work=moveNavigation(work,b.id,{sectionId:'scene',parentId:chapter});work=moveNavigation(work,c.id,{sectionId:'scene',parentId:b.id});
 work.aiConversations=[{docId:b.id,messages:[]}];state.works[0]=work;
 const [x,y,z]=[a,b,c].map(d=>work.documents.find(w=>w.id===d.id)!);

 return {state:materializeTrash(state),work,folder,chapter,a:x,b:y,c:z};
}

function damagedFolder(){
 const {state,work,folder}=folderTree(),next=trashDocumentFolder(state,work.id,folder),item=next.trash!.find(t=>t.type==='document'&&t.folder?.nodes)!;
 assert(item.type==='document'&&item.folder);const a=uid(),b=uid();
 item.folder.nodes=[{id:folder,parentId:null,title:'1부'},{id:item.id,parentId:a},{id:a,parentId:b},{id:b,parentId:a}];

 return {next,folder};
}

test('휴지통의 순환 폴더 구조는 작업공간 검증에서 거절한다',()=>{
 assert.equal(workspaceSchema.safeParse(damagedFolder().next).success,false);
});

test('검증을 우회한 폴더 복원도 멈추지 않고 원본을 보존하며 거절한다',()=>{
 const {next,folder}=damagedFolder();

 // Bound the real restore call so a regression cannot freeze the test process.
 const code=`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {restoreTrash} from './src/lib/workspace-trash.ts';
 const {next,folder}=JSON.parse(readFileSync(0,'utf8')),before=structuredClone(next);
 assert.throws(()=>restoreTrash(next,folder),/휴지통 폴더/);assert.deepEqual(next,before);`;

 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',code],{cwd:new URL('..',import.meta.url),input:JSON.stringify({next,folder}),encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined,`복원이 끝나지 않았습니다: ${result.error?.message}`);assert.equal(result.status,0,result.stderr);
});

test('폴더 복원 정보는 유일한 루트·부모·ID·깊이를 검사하고 원래 외부 부모는 허용한다',()=>{
 const {state,work,folder}=folderTree(),next=trashDocumentFolder(state,work.id,folder),item=next.trash!.find(t=>t.type==='document'&&t.folder?.nodes)!;
 assert(item.type==='document'&&item.folder?.nodes);const nodes=item.folder.nodes;

 const invalid=[[],nodes.filter(n=>n.id!==folder),[...nodes,nodes[0]],nodes.map(n=>n.id===folder?{...n,title:undefined}:n),
  nodes.map(n=>n.id!==folder?{...n,parentId:null}:n),nodes.map(n=>n.id!==folder?{...n,parentId:uid()}:n),
  nodes.map(n=>n.id===folder?{...n,parentId:folder}:n),nodes.map(n=>n.id===folder?{...n,parentId:nodes.find(x=>x.id!==folder)!.id}:n)];

 const deep:{id:string;parentId:string|null;title:string}[]=Array.from({length:25},(_,i)=>({id:i===0?folder:uid(),parentId:null,title:'하위 폴더'}));
 deep.forEach((n,i)=>{if(i)n.parentId=deep[i-1].id;});invalid.push(deep);

 for(const damaged of invalid){
  const copy=structuredClone(next),target=copy.trash!.find(t=>t.id===item.id)!;assert(target.type==='document'&&target.folder);
  target.folder.nodes=damaged;assert.equal(workspaceSchema.safeParse(copy).success,false);assert.throws(()=>restoreTrash(copy,folder),/휴지통 폴더/);
 }

 // A deleted nested folder still points at a live parent outside the saved subtree.
 let nested=insertFolder(work,'상위',{sectionId:'scene',parentId:null});const outer=resolveNavigation(nested).nodes.find(n=>n.type==='folder'&&n.title==='상위')!.id;
 nested=moveNavigation(nested,folder,{sectionId:'scene',parentId:outer});const before={...state,works:state.works.map(w=>w.id===work.id?nested:w)},deleted=trashDocumentFolder(before,work.id,folder);
 assert(workspaceSchema.safeParse(deleted).success);assert.deepEqual(treeOrder(restoreTrash(deleted,folder).works[0].navigation!),treeOrder(nested.navigation!));
});

test('휴지통 표시 개수는 문서·노트 폴더를 각각 하나로 묶고 낱개·작품도 센다',()=>{
 const docs=folderTree(),folderTrash=trashDocumentFolder(docs.state,docs.work.id,docs.folder);
 const n=notes();let noteState=editNoteTree(n.state,w=>insertFolder(w,'묶음',{sectionId:'notes',parentId:null}));
 const noteFolder=noteState.noteNavigation!.nodes.find(n=>n.type==='folder'&&n.title==='묶음')!.id;noteState=moveNote(noteState,n.parent.id,{parentId:noteFolder});
 const single=trashDocument(docs.state,docs.work.id,docs.work.documents.find(d=>![docs.a.id,docs.b.id,docs.c.id].includes(d.id))!.id).trash![0];
 const work=trashWork(seedWorkspace(),seedWorkspace().works[1].id).trash![0];
 const items=[...folderTrash.trash!,...trashNoteFolder(noteState,noteFolder).trash!,single,work].map((item,i)=>({...item,deletedAt:new Date(Date.UTC(2026,9,8,0,i)).toISOString()}));
 const before=structuredClone(items),rows=trashRows(items);
 assert.equal(rows.length,4);assert.deepEqual(rows.map(row=>row.id),[work.id,single.id,noteFolder,docs.folder]);
 assert.deepEqual(rows.find(row=>row.id===docs.folder)!.ids.slice().sort(),[docs.a.id,docs.b.id,docs.c.id].sort());assert.deepEqual(items,before);
 assert.equal(trashRows(purgeTrash(folderTrash,[docs.b.id]).trash).length,1);assert.equal(trashRows(restoreTrash(folderTrash,docs.folder).trash).length,0);assert.deepEqual(trashRows(),[]);
});

test('폴더 계층을 ZIP으로 왕복하고 무결성이 맞아도 순환 구조가 있으면 가져오기를 거절한다',async()=>{
 const {state,work,folder}=folderTree(),deleted=trashDocumentFolder(state,work.id,folder),zip=await createBackup(deleted,[],[]),backup=await readBackup(zip);
 assert.deepEqual(backup.data.trash,deleted.trash);assert.deepEqual(treeOrder(restoreTrash(backup.data,folder).works[0].navigation!),treeOrder(work.navigation!));
 const files=await JSZip.loadAsync(await zip.arrayBuffer()),raw=JSON.parse(await files.file('workspace.json')!.async('string')),item=raw.trash.find((t:{folder?:{nodes?:unknown}})=>t.folder?.nodes);
 item.folder.nodes.find((n:{id:string})=>n.id===folder).parentId=folder;
 const content=new TextEncoder().encode(JSON.stringify(raw)),manifest=JSON.parse(await files.file('manifest.json')!.async('string')),entry=manifest.files.find((f:{path:string})=>f.path==='workspace.json');
 entry.bytes=content.length;entry.sha256=Buffer.from(await crypto.subtle.digest('SHA-256',content)).toString('hex');files.file('workspace.json',content);files.file('manifest.json',JSON.stringify(manifest));
 const damaged=await files.generateAsync({type:'blob'});await assert.rejects(()=>readBackup(damaged),/휴지통 폴더/);
});

test('폴더 전체 삭제는 폴더째 복원해 하위 폴더·빈 폴더·문서 순서·AI 대화를 돌려놓는다',()=>{
 const {state,work,folder,a,b,c}=folderTree(),next=trashDocumentFolder(state,work.id,folder);
 assert.equal(next.trash!.length,3);assert(next.trash!.every(t=>t.type==='document'&&t.folder?.id===folder&&t.folder.title==='1부'));assert.equal(next.trash!.filter(t=>t.type==='document'&&t.folder?.nodes).length,1);
 assert.deepEqual(workspaceSchema.parse(next).trash,next.trash);assert(!next.works[0].navigation!.nodes.some(n=>n.id===folder));
 const restored=restoreTrash(next,folder),nav=restored.works[0].navigation!,folders=(n:{nodes:{type:string;id:string}[]})=>n.nodes.filter(x=>x.type==='folder').sort((p,q)=>p.id.localeCompare(q.id));
 assert.deepEqual(restored.trash,[]);assert.deepEqual(treeOrder(nav),treeOrder(work.navigation!));assert.deepEqual(folders(nav),folders(work.navigation!));

 for(const d of [a,b,c])assert.deepEqual(restored.works[0].documents.find(x=>x.id===d.id),d);
 assert(restored.works[0].aiConversations!.some(x=>x.docId===b.id));
 // A single item still restores alone, next to where the folder was.
 assert.equal(restoreTrash(next,c.id).works[0].navigation!.nodes.find(n=>n.id===c.id)!.parentId,null);
});

test('폴더 복원은 영구 삭제한 문서의 하위를 위로 올리고, 폴더 구조가 빠진 항목은 폴더 하나에 모은다',()=>{
 const {state,work,folder,chapter,a,b,c}=folderTree(),next=trashDocumentFolder(state,work.id,folder);
 assert.equal(next.trash!.find(t=>t.type==='document'&&t.folder?.nodes)!.id,a.id);
 const purged=restoreTrash(purgeTrash(next,[b.id]),folder).works[0].navigation!.nodes;assert.equal(purged.find(n=>n.id===c.id)!.parentId,chapter);
 const flat=restoreTrash({...next,trash:next.trash!.map(t=>t.type==='document'&&t.folder?{...t,folder:{id:t.folder.id,title:t.folder.title}}:t)},folder).works[0].navigation!.nodes;

 for(const d of [a,b,c])assert.equal(flat.find(n=>n.id===d.id)!.parentId,folder);
 assert.equal(flat.find(n=>n.id===folder)!.type,'folder');
});

test('노트 폴더 전체 삭제도 폴더째 복원한다',()=>{
 const {state,parent,child}=notes();let tree=editNoteTree(state,w=>insertFolder(w,'묶음',{sectionId:'notes',parentId:null}));
 const top=tree.noteNavigation!.nodes.find(n=>n.type==='folder'&&n.title==='묶음')!.id;tree=moveNote(tree,parent.id,{parentId:top});
 const next=trashNoteFolder(tree,top);assert.deepEqual(next.trash!.map(t=>t.id).sort(),[parent.id,child.id].sort());
 const restored=restoreTrash(next,top);assert.deepEqual(restored.trash,[]);assert.deepEqual(treeOrder(restored.noteNavigation!),treeOrder(tree.noteNavigation!));
 assert.deepEqual(restored.notes!.find(n=>n.id===parent.id),parent);
});

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

test('마지막 노트·문서는 휴지통으로 옮기고 중복 ID·손상 첨부는 거절한다',()=>{
 const {state,parent}=notes();let next=trashNote(state,parent.id);

for(const note of next.notes!)next=trashNote(next,note.id);assert.deepEqual(next.notes,[]);
 const last=state.works[1],document=last.documents[0],moved=trashDocument(state,last.id,document.id),replacement=moved.works[1].documents[0];
 assert.equal(moved.works[1].documents.length,1);assert.notEqual(replacement.id,document.id);assert.equal(replacement.chapter,'');assert.deepEqual(moved.trash?.find(item=>item.id===document.id)?.type,'document');
 const restored=restoreTrash(moved,document.id);assert.deepEqual(restored.works[1].documents.find(d=>d.id===document.id),document);assert(restored.works[1].documents.some(d=>d.id===replacement.id));assert(workspaceSchema.safeParse(restored).success);
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
  // The deployed guard accepts the folder field on document and note items, so folder restore needs no migration.
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261007081500_work_trash_unpublish.sql',import.meta.url),'utf8').match(/create or replace function public.guard_workspace_trash[\s\S]*?end \$\$;/)![0]);
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261007124540_workspace_templates_guard.sql',import.meta.url),'utf8'));
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261008055311_untitled_trash_documents.sql',import.meta.url),'utf8'));
  // A valid untitled manuscript, setting or memo must also save after entering the trash.

  for(const kind of ['scene','wiki','memo'] as const){
    const blank=structuredClone(state),work=blank.works[0],document=work.documents.find(d=>d.kind===kind)!;
    document.title='';workspaceSchema.parse(blank);await pg.query('insert into workspaces values (3,$1)',[JSON.stringify(blank)]);
    const removed=trashDocument(blank,work.id,document.id);workspaceSchema.parse(removed);
    await pg.query('update workspaces set payload=$1 where id=3',[JSON.stringify(removed)]);
    assert.deepEqual((await pg.query<{payload:typeof blank}>('select payload from workspaces where id=3')).rows[0].payload,removed);

    for(const value of [undefined,null,301,'x'.repeat(301)]){
      const payload={...removed,trash:removed.trash!.map(t=>t.type==='document'&&t.id===document.id?{...t,document:{...t.document,title:value}}:t)};
      assert(!workspaceSchema.safeParse(payload).success);
      await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=3',[JSON.stringify(payload)]),/휴지통 본문/);
    }

    for(const damage of [{workTitle:''},{document:{...document,kind:'invalid'}}]){
      const payload={...removed,trash:removed.trash!.map(t=>t.type==='document'&&t.id===document.id?{...t,...damage}:t)};
      assert(!workspaceSchema.safeParse(payload).success);
      await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=3',[JSON.stringify(payload)]),/휴지통 문서/);
    }

    const restored=restoreTrash(removed,document.id);await pg.query('update workspaces set payload=$1 where id=3',[JSON.stringify(restored)]);
    assert.deepEqual(restored.works[0].documents.find(d=>d.id===document.id),document);
    await pg.query('delete from workspaces where id=3');
  }

  const tree=folderTree();tree.a.title='';tree.state.works=tree.state.works.map(w=>applyNavigation(w,resolveNavigation(w)));await pg.query('insert into workspaces values (2,$1)',[JSON.stringify(tree.state)]);
  const folders=trashDocumentFolder(tree.state,tree.work.id,tree.folder);await pg.query('update workspaces set payload=$1 where id=2',[JSON.stringify(folders)]);
  const folderRestored=restoreTrash(folders,tree.folder);await pg.query('update workspaces set payload=$1 where id=2',[JSON.stringify(folderRestored)]);
  assert.deepEqual(folderRestored.works[0].documents.find(d=>d.id===tree.a.id),tree.a);
 }finally{await pg.close();}
});
