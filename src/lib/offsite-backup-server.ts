import { createClient } from '@supabase/supabase-js';
import { S3Client,GetObjectCommand,PutObjectCommand } from '@aws-sdk/client-s3';
import { backupConfiguration,backupReportSchema,createOffsiteBackup,type BackupStorage } from './offsite-backup';
import { workspaceSchema } from './model';
import { googleDriveStorage } from './google-drive-backup';
function connections(){
  const config=backupConfiguration();if(!config)throw new Error('외부 백업 설정이 필요합니다.');
  const signal=AbortSignal.timeout(50000);
  if(config.provider==='google-drive')return{config,storage:googleDriveStorage(config,signal),signal};
  const s3=new S3Client({endpoint:config.endpoint,region:config.region,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},maxAttempts:2});
  const storage:BackupStorage={
    read:async(key,maxBytes)=>{try{const object=await s3.send(new GetObjectCommand({Bucket:config.bucket,Key:key}),{abortSignal:signal});if(!object.Body||!object.ContentLength||object.ContentLength>maxBytes)throw new Error('백업 파일의 크기를 확인하세요.');const bytes=await object.Body.transformToByteArray();if(bytes.length>maxBytes)throw new Error('백업 크기를 초과했습니다.');return bytes;}catch(e){if(e&&typeof e==='object'&&'name'in e&&(e.name==='NoSuchKey'||e.name==='NotFound'))return null;throw e;}},
    write:async(key,data,type)=>{await s3.send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:data,ContentType:type}),{abortSignal:signal});},
  };
  return{config,storage,signal};
}
export async function latestOffsiteBackup(){const{config,storage}=connections();const raw=await storage.read(`${config.prefix}/${config.authorId}/latest.json`,4096);return raw?backupReportSchema.parse(JSON.parse(new TextDecoder().decode(raw))):null;}
export async function runOffsiteBackup(){
  const{config,storage,signal}=connections();
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal})}});
  const workspace=await client.from('workspaces').select('id,version,payload').eq('owner_id',config.authorId).single();if(workspace.error||!workspace.data)throw new Error('백업 대상 작업 공간을 불러오지 못했습니다.');
  const history=await client.from('workspace_revisions').select('id,created_at').eq('workspace_id',workspace.data.id).eq('owner_id',config.authorId).order('created_at',{ascending:false}).limit(50);if(history.error)throw new Error('서버 복구 이력을 불러오지 못했습니다.');
  const revisions=[];let jsonBytes=new TextEncoder().encode(JSON.stringify(workspace.data.payload)).length;
  for(const row of history.data||[]){const revision=await client.from('workspace_revisions').select('payload').eq('id',row.id).eq('workspace_id',workspace.data.id).eq('owner_id',config.authorId).single();if(revision.error||!revision.data)throw new Error('백업 도중 서버 복구 이력이 바뀌었습니다. 다시 시도하세요.');jsonBytes+=new TextEncoder().encode(JSON.stringify(revision.data.payload)).length;if(jsonBytes>100*1024*1024)throw new Error('백업 JSON 용량이 100MB를 넘습니다.');revisions.push({id:row.id,namespace:'server',createdAt:row.created_at,label:'클라우드 복구 지점',data:workspaceSchema.parse(revision.data.payload)});}
  return createOffsiteBackup({ownerId:config.authorId,prefix:config.prefix,storage,snapshot:{data:workspaceSchema.parse(workspace.data.payload),version:workspace.data.version,revisions},downloadAsset:async(id)=>{const result=await client.storage.from('private-assets').download(`${config.authorId}/${id}`);if(result.error||!result.data)throw new Error('백업 첨부를 불러오지 못했습니다.');return result.data;}});
}
