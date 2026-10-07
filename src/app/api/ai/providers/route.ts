import { writerClient } from '@/lib/server-auth';
import { providerSettingsStatus } from '@/lib/ai-credentials';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  const author=await writerClient(request);

if(!author)return Response.json({error:'작가 로그인이 필요합니다.'},{status:401,headers:{'Cache-Control':'no-store'}});

  return Response.json(providerSettingsStatus(request,author.userId),{headers:{'Cache-Control':'no-store'}});
}
