import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../src/lib/seed';
import { documentSchema,fromText,isRichDocument,makePublication,newDocument,plainText,publicationSchema,uid,workspaceSchema,type RichNode } from '../src/lib/model';
import { internalReferenceSchema,internalReferenceType,internalReferences,withoutInternalReferences } from '../src/lib/internal-reference-node';
import { referenceBacklinks,referenceChildren,referenceConnections,referenceGroup,referenceKey,referenceLabel,referenceTargets,searchReferences } from '../src/lib/internal-references';
import { addNote,newNote } from '../src/lib/personal-notes';
import { createBackup,readBackup } from '../src/lib/backup';
import { textStatistics } from '../src/lib/text-statistics';
import { prepareTemplate,prepareTemplateApplication } from '../src/lib/workspace-templates';
import { resolveNoteNavigation } from '../src/lib/note-navigation';
import { resolveNavigation } from '../src/lib/document-navigation';
import { exportInterchange } from '../src/lib/interchange';
import JSZip from 'jszip';
import { restoreTrash,trashDocumentFolder,trashNoteFolder,trashWork } from '../src/lib/workspace-trash';

function fixture(){
  const note={...newNote(),title:'도시 설정'},state=addNote(seedWorkspace(),note),source=state.works[0].documents.find(doc=>doc.kind==='scene')!;
  const ref={kind:'note' as const,targetId:note.id,workId:null,label:note.title};
  source.content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'앞 문장 '},{type:internalReferenceType,attrs:ref},{type:'text',text:' 뒤 문장'}]}]};

  return {state,note:state.notes!.find(value=>value.id===note.id)!,source,ref};
}

function containerFixture(){
  const base=fixture(),{state,note,source}=base,work=state.works[0],noteFolder=uid(),nestedNoteFolder=uid(),documentFolder=uid(),nestedDocumentFolder=uid(),shelf=uid();
  state.noteNavigation=resolveNoteNavigation(state);
  state.noteNavigation.nodes.push({id:noteFolder,type:'folder',title:'자료 폴더',parentId:null},{id:nestedNoteFolder,type:'folder',title:'하위 자료',parentId:noteFolder});
  state.noteNavigation.nodes.find(node=>node.id===note.id)!.parentId=nestedNoteFolder;
  work.navigation=resolveNavigation(work);const node=work.navigation.nodes.find(node=>node.id===source.id)!;
  work.navigation.nodes.push({id:documentFolder,type:'folder',title:'원고 폴더',parentId:null,sectionId:node.sectionId},{id:nestedDocumentFolder,type:'folder',title:'하위 원고',parentId:documentFolder,sectionId:node.sectionId});node.parentId=nestedDocumentFolder;
  state.workShelves=[{id:'default',title:'',workIds:[]},{id:shelf,title:'보관 책장',workIds:[work.id]}];
  const targets=referenceTargets(state),mentions=targets.filter(target=>[noteFolder,nestedNoteFolder,documentFolder,nestedDocumentFolder,work.id,shelf,'default'].includes(target.targetId));
  source.content.content!.push({type:'paragraph',content:mentions.map(({kind,targetId,workId,label})=>({type:internalReferenceType,attrs:{kind,targetId,workId,label}}))});

  return {...base,mentions,noteFolder,nestedNoteFolder,documentFolder,nestedDocumentFolder,shelf};
}

test('private references survive workspace/backup validation but do not enter public editions or body statistics',async()=>{
  const {state,note,source,ref}=fixture();
  workspaceSchema.parse(state);documentSchema.parse(source);
  const body=plainText(source.content);assert.equal(body,'앞 문장  뒤 문장');assert.equal(textStatistics(source.content).charactersWithSpaces,body.length);
  const before=structuredClone(source.content),pub=makePublication(state.works[0],[source.id]);
  assert.deepEqual(source.content,before);assert.equal(internalReferences(pub.scenes[0].content).length,0);
  const json=JSON.stringify(pub);

for(const secret of [note.id,ref.label,internalReferenceType])assert(!json.includes(secret));
  assert(!publicationSchema.safeParse({...pub,scenes:[{...pub.scenes[0],content:source.content}]}).success);
  const restored=await readBackup(await createBackup(state,[],[]));
  assert.deepEqual(restored.data.works[0].documents.find(doc=>doc.id===source.id)?.content,source.content);

  for(const format of ['html','markdown','enex'] as const){
    const exported=await exportInterchange(state.works[0],[source.id],[],[],format);
    const output=format==='enex'?await exported.blob.text():await JSZip.loadAsync(await exported.blob.arrayBuffer()).then(async zip=>(await Promise.all(Object.values(zip.files).filter(file=>!file.dir).map(file=>file.async('string')))).join('\n'));
    assert(output.includes('앞 문장'));

    for(const secret of [note.id,ref.label,internalReferenceType])assert(!output.includes(secret),`${format}: private reference escaped`);
  }
});

test('reference validation rejects malformed targets and hidden children; nested removal preserves prose and normal wiki links',()=>{
  const {source,ref}=fixture();

  for(const attrs of [{...ref,targetId:'broken'},{...ref,kind:'document'}, {...ref,label:'x'.repeat(301)}, {...ref,workId:uid()}]){
    assert(!internalReferenceSchema.safeParse(attrs).success);
    assert(!isRichDocument({type:'doc',content:[{type:internalReferenceType,attrs}]}));
  }

  assert(!isRichDocument({type:'doc',content:[{type:internalReferenceType,attrs:ref,content:[]}]}));
  const content:RichNode={type:'doc',content:[{type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'본문',marks:[{type:'wikiLink',attrs:{targetId:uid()}}]},{type:internalReferenceType,attrs:ref}]}]},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:internalReferenceType,attrs:ref},{type:'text',text:'표'}]}]}]}]}]};
  assert(isRichDocument(content));const clean=withoutInternalReferences(content);assert.equal(plainText(clean),plainText(content));assert.equal(internalReferences(clean).length,0);assert(JSON.stringify(clean).includes('wikiLink'));assert.equal(internalReferences(source.content).length,1);
});

test('search and backlinks resolve stable identities across spaces, renames, duplicate titles and unavailable targets',()=>{
  const {state,note,source,ref}=fixture(),otherDoc=newDocument('wiki','도시 설정'),work={...state.works[0],id:uid(),title:'다른 작품',documents:[otherDoc],navigation:undefined,publications:[],activePublicationId:null};
  state.works.push(work);note.content={type:'doc',content:[{type:'paragraph',content:[{type:internalReferenceType,attrs:{kind:'document',targetId:otherDoc.id,workId:work.id,label:otherDoc.title}}]}]};
  let targets=referenceTargets(state),found=searchReferences(targets,source.id,'도시');assert.equal(found.length,2);assert.notEqual(referenceKey(found[0]),referenceKey(found[1]));
  assert.equal(searchReferences(targets,source.id,'다른 작품')[0].targetId,otherDoc.id);
  assert.equal(referenceConnections(targets,note.id).incoming[0].targetId,source.id);
  assert.equal(referenceConnections(targets,otherDoc.id).incoming[0].targetId,note.id);
  note.title='바뀐 도시';targets=referenceTargets(state);assert.equal(referenceConnections(targets,source.id).outgoing[0].label,'바뀐 도시');
  state.notes=[];assert.equal(referenceConnections(referenceTargets(state),source.id).outgoing[0].label,ref.label);assert.equal(referenceConnections(referenceTargets(state),source.id).incoming.length,0);
});

test('template copies point to the copied document rather than a stale source ID',()=>{
  const {state,source}=fixture(),work=state.works[0],target=work.documents.find(doc=>doc.kind==='wiki')!;
  source.content={type:'doc',content:[{type:'paragraph',content:[{type:internalReferenceType,attrs:{kind:'document',targetId:target.id,workId:work.id,label:target.title}}]}]};
  const captured=prepareTemplate(state,{scope:'work',workId:work.id},[source.id,target.id],'참조 묶음');
  const copied=prepareTemplateApplication(captured.state,captured.templateId,{scope:'work',workId:work.id,to:{sectionId:resolveNavigation(work).sections[0].id,parentId:null}});
  const docs=copied.state.works[0].documents.filter(doc=>copied.documentIds.includes(doc.id)),newSource=docs.find(doc=>doc.title===source.title)!,newTarget=docs.find(doc=>doc.title===target.title)!;
  assert.equal(internalReferences(newSource.content)[0].targetId,newTarget.id);
  assert.equal(internalReferences(newSource.content)[0].workId,work.id);
  assert.notEqual(newTarget.id,target.id);
});

test('container targets preserve hierarchy, scope, default shelves and backlinks without adding bodies',async()=>{
  const {state,source,mentions,noteFolder,nestedNoteFolder,documentFolder,nestedDocumentFolder,shelf}=containerFixture();
  workspaceSchema.parse(state);const targets=referenceTargets(state),find=(id:string)=>targets.find(target=>target.targetId===id)!;
  assert.equal(new Set(mentions.map(referenceGroup)).size,3);
  assert.deepEqual(referenceChildren(targets,find(noteFolder)).map(target=>target.targetId),[nestedNoteFolder]);
  assert.deepEqual(referenceChildren(targets,find(documentFolder)).map(target=>target.targetId),[nestedDocumentFolder]);
  assert.deepEqual(referenceChildren(targets,find(nestedDocumentFolder)).map(target=>target.targetId),[source.id]);
  assert.deepEqual(referenceChildren(targets,find(shelf)).map(target=>target.targetId),[state.works[0].id]);
  assert.equal(find('default').label,'이름 없는 책장');assert.equal(referenceChildren(targets,find('default')).length,state.works.length-1);
  assert.equal(referenceBacklinks(targets,find(noteFolder))[0].targetId,source.id);
  assert.equal(referenceConnections(targets,source.id).outgoing.length,mentions.length+1);

  for(const ref of mentions){assert(internalReferenceSchema.safeParse(ref).success);assert.equal(referenceLabel(state,ref),ref.label);assert(!ref.content);}

  for(const attrs of [{...find(documentFolder),workId:null},{...find(noteFolder),workId:state.works[0].id},{...find(shelf),workId:state.works[0].id},{...find(shelf),kind:'work',targetId:'default'}])assert(!internalReferenceSchema.safeParse(attrs).success);
  const before=plainText(source.content),snapshot=structuredClone(source.content),backup=await readBackup(await createBackup(state,[],[]));
  assert.equal(plainText(makePublication(state.works[0],[source.id]).scenes[0].content),before);
  assert.deepEqual(backup.data.works[0].documents.find(doc=>doc.id===source.id)!.content,snapshot);
  assert.equal(internalReferences(withoutInternalReferences(source.content)).length,0);
  const folder=state.noteNavigation!.nodes.find(node=>node.id===noteFolder)!;

  if(folder.type==='folder')folder.title='새 자료 폴더';
  assert.equal(referenceLabel(state,find(noteFolder)),'새 자료 폴더');
  const saved=structuredClone(state.workShelves);state.workShelves=state.workShelves!.filter(value=>value.id!==shelf);
  assert.equal(referenceLabel(state,find(shelf)),null);assert(!referenceTargets(state).some(target=>referenceKey(target)===referenceKey(find(shelf))));
  state.workShelves=saved;assert.equal(referenceLabel(state,find(shelf)),'보관 책장');
  state.works[0].title='새 작품명';assert.equal(referenceLabel(state,find(state.works[0].id)),'새 작품명');
  const removed=state.works.shift()!;assert.equal(referenceLabel(state,find(removed.id)),null);state.works.unshift(removed);
  assert.equal(referenceLabel(state,find(removed.id)),'새 작품명');
});

test('large document groups do not crowd folders, works or shelves out of search',()=>{
  const {state,source,noteFolder,shelf}=containerFixture();
  state.workShelves!.find(value=>value.id===shelf)!.workIds=state.works.map(work=>work.id).reverse();
  const ordered=referenceTargets(state);assert.deepEqual(referenceChildren(ordered,ordered.find(target=>target.targetId===shelf)!).map(target=>target.targetId),state.workShelves!.find(value=>value.id===shelf)!.workIds);

  for(let i=0;i<50;i++)state.works[0].documents.push(newDocument('memo',`자료 ${i}`));
  const found=searchReferences(referenceTargets(state),source.id,'');
  assert.equal(found.filter(target=>referenceGroup(target)==='document').length,30);
  assert(found.some(target=>target.targetId===noteFolder));assert(found.some(target=>target.targetId===shelf));
  assert(found.some(target=>target.kind==='work'));assert(!found.some(target=>target.targetId===source.id));
});

test('folder mentions in work and note templates remap to copied folders while work and shelf mentions retain identity',()=>{
  const {state,source,note,noteFolder,documentFolder,nestedDocumentFolder,shelf}=containerFixture(),work=state.works[0];
  const captured=prepareTemplate(state,{scope:'work',workId:work.id},[documentFolder],'폴더 참조');
  const copied=prepareTemplateApplication(captured.state,captured.templateId,{scope:'work',workId:work.id,to:{sectionId:resolveNavigation(work).sections[0].id,parentId:null}});
  const newSource=copied.state.works[0].documents.find(doc=>copied.documentIds.includes(doc.id)&&doc.title===source.title)!,refs=internalReferences(newSource.content);
  const nav=resolveNavigation(copied.state.works[0]);

  for(const old of [documentFolder,nestedDocumentFolder]){const original=referenceTargets(state).find(target=>target.targetId===old)!,ref=refs.find(ref=>ref.kind==='document-folder'&&ref.label===original.label)!;assert.notEqual(ref.targetId,old);assert(nav.nodes.some(node=>node.id===ref.targetId));assert.equal(ref.workId,work.id);}

  assert(refs.some(ref=>ref.kind==='work'&&ref.targetId===work.id));assert(refs.some(ref=>ref.kind==='shelf'&&ref.targetId===shelf));
  const target=referenceTargets(state).find(target=>target.targetId===noteFolder)!,{kind,targetId,workId,label}=target;note.content={type:'doc',content:[{type:'paragraph',content:[{type:internalReferenceType,attrs:{kind,targetId,workId,label}}]}]};
  const saved=prepareTemplate(state,{scope:'notes'},[noteFolder],'노트 폴더 참조'),applied=prepareTemplateApplication(saved.state,saved.templateId,{scope:'notes',to:{parentId:null}});
  const cloned=applied.state.notes!.find(note=>applied.documentIds.includes(note.id))!,ref=internalReferences(cloned.content)[0];
  assert.equal(ref.kind,'note-folder');assert.notEqual(ref.targetId,noteFolder);assert.equal(ref.workId,null);assert(applied.state.noteNavigation!.nodes.some(node=>node.id===ref.targetId));
});

test('folder and work mentions become unavailable in trash and resolve to the same IDs after restoring',()=>{
  const {state,noteFolder,nestedNoteFolder,documentFolder,nestedDocumentFolder,shelf}=containerFixture(),work=state.works[0],targets=referenceTargets(state),find=(id:string)=>targets.find(target=>target.targetId===id)!;
  const removedNotes=trashNoteFolder(state,noteFolder);

  for(const id of [noteFolder,nestedNoteFolder])assert.equal(referenceLabel(removedNotes,find(id)),null);
  const restoredNotes=restoreTrash(removedNotes,noteFolder);

  for(const id of [noteFolder,nestedNoteFolder])assert.equal(referenceLabel(restoredNotes,find(id)),find(id).label);
  const removedDocs=trashDocumentFolder(state,work.id,documentFolder);

  for(const id of [documentFolder,nestedDocumentFolder])assert.equal(referenceLabel(removedDocs,find(id)),null);
  const restoredDocs=restoreTrash(removedDocs,documentFolder);

  for(const id of [documentFolder,nestedDocumentFolder])assert.equal(referenceLabel(restoredDocs,find(id)),find(id).label);
  const removedWork=trashWork(state,work.id);
  assert.equal(referenceLabel(removedWork,find(work.id)),null);assert.equal(referenceChildren(referenceTargets(removedWork),find(shelf)).length,0);
  const restoredWork=restoreTrash(removedWork,work.id);
  assert.equal(referenceLabel(restoredWork,find(work.id)),work.title);assert.equal(referenceChildren(referenceTargets(restoredWork),find(shelf))[0].targetId,work.id);
});

test('PostgreSQL publisher removes every private reference before storage/response; direct unsafe snapshots are rejected',async()=>{
  const pg=new PGlite();

  try{
    await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema public,storage to anon,authenticated;create publication supabase_realtime;`);
    await pg.exec(await readFile(new URL('../supabase/migrations/001_studio.sql',import.meta.url),'utf8'));
    await pg.exec(await readFile(new URL('../supabase/migrations/20261025130617_internal_references.sql',import.meta.url),'utf8'));
    const {state,source,note,mentions}=containerFixture(),author=uid();await pg.query('insert into auth.users values ($1)',[author]);await pg.query('insert into public.authors values ($1)',[author]);
    await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[author]);
    const initial=await pg.query<{r:{id:string}}>('select public.initialize_workspace($1::jsonb) r',[JSON.stringify(state)]),id=initial.rows[0].r.id;
    const published=await pg.query<{r:unknown}>('select public.publish_work($1,$2,$3::uuid[]) r',[id,state.works[0].id,[source.id]]),snapshot=JSON.stringify(published.rows[0].r);

    for(const secret of [note.id,note.title,internalReferenceType,...mentions.filter(ref=>ref.kind!=='work').flatMap(ref=>[ref.targetId,ref.label])])assert(!snapshot.includes(secret));
    assert(snapshot.includes('앞 문장'));publicationSchema.parse(published.rows[0].r);
    await assert.rejects(()=>pg.query('select public.strip_internal_references($1::jsonb)',[JSON.stringify(source.content)]),/permission/);
    await pg.exec('reset role');
    const saved=await pg.query<{payload:typeof state}>('select payload from public.workspaces where id=$1',[id]);assert.deepEqual(saved.rows[0].payload.works[0].documents.find(doc=>doc.id===source.id)?.content,source.content);
    await assert.rejects(()=>pg.query('update public.publications set payload=jsonb_set(payload,\'{scenes,0,content}\',$1::jsonb)',[JSON.stringify(source.content)]),/publications_no_internal_references/);
    await pg.exec('set role anon');const rows=await pg.query<{payload:unknown}>('select payload from public.publications where active');assert.equal(JSON.stringify(rows.rows[0].payload),snapshot);
    await assert.rejects(()=>pg.query('select public.publish_work($1,$2,$3::uuid[])',[id,state.works[0].id,[source.id]]),/permission/);
  }finally{await pg.close();}
});
