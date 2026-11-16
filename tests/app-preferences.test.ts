import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppPreferences, manuscriptLayoutStyle, parseAppPreferences, sidebarWidthStyle } from '../src/lib/app-preferences';

test('저장값이 없거나 깨졌으면 기본값으로 시작한다',()=>{
  for(const raw of [null,'','not json','[]','"x"','null'])assert.deepEqual(parseAppPreferences(raw),defaultAppPreferences);
  assert.deepEqual(defaultAppPreferences,{lineHeight:1.8,paragraphIndent:1,paragraphGap:0.6,manuscriptWidth:680,plotBoardMode:'part',graphScope:'all',graphDepth:1,graphIncludePov:true,aiIncludeManuscript:true,aiAttachLinked:true,checkpointMinutes:10,studioStart:'home',sidebarWidth:null,spacingDefaults:2});
});

test('허용한 값만 받고 잘못된 항목 하나는 그 항목만 기본값으로 돌린다',()=>{
  const value=parseAppPreferences(JSON.stringify({lineHeight:2.4,paragraphIndent:0,paragraphGap:0.6,manuscriptWidth:960,plotBoardMode:'time',graphScope:'local',graphDepth:3,graphIncludePov:false,aiIncludeManuscript:false,aiAttachLinked:false,checkpointMinutes:30,studioStart:'last',sidebarWidth:360,spacingDefaults:2}));
  assert.deepEqual(value,{lineHeight:2.4,paragraphIndent:0,paragraphGap:0.6,manuscriptWidth:960,plotBoardMode:'time',graphScope:'local',graphDepth:3,graphIncludePov:false,aiIncludeManuscript:false,aiAttachLinked:false,checkpointMinutes:30,studioStart:'last',sidebarWidth:360,spacingDefaults:2});
  const mixed=parseAppPreferences(JSON.stringify({lineHeight:9,manuscriptWidth:'800',graphDepth:4,graphIncludePov:'no',checkpointMinutes:1,plotBoardMode:'status',studioStart:'editor'}));
  assert.equal(mixed.lineHeight,1.8);assert.equal(mixed.manuscriptWidth,680);assert.equal(mixed.graphDepth,1);assert.equal(mixed.graphIncludePov,true);assert.equal(mixed.checkpointMinutes,10);assert.equal(mixed.studioStart,'home');assert.equal(mixed.plotBoardMode,'status');
});

test('이전 기본 간격(줄간격 2·문단 1.2줄)으로 저장된 값은 새 기본값을 따르고 직접 고른 다른 값은 그대로 둔다',()=>{
  const old=parseAppPreferences(JSON.stringify({lineHeight:2,paragraphIndent:0,paragraphGap:1.2,sidebarWidth:320}));
  assert.deepEqual([old.lineHeight,old.paragraphGap,old.paragraphIndent,old.sidebarWidth,old.spacingDefaults],[1.8,0.6,0,320,2]);
  const chosen=parseAppPreferences(JSON.stringify({lineHeight:2.4,paragraphGap:1.8}));
  assert.deepEqual([chosen.lineHeight,chosen.paragraphGap],[2.4,1.8]);
  // Once saved under the new defaults, 2 and 1.2 are the writer's own choice.
  const current=parseAppPreferences(JSON.stringify({lineHeight:2,paragraphGap:1.2,spacingDefaults:2}));
  assert.deepEqual([current.lineHeight,current.paragraphGap],[2,1.2]);
  // A later save writes the whole parsed object, so the marker travels with it.
  assert.equal(parseAppPreferences(JSON.stringify({...old,lineHeight:2})).lineHeight,2);
});

test('원고 표시 값은 studio.css가 읽는 CSS 변수로 바뀐다',()=>{
  assert.deepEqual(manuscriptLayoutStyle(defaultAppPreferences),{'--manuscript-line':'1.8','--manuscript-indent':'1em','--manuscript-gap':'0.6em','--manuscript-width':'680px'});
  assert.deepEqual(manuscriptLayoutStyle({...defaultAppPreferences,paragraphIndent:0,paragraphGap:0}),{'--manuscript-line':'1.8','--manuscript-indent':'0em','--manuscript-gap':'0em','--manuscript-width':'680px'});
});

test('사이드바 폭은 끌어 둔 값만 CSS 변수로 넘기고 범위 밖 값은 기본 폭으로 돌린다',()=>{
  assert.deepEqual(sidebarWidthStyle(defaultAppPreferences),{});
  assert.deepEqual(sidebarWidthStyle(parseAppPreferences(JSON.stringify({sidebarWidth:320}))),{'--sidebar-width':'320px'});

  for(const sidebarWidth of [120,900,300.5,'300'])assert.equal(parseAppPreferences(JSON.stringify({sidebarWidth,lineHeight:2.4})).sidebarWidth,null);

  assert.equal(parseAppPreferences(JSON.stringify({sidebarWidth:900,lineHeight:2.4})).lineHeight,2.4);
});
