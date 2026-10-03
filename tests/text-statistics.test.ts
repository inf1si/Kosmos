import test from 'node:test';
import assert from 'node:assert/strict';
import { manuscriptStatistics,statisticsSelection,statisticsText,textStatistics } from '../src/lib/text-statistics';
import { Schema } from '@tiptap/pm/model';
import { newDocument,type RichNode } from '../src/lib/model';
import { parseEditorPreferences } from '../src/lib/editor-preferences';
import { countChars } from '../src/lib/outline';
const paragraph=(text:string):RichNode=>({type:'paragraph',content:[{type:'text',text}]});
const document=(...content:RichNode[]):RichNode=>({type:'doc',content});
test('문단 일부를 선택해도 선택한 문단을 세고 문단 간 경계를 보존한다',()=>{
  const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*'},text:{inline:true}}});
  const doc=schema.nodeFromJSON(document(paragraph('항구에 도착'),paragraph('둘째 문단')));
  assert.equal(statisticsSelection(doc,1,1),null);
  const first=textStatistics(statisticsSelection(doc,1,5)!);
  assert.equal(first.charactersWithoutSpaces,3);assert.equal(first.charactersWithSpaces,4);assert.equal(first.paragraphs,1);
  const across=textStatistics(statisticsSelection(doc,5,12)!);
  assert.equal(across.paragraphs,2);assert.equal(across.words,2);
});
test('통계는 공백과 줄바꿈을 구분하고 이모지·결합문자를 한 글자로 센다',()=>{
  const doc=document(paragraph('가 나\tA\u00a0B\r\ne\u0301👨‍👩‍👧‍👦'));
  const stats=textStatistics(doc);assert.equal(stats.charactersWithoutSpaces,6);assert.equal(stats.charactersWithSpaces,9);
  assert.equal(stats.words,5);assert.equal(stats.paragraphs,1);
});
test('인용·목록·강제 줄바꿈은 단어 경계를 보존하고 서식은 글자를 늘리지 않는다',()=>{
  const doc=document({type:'blockquote',content:[paragraph('첫째'),paragraph('둘째')]},
    {type:'bulletList',content:[{type:'listItem',content:[paragraph('alpha')]},{type:'listItem',content:[paragraph('beta')]}]},
    {type:'paragraph',content:[{type:'text',text:'A',marks:[{type:'bold'}]},{type:'hardBreak'},{type:'text',text:'B'}]});
  assert.equal(statisticsText(doc),'첫째\n둘째\nalpha\nbeta\nA\nB');assert.equal(textStatistics(doc).words,6);
  assert.equal(textStatistics(doc).paragraphs,5);assert.equal(textStatistics(doc).charactersWithoutSpaces,15);
});
test('각주 본문·구분선·빈 문단·제목 서식의 문단 수를 구분한다',()=>{
  const doc=document({type:'heading',content:[{type:'text',text:'제목'}]},paragraph(' '),
    {type:'paragraph',content:[{type:'text',text:'본문'},{type:'footnote',attrs:{text:'통계에서 제외'}}]},
    {type:'horizontalRule'},paragraph('--- … 2026 SF-01'));
  const stats=textStatistics(doc);assert.equal(stats.footnotes,1);assert.equal(stats.paragraphs,2);assert.equal(stats.words,4);
  assert.equal(stats.charactersWithoutSpaces,17);assert.equal(textStatistics(document(paragraph(''))).sheets,0);
});
test('작품 합계는 원고만 더하고 200자 환산은 문서별 올림을 합하지 않는다',()=>{
  const a=newDocument('scene','첫 원고'),b=newDocument('scene','둘째 원고'),wiki=newDocument('wiki','설정');
  a.content=document(paragraph('가'.repeat(101)));b.content=document(paragraph('나'.repeat(99)));wiki.content=document(paragraph('다'.repeat(300)));
  const total=manuscriptStatistics([a,b,wiki]);assert.equal(total.charactersWithSpaces,200);assert.equal(total.sheets,1);assert.equal(total.paragraphs,2);
  assert.equal(countChars(a),101);a.content=document(paragraph('👩‍🚀'));assert.equal(countChars(a),1);
});
test('이전 표시 설정·손상된 값은 글꼴을 보존하고 공백 제외로 시작한다',()=>{
  assert.deepEqual(parseEditorPreferences('{"font":"ibm-plex","size":20}'),{font:'ibm-plex',size:20,countMetric:'charactersWithoutSpaces'});
  assert.equal(parseEditorPreferences('{"countMetric":"words"}').countMetric,'words');
  assert.equal(parseEditorPreferences('{"countMetric":"unknown"}').countMetric,'charactersWithoutSpaces');
});
