import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { workspaceSchema } from './model';
import { agentRunSchema,agentRunViewSchema,agentSessionSchema,agentMemorySchema,agentHash,captureAgentScope,applyAgentOperations,restoreAgentScope,validateAgentWorkspace,type AgentRun,type AgentEvent,type AgentOperation } from './writing-agent';

export function agentAdmin(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;

  if(!url||!key)throw new Error('작업 대화의 서버 저장 연결이 필요합니다.');

  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

export async function readAgentRun(id:string,workflow?:string){
  const db=agentAdmin(),result=await db.from('agent_runs').select('*').eq('id',id).single();

  if(result.error)throw new Error('작업을 찾지 못했습니다.');
  const run=agentRunSchema.parse(result.data);
  const author=await db.from('authors').select('user_id').eq('user_id',run.owner_id).maybeSingle();

  if(author.error||!author.data)throw new Error('작가 권한이 바뀌었습니다.');

  if(workflow&&(run.status!=='running'||run.workflow_id!==workflow))throw new Error('작업이 중단되었습니다.');

  return run;
}

export async function agentWorkspace(run:AgentRun){
  const result=await agentAdmin().from('workspaces').select('payload,version').eq('id',run.workspace_id).eq('owner_id',run.owner_id).single();

  if(result.error)throw new Error('원고를 읽지 못했습니다.');

  return {state:workspaceSchema.parse(result.data.payload),version:z.number().parse(result.data.version)};
}

export async function recordAgentEvent(run:AgentRun,event:AgentEvent,operation?:AgentOperation){
  const result=await agentAdmin().rpc('agent_record_step',{p_id:run.id,p_workflow:run.workflow_id,p_event:event,p_operation:operation||null});

  if(result.error)throw new Error('작업 기록을 저장하지 못했습니다.');
}

export async function commitAgentChanges(id:string,owner:string,revert=false){
  const run=await readAgentRun(id);

  if(run.owner_id!==owner||run.mode==='discuss'||(!revert&&!['running','completed'].includes(run.status)))throw new Error('이 작업의 변경을 적용할 수 없습니다.');

  if(run.reverted)throw new Error('되돌리거나 버린 변경입니다.');

  if(!revert&&run.applied_version!==null)return {version:run.applied_version};

  if(revert&&(run.applied_version===null||run.reverted))throw new Error('되돌릴 변경이 없습니다.');
  const {state,version}=await agentWorkspace(run),current=captureAgentScope(state,run.snapshot.scope);

  if(await agentHash(current)!==(revert?run.applied_hash:run.base_hash))throw new Error('작업 이후 원고가 바뀌었습니다. 변경을 다시 비교하세요.');
  const next=validateAgentWorkspace(revert?restoreAgentScope(state,run.snapshot):applyAgentOperations(state,run.snapshot.scope,run.operations));
  const after=await agentHash(captureAgentScope(next,run.snapshot.scope));
  const result=await agentAdmin().rpc('agent_commit_workspace',{p_id:id,p_base_version:version,p_payload:next,p_after_hash:after,p_revert:revert});

  if(result.error)throw new Error('변경을 저장하지 못했습니다. 원고와 작업 상태를 확인하세요.');
  const saved=z.object({status:z.enum(['saved','conflict']),version:z.number().optional()}).parse(result.data);

  if(saved.status==='conflict')throw new Error('저장 중 원고가 바뀌었습니다. 다시 비교하세요.');

  return {version:saved.version};
}

export async function readAgentSession(id:string,owner:string){
  const result=await agentAdmin().from('agent_sessions').select('*').eq('id',id).eq('owner_id',owner).single();

  if(result.error)throw new Error('작업 대화를 찾지 못했습니다.');

  return agentSessionSchema.parse(result.data);
}

export async function agentSessionHistory(sessionId:string,owner:string){
  const db=agentAdmin(),runs=[],memories=[];

  for(let offset=0;;offset+=100){
    const page=await db.from('agent_runs').select(Object.keys(agentRunViewSchema.shape).join(',')).eq('session_id',sessionId).eq('owner_id',owner).order('created_at').order('id').range(offset,offset+99);

    if(page.error)throw new Error('작업 기록을 읽지 못했습니다.');
    const parsed=z.array(agentRunViewSchema).parse(page.data);runs.push(...parsed);

if(parsed.length<100)break;
  }

  for(let offset=0;;offset+=100){
    const page=await db.from('agent_memories').select('*').eq('session_id',sessionId).eq('owner_id',owner).order('updated_at').order('id').range(offset,offset+99);

    if(page.error)throw new Error('작업 기억을 읽지 못했습니다.');
    const parsed=z.array(agentMemorySchema).parse(page.data);memories.push(...parsed);

if(parsed.length<100)break;
  }

  return {runs,memories};
}
