import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDocument } from '../src/lib/model';
import { groupScenes, nextPartLabel, sceneInsertIndex, splitLabel, storyDay } from '../src/lib/outline';

function scene(title:string,chapter:string,storyTime=''){return {...newDocument('scene',title),chapter,storyTime};}

test('부·장 이름은 가운뎃점 앞을 작은 글자, 뒤를 제목으로 나눈다',()=>{
  assert.deepEqual(splitLabel('제1부 · 남겨진 시간','부 미지정'),{kicker:'제1부',title:'남겨진 시간'});
  assert.deepEqual(splitLabel('프롤로그','부 미지정'),{kicker:'',title:'프롤로그'});
  assert.deepEqual(splitLabel('  ','부 미지정'),{kicker:'',title:'부 미지정'});
  assert.deepEqual(splitLabel('제3부 ·','부 미지정'),{kicker:'',title:'제3부'});
  assert.equal(storyDay('귀환일 · 08:40'),'귀환일');assert.equal(storyDay('귀환 다음 날'),'귀환 다음 날');
});

test('사이드바는 이웃한 장면만 묶고 보드는 같은 부를 하나로 모은다',()=>{
  const scenes=[scene('1','제1부'),scene('2','제1부'),scene('3','제2부'),scene('4','제1부')];
  assert.deepEqual(groupScenes(scenes,d=>d.chapter,'부 미지정').map(g=>[g.key,g.scenes.map(d=>d.title)]),[['제1부',['1','2']],['제2부',['3']],['제1부',['4']]]);
  assert.deepEqual(groupScenes(scenes,d=>d.chapter,'부 미지정',true).map(g=>[g.key,g.scenes.map(d=>d.title)]),[['제1부',['1','2','4']],['제2부',['3']]]);
});

test('새 장면은 같은 부의 마지막 장면 뒤, 없으면 마지막 장면 뒤에 들어간다',()=>{
  const docs=[scene('1','제1부'),scene('2','제2부'),newDocument('wiki','설정'),scene('3','제2부'),newDocument('memo','메모')];
  assert.equal(sceneInsertIndex(docs,'제1부'),1);assert.equal(sceneInsertIndex(docs,'제2부'),4);assert.equal(sceneInsertIndex(docs,'제9부'),4);
  assert.equal(sceneInsertIndex([newDocument('wiki','설정')],'제1부'),1);
  assert.equal(nextPartLabel(docs.filter(d=>d.kind==='scene')),'제3부');assert.equal(nextPartLabel([scene('1','프롤로그')]),'제1부');
});
