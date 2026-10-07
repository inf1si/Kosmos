import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../src/lib/seed';
import { newDocument } from '../src/lib/model';
import { openingDocument, parseStudioPosition, recentDocuments, workUpdatedAt } from '../src/lib/studio-position';

test('기억한 위치가 없거나 깨졌으면 빈 위치로 읽는다',()=>{
  for(const raw of [null,'','not json','[]','"x"','null'])assert.deepEqual(parseStudioPosition(raw),{workId:'',docs:{}});
  assert.deepEqual(parseStudioPosition(JSON.stringify({workId:'w1',docs:{w1:'d1',w2:'d2'}})),{workId:'w1',docs:{w1:'d1',w2:'d2'}});
  assert.deepEqual(parseStudioPosition(JSON.stringify({workId:5,docs:{w1:'d1'}})),{workId:'',docs:{w1:'d1'}},'a damaged field falls back alone');
  assert.deepEqual(parseStudioPosition(JSON.stringify({workId:'w1',docs:{w1:7}})),{workId:'w1',docs:{}});
});

test('작품은 기억한 문서, 없으면 첫 장면, 그것도 없으면 첫 문서로 연다',()=>{
  const work=seedWorkspace().works[0],docs=work.documents,wiki=docs.find(d=>d.kind==='wiki')!,scene=docs.find(d=>d.kind==='scene')!;
  assert.equal(openingDocument(docs,'home',wiki.id).id,wiki.id,'a view id is skipped for the remembered document');
  assert.equal(openingDocument(docs,'missing','').id,scene.id);
  const memo=newDocument('memo','메모만');assert.equal(openingDocument([memo]).id,memo.id);
});

test('최근 수정 문서는 모든 작품에서 최신순으로 고른다',()=>{
  const state=seedWorkspace(),last=state.works.at(-1)!.documents[0];last.updatedAt='2999-01-01T00:00:00.000Z';
  const recent=recentDocuments(state,3);
  assert.equal(recent.length,3);assert.equal(recent[0].doc.id,last.id);assert.equal(recent[0].work.id,state.works.at(-1)!.id);
  assert(recent.every((item,i)=>i===0||recent[i-1].doc.updatedAt>=item.doc.updatedAt));
  assert.equal(workUpdatedAt(state.works.at(-1)!),'2999-01-01T00:00:00.000Z');assert.equal(workUpdatedAt({documents:[]}),'');
});
