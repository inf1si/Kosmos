import { writerClient } from '@/lib/server-auth';
import { changeAICredential,sameOriginCredentialRequest } from '@/lib/ai-credential-handler';
export const dynamic='force-dynamic';
async function change(request:Request){
  if(!sameOriginCredentialRequest(request))return Response.json({error:'같은 사이트에서 AI 설정을 변경하세요.'},{status:403,headers:{'Cache-Control':'no-store'}});
  const author=await writerClient(request);
  if(!author)return Response.json({error:'작가 로그인이 필요합니다.'},{status:401,headers:{'Cache-Control':'no-store'}});
  return changeAICredential(request,author.userId);
}
export const POST=change;
export const DELETE=change;
