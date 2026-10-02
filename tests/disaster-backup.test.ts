import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuration,retentionKeys,sameInventory,storeVerified } from '../scripts/disaster-backup.mjs';
test('DB 백업은 정해진 Supabase 대상과 공개키만 허용한다',()=>{
  const env={SUPABASE_DB_URL:'postgresql://postgres.example:test@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',R2_ACCOUNT_ID:'a'.repeat(32),R2_BUCKET:'orbis-backups',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',BACKUP_AGE_RECIPIENT:`age1${'q'.repeat(58)}`,DB_BACKUP_HEALTHCHECK_URL:'https://hc-ping.com/12345678-1234-1234-1234-123456789abc'};
  assert.equal(configuration(env).budget,9000000000);assert.throws(()=>configuration({...env,SUPABASE_DB_URL:'postgresql://postgres:p@localhost:5432/postgres'}));assert.throws(()=>configuration({...env,BACKUP_AGE_RECIPIENT:'AGE-SECRET-KEY-test'}));assert.throws(()=>configuration({...env,R2_MAX_STORAGE_BYTES:'11000000000'}));assert.throws(()=>configuration({...env,DB_BACKUP_HEALTHCHECK_URL:'https://example.com/ping'}));
});
test('백업은 고유한 일간·월간 파일을 쓰고 첨부 삭제·변경을 감지한다',()=>{
  assert.equal(retentionKeys(new Date('2026-10-02T18:23:00Z'),'test').length,1);const month=retentionKeys(new Date('2026-11-01T18:23:00Z'),'test');assert.equal(month.length,2);assert(month[1].startsWith('monthly/2026-11/'));assert(month.every(key=>key.endsWith('.zip.age')));
  const files=[{bucket:'private-assets',path:'owner/image',id:'id',updatedAt:'2026-10-02',size:4}];assert(sameInventory(files,[...files]));assert(!sameInventory(files,[]));assert(!sameInventory(files,[{...files[0],updatedAt:'2026-10-03'}]));
});
test('R2 손상·용량 초과 시 성공 기록을 갱신하지 않는다',async()=>{
  const stored=new Map<string,Uint8Array>();let marked=false;const storage={write:async(key:string,bytes:Uint8Array)=>{stored.set(key,bytes);},read:async(key:string)=>stored.get(key),status:async()=>{marked=true;}};
  await storeVerified(storage,['daily/test.zip.age'],new Uint8Array([1,2,3]),100,0);assert(marked);marked=false;
  await assert.rejects(()=>storeVerified(storage,['daily/next.zip.age'],new Uint8Array([1,2,3]),2,0),/상한/);assert(!marked);assert(!stored.has('daily/next.zip.age'));
  await assert.rejects(()=>storeVerified({...storage,read:async()=>new Uint8Array([0,0,0])},['daily/bad.zip.age'],new Uint8Array([1,2,3]),100,0),/검증/);assert(!marked);
});
