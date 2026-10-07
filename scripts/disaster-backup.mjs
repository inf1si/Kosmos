import { createHash,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile,writeFile,mkdtemp,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createClient } from '@supabase/supabase-js';
import { S3Client,ListObjectsV2Command,PutObjectCommand,GetObjectCommand } from '@aws-sdk/client-s3';

const CAP=100*1024*1024;

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

class QuietToolError extends Error {}

/** Classify tool errors without returning a connection string, password, SQL, or raw output. */
export function toolFailureReason(stderr){
  if(/password authentication failed|28P01|authentication failed/i.test(stderr))return 'DB 인증 실패';

  if(/timed? ?out|timeout|connection refused|could not translate host|no route to host|network is unreachable/i.test(stderr))return 'DB 또는 도구 다운로드 연결 실패';

  if(/permission denied|42501/i.test(stderr))return 'DB 또는 Docker 접근 권한 확인 필요';

  if(/unknown flag|unrecognized option|mutually exclusive|none of the others can be|unsupported.*version|version mismatch/i.test(stderr))return 'CLI 옵션 또는 버전 확인 필요';

  return '도구 실행 실패';
}

/** @param {Record<string,string|undefined>} env */
export function configuration(env=process.env){
  const required=['SUPABASE_DB_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','R2_ACCOUNT_ID','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','BACKUP_AGE_RECIPIENT','DB_BACKUP_HEALTHCHECK_URL'];

  if(required.some(key=>!env[key]))throw new Error('DB 백업 연결 설정이 필요합니다.');
  const db=new URL(env.SUPABASE_DB_URL),api=new URL(env.SUPABASE_URL);
  const databaseHostAllowed=/^db\.[a-z0-9]+\.supabase\.co$/.test(db.hostname)||/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname);

  if(!['postgres:','postgresql:'].includes(db.protocol)||!db.password||!db.username||!databaseHostAllowed||db.port!=='5432'||db.pathname!=='/postgres')throw new Error('Supabase direct 또는 session pooler 5432 연결을 사용하세요.');

  if(api.protocol!=='https:'||!api.hostname.endsWith('.supabase.co')||api.pathname!=='/'||api.username||api.password||api.search)throw new Error('Supabase URL을 확인하세요.');

  if(!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID)||! /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET))throw new Error('R2 계정과 버킷을 확인하세요.');

  if(!/^age1[0-9a-z]{58}$/.test(env.BACKUP_AGE_RECIPIENT))throw new Error('age 공개키를 확인하세요. 개인키는 CI에 넣지 않습니다.');
  const budget=Number(env.R2_MAX_STORAGE_BYTES||9000000000),major=Number(env.BACKUP_POSTGRES_MAJOR||17);

  if(!Number.isSafeInteger(budget)||budget<=0||budget>9000000000||major!==17)throw new Error('저장량 제한 또는 고정 Postgres 버전을 확인하세요.');
  const heartbeat=new URL(env.DB_BACKUP_HEALTHCHECK_URL);

  if(heartbeat.origin!=='https://hc-ping.com'||!/^\/[a-f0-9-]{36}$/.test(heartbeat.pathname)||heartbeat.search||heartbeat.hash||heartbeat.username||heartbeat.password)throw new Error('DB 백업 감시 URL을 확인하세요.');

  return{dbUrl:env.SUPABASE_DB_URL,apiUrl:api.origin,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,account:env.R2_ACCOUNT_ID,bucket:env.R2_BUCKET,accessKey:env.R2_ACCESS_KEY_ID,secretKey:env.R2_SECRET_ACCESS_KEY,recipient:env.BACKUP_AGE_RECIPIENT,heartbeat:heartbeat.href,budget,major};
}

/** Tool output may contain connection strings. Capture it privately and emit only fixed errors. */
async function quietTool(command,args,label){
  return new Promise((resolveResult,reject)=>{
    const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',stderr='';
    child.stdout.on('data',chunk=>{if(output.length<2*1024*1024)output+=chunk.toString();});child.stderr.on('data',chunk=>{if(stderr.length<65536)stderr+=chunk.toString();});
    child.on('error',()=>reject(new QuietToolError(`${label} 도구를 실행하지 못했습니다.`)));
    child.on('close',code=>code===0?resolveResult(output):reject(new QuietToolError(`${label}: ${toolFailureReason(stderr)}.`)));
  });
}

export function sameInventory(a,b){
  const stable=items=>JSON.stringify(items.map(({bucket,path,id,updatedAt,size})=>({bucket,path,id,updatedAt,size})).sort((x,y)=>`${x.bucket}/${x.path}`.localeCompare(`${y.bucket}/${y.path}`)));

  return stable(a)===stable(b);
}

export async function inventory(client){
  const buckets=await client.storage.listBuckets();

if(buckets.error||!buckets.data)throw new Error('첨부 버킷 목록을 읽지 못했습니다.');
  const files=[];let estimated=0;

  for(const bucket of buckets.data){
    const queue=[''];let folders=0;

    while(queue.length){
      const prefix=queue.shift();

if(++folders>10000)throw new Error('첨부 폴더 수 한도를 넘었습니다.');

      for(let offset=0;;offset+=100){
        const page=await client.storage.from(bucket.id).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});

        if(page.error||!page.data)throw new Error('첨부 목록을 읽지 못했습니다.');

        for(const entry of page.data){
          if(!entry.name||entry.name.includes('/')||['.','..'].includes(entry.name))throw new Error('첨부 이름을 확인하세요.');
          const path=prefix?`${prefix}/${entry.name}`:entry.name;

          if(!entry.id){queue.push(path);continue;}

          const size=Number(entry.metadata?.size);

if(!Number.isSafeInteger(size)||size<0||(estimated+=size)>CAP||files.length>=10000)throw new Error('첨부 백업 용량 또는 파일 수 한도를 넘었습니다.');
          files.push({bucket:bucket.id,path,id:entry.id,updatedAt:entry.updated_at,size});
        }

        if(page.data.length<100)break;
      }
    }
  }

  return{buckets:buckets.data,files};
}

/** @param {Date} now @param {string} id */
export function retentionKeys(now=new Date(),id=randomUUID()){
  const stamp=now.toISOString().replace(/[:.]/g,'-'),name=`${stamp}-${id}.zip.age`;

  return[`daily/${name}`,...(now.getUTCDate()===1?[`monthly/${now.toISOString().slice(0,7)}/${name}`]:[])];
}

async function usedBytes(s3,bucket){
  let token,total=0;

  do{const page=await s3.send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}));

for(const object of page.Contents||[])total+=object.Size||0;token=page.IsTruncated?page.NextContinuationToken:undefined;

if(page.IsTruncated&&!token)throw new Error('R2 저장량 목록이 완전하지 않습니다.');}while(token);

  return total;
}

export async function storeVerified(storage,keys,bytes,budget,used){
  if(used+bytes.length*keys.length>budget)throw new Error('R2 저장량 상한에 가까워 새 업로드를 중단했습니다.');
  const expected=sha(bytes);

  for(const key of keys){await storage.write(key,bytes);const actual=await storage.read(key,bytes.length);

if(!actual||actual.length!==bytes.length||sha(actual)!==expected)throw new Error('R2 암호화 백업을 다시 읽어 검증하지 못했습니다.');}

  // Mutable status is outside locked daily/ and monthly/ prefixes.
  await storage.status({completedAt:new Date().toISOString(),keys,bytes:bytes.length,sha256:expected,verified:true,restoreVerified:false});
}

async function ping(config,event){
  const response=await fetch(`${config.heartbeat}${event==='success'?'':`/${event}`}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000)});

  if(!response.ok)throw new Error('백업 감시 서비스에 실행 결과를 전달하지 못했습니다.');
}

/** CLI 2.119.0 forbids --keep-comments with --data-only; data comments are retained automatically.
 * @returns {Array<[string,string[]]>}
 */
export function sqlDumpPlan(){
  return [
    ['roles.sql',['--role-only','--keep-comments']],
    ['schema.sql',['--keep-comments']],
    ['data.sql',['--data-only','--use-copy','--schema','public,auth,storage','-x','storage.buckets_vectors','-x','storage.vector_indexes']],
  ];
}

async function buildEncrypted(config,directory,onStage){
  onStage('첨부 목록 확인');
  const client=createClient(config.apiUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const before=await inventory(client),zip=new JSZip(),files=[];let total=0;

  function add(path,bytes){total+=bytes.length;

if(total>CAP)throw new Error('DB와 첨부의 총 백업 용량이 100MiB를 넘었습니다.');zip.file(path,bytes);files.push({path,bytes:bytes.length,sha256:sha(bytes)});}

  const common=['db','dump','--db-url',config.dbUrl];

  for(const [name,flags] of sqlDumpPlan()){
    onStage(`SQL 수집 ${name}`);
    const path=join(directory,name);await quietTool('supabase',[...common,...flags,'--file',path],name);add(name,await readFile(path));
  }

  onStage('Postgres 버전 확인');
  const schema=zip.file('schema.sql'),schemaText=await schema.async('string');
  const versions=[...schemaText.matchAll(/Dumped (?:from database|by pg_dump) version (\d+)/g)].map(match=>Number(match[1]));

  if(versions.length<2||versions.some(version=>version!==config.major))throw new Error('서버와 pg_dump의 Postgres 17 버전 확인에 실패했습니다.');
  onStage('첨부 바이트 수집');
  const assets=[];

  for(const entry of before.files){
    const result=await client.storage.from(entry.bucket).download(entry.path);

if(result.error||!result.data||result.data.size!==entry.size)throw new Error('첨부가 누락되거나 백업 도중 바뀌었습니다.');
    const path=`storage/${sha(Buffer.from(`${entry.bucket}/${entry.path}`))}`,bytes=Buffer.from(await result.data.arrayBuffer());add(path,bytes);assets.push({...entry,archivePath:path,sha256:sha(bytes)});
  }

  onStage('첨부 변경 확인');
  const after=await inventory(client);

if(!sameInventory(before.files,after.files))throw new Error('백업 중 첨부가 바뀌었습니다. 원고 저장을 마친 뒤 다시 실행하세요.');
  // Custom storage policies are excluded from the default CLI schema dump: retain versioned migrations.
  onStage('복원 migration 수집');
  const migrationRoot=fileURLToPath(new URL('../supabase/migrations/',import.meta.url));

  for(const name of await readdir(migrationRoot))if(/^\d+[a-zA-Z0-9_-]*\.sql$/.test(name))add(`migrations/${name}`,await readFile(join(migrationRoot,name)));
  zip.file('manifest.json',JSON.stringify({format:'orbis-tertius-disaster-backup',version:1,createdAt:new Date().toISOString(),postgresMajor:config.major,supabaseCli:'2.119.0',files,assets,buckets:before.buckets,restoreVerified:false},null,2));
  onStage('age 암호화');
  const plain=join(directory,'archive.zip'),encrypted=join(directory,'archive.zip.age');
  await writeFile(plain,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),{mode:0o600});
  await quietTool('age',['--recipient',config.recipient,'--output',encrypted,plain],'age 암호화');
  const result=await readFile(encrypted);

if(!result.subarray(0,22).toString().startsWith('age-encryption.org/v1'))throw new Error('age 암호화 파일 형식을 확인하지 못했습니다.');

  return result;
}

export async function runBackup(){
  const config=configuration(),temporaryRoot=resolve(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'orbis-db-'));
  let phase='시작 신호';
  const onStage=next=>{phase=next;console.log(`백업 단계: ${next}`);};

  try{
    await ping(config,'start');
    const bytes=await buildEncrypted(config,directory,onStage),keys=retentionKeys();
    onStage('R2 업로드와 재읽기');
    const s3=new S3Client({region:'auto',endpoint:`https://${config.account}.r2.cloudflarestorage.com`,credentials:{accessKeyId:config.accessKey,secretAccessKey:config.secretKey},maxAttempts:3});

    const storage={
      write:(key,body)=>s3.send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:body,ContentType:'application/octet-stream',IfNoneMatch:'*'})),
      read:async(key,max)=>{const object=await s3.send(new GetObjectCommand({Bucket:config.bucket,Key:key}));

if(!object.Body||object.ContentLength!==max)throw new Error('R2 파일 크기를 확인하지 못했습니다.');

return object.Body.transformToByteArray();},
      status:report=>s3.send(new PutObjectCommand({Bucket:config.bucket,Key:'status/latest.json',Body:JSON.stringify(report),ContentType:'application/json'})),
    };

    await storeVerified(storage,keys,bytes,config.budget,await usedBytes(s3,config.bucket));onStage('성공 신호');await ping(config,'success');
    console.log('암호화 DB·첨부 백업 업로드와 재다운로드 해시 검증 완료. DB 복원 훈련은 별도입니다.');
  }catch(error){
    try{await ping(config,'fail');}catch{}

    const detail=error instanceof QuietToolError?` ${error.message}`:'';
    throw new Error(`DB 백업 실패 (${phase}).${detail} 연결 설정·첨부 변경·용량·도구 버전·감시 연결을 확인하세요. 이전 백업은 유지됩니다.`);
  }finally{
    const checked=resolve(directory);

if(!checked.startsWith(`${temporaryRoot}/`)&&!checked.startsWith(`${temporaryRoot}\\`))throw new Error('임시 경로 확인 실패.');

    if(!checked.slice(temporaryRoot.length+1).startsWith('orbis-db-'))throw new Error('임시 경로 확인 실패.');
    await rm(checked,{recursive:true,force:true});
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runBackup().catch(error=>{console.error(error.message);process.exitCode=1;});
