import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../src/lib/seed';
import { makePublication, uid, workspaceSchema } from '../src/lib/model';
import { toggleWorkFavorite, preserveWorkFavorites } from '../src/lib/work-favorites';
import { createBackup, readBackup } from '../src/lib/backup';
import { trashWork, restoreTrash, purgeTrash } from '../src/lib/workspace-trash';

test('즐겨찾기는 원고·작품 순서·책장·공개 판본을 바꾸지 않으며 두 번 누르면 해제된다',()=>{
  const original=seedWorkspace(),before=structuredClone(original),id=original.works[1].id;
  const next=toggleWorkFavorite(original,id);
  assert.equal(next.works[1].favorite,true);assert.deepEqual(original,before);
  assert.deepEqual(next.works.map(w=>w.id),original.works.map(w=>w.id));
  assert.equal(next.works[1].documents,original.works[1].documents);assert.equal(next.works[1].publications,original.works[1].publications);
  assert.equal(next.workShelves,original.workShelves);assert.equal(next.assets,original.assets);
  assert.equal(toggleWorkFavorite(next,id).works[1].favorite,false);
  const work=next.works[1],pub=makePublication(work,work.documents.filter(d=>d.kind==='scene').map(d=>d.id));
  assert.equal('favorite' in pub,false);
});

test('이전 자료는 즐겨찾기 없이 열리며 boolean 외의 값은 거절한다',()=>{
  const state=seedWorkspace();assert.equal(workspaceSchema.parse(state).works[0].favorite,undefined);
  assert.equal(workspaceSchema.safeParse({...state,works:state.works.map(w=>({...w,favorite:'true'}))}).success,false);
});

test('즐겨찾기를 전체 ZIP·복구 지점·휴지통에서 보존하고 영구 삭제는 활성 목록에 남기지 않는다',async()=>{
  const original=seedWorkspace(),state=toggleWorkFavorite(original,original.works[1].id),work=state.works[1];
  assert.equal(work.favorite,true);
  const trashed=trashWork(state,work.id);assert.equal(trashed.works.some(w=>w.id===work.id),false);
  const restored=await readBackup(await createBackup(trashed,[{id:uid(),namespace:'synthetic',createdAt:new Date().toISOString(),label:'즐겨찾기',data:state}],[]));
  assert.equal(restored.revisions[0].data.works[1].favorite,true);
  assert.equal(restoreTrash(restored.data,work.id).works.find(w=>w.id===work.id)?.favorite,true);
  assert.equal(purgeTrash(restored.data,[work.id]).trash?.some(t=>t.id===work.id),false);
});

test('이전 백업의 누락은 같은 ID 즐겨찾기를 보존하며 명시한 false와 새 작품은 존중한다',()=>{
  const old=seedWorkspace(),previous=toggleWorkFavorite(old,old.works[1].id);
  assert.equal(preserveWorkFavorites(old,previous).works[1].favorite,true);
  assert.equal(preserveWorkFavorites(toggleWorkFavorite(previous,previous.works[1].id),previous).works[1].favorite,false);
  const fresh={...old,works:old.works.map(w=>({...w,id:uid()}))};
  assert.equal(preserveWorkFavorites(fresh,previous).works[1].favorite,undefined);
  const trashed=trashWork(previous,previous.works[1].id),legacy=structuredClone(trashed);

  for(const item of legacy.trash||[])if(item.type==='work')delete item.work.favorite;
  const result=preserveWorkFavorites(legacy,trashed),entry=result.trash?.find(t=>t.type==='work');
  assert.equal(entry?.type==='work'&&entry.work.favorite,true);assert.doesNotThrow(()=>workspaceSchema.parse(result));
});
