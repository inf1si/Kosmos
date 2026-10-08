import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../src/lib/seed';
import { uid, workspaceSchema } from '../src/lib/model';
import { addWorkShelf, DEFAULT_WORK_SHELF, moveWorkShelf, moveWorkToShelf, reorderWorkShelf, placeWorkOnShelf, workShelfTitle, preserveWorkShelves, removeWorkShelf, renameWorkShelf, shelfForWork, workShelves } from '../src/lib/work-shelves';
import { createBackup, readBackup } from '../src/lib/backup';
import { purgeTrash, restoreTrash, trashWork } from '../src/lib/workspace-trash';

test('이전 작업 공간의 작품은 기본 책장에 놓고 원본을 변경하지 않는다',()=>{
  const state=seedWorkspace(),before=structuredClone(state),shelves=workShelves(state);
  assert.deepEqual(shelves,[{id:DEFAULT_WORK_SHELF,title:'기본 책장',workIds:state.works.map(w=>w.id)}]);
  assert.deepEqual(state,before);assert.equal(state.workShelves,undefined);
});

test('책장 생성·이름·순서를 바꾸고 작품을 옮겨도 원고와 게시 순서·판본은 그대로다',()=>{
  const original=seedWorkspace();let state=addWorkShelf(original,'보관');const shelf=state.workShelves!.at(-1)!;
  state=moveWorkToShelf(state,state.works[0].id,shelf.id);state=renameWorkShelf(state,shelf.id,'잠시 멈춘 작품');state=moveWorkShelf(state,shelf.id,-1);
  assert.equal(workShelves(state)[0].title,'잠시 멈춘 작품');assert.equal(shelfForWork(state,state.works[0].id),shelf.id);
  assert.equal(state.works,original.works);assert.equal(state.assets,original.assets);
  assert.deepEqual(state.works,original.works);assert.equal(shelfForWork(state,state.works[1].id),DEFAULT_WORK_SHELF);
  assert.equal(moveWorkToShelf(state,state.works[0].id,shelf.id),state);
});

test('작품이 있는 책장을 지우면 모두 기본 책장으로 옮기고 기본 책장은 유지한다',()=>{
  let state=addWorkShelf(seedWorkspace(),'보관');const id=state.workShelves!.at(-1)!.id;

  for(const work of state.works)state=moveWorkToShelf(state,work.id,id);
  const works=state.works;state=removeWorkShelf(state,id);
  assert.equal(state.works,works);assert.deepEqual(workShelves(state).map(s=>s.workIds),[works.map(w=>w.id)]);
  assert.throws(()=>removeWorkShelf(state,DEFAULT_WORK_SHELF),/유지/);
});

test('긴 이름·중복 이름·없는 작품/책장·40개 제한과 중복/손상 위치를 거절한다',()=>{
  let state=addWorkShelf(seedWorkspace(),'보관');const id=state.workShelves!.at(-1)!.id;
  assert.throws(()=>addWorkShelf(state,'가'.repeat(81)),/80/);assert.throws(()=>addWorkShelf(state,' 보관 '),/같은 이름/);
  assert.throws(()=>renameWorkShelf(state,id,'기본 책장'),/같은 이름/);
  assert.throws(()=>moveWorkToShelf(state,uid(),id),/작품/);assert.throws(()=>moveWorkToShelf(state,state.works[0].id,uid()),/책장/);
  const duplicated=structuredClone(state);duplicated.workShelves![1].workIds.push(state.works[0].id);assert.throws(()=>workspaceSchema.parse(duplicated),/중복/);
  const missing=structuredClone(state);missing.workShelves![1].workIds.push(uid());assert.throws(()=>workspaceSchema.parse(missing),/찾지/);
  const absent=structuredClone(state);absent.workShelves=absent.workShelves!.slice(1);assert.throws(()=>workspaceSchema.parse(absent),/기본 책장/);

  for(let i=2;i<40;i++)state=addWorkShelf(state,`책장 ${i}`);
  assert.throws(()=>addWorkShelf(state,'초과'),/40개/);
});

test('작품 휴지통 이동·복원은 원래 책장을 보존하고 영구 삭제는 멤버 ID만 정리한다',()=>{
  let state=addWorkShelf(seedWorkspace(),'보관');const shelf=state.workShelves!.at(-1)!.id,work=state.works[1];
  state=moveWorkToShelf(state,work.id,shelf);const trashed=trashWork(state,work.id);
  assert.equal(shelfForWork(trashed,work.id),shelf);
  const restored=restoreTrash(trashed,work.id);assert.equal(shelfForWork(restored,work.id),shelf);assert.deepEqual(restored.works.find(w=>w.id===work.id)!.documents,work.documents);
  const purged=purgeTrash(trashed,[work.id]);assert(!workShelves(purged).some(s=>s.workIds.includes(work.id)));assert.equal(workShelves(purged).length,2);
  const removed=removeWorkShelf(trashed,shelf);assert.equal(shelfForWork(restoreTrash(removed,work.id),work.id),DEFAULT_WORK_SHELF);
});

test('이전 백업의 누락 필드는 현재 책장을 유지하고 명시된 목록은 정확히 반영한다',()=>{
  const old=seedWorkspace();let state=addWorkShelf(old,'보관');const id=state.workShelves!.at(-1)!.id;
  state=moveWorkToShelf(state,state.works[0].id,id);
  assert.deepEqual(preserveWorkShelves(old,state).workShelves,state.workShelves);
  const reset=preserveWorkShelves({...old,workShelves:[]},state);assert.deepEqual(reset.workShelves,workShelves(old));
  const surviving={...old,works:[old.works[1]]};const kept=preserveWorkShelves(surviving,state);
  assert.equal(kept.workShelves!.length,2);assert(!kept.workShelves!.some(s=>s.workIds.includes(old.works[0].id)));
  assert.doesNotThrow(()=>workspaceSchema.parse(kept));
});

test('새 작품과 외부에서 가져온 작품은 기본 책장에 보충되며 기존 분류를 보존한다',()=>{
  let state=addWorkShelf(seedWorkspace(),'보관');const id=state.workShelves!.at(-1)!.id;
  state=moveWorkToShelf(state,state.works[0].id,id);
  const imported={...structuredClone(state.works[1]),id:uid(),documents:state.works[1].documents.map(d=>({...d,id:uid()})),publications:[],activePublicationId:null};
  const next=preserveWorkShelves({...state,works:[...state.works,imported]},state);
  assert.equal(shelfForWork(next,imported.id),DEFAULT_WORK_SHELF);assert.equal(shelfForWork(next,state.works[0].id),id);
  assert.doesNotThrow(()=>workspaceSchema.parse(next));
});

test('전체 ZIP과 복구 이력에서 책장 이름·순서·작품 위치를 왕복한다',async()=>{
  let state=addWorkShelf(seedWorkspace(),'보관');const id=state.workShelves!.at(-1)!.id;
  state=moveWorkToShelf(state,state.works[1].id,id);state=moveWorkShelf(state,id,-1);
  const restored=await readBackup(await createBackup(state,[{id:uid(),namespace:'synthetic',createdAt:new Date().toISOString(),label:'책장 정리',data:state}],[]));
  assert.deepEqual(restored.data.workShelves,state.workShelves);assert.deepEqual(restored.revisions[0].data.workShelves,state.workShelves);assert.deepEqual(restored.data.works,state.works);
});


test('이름을 비운 책장 여러 개를 만들고 이름 변경·백업에서도 빈 값을 보존한다',async()=>{
  let state=addWorkShelf(addWorkShelf(seedWorkspace(),' '),'');
  const ids=state.workShelves!.slice(1).map(s=>s.id);
  assert.notEqual(ids[0],ids[1]);assert.deepEqual(state.workShelves!.slice(1).map(s=>s.title),['','']);
  state=renameWorkShelf(state,DEFAULT_WORK_SHELF,'');
  assert.equal(workShelfTitle(state.workShelves![0]),'이름 없는 책장');
  assert.doesNotThrow(()=>workspaceSchema.parse(state));
  const restored=await readBackup(await createBackup(state,[],[]));
  assert.deepEqual(restored.data.workShelves,state.workShelves);
});

test('책장을 앞뒤로 끌고 작품을 같은 책장 또는 다른 책장의 지정 위치로 옮긴다',()=>{
  const original=seedWorkspace();let state=addWorkShelf(addWorkShelf(original,'보관'),'구상');
  const [first,second,third]=state.workShelves!.map(s=>s.id),[a,b]=state.works.map(w=>w.id);
  state=reorderWorkShelf(state,third,first,'before');
  assert.deepEqual(state.workShelves!.map(s=>s.id),[third,first,second]);
  state=reorderWorkShelf(state,third,second,'after');
  assert.deepEqual(state.workShelves!.map(s=>s.id),[first,second,third]);
  state=placeWorkOnShelf(state,b,first,{id:a,edge:'before'});
  assert.deepEqual(state.workShelves![0].workIds,[b,a]);
  state=placeWorkOnShelf(state,a,second);
  state=placeWorkOnShelf(state,b,second,{id:a,edge:'after'});
  assert.deepEqual(state.workShelves!.map(s=>s.workIds),[[],[a,b],[]]);
  assert.equal(state.works,original.works);assert.equal(state.assets,original.assets);
  assert.equal(original.workShelves,undefined);
  assert.equal(reorderWorkShelf(state,first,first,'after'),state);
  assert.equal(placeWorkOnShelf(state,b,second,{id:a,edge:'after'}),state);
  assert.equal(placeWorkOnShelf(state,a,second,{id:a,edge:'before'}),state);
  assert.throws(()=>placeWorkOnShelf(state,b,third,{id:a,edge:'before'}),/위치/);
  assert.throws(()=>reorderWorkShelf(state,uid(),first,'before'),/책장/);
  assert.throws(()=>placeWorkOnShelf(state,uid(),third),/작품/);
});

test('드래그로 정리한 뒤에도 휴지통 작품의 책장과 복원 위치를 유지한다',()=>{
  let state=addWorkShelf(seedWorkspace(),'보관');const id=state.workShelves!.at(-1)!.id,[a,b]=state.works.map(w=>w.id);
  state=trashWork(state,b);state=placeWorkOnShelf(state,a,id);
  assert.deepEqual(workShelves(state)[0].workIds,[b]);
  state=reorderWorkShelf(state,id,DEFAULT_WORK_SHELF,'before');state=restoreTrash(state,b);
  assert.equal(shelfForWork(state,b),DEFAULT_WORK_SHELF);assert.equal(shelfForWork(state,a),id);
  assert.doesNotThrow(()=>workspaceSchema.parse(state));
});
