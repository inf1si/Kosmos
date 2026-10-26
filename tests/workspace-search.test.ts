import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema,Node } from '@tiptap/core';
import { EditorState,TextSelection } from '@tiptap/pm/state';
import { history,undo } from '@tiptap/pm/history';
import { editorExtensions,noteExtensions,NoteImage,trailingParagraphPlugin } from '../src/lib/editor-extensions';
import { fromText,newDocument,uid,workspaceSchema,type RichNode } from '../src/lib/model';
import { seedWorkspace } from '../src/lib/seed';
import { addNote,newNote } from '../src/lib/personal-notes';
import { trashNote } from '../src/lib/workspace-trash';
import { bodyMatchCount,bodyRuns,firstBodyMatch,searchDocuments,searchTerms,searchWorkspace,textRanges } from '../src/lib/workspace-search';
import { searchJumpKey,searchJumpPlugin } from '../src/lib/editor-search';

const schema=getSchema([...editorExtensions,...noteExtensions,NoteImage,Node.create({name:'internalReference',group:'inline',inline:true,atom:true})]);

function fixture(){
  let state=addNote(seedWorkspace(),{...newNote(),title:'별빛',tags:['조사태그'],content:fromText('별빛을 적은 노트다.')});
  const work=state.works[0],source=work.documents[0];source.title='별빛 기록';source.content=fromText('현재 작품의 검색 본문.');
  const foreign=newDocument('memo','다른 기록');foreign.content=fromText('배경 설명.\n\n저 멀리 별빛이 반짝였다.');
  const other={...work,id:uid(),title:'다른 작품',navigation:undefined,documents:[foreign],publications:[],activePublicationId:null};state.works.push(other);
  const removed={...newNote(),title:'휴지통 전용',content:fromText('숨은보관문장')};state=trashNote(addNote(state,removed),removed.id);

  return {state,work:state.works[0],foreign,other};
}

test('whole workspace search ranks exact titles before partial titles and body matches; scopes include all works and notes',()=>{
  const {state,work,other,foreign}=fixture(),before=structuredClone(state),index=searchDocuments(state),found=searchWorkspace(index,'별빛','all',work.id);
  assert.equal(found[0].document.label,'별빛');assert.equal(found[1].document.label,'별빛 기록');assert.equal(found[2].document.targetId,foreign.id);assert(found[2].snippet.includes('별빛'));
  assert(searchWorkspace(index,'별빛','notes',work.id).every(hit=>hit.document.kind==='note'));
  assert(searchWorkspace(index,'별빛','current',work.id).every(hit=>hit.document.workId===work.id));
  assert.equal(searchWorkspace(index,'별빛',other.id,work.id)[0].document.targetId,foreign.id);
  assert.equal(searchWorkspace(index,'숨은보관문장','all',work.id).length,0);assert.equal(searchWorkspace(index,'조사태그','all',work.id)[0].document.kind,'note');
  assert.equal(searchWorkspace(index,'다른 작품 별빛','all',work.id)[0].document.targetId,foreign.id);
  assert.deepEqual(state,before);workspaceSchema.parse(state);
});

test('literal queries, overlapping highlights and normalized Korean retain original Unicode offsets',()=>{
  assert.deepEqual(searchTerms('  별빛   항구 별빛 '),['별빛','항구']);
  assert.deepEqual(textRanges('가나다나다',['나다','다나']),[{from:1,to:5}]);
  assert.deepEqual(textRanges('a+b .* [x]',['.*','[x]']),[{from:4,to:6},{from:7,to:10}]);
  const original=`🚀 ${'항구'.normalize('NFD')} ECHO`,ranges=textRanges(original,['항구','echo']);
  assert.equal(original.slice(ranges[0].from,ranges[0].to).normalize('NFC'),'항구');assert.equal(original.slice(ranges[1].from,ranges[1].to),'ECHO');
  assert.deepEqual(textRanges('무관한 본문',['.*']),[]);
});

test('body offsets match the real editor schema across formatting, tables, checklists, images and private atoms',()=>{
  const content:RichNode={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'앞🚀 '},{type:'text',text:'별',marks:[{type:'bold'}]},{type:'text',text:'빛'},{type:'footnote',attrs:{text:'각주비밀'}},{type:'text',text:'뒤'},{type:'internalReference'},{type:'text',text:'문장'}]},{type:'noteImage',attrs:{assetId:uid(),alt:'이미지비밀'}},{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'확인 항목'}]}]}]},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'표의 좌표'}]}]}]}]},{type:'paragraph',content:[{type:'text',text:'왼쪽'},{type:'hardBreak'},{type:'text',text:'오른쪽'}]}]};
  const pm=schema.nodeFromJSON(content);

  for(const term of ['별빛','뒤','문장','확인','좌표','오른쪽']){const range=firstBodyMatch(content,[term])!;assert.equal(pm.textBetween(range.from,range.to),term);}

  assert.equal(firstBodyMatch(content,['각주비밀']),null);assert.equal(firstBodyMatch(content,['이미지비밀']),null);assert.equal(firstBodyMatch(content,['빛뒤']),null);assert.equal(firstBodyMatch(content,['왼쪽오른쪽']),null);
  assert(bodyRuns(content).some(run=>run.text==='앞🚀 별빛'));assert.deepEqual(pm.toJSON().content?.[0].content?.[3].attrs?.text,'각주비밀');
});

test('snippets follow a late body match and search finds formatted words without joining separate blocks',()=>{
  const {state,work,foreign}=fixture();foreign.content=fromText(`${'먼 배경 '.repeat(1000)}끝좌표 확인`);
  const mutable=state.works.find(value=>value.id!==work.id&&value.documents.some(doc=>doc.id===foreign.id))!;mutable.documents=[foreign];
  const hit=searchWorkspace(searchDocuments(state),'끝좌표','all',work.id)[0];assert(hit.snippet.includes('끝좌표'));assert(hit.snippet.length<200);assert(hit.snippet.startsWith('…'));
  const range=firstBodyMatch(foreign.content,['끝좌표'])!,pm=schema.nodeFromJSON(foreign.content);assert.equal(pm.textBetween(range.from,range.to),'끝좌표');
  assert.equal(searchWorkspace(searchDocuments(state),'끝좌표 없는단어','all',work.id).length,0);
});

test('jump highlight and selection never change document history or survive edits',()=>{
  const content=fromText('별빛 문장'),doc=schema.nodeFromJSON(content),range=firstBodyMatch(content,['별빛'])!;
  let state=EditorState.create({schema,doc,plugins:[history(),searchJumpPlugin()]});
  state=state.apply(state.tr.setSelection(TextSelection.create(doc,range.from,range.to)).setMeta(searchJumpKey,range).setMeta('addToHistory',false));
  assert.deepEqual(state.doc.toJSON(),doc.toJSON());assert.deepEqual(searchJumpKey.getState(state),range);assert.equal(undo(state),false);
  state=state.apply(state.tr.insertText('새 문장 ',1));assert.equal(searchJumpKey.getState(state),null);
  assert(undo(state,tr=>{state=state.apply(tr);}));assert.deepEqual(state.doc.toJSON(),doc.toJSON());
});


test('opening and selecting a list-only note never appends a paragraph; actual edits still provide an exit paragraph',()=>{
  const doc=schema.nodeFromJSON({type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'체크 항목'}]}]}]}]});
  let state=EditorState.create({schema,doc,plugins:[trailingParagraphPlugin(),searchJumpPlugin()]});
  state=state.applyTransaction(state.tr.setMeta(searchJumpKey,null).setMeta('addToHistory',false)).state;assert.deepEqual(state.doc.toJSON(),doc.toJSON());
  state=state.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc,3,5)).setMeta('addToHistory',false)).state;assert.deepEqual(state.doc.toJSON(),doc.toJSON());
  state=state.applyTransaction(state.tr.insertText('새 ',3)).state;assert.equal(state.doc.lastChild!.type.name,'paragraph');assert.equal(state.doc.childCount,2);
});

test('summary, point of view, story time and custom properties are searched and quoted when the body does not match',()=>{
  const {state,work}=fixture(),scene=state.works[0].documents.find(doc=>doc.kind==='scene')!;
  scene.summary='주인공이 등대지기를 만난다';scene.pov='한서';scene.storyTime='삼 년 전 겨울';scene.customProperties=[{id:uid(),name:'장소',type:'text',value:'북쪽 방파제'},{id:uid(),name:'완료',type:'checkbox',value:true}];
  const index=searchDocuments(state);

  for(const [query,label] of [['등대지기','요약'],['한서','시점 인물'],['삼 년 전','작중 시간'],['방파제','장소']]){
    const found=searchWorkspace(index,query,'all',work.id);
    assert.equal(found.length,1,query);assert.equal(found[0].document.targetId,scene.id);assert.equal(found[0].rank,4,`${query} ranks with body text`);assert(found[0].snippet.startsWith(`${label} · `),found[0].snippet);
  }

  assert.equal(searchWorkspace(index,'체크됨','all',work.id).length,0,'checkbox values are not searchable words');
});

test('body match counts include every occurrence of every term',()=>{
  const content=fromText('별빛 아래 별빛.\n\n바다와 별빛.');
  assert.equal(bodyMatchCount(content,['별빛']),3);assert.equal(bodyMatchCount(content,['별빛','바다']),4);assert.equal(bodyMatchCount(content,['없음']),0);
});
