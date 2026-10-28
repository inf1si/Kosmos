import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../src/lib/seed';
import { newDocument } from '../src/lib/model';
import { openingDocument, parseStudioPosition, readStudioTabs, recentDocuments, rememberStudioTabs, STUDIO_TABS_KEY, workUpdatedAt } from '../src/lib/studio-position';

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

test('열린 탭 순서는 작품별로 기억하고 깨진 값은 비운다',()=>{
  const store=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);}}});

  try{
    assert.deepEqual(readStudioTabs('w1'),[]);
    rememberStudioTabs('w1',['d2','home','d1']);rememberStudioTabs('w2',['d3']);
    assert.deepEqual(readStudioTabs('w1'),['d2','home','d1']);assert.deepEqual(readStudioTabs('w2'),['d3']);
    rememberStudioTabs('w1',Array.from({length:40},(_,i)=>`d${i}`));assert.equal(readStudioTabs('w1').length,30,'a work keeps at most 30 tabs');

    for(let i=0;i<60;i++)rememberStudioTabs(`many${i}`,['x']);
    assert.equal(Object.keys(JSON.parse(store.get(STUDIO_TABS_KEY)!)).length,50,'only the 50 most recent works are kept');assert.deepEqual(readStudioTabs('many59'),['x']);
    store.set(STUDIO_TABS_KEY,'not json');assert.deepEqual(readStudioTabs('w1'),[]);
    store.set(STUDIO_TABS_KEY,JSON.stringify({w1:[5]}));assert.deepEqual(readStudioTabs('w1'),[]);
  }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
