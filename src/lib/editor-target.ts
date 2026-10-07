import { getSchema, type Editor } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { editorExtensions, noteExtensions, NoteImage } from './editor-extensions';
import type { RichNode } from './model';

export type EditorRange={kind:'selection'|'paragraph';from:number;to:number;text:string};

export type EditorTarget=EditorRange&{cursor:number;document:PMNode};

const schemas:Partial<Record<'work'|'note',ReturnType<typeof getSchema>>>={};

/** Positions include nested blocks, inline atoms and UTF-16 text. */
export function editorRangeText(content:RichNode,from:number,to:number,scope:'work'|'note'){
  const schema=schemas[scope]??=getSchema(scope==='note'?[...editorExtensions,...noteExtensions,NoteImage]:editorExtensions);
  const doc=PMNode.fromJSON(schema,content);

  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to>doc.content.size)throw new Error('글의 범위를 확인하세요.');

  return doc.textBetween(from,to,'\n',node=>node.type.name==='hardBreak'?'\n':'');
}

export function captureEditorTarget(editor:Editor):EditorTarget{
  // A native Home/End or pointer move may precede ProseMirror's selectionchange observer.
  const domSelection=editor.view.dom.ownerDocument.getSelection();

  if(editor.isFocused&&domSelection?.anchorNode&&domSelection.focusNode&&editor.view.dom.contains(domSelection.anchorNode)&&editor.view.dom.contains(domSelection.focusNode)){
    const anchor=editor.view.posAtDOM(domSelection.anchorNode,domSelection.anchorOffset),head=editor.view.posAtDOM(domSelection.focusNode,domSelection.focusOffset);

    if(anchor!==editor.state.selection.anchor||head!==editor.state.selection.head)editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,anchor,head)));
  }

  const {from,to,$from,empty}=editor.state.selection;

  if(empty&&!$from.parent.isTextblock)throw new Error('문단 안에 커서를 놓거나 글을 선택하세요.');
  const start=empty?$from.start():from,end=empty?$from.end():to;

  return {kind:empty?'paragraph':'selection',from:start,to:end,cursor:to,text:editor.state.doc.textBetween(start,end,'\n',node=>node.type.name==='hardBreak'?'\n':''),document:editor.state.doc};
}

export function targetIsCurrent(editor:Editor,target:EditorTarget){
  return !editor.isDestroyed&&editor.isEditable&&editor.state.doc.eq(target.document);
}

/** JSON text nodes never interpret a response as HTML. One application is one undo step. */
export function applyEditorTarget(editor:Editor,target:EditorTarget,text:string,mode:'replace'|'insert'){
  if(!targetIsCurrent(editor,target))throw new Error('글이 바뀌었습니다. 현재 글에서 다시 질문하세요.');

  if(!text.trim())throw new Error('적용할 답변을 입력하세요.');
  const from=mode==='replace'?target.from:target.cursor,to=mode==='replace'?target.to:target.cursor;
  const lines=text.replace(/\r\n?/g,'\n').split('\n');

  const content=lines.length===1?{type:'text',text:lines[0]}:lines.map(line=>{const paragraph:RichNode={type:'paragraph'};

if(line)paragraph.content=[{type:'text',text:line}];

return paragraph;});

  const applied=editor.chain().focus().command(({tr})=>{closeHistory(tr);

return true;}).insertContentAt({from,to},content,{updateSelection:true}).run();

  if(!applied)throw new Error('이 위치에 답변을 넣을 수 없습니다.');
  editor.view.dispatch(closeHistory(editor.state.tr));
}
