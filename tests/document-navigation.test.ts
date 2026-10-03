import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../src/lib/seed';
import { fromText, makePublication, newDocument, uid, workspaceSchema, wikiReferences } from '../src/lib/model';
import { applyNavigation, childrenOf, insertDocument, insertFolder, moveNavigation, navigationOrder, navigationSnapshot, resolveNavigation, restoreNavigation, siblingDestination } from '../src/lib/document-navigation';
import { MAX_DOCUMENT_DEPTH } from '../src/lib/document-navigation-schema';
import { createBackup, readBackup } from '../src/lib/backup';
import { exportInterchange, prepareImport, readInterchange } from '../src/lib/interchange';

test('기존 부·장 폴더를 안정적으로 이어받고 비연속 부·장과 원고 순서를 보존한다',()=>{
  const work=seedWorkspace().works[0],scenes=work.documents.filter(d=>d.kind==='scene');scenes.forEach((d,i)=>d.chapter=i%2?'다른 부':'같은 부');
  const original=JSON.stringify(work),nav=resolveNavigation(work);assert.deepEqual(nav,resolveNavigation(work));assert.equal(JSON.stringify(work),original);
  assert.equal(nav.nodes.filter(n=>n.type==='folder').length,scenes.length);assert.deepEqual(navigationOrder(nav).filter(id=>scenes.some(d=>d.id===id)),scenes.map(d=>d.id));
  assert.deepEqual(applyNavigation(work,nav).documents.filter(d=>d.kind==='scene').map(d=>d.id),scenes.map(d=>d.id));
});
test('문서 하위에 문서·폴더를 넣고 하위 트리 전체를 다른 대분류로 옮겨도 링크·종류·부·장은 유지한다',()=>{
  let work=seedWorkspace().works[0];const scenes=work.documents.filter(d=>d.kind==='scene'),wiki=work.documents.find(d=>d.kind==='wiki')!;
  const original=structuredClone(work.documents),refs=wikiReferences(scenes[0].content);
  work=moveNavigation(work,scenes[1].id,{sectionId:'scene',parentId:scenes[0].id});
  work=insertFolder(work,'부속 자료',{sectionId:'scene',parentId:scenes[1].id});const folder=work.navigation!.nodes.find(n=>n.type==='folder'&&n.title==='부속 자료')!;
  work=moveNavigation(work,wiki.id,{sectionId:'scene',parentId:folder.id});work=moveNavigation(work,scenes[0].id,{sectionId:'memo',parentId:null});
  for(const id of [scenes[0].id,scenes[1].id,folder.id,wiki.id])assert.equal(work.navigation!.nodes.find(n=>n.id===id)!.sectionId,'memo');
  assert.deepEqual(wikiReferences(work.documents.find(d=>d.id===scenes[0].id)!.content),refs);
  for(const d of work.documents)assert.deepEqual(d,original.find(old=>old.id===d.id));
});
test('형제 순서 변경은 하위 트리를 함께 옮기며 발행 원고 순서도 트리 순서를 따른다',()=>{
  let work=seedWorkspace().works[0];const scenes=work.documents.filter(d=>d.kind==='scene'),folder=resolveNavigation(work).nodes.find(n=>n.type==='folder')!;
  work=moveNavigation(work,scenes[1].id,{sectionId:'scene',parentId:scenes[0].id});
  work=moveNavigation(work,scenes[2].id,{sectionId:'scene',parentId:folder.id,beforeId:scenes[0].id});
  const pub=makePublication(work,scenes.map(d=>d.id));assert.deepEqual(pub.scenes.map(d=>d.id),[scenes[2].id,scenes[0].id,scenes[1].id]);
  assert.deepEqual(siblingDestination(work,scenes[2].id,1),{sectionId:'scene',parentId:folder.id,beforeId:undefined});
  const to=siblingDestination(work,scenes[2].id,1)!;work=moveNavigation(work,scenes[2].id,to);assert.deepEqual(makePublication(work,scenes.map(d=>d.id)).scenes.map(d=>d.id),[scenes[0].id,scenes[1].id,scenes[2].id]);
  assert(!JSON.stringify(pub).includes('navigation'));assert(!JSON.stringify(pub).includes(folder.id));
});
test('자기 자신·자손·없는 부모·다른 대분류의 부모·없는 형제·과도한 깊이로의 이동은 거절한다',()=>{
  let work=seedWorkspace().works[0];const [a,b]=work.documents.filter(d=>d.kind==='scene');work=moveNavigation(work,b.id,{sectionId:'scene',parentId:a.id});
  for(const parentId of [a.id,b.id])assert.throws(()=>moveNavigation(work,a.id,{sectionId:'scene',parentId}),/자신/);
  assert.throws(()=>moveNavigation(work,a.id,{sectionId:'scene',parentId:uid()}),/위치/);
  assert.throws(()=>moveNavigation(work,a.id,{sectionId:'memo',parentId:b.id}),/위치/);
  assert.throws(()=>moveNavigation(work,a.id,{sectionId:'scene',parentId:null,beforeId:uid()}),/순서/);
  let parentId:string|null=null;for(let i=0;i<MAX_DOCUMENT_DEPTH;i++){work=insertFolder(work,`깊이 ${i}`,{sectionId:'memo',parentId});parentId=work.navigation!.nodes.find(n=>n.type==='folder'&&n.title===`깊이 ${i}`)!.id;}
  assert.throws(()=>moveNavigation(work,a.id,{sectionId:'memo',parentId}),/24단계/);
});
test('클라우드·복구 입력에서 중복·유실·순환 위치를 거절하고 누락된 새 문서 위치는 복구한다',()=>{
  const state=seedWorkspace(),work=state.works[0];work.navigation=resolveNavigation(work);const original=structuredClone(state);
  work.navigation.nodes.push({...work.navigation.nodes[0]});assert.throws(()=>workspaceSchema.parse(state),/중복/);
  const invalid=structuredClone(original),node=invalid.works[0].navigation!.nodes.find(n=>n.type==='document')!;node.parentId=node.id;assert.throws(()=>workspaceSchema.parse(invalid),/자신/);
  node.parentId=uid();assert.throws(()=>workspaceSchema.parse(invalid),/상위/);node.parentId=null;node.id=uid();assert.throws(()=>workspaceSchema.parse(invalid),/찾지/);
  const memo=newDocument('memo','새 메모');original.works[0].documents.push(memo);const parsed=workspaceSchema.parse(original);const repaired=applyNavigation(parsed.works[0],resolveNavigation(parsed.works[0]));assert(repaired.navigation!.nodes.some(n=>n.id===memo.id));assert(repaired.documents.some(d=>d.id===memo.id));
});
test('정리 되돌리기는 이후의 본문 편집·새 문서를 보존한다',()=>{
  let work=seedWorkspace().works[0];const before=navigationSnapshot(work),[a,b]=work.documents.filter(d=>d.kind==='scene');
  work=moveNavigation(work,b.id,{sectionId:'scene',parentId:a.id});work.documents.find(d=>d.id===a.id)!.content=fromText('이동 뒤에 쓴 문장');const memo=newDocument('memo','추가한 메모');work=insertDocument(work,memo);
  work=restoreNavigation(work,before);assert.deepEqual(work.navigation!.nodes.find(n=>n.id===b.id),before.navigation.nodes.find(n=>n.id===b.id));assert.equal(work.documents.find(d=>d.id===a.id)!.content.content![0].content![0].text,'이동 뒤에 쓴 문장');assert(work.documents.some(d=>d.id===memo.id));assert(work.navigation!.nodes.some(n=>n.id===memo.id));
});
test('전체 백업·복구 이력은 대분류와 폴더·하위 문서를 그대로 복원한다',async()=>{
  const state=seedWorkspace(),work=state.works[0],[a,b]=work.documents.filter(d=>d.kind==='scene');state.works[0]=moveNavigation(work,b.id,{sectionId:'scene',parentId:a.id});
  state.works[0].navigation!.sections.push({id:uid(),title:'연대표',defaultKind:'memo'});const blob=await createBackup(state,[{id:uid(),namespace:'test',createdAt:state.updatedAt,label:'정리',data:structuredClone(state)}],[]),loaded=await readBackup(blob);
  assert.deepEqual(loaded.data,state);assert.deepEqual(loaded.revisions[0].data.works[0].navigation,state.works[0].navigation);
});
test('기존 문서 묶음을 계층이 있는 작품에 추가해도 모든 문서가 탐색창에 나타난다',async()=>{
  const state=seedWorkspace();state.works[0]=applyNavigation(state.works[0],resolveNavigation(state.works[0]));const bundle=await readInterchange([new File(['추가 본문'],'리서치.txt')]);const out=prepareImport(state,bundle,bundle.pages.map(p=>({key:p.key,title:p.title,kind:'memo'})),{workId:state.works[0].id});
  const work=out.state.works[0],nav=resolveNavigation(work);assert(nav.nodes.some(n=>n.type==='document'&&work.documents.find(d=>d.id===n.id)?.title==='리서치'));assert.equal(childrenOf(nav,null,'memo').length,2);
});
for(const format of ['markdown','html'] as const)test(`${format} 교환 파일은 사용자 대분류·폴더·하위 문서를 새 ID로 복원한다`,async()=>{
  const state=seedWorkspace();let work=state.works[0];const [a,b]=work.documents.filter(d=>d.kind==='scene');work=moveNavigation(work,b.id,{sectionId:'scene',parentId:a.id});work=insertFolder(work,'조사 폴더',{sectionId:'scene',parentId:b.id});
  const sectionId=uid();work.navigation!.sections.push({id:sectionId,title:'연대표',defaultKind:'memo'});const memo=newDocument('memo','조사 결과'),folder=work.navigation!.nodes.find(n=>n.type==='folder'&&n.title==='조사 폴더')!;work=insertDocument(work,memo,{sectionId:'scene',parentId:folder.id});
  work=moveNavigation(work,a.id,{sectionId,parentId:null});const out=await exportInterchange(work,work.documents.map(d=>d.id),[],[],format),bundle=await readInterchange([new File([out.blob],out.name)]);
  const copied=prepareImport(state,bundle,bundle.pages.map(p=>({key:p.key,title:p.title,kind:p.kind})),{title:'복원',form:'장편'}).state.works.at(-1)!;
  assert(copied.navigation!.sections.some(s=>s.title==='연대표'));assert.equal(copied.documents.length,work.documents.length);assert(copied.documents.every(d=>!work.documents.some(old=>old.id===d.id)));
  const newA=copied.documents.find(d=>d.title===a.title)!,newB=copied.documents.find(d=>d.title===b.title)!,newFolder=copied.navigation!.nodes.find(n=>n.type==='folder'&&n.title==='조사 폴더')!,newMemo=copied.documents.find(d=>d.title==='조사 결과')!;
  assert.equal(copied.navigation!.nodes.find(n=>n.id===newB.id)!.parentId,newA.id);assert.equal(newFolder.parentId,newB.id);assert.equal(copied.navigation!.nodes.find(n=>n.id===newMemo.id)!.parentId,newFolder.id);assert.deepEqual(copied.documents.map(d=>d.title),work.documents.map(d=>d.title));
  const appended=prepareImport(state,bundle,bundle.pages.map(p=>({key:p.key,title:p.title,kind:p.kind})),{workId:state.works[0].id}).state.works[0];workspaceSchema.parse({...state,works:[appended]});assert.equal(appended.documents.length,state.works[0].documents.length+work.documents.length);
  const partial=await exportInterchange(work,[memo.id],[],[],format),partialBundle=await readInterchange([new File([partial.blob],partial.name)]),partialCopy=prepareImport(state,partialBundle,partialBundle.pages.map(p=>({key:p.key,title:p.title,kind:p.kind})),{title:'부분 복원',form:'단편'}).state.works.at(-1)!;
  assert.equal(partialCopy.documents.length,1);const retainedFolder=partialCopy.navigation!.nodes.find(n=>n.type==='folder'&&n.title==='조사 폴더')!;assert.equal(partialCopy.navigation!.nodes.find(n=>n.id===partialCopy.documents[0].id)!.parentId,retainedFolder.id);assert.equal(retainedFolder.parentId,null);
});
