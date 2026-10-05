import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppPreferences, manuscriptLayoutStyle, parseAppPreferences } from '../src/lib/app-preferences';

test('저장값이 없거나 깨졌으면 코드에 있던 기존 기본값으로 시작한다',()=>{
  for(const raw of [null,'','not json','[]','"x"','null'])assert.deepEqual(parseAppPreferences(raw),defaultAppPreferences);
  assert.deepEqual(defaultAppPreferences,{lineHeight:2,paragraphIndent:1,paragraphGap:1.2,manuscriptWidth:680,plotBoardMode:'part',graphScope:'all',graphDepth:1,graphIncludePov:true,aiIncludeManuscript:true,aiAttachLinked:true,checkpointMinutes:10});
});
test('허용한 값만 받고 잘못된 항목 하나는 그 항목만 기본값으로 돌린다',()=>{
  const value=parseAppPreferences(JSON.stringify({lineHeight:2.4,paragraphIndent:0,paragraphGap:0.6,manuscriptWidth:960,plotBoardMode:'time',graphScope:'local',graphDepth:3,graphIncludePov:false,aiIncludeManuscript:false,aiAttachLinked:false,checkpointMinutes:30}));
  assert.deepEqual(value,{lineHeight:2.4,paragraphIndent:0,paragraphGap:0.6,manuscriptWidth:960,plotBoardMode:'time',graphScope:'local',graphDepth:3,graphIncludePov:false,aiIncludeManuscript:false,aiAttachLinked:false,checkpointMinutes:30});
  const mixed=parseAppPreferences(JSON.stringify({lineHeight:9,manuscriptWidth:'800',graphDepth:4,graphIncludePov:'no',checkpointMinutes:1,plotBoardMode:'status'}));
  assert.equal(mixed.lineHeight,2);assert.equal(mixed.manuscriptWidth,680);assert.equal(mixed.graphDepth,1);assert.equal(mixed.graphIncludePov,true);assert.equal(mixed.checkpointMinutes,10);assert.equal(mixed.plotBoardMode,'status');
});
test('원고 표시 값은 studio.css가 읽는 CSS 변수로 바뀐다',()=>{
  assert.deepEqual(manuscriptLayoutStyle(defaultAppPreferences),{'--manuscript-line':'2','--manuscript-indent':'1em','--manuscript-gap':'1.2em','--manuscript-width':'680px'});
  assert.deepEqual(manuscriptLayoutStyle({...defaultAppPreferences,paragraphIndent:0,paragraphGap:0}),{'--manuscript-line':'2','--manuscript-indent':'0em','--manuscript-gap':'0em','--manuscript-width':'680px'});
});
