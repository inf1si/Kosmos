import { writerClient } from '@/lib/server-auth';
import { providerConfig,providerLabels,type AIProvider } from '@/lib/ai-provider';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(!await writerClient(request))return Response.json({error:'작가 로그인이 필요합니다.'},{status:401});
  return Response.json({providers:(['openai','anthropic','gemini'] as AIProvider[]).map(provider=>({id:provider,label:providerLabels[provider],configured:!!providerConfig(provider),model:providerConfig(provider)?.model||null}))},{headers:{'Cache-Control':'no-store'}});
}
