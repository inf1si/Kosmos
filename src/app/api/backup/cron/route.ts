import { backupConfiguration,cronAuthorized } from '@/lib/offsite-backup';
import { runOffsiteBackup } from '@/lib/offsite-backup-server';
import { pingBackup } from '@/lib/backup-monitor';

export const runtime='nodejs';

export const maxDuration=60;

export const dynamic='force-dynamic';

export async function GET(request:Request){
  if(!cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET))return Response.json({error:'인증이 필요합니다.'},{status:401});

  if(!backupConfiguration())return Response.json({error:'외부 백업이 아직 연결되지 않았습니다.'},{status:503});

  if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=='production')return Response.json({error:'운영 배포에서만 실행합니다.'},{status:403});
  await pingBackup('start');

  try{const report=await runOffsiteBackup();const monitorDelivered=await pingBackup('success');

return Response.json({report,monitorDelivered},{headers:{'Cache-Control':'no-store'}});}catch{await pingBackup('fail');

return Response.json({error:'외부 백업에 실패했습니다. 마지막 정상 백업은 유지됩니다.'},{status:502});}
}
