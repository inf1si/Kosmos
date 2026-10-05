import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSchema } from '@tiptap/core';
import { EditorState,TextSelection } from '@tiptap/pm/state';
import { history,undo,closeHistory } from '@tiptap/pm/history';
import { addRowAfter,addColumnAfter,mergeCells,splitCell,CellSelection } from '@tiptap/pm/tables';
import { editorExtensions } from '../src/lib/editor-extensions';
import { searchMatches,searchKey,searchPlugin } from '../src/lib/editor-search';
import { paragraphCss,htmlParagraphAttrs,listStyleType } from '../src/lib/manuscript-format';
import { parseEditorPreferences,validFontSize,manuscriptFonts } from '../src/lib/editor-preferences';
import { isRichDocument,makePublication,footnotes,wikiReferences,type RichNode } from '../src/lib/model';
import { textStatistics } from '../src/lib/text-statistics';
import { readInterchange,exportInterchange } from '../src/lib/interchange';
import { createBackup,readBackup } from '../src/lib/backup';
import { seedWorkspace } from '../src/lib/seed';
import { RichReader } from '../src/components/public-site';
const schema=getSchema(editorExtensions);
const text=(value:string,marks?:RichNode['marks']):RichNode=>({type:'text',text:value,...(marks?{marks}:{})});
const paragraph=(...content:RichNode[]):RichNode=>({type:'paragraph',content});
const doc=(...content:RichNode[]):RichNode=>({type:'doc',content});
const nodes=(n:RichNode):RichNode[]=>[n,...(n.content||[]).flatMap(nodes)];
function formattedContent():RichNode{
  const state=seedWorkspace(),wiki=state.works[0].documents.find(d=>d.kind==='wiki')!;
  return doc({type:'heading',attrs:{level:2,textAlign:'center'},content:[text('우주선 제원')]},
    {...paragraph(text('초광속'),text('2',[{type:'superscript'}]),text('H'),text('2',[{type:'subscript'}]),text('O'),text(' 핵심',[{type:'highlight'}]),{type:'footnote',attrs:{noteId:'test-note',text:'보존할 각주'}}),attrs:{lineHeight:1.5,indent:2,firstLineIndent:0,spaceBefore:8,spaceAfter:12,textAlign:'justify'}},
    {type:'table',content:[
      {type:'tableRow',content:[{type:'tableHeader',attrs:{colspan:2,rowspan:1,colwidth:[100,120]},content:[paragraph(text('병합된 제목'))]}]},
      {type:'tableRow',content:[{type:'tableCell',attrs:{colspan:1,rowspan:1},content:[paragraph(text('alpha'))]},{type:'tableCell',attrs:{colspan:1,rowspan:1},content:[paragraph(text('beta'))]}]}
    ]},
    paragraph(text('설정 참조',[{type:'wikiLink',attrs:{targetId:wiki.id}}])));
}
test('새 서식은 스키마·판본·전체 백업에서 보존되고 잘못된 크기·표 구조는 거절된다',async()=>{
  const state=seedWorkspace(),work=state.works[0];work.documents[0].content=formattedContent();assert(isRichDocument(work.documents[0].content));
  schema.nodeFromJSON(work.documents[0].content).check();
  const publication=makePublication(work,[work.documents[0].id]);assert.deepEqual(publication.scenes[0].content,work.documents[0].content);
  const restored=await readBackup(await createBackup(state,[],[]));assert.deepEqual(restored.data,state);
  assert(!isRichDocument(doc({type:'table',content:[paragraph(text('잘못된 행'))]})));
  assert(!isRichDocument(doc({...paragraph(text('값')),attrs:{lineHeight:'url(attack)'}})));
  assert(!isRichDocument(doc({...paragraph(text('값')),attrs:{spaceAfter:49}})));
  const broken=formattedContent();broken.content![2].content![0].content![0].attrs!.colspan=1000000;assert(!isRichDocument(broken));
});
for(const format of ['markdown','html','enex'] as const)test(`${format}의 표·문단 간격·위첨자·아래첨자·강조를 다시 가져올 수 있다`,async()=>{
  const state=seedWorkspace(),work=state.works[0];work.documents[0].content=formattedContent();
  const exported=await exportInterchange(work,work.documents.map(d=>d.id),[],[],format),bundle=await readInterchange([new File([exported.blob],exported.name)]);
  const content=bundle.pages[0].content,all=nodes(content),table=all.find(n=>n.type==='table')!;
  assert.equal(table.content!.length,2);assert.equal(table.content![0].content![0].attrs?.colspan,2);
  if(format!=='enex')assert.deepEqual(table.content![0].content![0].attrs?.colwidth,[100,120]);
  const p=all.find(n=>n.type==='paragraph'&&n.attrs?.lineHeight===1.5)!;
  assert.equal(p.attrs?.indent,2);assert.equal(p.attrs?.firstLineIndent,0);assert.equal(p.attrs?.spaceBefore,8);assert.equal(p.attrs?.spaceAfter,12);assert.equal(p.attrs?.textAlign,'justify');
  for(const mark of ['superscript','subscript','highlight'])assert(all.some(n=>n.marks?.some(m=>m.type===mark)),mark);
  if(format!=='enex'){assert.equal(footnotes(content)[0].text,'보존할 각주');assert(all.some(n=>n.marks?.some(m=>m.type==='wikiLink')));}
});
test('독서 HTML은 표·서식을 렌더링하고 임의 CSS·스크립트를 출력하지 않는다',()=>{
  const work=seedWorkspace().works[0];work.documents[0].content=formattedContent();const pub=makePublication(work,[work.documents[0].id]);
  const html=renderToStaticMarkup(createElement(RichReader,{content:pub.scenes[0].content,publication:pub,onWiki:()=>{}}));
  assert(html.includes('<table'));assert(html.includes('colSpan="2"'));assert(html.includes('line-height:1.5'));assert(html.includes('<sup>'));assert(html.includes('<sub>'));assert(html.includes('<mark>'));
  assert(!paragraphCss({lineHeight:'url(attack)',textAlign:'expression(attack)',indent:-1,spaceAfter:100}).length);
  assert.deepEqual(htmlParagraphAttrs('line-height:url(x);margin-top:-1px;text-align:justify;background-image:url(x)'),{textAlign:'justify'});
});
test('검색은 서식 경계·한글 어절·대소문자·정규식 기호를 처리하며 각주를 건너지 않는다',()=>{
  const content=doc(paragraph(text('우주'),text('항구',[{type:'bold'}]),text(' 우주항구 우주'),{type:'footnote',attrs:{text:'비밀'}},text('항구')),
    paragraph(text('Alpha alpha alphabets [a.b]')));
  const pm=schema.nodeFromJSON(content),search=(query:string,wholeWord=false,caseSensitive=false)=>searchMatches(pm,{query,wholeWord,caseSensitive});
  assert.equal(search('우주항구').length,2);assert.equal(search('우주',true).length,1);assert.equal(search('Alpha').length,3);
  assert.equal(search('Alpha',true,true).length,1);assert.equal(search('[a.b]').length,1);assert.equal(search('비밀').length,0);
  assert.equal(search('항구 우주항구').length,1);assert.equal(search('항구Alpha').length,0);
});
test('모두 치환은 입력을 문자 그대로 넣고 링크·각주를 보존하며 한 번에 실행 취소된다',()=>{
  const content=doc(paragraph(text('항'),text('구',[{type:'bold'}]),text(' 항구'),{type:'footnote',attrs:{noteId:'note',text:'각주'}},text(' 설정',[{type:'wikiLink',attrs:{targetId:'wiki-id'}}])));
  let state=EditorState.create({schema,doc:schema.nodeFromJSON(content),plugins:[history(),searchPlugin()]});
  state=state.apply(state.tr.setMeta(searchKey,{query:'항구',caseSensitive:false,wholeWord:false}).setMeta('addToHistory',false));
  const matches=searchMatches(state.doc,searchKey.getState(state)!),before=state.doc.toJSON(),tr=closeHistory(state.tr);
  for(const match of [...matches].reverse())tr.insertText('<b>$1 & "별"</b>',match.from,match.to);
  state=state.apply(tr);assert.equal(searchMatches(state.doc,{query:'<b>$1 & "별"</b>',caseSensitive:false,wholeWord:false}).length,2);
  assert.equal(footnotes(state.doc.toJSON())[0].text,'각주');assert.deepEqual(wikiReferences(state.doc.toJSON()),['wiki-id']);
  assert(undo(state,t=>{state=state.apply(t);}));assert.deepEqual(state.doc.toJSON(),before);
});
test('표의 행·열 추가와 셀 병합·분할은 정상적인 문서 구조를 유지한다',()=>{
  const cell=()=>({type:'tableCell',attrs:{colspan:1,rowspan:1},content:[paragraph(text('셀'))]});
  let state=EditorState.create({schema,doc:schema.nodeFromJSON(doc({type:'table',content:[{type:'tableRow',content:[cell(),cell()]},{type:'tableRow',content:[cell(),cell()]}]}))});
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,4)));
  assert(addRowAfter(state,tr=>{state=state.apply(tr);}));assert.equal(state.doc.firstChild!.childCount,3);
  assert(addColumnAfter(state,tr=>{state=state.apply(tr);}));assert.equal(state.doc.firstChild!.firstChild!.childCount,3);
  const row=state.doc.firstChild!.firstChild!,first=2,second=first+row.firstChild!.nodeSize;
  state=state.apply(state.tr.setSelection(CellSelection.create(state.doc,first,second)));
  assert(mergeCells(state,tr=>{state=state.apply(tr);}));assert.equal(state.doc.firstChild!.firstChild!.firstChild!.attrs.colspan,2);
  assert(splitCell(state,tr=>{state=state.apply(tr);}));state.doc.check();assert(isRichDocument(state.doc.toJSON()));
});
test('표 안의 통계는 셀 사이 어절 경계를 유지하고 글꼴·0.5px 크기를 검증한다',()=>{
  const table=formattedContent().content![2],stats=textStatistics(doc(table));assert.equal(stats.words,4);assert.equal(stats.paragraphs,3);
  assert.equal(manuscriptFonts.length,20);assert(validFontSize(10));assert(validFontSize(72));assert(validFontSize(22.5));assert(!validFontSize(9));assert(!validFontSize(72.5));assert(!validFontSize(20.1));assert(!validFontSize(Infinity));
  assert.equal(parseEditorPreferences('{"font":"hahmlet","size":22.5}').font,'hahmlet');assert.equal(parseEditorPreferences('{"size":22.5}').size,22.5);
});
test('선택한 글자 크기와 목록 모양은 검증되어 판본·교환 파일에 남는다',async()=>{
  const list=(type:string,listStyle:string|null,...items:string[]):RichNode=>({type,attrs:{...(type==='orderedList'?{start:1}:{}),listStyle},content:items.map(v=>({type:'listItem',content:[paragraph(text(v))]}))});
  const content=doc(paragraph(text('보통 '),text('큰 글자',[{type:'fontSize',attrs:{size:27}}])),list('bulletList','square','네모'),list('orderedList','hangul','가','나'),list('bulletList',null,'기본'));
  assert(isRichDocument(content));schema.nodeFromJSON(content).check();
  for(const size of [9.5,72.5,20.2,'24px',null])assert(!isRichDocument(doc(paragraph(text('값',[{type:'fontSize',attrs:{size}}])))),String(size));
  assert(!isRichDocument(doc(list('orderedList','square','x'))));assert(!isRichDocument(doc(list('bulletList','url(x)','x'))));
  assert.equal(listStyleType({type:'orderedList',attrs:{type:'a'}}),'lower-alpha');assert.equal(listStyleType({type:'orderedList',attrs:{type:'a',listStyle:'hangul'}}),'hangul');assert.equal(listStyleType({type:'bulletList',attrs:{listStyle:'decimal'}}),undefined);
  const work=seedWorkspace().works[0];work.documents[0].content=content;const pub=makePublication(work,[work.documents[0].id]);
  const html=renderToStaticMarkup(createElement(RichReader,{content:pub.scenes[0].content,publication:pub,onWiki:()=>{}}));
  assert(html.includes('font-size:1.5em'));assert(html.includes('list-style-type:square'));assert(html.includes('list-style-type:hangul'));
  for(const format of ['markdown','html','enex'] as const){
    const exported=await exportInterchange(work,[work.documents[0].id],[],[],format),raw=await exported.blob.text(),back=nodes((await readInterchange([new File([exported.blob],exported.name)])).pages[0].content);
    if(format==='enex'){assert(!/data-(font-size|list-style)/.test(raw));assert(raw.includes('list-style-type:hangul'));continue;}
    assert(back.some(n=>n.marks?.some(m=>m.type==='fontSize'&&m.attrs?.size===27)),format);
    assert.deepEqual(back.filter(n=>n.type==='bulletList'||n.type==='orderedList').map(n=>n.attrs?.listStyle??null),['square','hangul',null],format);
  }
});
