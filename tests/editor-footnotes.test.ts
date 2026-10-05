import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { history,undo } from '@tiptap/pm/history';
import { editorExtensions } from '../src/lib/editor-extensions';
import { editorFootnote,updateEditorFootnote } from '../src/lib/editor-footnotes';
const schema=getSchema(editorExtensions);
const note=(id:string)=>({type:'footnote',attrs:{noteId:id,text:'같은 설명'}});
const content={type:'doc',content:[{type:'paragraph',attrs:{blockId:'block'},content:[{type:'text',text:'앞 글',marks:[{type:'bold'}]},note('first'),{type:'text',text:'뒤 글'},note('second')]}]};
test('각주는 위치가 이동해도 ID로 수정하며 다른 각주·서식을 보존하고 한 번에 되돌린다',()=>{
  let state=EditorState.create({schema,doc:schema.nodeFromJSON(content),plugins:[history()]});
  const originalPosition=editorFootnote(state.doc,'second')!.pos;
  state=state.apply(state.tr.insertText('추가 ',1));const before=state.doc.toJSON();
  assert(editorFootnote(state.doc,'second')!.pos>originalPosition);
  const tr=state.tr;assert(updateEditorFootnote(tr,'second','같은 설명','  바꾼 설명\n둘째 줄  '));state=state.apply(tr);
  assert.equal(editorFootnote(state.doc,'second')!.text,'바꾼 설명\n둘째 줄');assert.equal(editorFootnote(state.doc,'first')!.text,'같은 설명');
  assert.deepEqual(state.doc.firstChild!.firstChild!.marks,before.content[0].content[0].marks.map((m:unknown)=>schema.markFromJSON(m)));
  assert(undo(state,tr=>{state=state.apply(tr);}));assert.deepEqual(state.doc.toJSON(),before);
});
test('각주가 지워지거나 설명이 바뀌거나 ID가 중복되면 오래된 수정을 적용하지 않는다',()=>{
  const state=EditorState.create({schema,doc:schema.nodeFromJSON(content)});
  for(const [id,original,next] of [['missing','같은 설명','새 설명'],['first','오래된 설명','새 설명'],['first','같은 설명','  ']]){
    const tr=state.tr;assert.equal(updateEditorFootnote(tr,id,original,next),false);assert.equal(tr.docChanged,false);
  }
  const duplicate=schema.nodeFromJSON({type:'doc',content:[{type:'paragraph',content:[note('first'),note('first')]}]});
  assert.equal(editorFootnote(duplicate,'first'),null);
  assert.equal(updateEditorFootnote(EditorState.create({schema,doc:duplicate}).tr,'first','같은 설명','새 설명'),false);
});
