import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {history,undo} from '@tiptap/pm/history';
import {editorExtensions} from '../src/lib/editor-extensions';
import {captureWebLink,normalizeWebLink,webLinkTransaction} from '../src/lib/editor-web-links';
import {isRichDocument,makePublication,plainText,uid} from '../src/lib/model';
import {InternalReferenceNode} from '../src/components/internal-reference-node';
import {seedWorkspace} from '../src/lib/seed';
import {createBackup,readBackup} from '../src/lib/backup';
import {exportInterchange,readInterchange} from '../src/lib/interchange';

const schema=getSchema([...editorExtensions,InternalReferenceNode]),paragraph=(text:string)=>({type:'paragraph',content:[{type:'text',text}]}),doc=(...content:object[])=>schema.nodeFromJSON({type:'doc',content});

test('웹 주소는 HTTPS를 보완하고 실행 주소·인증 정보·공백을 거절한다',()=>{
  assert.equal(normalizeWebLink(' example.com/path?q=한글#top '),'https://example.com/path?q=%ED%95%9C%EA%B8%80#top');
  assert.equal(normalizeWebLink('//example.com'),'https://example.com/');assert.equal(normalizeWebLink('http://localhost:3000/a'),'http://localhost:3000/a');

  for(const value of ['javascript:alert(1)','data:text/html,test','file:///a','mailto:a@b.com','https://name:secret@example.com','https://example.com/a\nb','https://example.com/a b','https://',''])assert.equal(normalizeWebLink(value),null,value);
});

test('선택한 글의 서식·각주·비공개 참조를 보존하고 링크 서식만 한 번에 되돌린다',()=>{
  const noteId=uid(),ref={type:'internalReference',attrs:{kind:'note',targetId:uid(),workId:null,label:'참조'}};
  let state=EditorState.create({schema,plugins:[history()],doc:doc({type:'paragraph',content:[{type:'text',text:'앞글',marks:[{type:'bold'}]},{type:'footnote',attrs:{noteId,text:'각주'}},ref,{type:'text',text:'뒷글',marks:[{type:'italic'},{type:'wikiLink',attrs:{targetId:uid()}}]}]})});
  const original=state.doc.toJSON();state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,state.doc.content.size-1)));
  state=state.apply(webLinkTransaction(state,captureWebLink(state),'example.com'));
  assert(isRichDocument(state.doc.toJSON()));assert.equal(state.doc.textContent,'앞글뒷글');
  assert(state.doc.firstChild!.child(0).marks.some(m=>m.type.name==='bold'));assert(state.doc.firstChild!.lastChild!.marks.some(m=>m.type.name==='italic'));

  for(const index of [1,2])assert.deepEqual(state.doc.firstChild!.child(index).toJSON(),original.content[0].content[index]);
  assert(!state.doc.firstChild!.lastChild!.marks.some(m=>m.type.name==='wikiLink'));
  assert(undo(state,tr=>{state=state.apply(tr);}));assert.deepEqual(state.doc.toJSON(),original);
});

test('커서 삽입은 HTML을 글자로 남기고 뒤에 입력하는 글에 링크를 이어 붙이지 않는다',()=>{
  let state=EditorState.create({schema,doc:doc(paragraph('앞뒤'))});state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,2)));
  state=state.apply(webLinkTransaction(state,captureWebLink(state),'example.com','<b>링크</b>'));
  assert.equal(state.doc.textContent,'앞<b>링크</b>뒤');assert(state.storedMarks?.every(m=>m.type.name!=='link'));
  state=state.apply(state.tr.insertText('추가'));assert.equal(state.doc.textContent,'앞<b>링크</b>추가뒤');
  const node=state.doc.nodeAt(12);assert(!node?.marks.some(m=>m.type.name==='link'));
});

test('기존 링크는 커서에서 전체 범위를 수정·해제하며 선택 범위와 오래된 문서를 구분한다',()=>{
  let state=EditorState.create({schema,plugins:[history()],doc:doc({type:'paragraph',content:[{type:'text',text:'긴 링크',marks:[{type:'link',attrs:{href:'https://old.example/',target:'_blank',rel:'noopener noreferrer'}}]}]})});
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,3)));const target=captureWebLink(state);assert.deepEqual([target.from,target.to,target.href],[1,5,'https://old.example/']);
  state=state.apply(webLinkTransaction(state,target,'new.example'));assert.equal(state.doc.firstChild!.firstChild!.marks.find(m=>m.type.name==='link')?.attrs.href,'https://new.example/');
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,2,3)));const part=captureWebLink(state);assert.deepEqual([part.from,part.to],[2,3]);
  state=state.apply(webLinkTransaction(state,part,null));assert.equal(state.doc.textContent,'긴 링크');assert(!state.doc.nodeAt(2)!.marks.some(m=>m.type.name==='link'));
  assert.throws(()=>webLinkTransaction(state,target,'example.com'),/바뀌었습니다/);
});

test('웹 링크는 원본·판본·전체 백업과 HTML 교환에 보존된다',async()=>{
  let state=EditorState.create({schema,doc:doc(paragraph('연결 문장'))});state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,6)));state=state.apply(webLinkTransaction(state,captureWebLink(state),'example.com/source'));
  const workspace=seedWorkspace(),work=workspace.works[0],scene=work.documents.find(d=>d.kind==='scene')!;scene.content=JSON.parse(JSON.stringify(state.doc.toJSON()));
  const restored=await readBackup(await createBackup(workspace,[],[]));assert.deepEqual(restored.data.works[0].documents.find(d=>d.id===scene.id)!.content,scene.content);
  assert.deepEqual(makePublication(work,[scene.id]).scenes[0].content,scene.content);assert.equal(plainText(scene.content),'연결 문장');
  const exported=await exportInterchange(work,[scene.id],[],[],'html');const imported=await readInterchange([new File([exported.blob],exported.name)]);
  assert(JSON.stringify(imported).includes('https://example.com/source'));
});
