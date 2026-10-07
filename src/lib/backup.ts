import JSZip from 'jszip';
import { z } from 'zod';
import { zipUncompressedSize } from './zip-metadata';
import { Workspace, Revision, workspaceSchema, plainText } from './model';
import { trashTitle } from './workspace-trash';
import { noteTitle } from './personal-notes';

const MAX_BYTES=100*1024*1024;

export type BackupAsset={id:string;blob:Blob};

const manifestSchema=z.object({format:z.literal('orbit-novel-backup'),version:z.literal(1),createdAt:z.string(),workspaceId:z.string(),files:z.array(z.object({path:z.string(),bytes:z.number().int().nonnegative().safe(),sha256:z.string()})).max(12000)});

 type Manifest=z.infer<typeof manifestSchema>;

async function digest(data:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data).buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');}

const encode=(text:string)=>new TextEncoder().encode(text);

export async function createBackup(data:Workspace,revisions:Revision[],assets:BackupAsset[]):Promise<Blob>{
  workspaceSchema.parse(data);
  const zip=new JSZip();const manifest:Manifest={format:'orbit-novel-backup',version:1,createdAt:new Date().toISOString(),workspaceId:data.id,files:[]};
  let bytes=0;

  async function add(path:string,content:Uint8Array){bytes+=content.length;

if(bytes>MAX_BYTES)throw new Error('백업 용량이 100MB를 넘습니다.');zip.file(path,content);manifest.files.push({path,bytes:content.length,sha256:await digest(content)});}

  await add('workspace.json',encode(JSON.stringify(data,null,2)));
  await add('revisions.json',encode(JSON.stringify(revisions.map(({id,createdAt,label,data})=>({id,createdAt,label,data})),null,2)));
  const assetMap=new Map(assets.map(a=>[a.id,a.blob]));
  const allMeta=new Map([...data.assets,...revisions.flatMap(r=>r.data.assets)].map(a=>[a.id,a]));

  for(const meta of allMeta.values()){const blob=assetMap.get(meta.id);

if(!blob||blob.size!==meta.size)throw new Error(`첨부가 누락되었거나 손상되었습니다: ${meta.name}`);await add(`assets/${meta.id}`,new Uint8Array(await blob.arrayBuffer()));}

  for(const work of data.works)for(const d of work.documents)await add(`text/${work.id}/${d.id}.md`,encode(`# ${d.title}\n\n${plainText(d.content)}\n`));

  for(const note of data.notes||[])await add(`text/notes/${note.id}.md`,encode(`# ${noteTitle(note)}\n\n${plainText(note.content)}\n`));

  for(const item of data.trash||[])await add(`text/trash/${item.id}.md`,encode(`# ${trashTitle(item)}\n\n${plainText(item.type==='note'?item.note.content:item.document.content)}\n`));
  await add('README.txt',encode('workspace.json이 원고·설정·독립 노트·휴지통·각주·관계·공개 판본의 복원 원본입니다. assets/에는 실제 첨부, revisions.json에는 복구 이력이 있습니다. text/는 읽기 쉬운 별도 사본입니다. 이 파일에는 비공개 원고와 노트가 포함됩니다.\n'));
  zip.file('manifest.json',JSON.stringify(manifest,null,2));

  return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}

export async function readBackup(file:Blob):Promise<{data:Workspace;revisions:Omit<Revision,'namespace'>[];assets:BackupAsset[]}>{
  if(file.size>MAX_BYTES)throw new Error('백업 파일은 100MB 이하여야 합니다.');
  const zip=await JSZip.loadAsync(await file.arrayBuffer());

  if(Object.keys(zip.files).length>14000)throw new Error('백업 파일 수가 너무 많습니다.');
  const manifestFile=zip.file('manifest.json');

if(!manifestFile)throw new Error('백업 목록이 없습니다.');
  const manifestSize=zipUncompressedSize(manifestFile);

  if(manifestSize===undefined||manifestSize>3*1024*1024)throw new Error('백업 목록의 크기가 올바르지 않습니다.');
  const parsed=manifestSchema.safeParse(JSON.parse(await manifestFile.async('string')));

  if(!parsed.success)throw new Error('지원하지 않는 백업 형식입니다.');
  const manifest=parsed.data;
  const listed=new Set<string>();let total=0;const contents=new Map<string,Uint8Array>();

  for(const entry of manifest.files){
    if(entry.path.includes('..')||entry.path.startsWith('/')||entry.path.includes('\\')||listed.has(entry.path)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||(total+=entry.bytes)>MAX_BYTES)throw new Error('백업 목록 또는 용량이 올바르지 않습니다.');
    listed.add(entry.path);const f=zip.file(entry.path);

if(!f)throw new Error(`백업 파일 누락: ${entry.path}`);
    // Inspect the declared decompressed size before allocating a large ZIP member.
    const declared=zipUncompressedSize(f);

    if(declared!==undefined&&declared!==entry.bytes)throw new Error('백업 파일 크기가 일치하지 않습니다.');
    const buffer=await f.async('uint8array');

if(buffer.length!==entry.bytes||await digest(buffer)!==entry.sha256)throw new Error('백업 무결성 검증에 실패했습니다.');contents.set(entry.path,buffer);
  }

  const raw=contents.get('workspace.json');

if(!raw)throw new Error('원고 데이터가 없습니다.');
  const data=workspaceSchema.parse(JSON.parse(new TextDecoder().decode(raw)));

  if(manifest.workspaceId!==data.id)throw new Error('작품 식별자가 일치하지 않습니다.');
  const revisionBytes=contents.get('revisions.json');const rawRevisions=revisionBytes?JSON.parse(new TextDecoder().decode(revisionBytes)):[];

  if(!Array.isArray(rawRevisions)||rawRevisions.length>50)throw new Error('복구 이력 형식을 확인하세요.');
  const revisions=rawRevisions.map(r=>({id:String(r.id),createdAt:String(r.createdAt),label:String(r.label),data:workspaceSchema.parse(r.data)}));
  const allMeta=new Map([...data.assets,...revisions.flatMap(r=>r.data.assets)].map(a=>[a.id,a]));

  const assets:BackupAsset[]=[...allMeta.values()].map(meta=>{
    const buffer=contents.get(`assets/${meta.id}`);

if(!buffer||buffer.length!==meta.size)throw new Error(`첨부 검증 실패: ${meta.name}`);

    return {id:meta.id,blob:new Blob([new Uint8Array(buffer).buffer],{type:meta.type})};
  });

  return {data,revisions,assets};
}
