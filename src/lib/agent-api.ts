import { z } from 'zod';
import { start } from 'workflow/api';
import { HookConflictError } from 'workflow/errors';
import { writerClient } from './server-auth';
import { sameOriginCredentialRequest } from './ai-credential-handler';
import { readLimitedJson,BodyLimitError } from './http';
import { providerConfig } from './ai-provider';
import { workspaceSchema } from './model';
import { agentAdmin,agentSessionHistory,readAgentSession,readAgentRun,commitAgentChanges } from './agent-server';
import { agentSessionInputSchema,agentMessageInputSchema,agentHash,captureAgentScope,agentSessionSchema,agentModeSchema,agentRunView,agentDiff } from './writing-agent';
import { runWritingAgent } from './agent-workflow';

const json=<T,>(value:T,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

async function exportAgentRows(table:'agent_sessions'|'agent_runs'|'agent_memories',owner:string){
  const rows=[];

  for(let offset=0;;offset+=100){
    const result=await agentAdmin().from(table).select('*').eq('owner_id',owner).order('id').range(offset,offset+99);

    if(result.error)throw new Error('AI 자료를 내보내지 못했습니다.');
    const page=z.array(z.json()).parse(result.data);rows.push(...page);

if(page.length<100)return rows;
  }
}

async function dispatch(id:string){
  let workflow:string;

  try{workflow=(await start(runWritingAgent,[id],{experimental_hook:{token:`writing-agent:${id}`,experimental_minRetention:'30 days'}})).runId;}
  catch(e){if(HookConflictError.is(e)&&e.conflictingRunId)workflow=e.conflictingRunId;else return false;}

  const saved=await agentAdmin().from('agent_runs').update({workflow_id:workflow}).eq('id',id).eq('status','queued');

  return !saved.error;
}

export async function writingAgentAPI(request:Request,path:string[]){
  try{
    const auth=await writerClient(request);

    if(!auth)return json({error:'작가 로그인이 필요합니다.'},401);

    if(request.method!=='GET'&&!sameOriginCredentialRequest(request))return json({error:'같은 사이트에서 작업 대화를 사용하세요.'},403);

    if(!process.env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'작업 대화의 서버 저장 연결이 필요합니다.'},503);
    const db=agentAdmin(),method=request.method;

    if(path[0]==='sessions'&&path.length===1){
      if(method==='GET'){
        const list=await exportAgentRows('agent_sessions',auth.userId);

        const providers=(['openai','anthropic','gemini'] as const).map(id=>{const config=providerConfig(id);

return {id,model:config?.model||null,configured:!!config};});

        return json({sessions:z.array(agentSessionSchema).parse(list).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)),providers,webAvailable:!!(process.env.GEMINI_API_KEY&&(process.env.GEMINI_SEARCH_MODEL||process.env.GEMINI_MODEL))});
      }

      if(method==='POST'){
        const input=agentSessionInputSchema.parse(await readLimitedJson(request,1024*1024)),row=await auth.client.from('workspaces').select('id,payload').eq('owner_id',auth.userId).single();

        if(row.error)return json({error:'원고를 찾지 못했습니다.'},403);
        captureAgentScope(workspaceSchema.parse(row.data.payload),input.scope);
        const old=await db.from('agent_sessions').select('*').eq('id',input.id).maybeSingle();

        if(old.data){if(old.data.owner_id!==auth.userId)return json({error:'사용할 수 없는 대화 ID입니다.'},409);

return json({session:agentSessionSchema.parse(old.data)});}

        const saved=await db.from('agent_sessions').insert({...input,owner_id:auth.userId,workspace_id:row.data.id}).select('*').single();

        if(saved.error)throw new Error('작업 대화를 만들지 못했습니다.');

        return json({session:agentSessionSchema.parse(saved.data)},201);
      }
    }

    if(path[0]==='sessions'&&path[1]&&z.uuid().safeParse(path[1]).success){
      const session=await readAgentSession(path[1],auth.userId);

      if(path.length===2&&method==='GET'){
        const history=await agentSessionHistory(session.id,auth.userId),queued=history.runs.find(r=>r.status==='queued'&&!r.workflow_id);

        if(queued)await dispatch(queued.id);

        return json({session,runs:history.runs,memories:history.memories});
      }

      if(path.length===2&&method==='PATCH'){
        const input=z.object({mode:agentModeSchema.optional(),provider:agentSessionInputSchema.shape.provider.optional(),web:z.boolean().optional(),title:z.string().trim().min(1).max(300).optional()}).strict().parse(await readLimitedJson(request,8192));
        const result=await db.from('agent_sessions').update({...input,updated_at:new Date().toISOString()}).eq('id',session.id).eq('owner_id',auth.userId).select('*').single();

        if(result.error)throw new Error('대화 설정을 저장하지 못했습니다.');

        return json({session:agentSessionSchema.parse(result.data)});
      }

      if(path.length===3&&path[2]==='messages'&&method==='POST'){
        const input=agentMessageInputSchema.parse(await readLimitedJson(request,4*1024*1024));
        const duplicate=await db.from('agent_runs').select('*').eq('id',input.id).maybeSingle();

        if(duplicate.data){if(duplicate.data.owner_id!==auth.userId||duplicate.data.session_id!==session.id||duplicate.data.message!==input.message)return json({error:'이미 사용한 요청 ID입니다.'},409);

return json({run:agentRunView(await readAgentRun(input.id))});}

        const config=providerConfig(session.provider);

        if(!config)return json({error:'선택한 제공자의 서버 API 키와 모델을 연결하세요. 브라우저 연결은 작업 실행에 사용하지 않습니다.'},503);

        if(input.mode!==session.mode||input.provider!==session.provider||input.web!==session.web)return json({error:'대화 설정이 바뀌었습니다. 확인 후 다시 보내세요.'},409);

        if(session.web&&!(process.env.GEMINI_API_KEY&&(process.env.GEMINI_SEARCH_MODEL||process.env.GEMINI_MODEL)))return json({error:'Gemini 웹 조사 연결이 필요합니다.'},503);
        const workspace=await auth.client.from('workspaces').select('id,payload').eq('id',session.workspace_id).eq('owner_id',auth.userId).single();

        if(workspace.error)return json({error:'원고를 읽지 못했습니다.'},403);
        let snapshot=captureAgentScope(workspaceSchema.parse(workspace.data.payload),session.scope);const hash=await agentHash(snapshot);
        const history=await agentSessionHistory(session.id,auth.userId),last=history.runs.at(-1);
        let operations=last?.status==='completed'&&last.applied_version===null&&!last.reverted&&last.base_hash===hash?last.operations:[];

        if(session.mode==='discuss')operations=[];

        if(operations.length)snapshot=(await readAgentRun(last!.id)).snapshot;
        // A new user message steers the current session. Other sessions keep their own running job.
        const stopped=await db.from('agent_runs').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('session_id',session.id).eq('owner_id',auth.userId).in('status',['queued','running']);

        if(stopped.error)throw new Error('진행 중인 작업을 전환하지 못했습니다.');
        const active=await db.from('agent_runs').select('id').eq('owner_id',auth.userId).in('status',['queued','running']).limit(1);

        if(active.data?.length)return json({error:'다른 대화의 작업이 진행 중입니다. 완료하거나 중단한 뒤 보내세요.'},409);
        const saved=await db.from('agent_runs').insert({id:input.id,session_id:session.id,owner_id:auth.userId,workspace_id:session.workspace_id,message:input.message,provider:config.provider,model:config.model,mode:session.mode,web:session.web,snapshot,base_hash:hash,operations}).select('*').single();

        if(saved.error)throw new Error('작업 요청을 보관하지 못했습니다.');
        await db.from('agent_sessions').update({updated_at:new Date().toISOString()}).eq('id',session.id).eq('owner_id',auth.userId);
        const dispatched=await dispatch(input.id);

        return json({run:agentRunView(await readAgentRun(input.id)),dispatched},202);
      }
    }

    if(path[0]==='runs'&&path[1]&&z.uuid().safeParse(path[1]).success){
      const run=await readAgentRun(path[1]);

      if(run.owner_id!==auth.userId)return json({error:'작업을 찾지 못했습니다.'},404);

      if(path.length===2&&method==='GET')return json({run:agentRunView(run)});

      if(path.length===3&&path[2]==='changes'&&method==='GET')return json(agentDiff(run.snapshot,run.operations));

      if(path.length===3&&path[2]==='cancel'&&method==='POST'){
        const result=await db.from('agent_runs').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',run.id).eq('owner_id',auth.userId).in('status',['queued','running']);

        if(result.error)throw new Error('작업을 중단하지 못했습니다.');

        return json({cancelled:true});
      }
    }

    if(path[0]==='changes'&&path[1]&&z.uuid().safeParse(path[1]).success&&method==='POST'){
      const run=await readAgentRun(path[1]);

      if(run.owner_id!==auth.userId)return json({error:'작업을 찾지 못했습니다.'},404);

      if(path[2]==='discard'&&run.applied_version===null&&!['queued','running'].includes(run.status)){
        const result=await db.from('agent_runs').update({reverted:true}).eq('id',run.id).eq('owner_id',auth.userId).is('applied_version',null).in('status',['completed','failed','cancelled']).select('id').maybeSingle();

        if(result.error||!result.data)throw new Error('이미 반영되었거나 진행 중인 변경입니다. 다시 확인하세요.');

        return json({discarded:true});
      }

      if(path[2]==='apply'||path[2]==='revert'){
        if(path[2]==='apply'){
          const later=await db.from('agent_runs').select('id').eq('session_id',run.session_id).gt('created_at',run.created_at).neq('operations','[]').eq('reverted',false).limit(1);

          if(later.data?.length)return json({error:'이어진 대화의 최신 변경을 확인하세요.'},409);
        }

        return json(await commitAgentChanges(run.id,auth.userId,path[2]==='revert'));
      }
    }

    if(path[0]==='memories'&&path[1]&&path[2]==='forget'&&method==='POST'){
      const result=await db.from('agent_memories').delete().eq('id',z.uuid().parse(path[1])).eq('owner_id',auth.userId);

      if(result.error)throw new Error('기억을 지우지 못했습니다.');

      return json({forgotten:true});
    }

    if(path[0]==='export'&&path.length===1&&method==='GET'){
      const [sessions,runs,memories]=await Promise.all([exportAgentRows('agent_sessions',auth.userId),exportAgentRows('agent_runs',auth.userId),exportAgentRows('agent_memories',auth.userId)]);

      return json({format:'orbis-writing-agent',version:1,exportedAt:new Date().toISOString(),sessions,runs,memories});
    }

    return json({error:'지원하지 않는 작업입니다.'},404);
  }catch(e){
    if(e instanceof z.ZodError||e instanceof SyntaxError)return json({error:'작업 요청의 형식을 확인하세요.'},400);

    if(e instanceof BodyLimitError)return json({error:'요청이 너무 큽니다.'},413);

    return json({error:e instanceof Error?e.message:'작업을 처리하지 못했습니다.'},409);
  }
}
