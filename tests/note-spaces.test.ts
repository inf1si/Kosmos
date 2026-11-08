import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../src/lib/seed';
import { fromText, uid, workspaceSchema } from '../src/lib/model';
import { newNote, addNote, prepareNoteImport, preserveNoteDetails } from '../src/lib/personal-notes';
import { addNoteSpace, removeNoteSpace, renameNoteSpace, noteSpaceFor, notesInSpace, noteTreeWork, editNoteTree, moveNote, resolveNoteNavigation, materializeNoteNavigation } from '../src/lib/note-navigation';
import { applyNavigation, insertFolder } from '../src/lib/document-navigation';
import { prepareTemplate, prepareTemplateApplication } from '../src/lib/workspace-templates';
import { trashNote, trashNoteFolder, restoreTrash } from '../src/lib/workspace-trash';
import { referenceTargets } from '../src/lib/internal-references';
import { searchDocuments, searchWorkspace } from '../src/lib/workspace-search';

function fixture(){
  let state=seedWorkspace();const a={...newNote(),title:'첫 노트',content:fromText('공간검색어를 적었다.')},b={...newNote(),title:'다른 노트',content:fromText('공간검색어를 모았다.')};
  state=addNote(addNote(state,a),b);const spaceId=uid();state=addNoteSpace(state,'구상실',spaceId);
  const sectionId=resolveNoteNavigation(state).spaces.find(s=>s.id===spaceId)!.sections[0].id;

  return {state,a,b,spaceId,sectionId};
}

test('이전 노트 트리는 ID·본문·부모·형제 순서를 그대로 기본 작업공간에 편입한다',()=>{
  const {state,a,b}=fixture(),folder=uid(),legacy={...state,noteNavigation:{version:1 as const,nodes:[{id:folder,type:'folder' as const,title:'기존 폴더',parentId:null},{id:b.id,type:'note' as const,parentId:folder},{id:a.id,type:'note' as const,parentId:null}]}};
  workspaceSchema.parse(legacy);const next=materializeNoteNavigation(legacy),nav=resolveNoteNavigation(next);
  assert.equal(nav.spaces.length,1);assert.equal(nav.spaces[0].id,'default');assert.deepEqual(nav.nodes.map(n=>[n.id,n.parentId]),legacy.noteNavigation.nodes.map(n=>[n.id,n.parentId]));assert.deepEqual(next.notes,state.notes);assert.deepEqual(next.works,state.works);
});

test('작업공간은 각자의 섹션 트리를 가지며 빈 이름·이름 변경·삭제 후 병합을 지원한다',()=>{
  let {state,a,spaceId,sectionId}=fixture();state=renameNoteSpace(state,spaceId,'');assert.equal(noteTreeWork(state,spaceId).title,'이름 없는 작업공간');
  state=renameNoteSpace(state,spaceId,'리서치');const extra=uid();state=editNoteTree(state,w=>applyNavigation(w,{...w.navigation!,sections:[...w.navigation!.sections,{id:extra,title:'자료',defaultKind:'memo'}]}),spaceId);
  state=moveNote(state,a.id,{spaceId,sectionId:extra,parentId:null});assert.equal(notesInSpace(state,spaceId).length,1);assert.equal(noteTreeWork(state,spaceId).navigation!.sections.length,2);assert.equal(noteTreeWork(state).documents.length,1);
  const before=structuredClone(state.notes);state=removeNoteSpace(state,spaceId);assert.deepEqual(state.notes,before);assert.equal(noteSpaceFor(state,a.id),'default');assert(resolveNoteNavigation(state).spaces[0].sections.some(s=>s.id===sectionId));assert.throws(()=>removeNoteSpace(state,'default'),/기본/);workspaceSchema.parse(state);
});

test('공간 간 폴더 이동은 하위 문서·첨부·AI 대화·참조의 ID를 보존하고 검색 경로만 갱신한다',()=>{
  let {state,a,b,spaceId,sectionId}=fixture();state=editNoteTree(state,w=>insertFolder(w,'관측',{sectionId:'notes',parentId:null}));const folder=resolveNoteNavigation(state).nodes.find(n=>n.type==='folder')!;
  state=moveNote(state,a.id,{parentId:folder.id});state=moveNote(state,b.id,{parentId:a.id});const before=structuredClone({notes:state.notes,assets:state.assets,works:state.works});
  state=moveNote(state,folder.id,{spaceId,sectionId,parentId:null});assert.deepEqual({notes:state.notes,assets:state.assets,works:state.works},before);assert.equal(noteSpaceFor(state,a.id),spaceId);assert.equal(noteSpaceFor(state,b.id),spaceId);assert.equal(notesInSpace(state,'default').length,0);
  const ref=referenceTargets(state).find(t=>t.targetId===a.id)!;assert(ref.path.includes('구상실'));assert(ref.path.includes('관측'));assert.equal(ref.targetId,a.id);assert.equal(searchWorkspace(searchDocuments(state),'공간검색어',`space:${spaceId}`,'').length,2);assert.equal(searchWorkspace(searchDocuments(state),'공간검색어','space:default','').length,0);
  assert.throws(()=>moveNote(state,folder.id,{spaceId,sectionId,parentId:b.id}),/자신/);assert.throws(()=>moveNote(state,a.id,{spaceId:'missing',parentId:null}),/작업공간/);workspaceSchema.parse(state);
});

test('섹션 중복·다른 공간의 부모·없는 섹션·공간 ID 충돌을 저장 경계에서 거절한다',()=>{
  const {state,a,b,spaceId,sectionId}=fixture();const moved=moveNote(state,b.id,{spaceId,sectionId,parentId:null});

  for(const change of [
    (s:typeof moved)=>{s.noteNavigation!.nodes.find(n=>n.id===a.id)!.parentId=b.id;},
    (s:typeof moved)=>{s.noteNavigation!.nodes.find(n=>n.id===a.id)!.sectionId='missing';},
    (s:typeof moved)=>{delete s.noteNavigation!.nodes.find(n=>n.id===a.id)!.sectionId;},
    (s:typeof moved)=>{s.noteNavigation!.nodes=s.noteNavigation!.nodes.filter(n=>n.id!==a.id);},
    (s:typeof moved)=>{s.noteNavigation!.spaces![1].sections[0].id='notes';},
    (s:typeof moved)=>{s.noteNavigation!.spaces![1].id=a.id;},
    (s:typeof moved)=>{s.noteNavigation!.spaces=s.noteNavigation!.spaces!.slice(1);},
  ]){const copy=structuredClone(moved);change(copy);assert.equal(workspaceSchema.safeParse(copy).success,false);}
});

test('이전 백업의 노트는 현재 공간을 유지하고 명시된 새 백업의 소속은 그대로 복구한다',()=>{
  let {state,a,spaceId,sectionId}=fixture();state=moveNote(state,a.id,{spaceId,sectionId,parentId:null});
  const legacy=structuredClone(state);legacy.noteNavigation={version:1,nodes:legacy.noteNavigation!.nodes.map(({sectionId:_,...n})=>n)};legacy.notes![0].content=fromText('이전 본문');
  const next=preserveNoteDetails(legacy,state);assert.equal(noteSpaceFor(next,a.id),spaceId);assert.deepEqual(next.notes,legacy.notes);workspaceSchema.parse(next);
  const empty=preserveNoteDetails({...state,notes:[],noteNavigation:undefined},state);assert.deepEqual(empty.noteNavigation?.spaces,state.noteNavigation?.spaces);assert.deepEqual(empty.noteNavigation?.nodes,[]);workspaceSchema.parse(empty);
  const explicit=moveNote(state,a.id,{parentId:null});assert.equal(noteSpaceFor(preserveNoteDetails(explicit,state),a.id),'default');
});

test('다른 공간의 폴더 템플릿은 대상 공간·섹션에 새 ID로 만들고 원본을 유지한다',()=>{
  let {state,a,spaceId,sectionId}=fixture();state=moveNote(state,a.id,{spaceId,sectionId,parentId:null});
  const prepared=prepareTemplate(state,{scope:'notes',spaceId},[a.id],'반복 자료'),applied=prepareTemplateApplication(prepared.state,prepared.templateId,{scope:'notes',to:{spaceId:'default',sectionId:'notes',parentId:null}});
  assert.equal(noteSpaceFor(applied.state,applied.documentIds[0]),'default');assert.equal(noteSpaceFor(applied.state,a.id),spaceId);assert.notEqual(applied.documentIds[0],a.id);assert.deepEqual(applied.state.notes!.find(n=>n.id===a.id),state.notes!.find(n=>n.id===a.id));workspaceSchema.parse(applied.state);
});

test('문서·폴더 휴지통 복원은 원래 작업공간·섹션·하위 구조를 복원한다',()=>{
  let {state,a,b,spaceId,sectionId}=fixture();state=moveNote(state,a.id,{spaceId,sectionId,parentId:null});const removed=trashNote(state,a.id),restored=restoreTrash(removed,a.id);assert.equal(noteSpaceFor(restored,a.id),spaceId);
  state=editNoteTree(state,w=>insertFolder(w,'구상 폴더',{sectionId,parentId:null}),spaceId);const folder=resolveNoteNavigation(state).nodes.find(n=>n.type==='folder')!;state=moveNote(state,a.id,{parentId:folder.id});state=moveNote(state,b.id,{parentId:a.id});
  const trashed=trashNoteFolder(state,folder.id),back=restoreTrash(trashed,folder.id);assert.equal(noteSpaceFor(back,a.id),spaceId);assert.equal(noteSpaceFor(back,b.id),spaceId);assert.equal(resolveNoteNavigation(back).nodes.find(n=>n.id===a.id)!.parentId,folder.id);assert.equal(resolveNoteNavigation(back).nodes.find(n=>n.id===b.id)!.parentId,a.id);assert.deepEqual(back.notes!.find(n=>n.id===b.id),state.notes!.find(n=>n.id===b.id));workspaceSchema.parse(back);
});

test('휴지통에 있는 동안 공간을 삭제하면 문서를 기본 공간의 유지된 섹션에 복원한다',()=>{
  let {state,a,spaceId,sectionId}=fixture();state=moveNote(state,a.id,{spaceId,sectionId,parentId:null});state=removeNoteSpace(trashNote(state,a.id),spaceId);state=restoreTrash(state,a.id);assert.equal(noteSpaceFor(state,a.id),'default');assert.equal(resolveNoteNavigation(state).nodes.find(n=>n.id===a.id)!.sectionId,sectionId);workspaceSchema.parse(state);
});

test('서버는 이전 탭의 공간 정보 누락·없는 섹션·다른 공간 부모를 거절하고 정상 이동을 저장한다',async()=>{
  const {PGlite}=await import('@electric-sql/pglite'),{readFile}=await import('node:fs/promises');const db=new PGlite();
  await db.exec('create role anon; create role authenticated; create table public.workspaces(id int primary key,payload jsonb not null);');
  await db.exec(await readFile('supabase/migrations/20261108083801_note_spaces_guard.sql','utf8'));
  let {state,a,b,spaceId,sectionId}=fixture();state=moveNote(state,a.id,{spaceId,sectionId,parentId:null});
  const save=(payload:typeof state)=>db.query('update public.workspaces set payload=$1 where id=1',[JSON.stringify(payload)]);

  try{
    await db.query('insert into public.workspaces values (1,$1)',[JSON.stringify(state)]);
    const legacy=structuredClone(state);delete legacy.noteNavigation!.spaces;await assert.rejects(save(legacy),/새로고침/);
    const lostSection=structuredClone(state);delete lostSection.noteNavigation!.nodes[0].sectionId;await assert.rejects(save(lostSection),/작업공간·섹션/);
    const wrongParent=structuredClone(state);wrongParent.noteNavigation!.nodes.find(n=>n.id===a.id)!.parentId=b.id;await assert.rejects(save(wrongParent),/섹션/);
    const duplicate=structuredClone(state);duplicate.noteNavigation!.spaces![1].sections[0].id='notes';await assert.rejects(save(duplicate),/중복/);
    const next=moveNote(state,b.id,{spaceId,sectionId,parentId:null});await save(next);const stored=await db.query<{payload:typeof state}>('select payload from public.workspaces where id=1');assert.deepEqual(stored.rows[0].payload,next);
  }finally{await db.close();}
});

test('공간·섹션·휴지통 소속은 전체 백업에서 원고와 함께 왕복한다',async()=>{
  const {createBackup,readBackup}=await import('../src/lib/backup');let {state,a,spaceId,sectionId}=fixture();state=moveNote(state,a.id,{spaceId,sectionId,parentId:null});state=trashNote(state,a.id);
  const backup=await createBackup(state,[],[]),restored=await readBackup(backup);assert.deepEqual(restored.data.noteNavigation,state.noteNavigation);assert.deepEqual(restored.data.trash,state.trash);
  assert.equal(noteSpaceFor(restoreTrash(restored.data,a.id),a.id),spaceId);
});


test('노트 가져오기는 선택한 공간의 첫 섹션에 폴더와 문서를 만들고 다른 공간을 유지한다',()=>{
  const {state,spaceId,sectionId}=fixture(),bundle={source:'자료.md',warnings:[],assets:[],pages:[{key:'page',title:'가져온 자료',kind:'memo' as const,chapter:'',category:'',summary:'',assetKeys:[],content:fromText('가져온 본문')}]};
  const result=prepareNoteImport(state,bundle,'가져온 폴더',spaceId),nav=resolveNoteNavigation(result.state),note=result.state.notes!.find(n=>n.title==='가져온 자료')!;
  assert.equal(noteSpaceFor(result.state,note.id),spaceId);assert.equal(nav.nodes.find(n=>n.id===result.folderId)!.sectionId,sectionId);assert.equal(nav.nodes.find(n=>n.id===note.id)!.parentId,result.folderId);assert.deepEqual(result.state.notes!.filter(n=>n.id!==note.id),state.notes);workspaceSchema.parse(result.state);
});

test('기본 공간이 비어 있고 다른 공간에만 문서가 있어도 빠른 메모를 만들며 선택 공간 새 노트는 맨 앞에 둔다',()=>{
  let {state,a,b,spaceId,sectionId}=fixture();state=moveNote(state,a.id,{spaceId,sectionId,parentId:null});state=moveNote(state,b.id,{spaceId,sectionId,parentId:null});
  const capture=newNote();state=addNote(state,capture);assert.equal(noteSpaceFor(state,capture.id),'default');
  const selected=newNote();state=addNote(state,selected,{spaceId,parentId:null});assert.equal(noteSpaceFor(state,selected.id),spaceId);assert.equal(resolveNoteNavigation(state).nodes.filter(n=>n.sectionId===sectionId&&n.parentId===null)[0].id,selected.id);
});
