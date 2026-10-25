import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../src/lib/seed';
import { documentSchema,fromText,isRichDocument,makePublication,newDocument,plainText,publicationSchema,uid,workspaceSchema,type RichNode } from '../src/lib/model';
import { internalReferenceSchema,internalReferenceType,internalReferences,withoutInternalReferences } from '../src/lib/internal-reference-node';
import { referenceConnections,referenceKey,referenceTargets,searchReferences } from '../src/lib/internal-references';
import { addNote,newNote } from '../src/lib/personal-notes';
import { createBackup,readBackup } from '../src/lib/backup';
import { textStatistics } from '../src/lib/text-statistics';
import { prepareTemplate,prepareTemplateApplication } from '../src/lib/workspace-templates';
import { resolveNavigation } from '../src/lib/document-navigation';
import { exportInterchange } from '../src/lib/interchange';
import JSZip from 'jszip';

function fixture(){
  const note={...newNote(),title:'도시 설정'},state=addNote(seedWorkspace(),note),source=state.works[0].documents.find(doc=>doc.kind==='scene')!;
  const ref={kind:'note' as const,targetId:note.id,workId:null,label:note.title};
  source.content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'앞 문장 '},{type:internalReferenceType,attrs:ref},{type:'text',text:' 뒤 문장'}]}]};

  return {state,note:state.notes!.find(value=>value.id===note.id)!,source,ref};
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

test('PostgreSQL publisher removes every private reference before storage/response; direct unsafe snapshots are rejected',async()=>{
  const pg=new PGlite();

  try{
    await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema public,storage to anon,authenticated;create publication supabase_realtime;`);
    await pg.exec(await readFile(new URL('../supabase/migrations/001_studio.sql',import.meta.url),'utf8'));
    await pg.exec(await readFile(new URL('../supabase/migrations/20261025130617_internal_references.sql',import.meta.url),'utf8'));
    const {state,source,note}=fixture(),author=uid();await pg.query('insert into auth.users values ($1)',[author]);await pg.query('insert into public.authors values ($1)',[author]);
    await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[author]);
    const initial=await pg.query<{r:{id:string}}>('select public.initialize_workspace($1::jsonb) r',[JSON.stringify(state)]),id=initial.rows[0].r.id;
    const published=await pg.query<{r:unknown}>('select public.publish_work($1,$2,$3::uuid[]) r',[id,state.works[0].id,[source.id]]),snapshot=JSON.stringify(published.rows[0].r);

    for(const secret of [note.id,note.title,internalReferenceType])assert(!snapshot.includes(secret));
    assert(snapshot.includes('앞 문장'));publicationSchema.parse(published.rows[0].r);
    await assert.rejects(()=>pg.query('select public.strip_internal_references($1::jsonb)',[JSON.stringify(source.content)]),/permission/);
    await pg.exec('reset role');
    const saved=await pg.query<{payload:typeof state}>('select payload from public.workspaces where id=$1',[id]);assert.deepEqual(saved.rows[0].payload.works[0].documents.find(doc=>doc.id===source.id)?.content,source.content);
    await assert.rejects(()=>pg.query('update public.publications set payload=jsonb_set(payload,\'{scenes,0,content}\',$1::jsonb)',[JSON.stringify(source.content)]),/publications_no_internal_references/);
    await pg.exec('set role anon');const rows=await pg.query<{payload:unknown}>('select payload from public.publications where active');assert.equal(JSON.stringify(rows.rows[0].payload),snapshot);
    await assert.rejects(()=>pg.query('select public.publish_work($1,$2,$3::uuid[])',[id,state.works[0].id,[source.id]]),/permission/);
  }finally{await pg.close();}
});
