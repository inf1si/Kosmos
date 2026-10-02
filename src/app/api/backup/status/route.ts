import { writerClient } from '@/lib/server-auth';
import { backupConfiguration } from '@/lib/offsite-backup';
import { latestOffsiteBackup } from '@/lib/offsite-backup-server';
import { heartbeatUrl } from '@/lib/backup-monitor';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const writer=await writerClient(request);if(!writer)return Response.json({error:'작가 로그인이 필요합니다.'},{status:401});const config=backupConfiguration();
  if(!config)return Response.json({configured:false,report:null},{headers:{'Cache-Control':'no-store'}});
  if(config.authorId!==writer.userId)return Response.json({error:'백업 대상 작가를 확인하세요.'},{status:403});
  try{let monitorConfigured=false;try{monitorConfigured=!!heartbeatUrl(process.env.BACKUP_HEALTHCHECK_URL,'success');}catch{}return Response.json({configured:true,report:await latestOffsiteBackup(),monitorConfigured},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'외부 백업 상태를 확인하지 못했습니다.'},{status:502});}
}
