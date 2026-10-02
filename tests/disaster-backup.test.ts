import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuration,retentionKeys,sameInventory,storeVerified,toolFailureReason,sqlDumpPlan } from '../scripts/disaster-backup.mjs';
test('DB 백업은 정해진 Supabase 대상과 공개키만 허용한다',()=>{
  const env={SUPABASE_DB_URL:'postgresql://postgres.example:test@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',R2_ACCOUNT_ID:'a'.repeat(32),R2_BUCKET:'orbis-backups',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',BACKUP_AGE_RECIPIENT:`age1${'q'.repeat(58)}`,DB_BACKUP_HEALTHCHECK_URL:'https://hc-ping.com/12345678-1234-1234-1234-123456789abc'};
  assert.equal(configuration(env).budget,9000000000);assert.throws(()=>configuration({...env,SUPABASE_DB_URL:'postgresql://postgres:p@localhost:5432/postgres'}));assert.throws(()=>configuration({...env,BACKUP_AGE_RECIPIENT:'AGE-SECRET-KEY-test'}));assert.throws(()=>configuration({...env,R2_MAX_STORAGE_BYTES:'11000000000'}));assert.throws(()=>configuration({...env,DB_BACKUP_HEALTHCHECK_URL:'https://example.com/ping'}));
  assert.equal(configuration({...env,SUPABASE_DB_URL:'postgresql://postgres:test@db.example.supabase.co:5432/postgres?sslmode=require'}).major,17);
  assert.throws(()=>configuration({...env,SUPABASE_DB_URL:'postgresql://postgres:test@unknown.supabase.com:5432/postgres'}));
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
test('DB 도구 오류는 비밀값 없이 고정된 원인만 표시한다',()=>{
  assert.equal(toolFailureReason('postgresql://postgres:private-test-password@db.example.supabase.co:5432/postgres password authentication failed'), 'DB 인증 실패');
  assert.equal(toolFailureReason('pg_dump: connection timed out'), 'DB 또는 도구 다운로드 연결 실패');
  assert.equal(toolFailureReason('unknown flag: --test-only'), 'CLI 옵션 또는 버전 확인 필요');
  assert.equal(toolFailureReason('if any flags in the group [keep-comments data-only] are set none of the others can be'), 'CLI 옵션 또는 버전 확인 필요');
  assert.equal(toolFailureReason('permission denied for table users'), 'DB 또는 Docker 접근 권한 확인 필요');
  assert.equal(toolFailureReason('SQL or unexpected private-test-password diagnostic'), '도구 실행 실패');
});
test('SQL 백업은 CLI의 상호 배타 옵션을 지키고 계정·첨부 데이터 범위를 유지한다',()=>{
  const plan=sqlDumpPlan();
  for(const [,flags] of plan){
    for(const group of [['--keep-comments','--data-only'],['--role-only','--data-only'],['--schema','--role-only']]){
      assert(flags.filter(flag=>group.includes(flag)).length<=1,`금지된 옵션 조합: ${group.join(', ')}`);
    }
    if(flags.includes('--use-copy')||flags.includes('-x'))assert(flags.includes('--data-only'));
  }
  const data=plan.find(([name])=>name==='data.sql')?.[1];assert(data);
  assert.deepEqual(data[data.indexOf('--schema')+1].split(',').sort(),['auth','public','storage']);
  assert(data.includes('--use-copy'));assert(data.includes('storage.buckets_vectors'));assert(data.includes('storage.vector_indexes'));
  assert(plan.find(([name])=>name==='schema.sql')?.[1].includes('--keep-comments'));
});
