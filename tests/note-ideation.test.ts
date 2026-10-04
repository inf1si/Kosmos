import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNote, newNote, noteBacklinks, noteBoardColumns, noteContentForWork, noteFromTemplate, noteImportContent, patchNote, prepareFolderWork, prepareNoteImport } from '../src/lib/personal-notes';
import { applyNoteNavigation, resolveNoteNavigation } from '../src/lib/note-navigation';
import { fromText, noteSchema, uid, workspaceSchema, type RichNode, type Workspace } from '../src/lib/model';
import { seedWorkspace } from '../src/lib/seed';
import type { ImportBundle } from '../src/lib/interchange';

const all=(node:RichNode):RichNode[]=>[node,...(node.content||[]).flatMap(all)];
function fixture(){
  let state:Workspace=seedWorkspace();const make=(title:string,body:string)=>{const note={...newNote(),title,content:fromText(body)};state=addNote(state,note);return note;};
  const a=make('도시','달의 도시'),b=make('인물','떠나는 이유'),c=make('밖','폴더 밖 노트');
  const folder=uid(),sub=uid(),nav=resolveNoteNavigation(state);
  nav.nodes=[{id:folder,type:'folder',title:'구상',parentId:null},{id:sub,type:'folder',title:'인물들',parentId:folder},...nav.nodes.map(n=>n.id===a.id?{...n,parentId:folder}:n.id===b.id?{...n,parentId:sub}:n)];
  return {state:applyNoteNavigation(state,nav),a,b,c,folder,sub};
}

test('보드는 최상위 폴더마다 한 열이고 하위 폴더 노트를 포함하며 폴더 밖 노트를 따로 모은다',()=>{
  const {state,a,b,c,folder}=fixture(),columns=noteBoardColumns(state);
  assert.deepEqual(columns.map(col=>col.folderId),[folder,null]);
  assert.deepEqual(columns[0].notes.map(n=>n.id).sort(),[a.id,b.id].sort());
  assert.deepEqual(columns[1].notes.map(n=>n.id),[c.id]);
});

test('노트 링크는 대상 노트의 백링크가 되고 자기 자신은 제외한다',()=>{
  const {state,a,b}=fixture();
  const linked=patchNote(state,b.id,{content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'도시',marks:[{type:'wikiLink',attrs:{targetId:a.id}}]},{type:'text',text:'나',marks:[{type:'wikiLink',attrs:{targetId:b.id}}]}]}]}});
  assert.deepEqual(noteBacklinks(linked.notes!,a.id).map(n=>n.id),[b.id]);
  assert.deepEqual(noteBacklinks(linked.notes!,b.id),[]);
});

test('고정은 수정 시각을 바꾸지 않고 템플릿은 소제목과 빈 문단을 만든다',()=>{
  const {state,a}=fixture(),pinned=patchNote(state,a.id,{pinned:true}),note=pinned.notes!.find(n=>n.id===a.id)!;
  assert.equal(note.pinned,true);assert.equal(note.updatedAt,a.updatedAt);
  const template=noteFromTemplate('character');assert(template.title.length>0);
  assert(template.content.content!.some(n=>n.type==='heading'));noteSchema.parse(template);
});

test('작품으로 옮길 때 체크리스트는 글머리표로, 본문 이미지는 이름 문단으로 바뀌고 노트 링크는 빠진다',()=>{
  const assetId=uid(),content:RichNode={type:'doc',content:[
    {type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[{type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:'지도',marks:[{type:'wikiLink',attrs:{targetId:uid()}}]}]}]}]},
    {type:'noteImage',attrs:{assetId,alt:'map.png'}}]};
  const converted=noteContentForWork(content,new Set(),[{id:assetId,noteId:uid(),name:'map.png',type:'image/png',size:1}]),nodes=all(converted);
  assert(!nodes.some(n=>['taskList','taskItem','noteImage'].includes(n.type)));
  assert(nodes.some(n=>n.type==='bulletList'));assert(nodes.some(n=>n.text==='[이미지: map.png]'));
  assert(!nodes.some(n=>n.marks?.some(m=>m.type==='wikiLink')));
});

test('작품 문서는 노트 전용 노드를 받지 않지만 노트는 받는다',()=>{
  const state=seedWorkspace(),doc=state.works[0].documents[0],task:RichNode={type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph'}]}]}]};
  assert.throws(()=>workspaceSchema.parse({...state,works:[{...state.works[0],documents:[{...doc,content:task}]}]}));
  noteSchema.parse({...newNote(),content:task});
});

test('폴더로 만든 새 작품은 노트를 메모 문서로 복사하고 하위 폴더를 유지하며 원본 노트에 작품을 연결한다',()=>{
  const {state,a,b,folder}=fixture(),prepared=prepareFolderWork(state,folder,{title:'달의 도시',form:'중편'});
  const work=prepared.state.works.find(w=>w.id===prepared.workId)!;
  assert.equal(work.form,'중편');assert.deepEqual(work.documents.map(d=>d.title).sort(),['도시','인물'].sort());
  assert(work.documents.every(d=>d.kind==='memo'));
  assert(work.navigation!.nodes.some(n=>n.type==='folder'&&n.title==='인물들'));
  for(const id of [a.id,b.id])assert(prepared.state.notes!.find(n=>n.id===id)!.linkedWorkIds.includes(work.id));
  assert.equal(prepared.state.notes!.length,state.notes!.length);
  assert.throws(()=>prepareFolderWork(state,folder,{title:' ',form:'장편'}));
});

test('가져온 ENEX 노트는 새 폴더의 수집함에 들어가고 태그·날짜·체크박스·본문 이미지를 유지한다',()=>{
  const {state}=fixture(),blob=new Blob([new Uint8Array([1])],{type:'image/png'});
  const bundle:ImportBundle={source:'a.enex',warnings:[],assets:[{key:'enex:a:1',name:'map.png',blob}],pages:[{key:'a',title:'시장',kind:'memo',chapter:'',category:'',summary:'',assetKeys:['enex:a:1'],tags:['#세계관','세계관',' 시장 '],created:'20250302T091500Z',updated:'20250410T120000Z',
    content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'☑ 지도'}]},{type:'paragraph',content:[{type:'text',text:'☐ 이름'}]},{type:'paragraph',content:[{type:'text',text:'[첨부: map.png]'}]}]}}]};
  const prepared=prepareNoteImport(state,bundle,'에버노트'),note=prepared.state.notes![0];
  assert.equal(prepared.count,1);assert.deepEqual(note.tags,['세계관','시장']);assert.equal(note.box,'inbox');
  assert.equal(note.createdAt,'2025-03-02T09:15:00.000Z');assert.equal(note.updatedAt,'2025-04-10T12:00:00.000Z');
  const nodes=all(note.content);assert.deepEqual(nodes.filter(n=>n.type==='taskItem').map(n=>n.attrs?.checked),[true,false]);
  assert(nodes.some(n=>n.text==='지도'));assert.equal(nodes.find(n=>n.type==='noteImage')?.attrs?.assetId,note.assetIds[0]);
  assert.equal(note.content.content!.at(-1)!.type,'paragraph');
  const nav=resolveNoteNavigation(prepared.state);assert.equal(nav.nodes.find(n=>n.id===prepared.folderId)?.type,'folder');
  assert.equal(nav.nodes.find(n=>n.id===note.id)?.parentId,prepared.folderId);assert.equal(prepared.assets.length,1);
});

test('가져온 문서의 블록 ID는 매번 새로 만든다',()=>{
  const id=uid(),content:RichNode={type:'doc',content:[{type:'paragraph',attrs:{blockId:id},content:[{type:'text',text:'a'}]}]};
  assert.notEqual(noteImportContent(content,new Map()).content![0].attrs?.blockId,id);
});
