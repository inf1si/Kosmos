import { workspaceSchema } from '@/lib/model';
import { writerClient } from '@/lib/server-auth';
import { requestChat } from '@/lib/ai-vertex';
import { requestProviderConfig } from '@/lib/ai-credentials';
import { chatInputSchema } from '@/lib/ai-conversation';
import { chatContext,ChatContextError } from '@/lib/ai-chat-context';
import { readLimitedJson,BodyLimitError } from '@/lib/http';
import { resolveRequestPrompt } from '@/lib/ai-prompt-presets';

export const maxDuration=60;

const json=<T,>(body:T,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function POST(request:Request){
  try{
    const auth=await writerClient(request);

if(!auth)return json({error:'작가 로그인이 필요합니다.'},401);
    const parsed=chatInputSchema.safeParse(await readLimitedJson(request,4*1024*1024));

if(!parsed.success)return json({error:'질문·자료·이전 대화의 길이와 형식을 확인하세요.'},400);
    const input=parsed.data,config=requestProviderConfig(request,input.provider,auth.userId,process.env,input.model);

if(!config)return json({error:'Vertex AI의 Gemini·Claude 모델과 서버 인증을 확인하세요.'},503);
    const row=await auth.client.from('workspaces').select('payload').single();

if(row.error)return json({error:'원고 권한을 확인하세요.'},403);
    const workspace=workspaceSchema.parse(row.data.payload),context=chatContext(workspace,input);
    let prompt:ReturnType<typeof resolveRequestPrompt>;

try{prompt=resolveRequestPrompt(workspace.aiPreferences,input);}catch(e){return json({error:e instanceof Error?e.message:'시스템 프롬프트를 확인하세요.'},409);}

    try{const result=await requestChat(config,context.input,input.history,fetch,prompt.prompt);

if(!input.includeManuscript)result.suggestions=[];

return json({result,provider:config.provider,model:config.model,version:context.version,sources:context.sources,promptPreset:prompt.preset});}
    catch{return json({error:'AI 응답 실패. 제공자 설정·모델·사용 한도를 확인하세요.'},502);}
  }catch(e){if(e instanceof ChatContextError)return json({error:e.message},e.status);

if(e instanceof BodyLimitError)return json({error:'요청이 너무 큽니다.'},413);

if(e instanceof SyntaxError)return json({error:'요청 형식을 확인하세요.'},400);

return json({error:'대화를 처리하지 못했습니다.'},502);}
}
