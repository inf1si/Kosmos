import { workspaceSchema } from '@/lib/model';
import { writerClient } from '@/lib/server-auth';
import { providerConfig,requestChat } from '@/lib/ai-provider';
import { chatInputSchema } from '@/lib/ai-conversation';
import { chatContext,ChatContextError } from '@/lib/ai-chat-context';
import { readLimitedJson,BodyLimitError } from '@/lib/http';
export const maxDuration=60;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
  try{
    const auth=await writerClient(request);if(!auth)return json({error:'작가 로그인이 필요합니다.'},401);
    const parsed=chatInputSchema.safeParse(await readLimitedJson(request,128*1024));if(!parsed.success)return json({error:'질문·자료·이전 대화의 길이와 형식을 확인하세요.'},400);
    const input=parsed.data,config=providerConfig(input.provider);if(!config)return json({error:'선택한 AI의 API 키와 모델을 서버에 설정하세요.'},503);
    const row=await auth.client.from('workspaces').select('payload').single();if(row.error)return json({error:'원고 권한을 확인하세요.'},403);
    const context=chatContext(workspaceSchema.parse(row.data.payload),input);
    const budget=await auth.client.rpc('reserve_ai_call');if(budget.error)return json({error:'하루 AI 요청 한도(세 제공자 합계 10회)를 확인하세요.'},429);
    try{const result=await requestChat(config,context.input,input.history);if(!input.includeManuscript)result.suggestions=[];return json({result,provider:config.provider,model:config.model,version:context.version,sources:context.sources,dailyCalls:budget.data});}
    catch{return json({error:'AI가 답변을 완료하지 못했습니다. 제공자 설정·모델·사용 한도를 확인하세요. 질문과 원고는 유지됩니다.'},502);}
  }catch(e){if(e instanceof ChatContextError)return json({error:e.message},e.status);if(e instanceof BodyLimitError)return json({error:'요청이 너무 큽니다.'},413);if(e instanceof SyntaxError)return json({error:'요청 형식을 확인하세요.'},400);return json({error:'대화를 처리하지 못했습니다. 원고는 유지됩니다.'},502);}
}
