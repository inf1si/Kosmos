import { writerClient } from '@/lib/server-auth';
import { backupConfiguration } from '@/lib/offsite-backup';
import { downloadOffsiteBackup } from '@/lib/offsite-backup-server';
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const writer=await writerClient(request);
  if(!writer)return Response.json({error:'작가 로그인이 필요합니다.'},{status:401});
  const config=backupConfiguration();
  if(!config||config.authorId!==writer.userId)return Response.json({error:'백업 연결과 대상 작가를 확인하세요.'},{status:403});
  if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=='production')return Response.json({error:'운영 배포에서만 실행합니다.'},{status:403});
  try{const bytes=await downloadOffsiteBackup();if(bytes.length>4*1024*1024)return Response.json({error:'4MiB보다 큰 백업은 저장소에서 직접 내려받아 ZIP 파일 복원을 사용하세요.'},{status:413});return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="orbis-tertius-cloud-backup.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch{return Response.json({error:'백업을 내려받지 못했습니다. 새 백업을 한 번 만든 뒤 다시 시도하세요.'},{status:502});}
}
