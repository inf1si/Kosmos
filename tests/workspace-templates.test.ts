import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../src/lib/seed';
import { documentSchema, documentTitle, fromText, makePublication, newDocument, plainText, uid, wikiReferences, workspaceSchema } from '../src/lib/model';
import { customPropertiesSchema } from '../src/lib/custom-properties';
import { applyNavigation, defaultSections, resolveNavigation } from '../src/lib/document-navigation';
import { newNote, prepareNoteCopy, prepareFolderWork } from '../src/lib/personal-notes';
import { prepareTemplate, prepareTemplateApplication, preserveTemplateData, removeTemplate } from '../src/lib/workspace-templates';
import { purgeTrash, trashDocument, trashDocumentFolder } from '../src/lib/workspace-trash';
import { createBackup, readBackup } from '../src/lib/backup';
import { exportInterchange, prepareImport, readInterchange } from '../src/lib/interchange';

const image=new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64'))],{type:'image/png'});

function fixture(){
 const state=seedWorkspace(),work=state.works[0],folder=uid(),childFolder=uid(),a=newDocument('scene',''),b=newDocument('wiki','연결할 설정'),outside=newDocument('memo','묶음 밖');
 a.customProperties=[{id:uid(),name:'회차',type:'number',value:0},{id:uid(),name:'확정',type:'checkbox',value:false}];
 a.content={type:'doc',content:[{type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:'내부 링크',marks:[{type:'wikiLink',attrs:{targetId:b.id}}]},{type:'text',text:'외부 링크',marks:[{type:'wikiLink',attrs:{targetId:outside.id}}]},{type:'footnote',attrs:{noteId:uid(),text:'합성 각주'}}]}]};
 const asset=uid();a.assetIds=[asset];state.assets.push({id:asset,workId:work.id,name:'합성.png',type:'image/png',size:image.size});
 work.documents=[a,b,outside];work.navigation={version:1,sections:structuredClone(defaultSections),nodes:[{id:folder,type:'folder',title:'본문',sectionId:'scene',parentId:null},{id:a.id,type:'document',sectionId:'scene',parentId:folder},{id:childFolder,type:'folder',title:'내부 폴더',sectionId:'scene',parentId:folder},{id:b.id,type:'document',sectionId:'scene',parentId:childFolder},{id:outside.id,type:'document',sectionId:'memo',parentId:null}]};

 return {state,work,a,b,outside,folder,childFolder,asset};
}

test('폴더·문서 중복 선택은 한 사본으로 저장하고 원본 삭제 후 다른 작품에 독립된 구조·첨부·속성을 만든다',()=>{
 const {state,work,a,b,folder,asset}=fixture(),before=structuredClone(state),saved=prepareTemplate(state,{scope:'work',workId:work.id},[folder,a.id],'폴더 템플릿');
 const template=saved.state.templates![0];assert.equal(template.scope,'work');

if(template.scope!=='work')return;
 assert.equal(template.documents.length,2);assert.equal(template.navigation.nodes.length,4);assert.equal(saved.copies[0].sourceId,asset);
 assert.notEqual(template.documents[0].id,a.id);assert.equal(template.documents[0].title,'');assert.equal(template.documents[0].customProperties![0].value,0);assert.equal(template.documents[0].customProperties![1].value,false);
 assert.deepEqual(wikiReferences(template.documents[0].content),[template.documents[1].id]);assert.equal(plainText(template.documents[0].content),plainText(a.content));
 assert.notEqual(template.documents[0].content.content![0].attrs!.blockId,a.content.content![0].attrs!.blockId);
 const moved=trashDocumentFolder(saved.state,work.id,folder),deleted=purgeTrash(moved,moved.trash!.map(t=>t.id));assert(!deleted.assets.some(x=>x.id===asset));assert(deleted.assets.some(x=>x.templateId===template.id));
 const target=deleted.works[1],applied=prepareTemplateApplication(deleted,template.id,{scope:'work',workId:target.id,to:{sectionId:'scene',parentId:null}}),next=applied.state.works[1];
 const docs=next.documents.filter(d=>applied.documentIds.includes(d.id));assert.equal(docs.length,2);assert.deepEqual(wikiReferences(docs[0].content),[docs[1].id]);assert(!docs.some(d=>d.id===a.id||d.id===b.id));
 assert.equal(next.navigation!.nodes.filter(n=>n.type==='folder').length,resolveNavigation(target).nodes.filter(n=>n.type==='folder').length+2);
 assert.equal(applied.state.assets.find(x=>x.id===docs[0].assetIds[0])!.workId,target.id);assert.deepEqual(applied.state.templates,deleted.templates);assert.deepEqual(state,before);
 assert.deepEqual(removeTemplate(applied.state,template.id).works,applied.state.works);
});

test('문서 하나와 여러 문서를 저장하고 잘못된 위치·공간·빈 폴더·손상 첨부를 적용 전에 거절한다',()=>{
 const {state,work,a,b,folder}=fixture();

 for(const selected of [[a.id],[a.id,b.id]]){const saved=prepareTemplate(state,{scope:'work',workId:work.id},selected,'선택 문서');const template=saved.state.templates![0];assert.equal(template.scope==='work'&&template.documents.length,selected.length);const before=structuredClone(saved.state);
 assert.throws(()=>prepareTemplateApplication(saved.state,template.id,{scope:'work',workId:work.id,to:{sectionId:'scene',parentId:uid()}}),/위치/);assert.throws(()=>prepareTemplateApplication(saved.state,template.id,{scope:'notes',to:{parentId:null}}),/템플릿/);assert.deepEqual(saved.state,before);}

 assert.throws(()=>prepareTemplate(state,{scope:'work',workId:work.id},[],'빈 선택'),/선택/);
 const damaged=structuredClone(state);damaged.assets=[];assert.throws(()=>prepareTemplate(damaged,{scope:'work',workId:work.id},[folder],'손상'),/첨부/);
 const saved=prepareTemplate(state,{scope:'work',workId:work.id},[folder],'깊은 구조');let nav=resolveNavigation(work),parentId:string|null=null;

 for(let i=0;i<23;i++){const id=uid();nav.nodes.push({id,type:'folder',title:'깊이',sectionId:'scene',parentId});parentId=id;}

 saved.state.works[0]=applyNavigation(work,nav);assert.throws(()=>prepareTemplateApplication(saved.state,saved.templateId,{scope:'work',workId:work.id,to:{sectionId:'scene',parentId}}),/단계/);
});

test('노트 템플릿은 본문 이미지·체크리스트·속성을 복제하고 작품 연결·AI 대화를 복사하지 않는다',()=>{
 const state=seedWorkspace(),a=newNote(),b=newNote(),folder=uid(),asset=uid();a.title='합성 이미지 노트';a.linkedWorkIds=[state.works[0].id];a.pinned=true;
 a.customProperties=[{id:uid(),name:'날짜',type:'date',value:'2026-10-07'}];a.assetIds=[asset];a.content={type:'doc',content:[{type:'noteImage',attrs:{assetId:asset,alt:'합성 이미지'}},{type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[{type:'paragraph',content:[{type:'text',text:'체크한 생각',marks:[{type:'wikiLink',attrs:{targetId:b.id}}]}]}]}]}]};
 a.aiMessages=[{id:uid(),role:'user',text:'복사하지 않을 합성 대화',createdAt:new Date().toISOString()},{id:uid(),role:'assistant',result:{review:'합성 답변',suggestions:[]},createdAt:new Date().toISOString(),provider:'openai',model:'synthetic',version:'synthetic',sources:[]}];state.notes=[a,b];state.noteNavigation={version:1,nodes:[{id:folder,type:'folder',title:'노트 묶음',parentId:null},{id:a.id,type:'note',parentId:folder},{id:b.id,type:'note',parentId:a.id}]};state.assets=[{id:asset,noteId:a.id,name:'합성.png',type:'image/png',size:image.size}];
 assert.deepEqual(prepareNoteCopy(state,a.id,state.works[0].id,'memo').state.works[0].documents.at(-1)!.customProperties,a.customProperties);
 const madeWork=prepareFolderWork(state,folder,{title:'합성 속성 작품',form:'단편'}).state.works.at(-1)!;assert.deepEqual(madeWork.documents[0].customProperties,a.customProperties);
 const saved=prepareTemplate(state,{scope:'notes'},[folder],'노트 템플릿'),template=saved.state.templates![0];assert.equal(template.scope,'notes');

if(template.scope!=='notes')return;
 assert.deepEqual(template.notes[0].linkedWorkIds,[]);assert.equal(template.notes[0].aiMessages,undefined);assert.equal(template.notes[0].pinned,false);
 const applied=prepareTemplateApplication(saved.state,template.id,{scope:'notes',to:{parentId:folder}}),copies=applied.state.notes!.filter(n=>applied.documentIds.includes(n.id));
 assert.equal(copies.length,2);assert.equal(copies[0].content.content![0].attrs!.assetId,copies[0].assetIds[0]);assert.equal(applied.state.assets.find(x=>x.id===copies[0].assetIds[0])!.noteId,copies[0].id);assert.deepEqual(wikiReferences(copies[0].content),[copies[1].id]);assert.equal(copies[0].customProperties![0].value,'2026-10-07');assert.equal(copies[0].content.content![1].content![0].attrs!.checked,true);assert(workspaceSchema.safeParse(applied.state).success);
});

test('빈 제목과 사용자 속성은 전체 백업·HTML/Markdown 교환에서 보존되고 공개판에는 속성을 내보내지 않는다',async()=>{
 const {state,work,a,folder}=fixture(),saved=prepareTemplate(state,{scope:'work',workId:work.id},[folder],'백업 템플릿');assert(documentSchema.safeParse(a).success);assert.equal(documentTitle(a),'제목 없음');
 const zip=await createBackup(saved.state,[],saved.state.assets.map(a=>({id:a.id,blob:image}))),backup=await readBackup(zip);assert.deepEqual(backup.data,saved.state);assert.equal(backup.assets.length,2);

 for(const format of ['markdown','html'] as const){const exported=await exportInterchange(work,[a.id],state.assets,state.assets.map(a=>({id:a.id,blob:image})),format),bundle=await readInterchange([new File([await exported.blob.arrayBuffer()],exported.name)]);assert.equal(bundle.pages[0].title,'');
 const imported=prepareImport(seedWorkspace(),bundle,[{key:bundle.pages[0].key,title:'',kind:'scene'}],{workId:state.works[1].id});const copied=imported.state.works[1].documents.at(-1)!;assert.equal(copied.title,'');assert.equal(copied.customProperties![0].value,0);assert.equal(copied.customProperties![1].value,false);assert.equal(plainText(copied.content.content![0]),plainText(a.content));assert.equal(copied.assetIds.length,1);}

 const pub=makePublication(work,[a.id]);assert.equal(pub.scenes[0].title,'');assert(!JSON.stringify(pub).includes('customProperties'));
 assert(!customPropertiesSchema.safeParse([{id:uid(),name:'중복',type:'text',value:''},{id:uid(),name:'중복',type:'number',value:null}]).success);assert(!customPropertiesSchema.safeParse([{id:uid(),name:'날짜',type:'date',value:'2026-02-31'}]).success);
 const old=structuredClone(saved.state);delete old.templates;delete old.works[0].documents[0].customProperties;old.assets=old.assets.filter(a=>!a.templateId);assert(workspaceSchema.safeParse(preserveTemplateData(old,saved.state)).success);assert.deepEqual(preserveTemplateData(old,saved.state).templates,saved.state.templates);
 old.templates=[];old.works[0].documents[0].customProperties=[];assert.deepEqual(preserveTemplateData(old,saved.state).templates,[]);assert.deepEqual(preserveTemplateData(old,saved.state).works[0].documents[0].customProperties,[]);
});

test('새 저장 보호 SQL은 구버전 필드 누락을 차단하고 명시적 삭제·휴지통·복원을 허용한다',async()=>{
 const pg=new PGlite();

try{
 await pg.exec('create role anon;create role authenticated;create table public.workspaces(id integer primary key,payload jsonb not null);');const sql=readFileSync(new URL('../supabase/migrations/20261007124540_workspace_templates_guard.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);
 const {state,work,a,folder}=fixture(),saved=prepareTemplate(state,{scope:'work',workId:work.id},[folder],'SQL 템플릿').state;await pg.query('insert into workspaces values(1,$1)',[JSON.stringify(saved)]);
 const legacy=structuredClone(saved);delete legacy.templates;await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(legacy)]),/템플릿/);
 legacy.templates=saved.templates;delete legacy.works[0].documents[0].customProperties;await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(legacy)]),/속성/);
 const moved=trashDocument(saved,work.id,a.id);await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(moved)]);const damaged=structuredClone(moved);

if(damaged.trash![0].type==='document')delete damaged.trash![0].document.customProperties;await assert.rejects(()=>pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(damaged)]),/속성/);
 await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(saved)]);saved.templates=[];saved.works[0].documents[0].customProperties=[];await pg.query('update workspaces set payload=$1 where id=1',[JSON.stringify(saved)]);
 assert.equal((await pg.query<{allowed:boolean}>("select has_function_privilege('anon','public.guard_workspace_templates()','EXECUTE') as allowed")).rows[0].allowed,false);
 }finally{await pg.close();}
});
