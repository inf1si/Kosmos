import { writerClient } from '@/lib/server-auth';
import { backupConfiguration } from '@/lib/offsite-backup';
import { runOffsiteBackup } from '@/lib/offsite-backup-server';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
  const writer=await writerClient(request);if(!writer)return Response.json({error:'작가 로그인이 필요합니다.'},{status:401});const config=backupConfiguration();
  if(!config)return Response.json({error:'외부 백업이 아직 연결되지 않았습니다.'},{status:503});if(config.authorId!==writer.userId)return Response.json({error:'백업 대상 작가를 확인하세요.'},{status:403});
  if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=='production')return Response.json({error:'운영 배포에서만 실행합니다.'},{status:403});
  try{return Response.json({report:await runOffsiteBackup()},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'외부 백업에 실패했습니다. 마지막 정상 백업은 유지됩니다.'},{status:502});}
}
