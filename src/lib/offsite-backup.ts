import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createBackup, readBackup } from './backup';
import { workspaceSchema, uid, type Workspace, type Revision } from './model';

export const backupReportSchema=z.object({completedAt:z.iso.datetime(),version:z.number().int().nonnegative(),bytes:z.number().int().positive(),documents:z.number().int().nonnegative(),revisions:z.number().int().nonnegative(),assets:z.number().int().nonnegative(),verified:z.literal(true),archiveKey:z.string().max(300).optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()});

export type BackupReport=z.infer<typeof backupReportSchema>;

export type BackupSnapshot={data:Workspace;version:number;revisions:Revision[]};

export type BackupStorage={read:(key:string,maxBytes:number)=>Promise<Uint8Array|null>;write:(key:string,data:Uint8Array,type:string)=>Promise<void>};

export function cronAuthorized(header:string|null,secret:string|undefined){
  if(!secret||secret.length<32||!header)return false;const a=Buffer.from(header),b=Buffer.from(`Bearer ${secret}`);

return a.length===b.length&&timingSafeEqual(a,b);
}

export function backupConfiguration(env:Record<string,string|undefined>=process.env){
  const names=['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','BACKUP_AUTHOR_ID','CRON_SECRET'];

  if(names.some(n=>!env[n])||!z.uuid().safeParse(env.BACKUP_AUTHOR_ID).success||(env.CRON_SECRET?.length||0)<32)return null;
  const prefix=env.BACKUP_S3_PREFIX||'kosmos';

if(!/^[a-zA-Z0-9/_-]{1,100}$/.test(prefix))return null;

  if((env.BACKUP_STORAGE_PROVIDER||'google-drive')==='google-drive'){
    if(!env.BACKUP_GOOGLE_CLIENT_ID||!env.BACKUP_GOOGLE_CLIENT_SECRET||!env.BACKUP_GOOGLE_REFRESH_TOKEN)return null;

    return{provider:'google-drive' as const,authorId:env.BACKUP_AUTHOR_ID!,prefix,clientId:env.BACKUP_GOOGLE_CLIENT_ID,clientSecret:env.BACKUP_GOOGLE_CLIENT_SECRET,refreshToken:env.BACKUP_GOOGLE_REFRESH_TOKEN};
  }

  if(env.BACKUP_STORAGE_PROVIDER!=='s3'||!env.BACKUP_S3_BUCKET||!env.BACKUP_S3_ACCESS_KEY_ID||!env.BACKUP_S3_SECRET_ACCESS_KEY)return null;
  const endpoint=env.BACKUP_S3_ENDPOINT;

if(endpoint){try{const url=new URL(endpoint);

if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)(r2\.cloudflarestorage\.com|amazonaws\.com)$/.test(url.hostname))return null;}catch{return null;}}

  return{provider:'s3' as const,authorId:env.BACKUP_AUTHOR_ID!,bucket:env.BACKUP_S3_BUCKET!,endpoint,region:env.BACKUP_S3_REGION||'auto',accessKeyId:env.BACKUP_S3_ACCESS_KEY_ID!,secretAccessKey:env.BACKUP_S3_SECRET_ACCESS_KEY!,prefix};
}

export async function createOffsiteBackup({snapshot,ownerId,prefix,storage,downloadAsset,now=new Date()}:{snapshot:BackupSnapshot;ownerId:string;prefix:string;storage:BackupStorage;downloadAsset:(id:string)=>Promise<Blob>;now?:Date}):Promise<BackupReport>{
  workspaceSchema.parse(snapshot.data);

if(!z.uuid().safeParse(ownerId).success||!Number.isSafeInteger(snapshot.version)||snapshot.version<0)throw new Error('백업 대상 정보를 확인하세요.');
  const key=`${prefix}/${ownerId}/${now.toISOString().replace(/[:.]/g,'-')}-v${snapshot.version}-${uid()}.zip`;
  const assets:{id:string;blob:Blob}[]=[];const metas=[...new Map([...snapshot.data.assets,...snapshot.revisions.flatMap(r=>r.data.assets)].map(a=>[a.id,a])).values()];
  let total=0;

for(const a of metas)total+=a.size;

if(total>100*1024*1024)throw new Error('백업 첨부 크기가 100MB를 넘습니다.');
  // Four concurrent downloads keep a small personal archive within the function duration budget.
  let index=0;await Promise.all(Array.from({length:Math.min(4,metas.length)},async()=>{for(;;){const i=index++;

if(i>=metas.length)return;const meta=metas[i],blob=await downloadAsset(meta.id);

if(blob.size!==meta.size)throw new Error('첨부 크기가 일치하지 않습니다.');assets.push({id:meta.id,blob});}}));
  const archive=await createBackup(snapshot.data,snapshot.revisions,assets);await readBackup(archive);const bytes=new Uint8Array(await archive.arrayBuffer());
  const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
  await storage.write(key,bytes,'application/zip');const restored=await storage.read(key,100*1024*1024);

  if(!restored||sha(restored)!==sha(bytes))throw new Error('외부 저장소의 백업 파일 검증에 실패했습니다.');await readBackup(new Blob([Uint8Array.from(restored).buffer]));
  const report:BackupReport={completedAt:new Date().toISOString(),version:snapshot.version,bytes:bytes.length,documents:snapshot.data.works.reduce((n,w)=>n+w.documents.length,0),revisions:snapshot.revisions.length,assets:assets.length,verified:true,archiveKey:key,sha256:sha(bytes)};
  // Update the success marker only after downloading and verifying the stored archive.
  await storage.write(`${prefix}/${ownerId}/latest.json`,new TextEncoder().encode(JSON.stringify(report)),'application/json');

return report;
}

/** The marker cannot redirect a download to another author's backup or status file. */
export async function readOffsiteArchive(report:BackupReport,prefix:string,ownerId:string,storage:BackupStorage){
  const root=`${prefix}/${ownerId}/`,key=report.archiveKey;

  if(!key||!report.sha256)throw new Error('새 백업을 한 번 만든 뒤 내려받을 수 있습니다.');

  if(!key.startsWith(root)||!key.endsWith('.zip')||key.slice(root.length).includes('/')||key.includes('..')||key.includes('\\'))throw new Error('백업 파일 위치가 올바르지 않습니다.');
  const bytes=await storage.read(key,100*1024*1024);

  if(!bytes||bytes.length!==report.bytes||createHash('sha256').update(bytes).digest('hex')!==report.sha256)throw new Error('저장된 백업 파일의 무결성을 확인하지 못했습니다.');
  await readBackup(new Blob([Uint8Array.from(bytes).buffer]));

  return bytes;
}
