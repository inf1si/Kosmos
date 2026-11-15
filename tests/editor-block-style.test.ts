import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor,type JSONContent } from '@tiptap/core';
import { editorExtensions,noteExtensions } from '../src/lib/editor-extensions';
import { blockStyle } from '../src/lib/editor-block-style';

type Outline=string|[string,Outline[]];

const paragraph=(text:string,attrs?:JSONContent['attrs']):JSONContent=>{const node:JSONContent={type:'paragraph',content:[{type:'text',text}]};

if(attrs)node.attrs=attrs;

return node;};

const item=(text:string,...rest:JSONContent[]):JSONContent=>({type:'listItem',content:[paragraph(text),...rest]});

const task=(text:string,...rest:JSONContent[]):JSONContent=>({type:'taskItem',attrs:{checked:false},content:[paragraph(text),...rest]});

const list=(type:string,...content:JSONContent[]):JSONContent=>({type,content});

/** Block structure without attributes: 'p:글' for a text block, [type, children] for a container. */
function outline(node:JSONContent):Outline{
  if(node.content&&!node.content.some(child=>child.type==='text'))return [node.type||'',node.content.map(outline)];
  const name=node.type==='paragraph'?'p':node.type==='heading'?`h${node.attrs?.level}`:node.type;

  return `${name}:${(node.content||[]).map(child=>child.text||'').join('')}`;
}

/** Puts the cursor in `from` (or selects through `to`), runs the style and returns the block structure. */
function styled(content:JSONContent[],level:0|1|2|3,from:string,to?:string){
  const editor=new Editor({element:null,extensions:[...editorExtensions,...noteExtensions],content:{type:'doc',content}});

  const at=(text:string)=>{let found=0;editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text===text)found=pos+1;});assert(found,`${text} exists`);

return found;};

  editor.commands.setTextSelection(to?{from:at(from),to:at(to)}:at(from));editor.chain().command(blockStyle(level)).run();
  const result:JSONContent=editor.getJSON(),cursor=editor.state.selection.$from.parent.textContent;editor.destroy();

  return {blocks:(result.content||[]).map(outline),cursor,json:result};
}

const nested=(type='bulletList',li=item)=>[paragraph('앞'),list(type,li('가',list(type,li('나1'),li('나2'),li('나3'))),li('다')),paragraph('뒤')];

test('a nested list item leaves its list alone; sibling items keep their level',()=>{
  for(const [type,li,name] of [['bulletList',item,'listItem'],['orderedList',item,'listItem'],['taskList',task,'taskItem']] as const)for(const [level,tag] of [[2,'h2'],[0,'p']] as const){
    const {blocks,cursor}=styled(nested(type,li),level,'나2');

    assert.deepEqual(blocks,['p:앞',[type,[[name,['p:가',[type,[[name,['p:나1']]]],`${tag}:나2`,[type,[[name,['p:나3']]]]]],[name,['p:다']]]],'p:뒤']);
    assert.equal(cursor,'나2');
  }

  assert.deepEqual(styled(nested(),1,'나1').blocks[1],['bulletList',[['listItem',['p:가','h1:나1',['bulletList',[['listItem',['p:나2']],['listItem',['p:나3']]]]]],['listItem',['p:다']]]]);
  assert.deepEqual(styled(nested(),3,'나3').blocks[1],['bulletList',[['listItem',['p:가',['bulletList',[['listItem',['p:나1']],['listItem',['p:나2']]]],'h3:나3']],['listItem',['p:다']]]]);
});

test('an outer item takes its own line out; its children become a list of their own',()=>{
  assert.deepEqual(styled(nested(),2,'가').blocks,['p:앞','h2:가',['bulletList',[['listItem',['p:나1']],['listItem',['p:나2']],['listItem',['p:나3']]]],['bulletList',[['listItem',['p:다']]]],'p:뒤']);
  assert.deepEqual(styled(nested(),0,'다').blocks,['p:앞',['bulletList',[['listItem',['p:가',['bulletList',[['listItem',['p:나1']],['listItem',['p:나2']],['listItem',['p:나3']]]]]]]],'p:다','p:뒤']);
});

test('a selection across items changes every selected line and nothing else',()=>{
  assert.deepEqual(styled(nested(),0,'나1','나2').blocks[1],['bulletList',[['listItem',['p:가','p:나1','p:나2',['bulletList',[['listItem',['p:나3']]]]]],['listItem',['p:다']]]]);
  assert.deepEqual(styled(nested(),1,'앞','다').blocks,['h1:앞','h1:가','h1:나1','h1:나2','h1:나3','h1:다','p:뒤']);
});

test('a later block of a list item changes in place, and a plain paragraph there stays as it is',()=>{
  const content=[list('bulletList',item('가',paragraph('가 둘째 줄'),list('bulletList',item('나1'))))];

  assert.deepEqual(styled(content,2,'가 둘째 줄').blocks,[['bulletList',[['listItem',['p:가','h2:가 둘째 줄',['bulletList',[['listItem',['p:나1']]]]]]]]]);
  assert.deepEqual(styled(content,0,'가 둘째 줄').blocks,[['bulletList',[['listItem',['p:가','p:가 둘째 줄',['bulletList',[['listItem',['p:나1']]]]]]]]]);
});

test('outside a list the paragraph style behaves as before and keeps the paragraph format',()=>{
  const {blocks,json}=styled([paragraph('본문',{textAlign:'center',indent:2})],2,'본문');

  assert.deepEqual(blocks,['h2:본문']);assert.equal(json.content?.[0].attrs?.textAlign,'center');assert.equal(json.content?.[0].attrs?.indent,2);
  assert.deepEqual(styled([{type:'heading',attrs:{level:2},content:[{type:'text',text:'제목'}]}],0,'제목').blocks,['p:제목']);
  assert.deepEqual(styled([{type:'blockquote',content:[paragraph('인용 하나'),paragraph('인용 둘')]}],0,'인용 둘').blocks,[['blockquote',['p:인용 하나']],'p:인용 둘']);
});

test('the list item keeps its paragraph format when it becomes a heading',()=>{
  const content=[list('bulletList',item('가',list('bulletList',{type:'listItem',content:[paragraph('나1',{textAlign:'right'})]},item('나2'))))];
  const inner=styled(content,2,'나1').json.content?.[0].content?.[0].content?.[1];

  assert.equal(inner?.type,'heading');assert.equal(inner?.attrs?.level,2);assert.equal(inner?.attrs?.textAlign,'right');
});
