import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOffsiteBackup,cronAuthorized,backupConfiguration,readOffsiteArchive,type BackupStorage } from '../src/lib/offsite-backup';
import { readBackup } from '../src/lib/backup';
import { seedWorkspace } from '../src/lib/seed';
import { uid } from '../src/lib/model';

test('외부 백업은 현재·과거 원고와 첨부를 저장하고 실제 읽기·무결성 검증 후 성공을 기록한다',async()=>{
  const state=seedWorkspace(),old=structuredClone(state),id=uid(),blob=new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});old.assets.push({id,workId:old.works[0].id,name:'과거.png',type:'image/png',size:4});old.works[0].documents[0].assetIds.push(id);
  const stored=new Map<string,Uint8Array>(),events:string[]=[];

const storage:BackupStorage={write:async(k,b)=>{events.push(`write:${k}`);stored.set(k,b);},read:async(k)=>{events.push(`read:${k}`);

return stored.get(k)||null;}};

  const report=await createOffsiteBackup({snapshot:{data:state,version:9,revisions:[{id:uid(),namespace:'server',createdAt:new Date().toISOString(),label:'이력',data:old}]},ownerId:uid(),prefix:'kosmos',storage,downloadAsset:async()=>blob});assert.equal(report.verified,true);assert.equal(report.assets,1);assert(events[0].endsWith('.zip'));assert(events[1].startsWith('read:'));assert(events.at(-1)!.endsWith('latest.json'));
  const bytes=[...stored.entries()].find(([k])=>k.endsWith('.zip'))![1];const restored=await readBackup(new Blob([Uint8Array.from(bytes).buffer]));assert.deepEqual(restored.data,state);assert.deepEqual(restored.revisions[0].data,old);assert.equal(restored.assets[0].blob.size,4);
  const key=report.archiveKey!,owner=key.split('/')[1];assert.deepEqual(await readOffsiteArchive(report,'kosmos',owner,storage),bytes);
  await assert.rejects(()=>readOffsiteArchive({...report,archiveKey:key.replace(owner,uid())},'kosmos',owner,storage),/위치/);
  await assert.rejects(()=>readOffsiteArchive({...report,sha256:'0'.repeat(64)},'kosmos',owner,storage),/무결성/);
});

test('외부 저장소 손상·누락 첨부 시 이전 성공 표시를 바꾸지 않는다',async()=>{
  const writes:string[]=[];const storage:BackupStorage={write:async(k)=>{writes.push(k);},read:async()=>new Uint8Array([1,2,3])};await assert.rejects(()=>createOffsiteBackup({snapshot:{data:seedWorkspace(),version:1,revisions:[]},ownerId:uid(),prefix:'kosmos',storage,downloadAsset:async()=>{throw new Error('missing');}}),/검증/);assert(!writes.some(k=>k.endsWith('latest.json')));
  const state=seedWorkspace(),id=uid();state.assets.push({id,workId:state.works[0].id,name:'missing.png',type:'image/png',size:4});await assert.rejects(()=>createOffsiteBackup({snapshot:{data:state,version:2,revisions:[]},ownerId:uid(),prefix:'kosmos',storage,downloadAsset:async()=>{throw new Error('missing');}}),/missing/);assert(!writes.some(k=>k.endsWith('latest.json')));
});

test('크론은 충분한 별도 비밀과 정확한 Bearer 인증을 요구하고 설정이 없으면 비활성화한다',()=>{
  const secret='a'.repeat(40);assert.equal(cronAuthorized(null,secret),false);assert.equal(cronAuthorized('Bearer a','a'),false);assert.equal(cronAuthorized(`Bearer ${secret}x`,secret),false);assert.equal(cronAuthorized(`Bearer ${secret}`,secret),true);assert.equal(backupConfiguration({}),null);
  const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only',BACKUP_AUTHOR_ID:uid(),BACKUP_STORAGE_PROVIDER:'s3',BACKUP_S3_BUCKET:'private',BACKUP_S3_ACCESS_KEY_ID:'id',BACKUP_S3_SECRET_ACCESS_KEY:'secret',CRON_SECRET:secret,BACKUP_S3_ENDPOINT:'https://example.r2.cloudflarestorage.com'};assert(backupConfiguration(env));assert.equal(backupConfiguration({...env,BACKUP_S3_ENDPOINT:'http://localhost'}),null);assert.equal(backupConfiguration({...env,BACKUP_STORAGE_PROVIDER:'google-drive'}),null);assert.equal(backupConfiguration({...env,BACKUP_STORAGE_PROVIDER:'google-drive',BACKUP_GOOGLE_CLIENT_ID:'id',BACKUP_GOOGLE_CLIENT_SECRET:'secret',BACKUP_GOOGLE_REFRESH_TOKEN:'token'})?.provider,'google-drive');
});
