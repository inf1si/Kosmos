import { tool } from 'ai';
import { z } from 'zod';
import { agentOperationSchema,type AgentOperation,type AgentMode } from './writing-agent';
import { wikiWriteSchema } from './agent-wiki';

type AgentToolInput=AgentOperation|{id:string}|{query:string;offset:number}|{id:string;offset:number;length:number}|{plan:string}|{title:string;content:string;sourceIds:string[]}|{query:string;url:string|null}|{query:string;everywhere:boolean}|z.infer<typeof wikiWriteSchema>|Record<string,never>;

async function executeAgentTool(runId:string,workflow:string,name:string,input:AgentToolInput,callId:string){
  'use step';

  const {performAgentTool}=await import('./agent-tool-runtime');

  return performAgentTool(runId,workflow,name,input,callId);
}

export function writingAgentTools(runId:string,workflow:string,mode:AgentMode,web:boolean,meaning:boolean){
  return {
    searchHistory:tool({description:'현재 작업 대화의 과거 질문·답변을 검색한다. query가 비어 있으면 전체 이력을 20개씩 탐색한다.',inputSchema:z.object({query:z.string(),offset:z.number().int().min(0)}),execute:async(input,options)=>executeAgentTool(runId,workflow,'history_search',input,options.toolCallId)}),
    readHistory:tool({description:'과거 대화를 이어 읽는다. 현재 허용한 자료 범위를 벗어난 출처의 대화는 제외한다.',inputSchema:z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}),execute:async(input,options)=>executeAgentTool(runId,workflow,'history_read',input,options.toolCallId)}),
    searchSources:tool({description:'허용한 원고·노트에서 모든 검색어가 제목이나 본문에 든 문서를 찾는다. 문서마다 일치한 대목(matches)과 그 위치(offset)를 돌려주므로 readSource에 그 offset을 넣어 해당 대목부터 읽는다. 빈 query는 문서 목록·섹션·폴더를 돌려준다. 결과는 30개씩 다음 offset으로 이어 읽는다.',inputSchema:z.object({query:z.string(),offset:z.number().int().min(0)}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'search',input,options.toolCallId);}}),
    searchLibrary:tool({description:'지금 범위 밖의 다른 작품과 다른 노트 작업공간에서 모든 검색어가 제목이나 본문에 든 문서를 찾는다. place는 문서가 있는 곳이다. 찾은 문서는 readSource로 읽을 수 있지만 고칠 수는 없다. 결과는 30개씩 다음 offset으로 이어 읽는다.',inputSchema:z.object({query:z.string(),offset:z.number().int().min(0)}),execute:async(input,options)=>executeAgentTool(runId,workflow,'library_search',input,options.toolCallId)}),
    ...meaning&&{
      searchMeaning:tool({description:'뜻이 가까운 대목을 찾는다. 낱말이 달라도 같은 생각·장면·설정을 다룬 곳을 찾을 때 쓴다(예: "주인공이 고향을 그리워하는 장면"). 정확한 이름·낱말은 searchSources가 낫다. everywhere가 true면 다른 작품·노트 작업공간도 찾는다. 결과의 offset으로 readSource를 이어 읽는다. 처음 찾는 문서는 색인하느라 시간이 걸린다.',inputSchema:z.object({query:z.string().min(1),everywhere:z.boolean()}),execute:async(input,options)=>executeAgentTool(runId,workflow,'meaning_search',input,options.toolCallId)}),
    },
    readSource:tool({description:'ID로 문서를 읽는다. 긴 글은 nextOffset으로 이어 읽는다. properties에는 작가가 적은 요약·시점 인물·작중 시각·상태가 있다. 아직 적용하지 않은 자신의 수정도 반영된 작업본이다. 다른 작품·노트 작업공간의 문서도 ID로 읽으며, 그때는 place와 readOnly가 붙는다.',inputSchema:z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'read',input,options.toolCallId);}}),
    plan:tool({description:'진행할 작업과 열린 문제를 짧게 기록한다. 단순 대화에는 불필요하다.',inputSchema:z.object({plan:z.string()}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'plan',input,options.toolCallId);}}),
    remember:tool({description:'사용자가 선택한 방향·보류 이유·작업의 열린 질문 또는 근거가 있는 자료 종합을 기억한다. 취향·확정 설정을 추측해서 기록하지 않는다. 새 아이디어는 아이디어임을 명시한다.',inputSchema:z.object({title:z.string().max(300),content:z.string(),sourceIds:z.array(z.uuid())}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'remember',input,options.toolCallId);}}),
    findReferences:tool({description:'문서 하나에서 나가는 연결(설정 연결·@ 참조)과 그 문서를 가리키는 다른 문서(백링크)를 찾는다. 다른 작품·노트의 문서도 나오며, 읽으려면 readSource를 쓴다.',inputSchema:z.object({id:z.uuid()}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'references',input,options.toolCallId);}}),
    searchWiki:tool({description:'위키 페이지를 찾는다. 작품에서는 이 작품의 페이지와 공통 페이지를 함께 찾는다. 빈 query는 목차를 돌려준다. stale이 true면 출처 문서가 쓴 뒤에 바뀌었거나 사라졌다.',inputSchema:z.object({query:z.string(),offset:z.number().int().min(0)}),execute:async(input,options)=>executeAgentTool(runId,workflow,'wiki_search',input,options.toolCallId)}),
    readWiki:tool({description:'위키 페이지를 읽는다. sources의 status는 current(그대로)·changed(바뀜)·gone(사라짐)이다. 바뀐 출처는 readSource로 다시 읽고 확인한다. 위키에 없는 세부는 원문에서 확인한다.',inputSchema:z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}),execute:async(input,options)=>executeAgentTool(runId,workflow,'wiki_read',input,options.toolCallId)}),
    writeWiki:tool({description:'위키 페이지를 만들거나(id null) 이 범위의 페이지를 통째로 고친다. 원고는 바뀌지 않는다. category는 character 인물, place 장소·조직, rule 기술·규칙, event 사건·연표, thread 복선·회수, open 미해결, concept 개념, source 자료 요약, other 기타. content는 마크다운 없는 줄글이며 진술마다 지위(원문에 적힌 것·확정 설정·아이디어·네 해석)를 구분한다. sourceIds에는 근거로 읽은 문서 ID를 넣는다. 고칠 때는 먼저 readWiki로 읽고 남길 내용을 함께 넣는다.',inputSchema:wikiWriteSchema,execute:async(input,options)=>executeAgentTool(runId,workflow,'wiki_write',input,options.toolCallId)}),
    validateChanges:tool({description:'준비한 변경을 코드로 점검한다. 없는 문서를 가리키는 연결, 본문이 빈 새 문서, 설정 문서가 없는 시점 인물, 겹치는 제목을 알려 준다. 문서를 고친 뒤 답하기 전에 쓴다.',inputSchema:z.object({}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'validate',input,options.toolCallId);}}),
    inspectChanges:tool({description:'현재 문서 변경 전후를 확인한다. 작업 완료 전 결과와 의도를 대조한다.',inputSchema:z.object({}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'inspect',input,options.toolCallId);}}),
    ...mode!=='discuss'&&{
      stageChange:tool({description:'문서 생성(create)·폴더 생성(folder)·구절 치환(replace)·이어 쓰기(insert)·이름 변경(rename)·문서 이동(move)·속성 변경(properties)을 작업본에 반영한다. properties는 작품 문서의 요약·상태·시점 인물·작중 시각·분류, 노트의 태그를 바꾸며 null인 항목은 그대로 둔다. 작가가 적은 속성을 청하지 않았는데 고치지 않는다. replace의 quote는 문서에 정확히 한 번, 한 문단의 같은 서식 안에 나오는 구절이어야 하고 문단을 새로 만들지 못한다. insert는 after에 인용한 구절이 든 문단 바로 뒤에 새 문단을 넣으며 after가 null이면 문서 끝에 잇는다. text의 빈 줄이 문단을 나눈다. create/folder의 id는 임의 UUID를 넣으면 서버가 실제 ID를 반환한다. sectionId와 폴더 ID는 문서 지도나 검색 결과의 것을 쓴다. 청하지 않은 대목을 고치거나 원고 전체를 다른 문체로 바꾸지 않는다.',inputSchema:z.object({change:z.union(agentOperationSchema.options)}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'stage_change',input.change,options.toolCallId);}}),
    },
    ...web&&{
      researchWeb:tool({description:'Gemini의 Google 검색으로 공개 자료를 조사한다. query에는 필요한 개념만 넣고 원고 전체를 넣지 않는다. 특정 공개 HTTPS 페이지를 읽으려면 url을 지정한다. 검색·모델 비용이 발생할 수 있다.',inputSchema:z.object({query:z.string().min(1),url:z.string().nullable()}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'web',input,options.toolCallId);}}),
    },
  };
}
