import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createBackup,readBackup } from '../src/lib/backup';
import { seedWorkspace } from '../src/lib/seed';
import { makePublication,uid,fromText,plainText } from '../src/lib/model';
import { applySuggestion } from '../src/lib/ai';

test('백업은 주석, 설정 연결, 판본, 현재 및 과거 첨부의 실제 바이트를 복원한다',async()=>{
 const state=seedWorkspace();const old=structuredClone(state);const id=uid();const blob=new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});
 old.assets.push({id,workId:old.works[0].id,name:'과거자료.png',type:'image/png',size:4});old.works[0].documents[0].assetIds.push(id);
 const zip=await createBackup(state,[{id:uid(),namespace:'test',createdAt:new Date().toISOString(),label:'과거',data:old}],[{id,blob}]);
 const restored=await readBackup(zip);assert.deepEqual(restored.data,state);assert.deepEqual(restored.revisions[0].data,old);assert.equal(restored.assets.length,1);assert.deepEqual(new Uint8Array(await restored.assets[0].blob.arrayBuffer()),new Uint8Array(await blob.arrayBuffer()));
});

test('원고가 변조되었으면 현재 원고를 건드리기 전에 복원을 거절한다',async()=>{
 const original=seedWorkspace();const bytes=await createBackup(original,[],[]);const zip=await JSZip.loadAsync(await bytes.arrayBuffer());zip.file('workspace.json','{}');
 const corrupt=await zip.generateAsync({type:'blob'});await assert.rejects(()=>readBackup(corrupt),/일치|검증/);assert.equal(original.works[0].title,'먼 별의 항구');
});

test('누락된 첨부와 알 수 없는 백업을 거절한다',async()=>{
 const state=seedWorkspace();state.assets.push({id:uid(),workId:state.works[0].id,name:'누락.png',type:'image/png',size:4});
 await assert.rejects(()=>createBackup(state,[],[]),/첨부/);await assert.rejects(()=>readBackup(new Blob(['not a zip'])));
});

test('공개 판본은 초안 수정과 비공개 설정에서 독립적이다',()=>{
 const state=seedWorkspace();const work=state.works[0];const pub=makePublication(work,[work.documents[0].id]);const before=JSON.stringify(pub);
 work.documents[0].content=fromText('수정한 초안');work.documents.find(d=>d.kind==='wiki')!.content=fromText('비밀');
 assert.equal(JSON.stringify(pub),before);assert(!before.includes('결말에서'));assert(!before.includes('제7항구'));assert.equal(pub.wiki.length,2);
});

test('AI 제안은 각주와 설정 링크를 보존하며 중복 인용은 자동 적용하지 않는다',()=>{
 const content=seedWorkspace().works[0].documents[0].content;const edited=applySuggestion(content,'숫자는 아무 감정도 없이 정확했다.','숫자는 정확했다.');
 assert(plainText(edited).includes('숫자는 정확했다.'));assert(JSON.stringify(edited).includes('footnote'));assert(JSON.stringify(edited).includes('wikiLink'));
 assert.throws(()=>applySuggestion(fromText('같은 말. 같은 말.'),'같은 말.','새 말.'),/하나의 위치/);assert(plainText(content).includes('숫자는 아무 감정도 없이 정확했다.'));
});
