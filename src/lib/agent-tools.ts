import { tool } from 'ai';
import { z } from 'zod';
import { agentOperationSchema,type AgentOperation,type AgentMode } from './writing-agent';

type AgentToolInput=AgentOperation|{query:string;offset:number}|{id:string;offset:number;length:number}|{plan:string}|{title:string;content:string;sourceIds:string[]}|{query:string;url:string|null}|Record<string,never>;

async function executeAgentTool(runId:string,workflow:string,name:string,input:AgentToolInput,callId:string){
  'use step';

  const {performAgentTool}=await import('./agent-tool-runtime');

  return performAgentTool(runId,workflow,name,input,callId);
}

export function writingAgentTools(runId:string,workflow:string,mode:AgentMode,web:boolean){
  return {
    searchHistory:tool({description:'현재 작업 대화의 과거 질문·답변을 검색한다. query가 비어 있으면 전체 이력을 20개씩 탐색한다.',inputSchema:z.object({query:z.string(),offset:z.number().int().min(0)}),execute:async(input,options)=>executeAgentTool(runId,workflow,'history_search',input,options.toolCallId)}),
    readHistory:tool({description:'과거 대화를 이어 읽는다. 현재 허용한 자료 범위를 벗어난 출처의 대화는 제외한다.',inputSchema:z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}),execute:async(input,options)=>executeAgentTool(runId,workflow,'history_read',input,options.toolCallId)}),
    searchSources:tool({description:'허용한 원고·노트를 검색한다. 빈 query로 문서 목록·섹션·폴더를 확인한다. 결과는 30개씩 다음 offset으로 이어 읽는다.',inputSchema:z.object({query:z.string(),offset:z.number().int().min(0)}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'search',input,options.toolCallId);}}),
    readSource:tool({description:'ID로 문서를 읽는다. 긴 글은 nextOffset으로 이어 읽는다. 아직 적용하지 않은 자신의 수정도 반영된 작업본이다.',inputSchema:z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'read',input,options.toolCallId);}}),
    plan:tool({description:'진행할 작업과 열린 문제를 짧게 기록한다. 단순 대화에는 불필요하다.',inputSchema:z.object({plan:z.string()}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'plan',input,options.toolCallId);}}),
    remember:tool({description:'사용자가 선택한 방향·보류 이유·작업의 열린 질문 또는 근거가 있는 자료 종합을 기억한다. 취향·확정 설정을 추측해서 기록하지 않는다. 새 아이디어는 아이디어임을 명시한다.',inputSchema:z.object({title:z.string().max(300),content:z.string(),sourceIds:z.array(z.uuid())}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'remember',input,options.toolCallId);}}),
    inspectChanges:tool({description:'현재 문서 변경 전후를 확인한다. 작업 완료 전 결과와 의도를 대조한다.',inputSchema:z.object({}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'inspect',input,options.toolCallId);}}),
    ...mode!=='discuss'&&{
      stageChange:tool({description:'문서 생성·폴더 생성·정확히 한 번 나오는 문장 치환·이름 변경·문서 이동을 작업본에 반영한다. create/folder의 id는 임의 UUID를 넣으면 서버가 실제 ID를 반환한다. 먼저 검색에서 섹션과 폴더를 확인한다. 원고 전체를 다른 문체로 바꾸지 않는다.',inputSchema:z.object({change:z.union(agentOperationSchema.options)}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'stage_change',input.change,options.toolCallId);}}),
    },
    ...web&&{
      researchWeb:tool({description:'Gemini의 Google 검색으로 공개 자료를 조사한다. query에는 필요한 개념만 넣고 원고 전체를 넣지 않는다. 특정 공개 HTTPS 페이지를 읽으려면 url을 지정한다. 검색·모델 비용이 발생할 수 있다.',inputSchema:z.object({query:z.string().min(1),url:z.string().nullable()}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'web',input,options.toolCallId);}}),
    },
  };
}
