import { WorkflowAgent } from '@ai-sdk/workflow';
import { isStepCount,type ModelMessage } from 'ai';
import { FatalError,getWorkflowMetadata } from 'workflow';
import { writingAgentTools } from './agent-tools';
import { agentLanguageModel } from './agent-language-model';
import { agentContext,agentDocuments,agentMap,agentOverlay,captureAgentScope } from './writing-agent';
import { buildAgentInstructions } from './agent-instructions';
import { activePromptPreset } from './ai-prompt-presets';
import { agentWorkspace,agentAdmin,readAgentRun,agentSessionHistory,commitAgentChanges } from './agent-server';

async function prepareAgentRun(id:string,workflow:string){
  'use step';
  const db=agentAdmin(),claim=await db.rpc('agent_claim_run',{p_id:id,p_workflow:workflow});

  if(claim.error||!claim.data){await db.from('agent_runs').update({status:'failed',error:'다른 작업이 진행 중이거나 실행 권한이 바뀌었습니다.'}).eq('id',id).eq('status','queued');throw new FatalError('이미 진행 중이거나 중단된 작업입니다.');}

  const run=await readAgentRun(id,workflow),history=await agentSessionHistory(run.session_id,run.owner_id);
  const {state}=await agentWorkspace(run),live=captureAgentScope(state,run.snapshot.scope);
  const context=agentContext(history.runs.filter(r=>r.created_at<run.created_at),history.memories,new Set(agentDocuments(live).map(d=>d.id)),Number(process.env.AGENT_HISTORY_CHARACTERS)||60000);
  const messages:ModelMessage[]=context.runs.flatMap(r=>[{role:'user' as const,content:r.message},...r.answer?[{role:'assistant' as const,content:r.answer}]:[]]);
  messages.push({role:'user',content:run.message});

  const focus=run.events.find(e=>e.id==='focus')?.sources?.[0];
  // The persona and skills are the writer's synced AI settings, read when the run starts.
  const instructions=buildAgentInstructions({mode:run.mode,web:run.web,today:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()),persona:activePromptPreset(state.aiPreferences).prompt,skills:(state.aiPreferences?.skills||[]).map(skill=>({title:skill.title,description:skill.description,prompt:skill.prompt})),map:agentMap(agentOverlay(run.snapshot,run.operations),Number(process.env.AGENT_MAP_CHARACTERS)||16000),focus:focus?{id:focus.id,title:focus.title}:null,memories:context.memories.map(m=>({title:m.title,content:m.content,sources:m.sources}))});

  return {run:{provider:run.provider,model:run.model,mode:run.mode,web:run.web},messages,instructions,maxSteps:Number(process.env.AGENT_MAX_STEPS)||80};
}

async function completeAgentRun(id:string,workflow:string,answer:string,usage:{input:number;output:number}|null,error=''){
  'use step';
  const run=await readAgentRun(id,workflow);
  let issue=error;

  if(!issue&&run.mode==='execute'&&run.operations.length){try{await commitAgentChanges(id,run.owner_id);}catch(e){issue=e instanceof Error?e.message:'변경을 적용하지 못했습니다.';}}

  const result=await agentAdmin().from('agent_runs').update({status:error?'failed':'completed',answer,error:issue,usage,updated_at:new Date().toISOString()}).eq('id',id).eq('status','running').eq('workflow_id',workflow);

  if(result.error)throw new Error('작업 결과를 보관하지 못했습니다.');
}

export async function runWritingAgent(id:string){
  'use workflow';
  const workflow=getWorkflowMetadata().workflowRunId;

  try{
    const {run,messages,instructions,maxSteps}=await prepareAgentRun(id,workflow);
    const agent=new WorkflowAgent({model:agentLanguageModel(run.provider,run.model),toolCallConcurrency:1,stopWhen:isStepCount(maxSteps),maxRetries:0,instructions,tools:writingAgentTools(id,workflow,run.mode,run.web)});
    const result=await agent.generate({messages});
    const issue=result.finishReason==='tool-calls'||result.finishReason==='length'?'실행 단계 또는 모델 출력 한도에 도달했습니다. 준비한 변경을 확인하고 이어서 요청하세요.':'';
    await completeAgentRun(id,workflow,result.text,{input:result.totalUsage.inputTokens||0,output:result.totalUsage.outputTokens||0},issue);
  }catch{
    try{await completeAgentRun(id,workflow,'',null,'작업을 완료하지 못했습니다. 연결·모델 문맥·작업 상태를 확인하세요.');}catch{/* Cancellation and revoked access retain the already saved state. */}
  }
}
