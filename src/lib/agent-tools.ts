import { tool } from 'ai';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { agentSessionHistory,agentAdmin,agentWorkspace,readAgentRun,recordAgentEvent } from './agent-server';
import { agentContext,agentDocuments,agentOverlay,agentOperationSchema,captureAgentScope,agentDiff,richBlocks,type AgentOperation,type AgentMode } from './writing-agent';
import { researchAgentWeb } from './agent-web';

type AgentToolInput=AgentOperation|{query:string;offset:number}|{id:string;offset:number;length:number}|{plan:string}|{title:string;content:string;sourceIds:string[]}|{query:string;url:string|null}|Record<string,never>;

async function executeAgentTool(runId:string,workflow:string,name:string,input:AgentToolInput,callId:string){
  'use step';

  return performAgentTool(runId,workflow,name,input,callId);
}

function operationId(key:string){
  const hex=createHash('sha256').update(key).digest('hex');

  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function performAgentTool<T>(runId:string,workflow:string,name:string,input:T,callId:string){
  const run=await readAgentRun(runId,workflow),db=agentAdmin();
  const old=run.events.find(e=>e.id===callId);
  const overlay=agentOverlay(run.snapshot,run.operations),docs=agentDocuments(overlay);
  const {state}=await agentWorkspace(run),live=captureAgentScope(state,run.snapshot.scope),liveIds=new Set(agentDocuments(live).map(d=>d.id));
  const available=docs.filter(d=>liveIds.has(d.id)||run.operations.some(op=>op.type==='create'&&op.id===d.id));

  if(old&&name==='stage_change'){
    const op=agentOperationSchema.parse(input);

    return {saved:true,id:op.type==='create'||op.type==='folder'?operationId(`${runId}:${callId}`):op.id,changes:agentDiff(run.snapshot,run.operations)};
  }

  if(old&&(name==='remember'||name==='plan'))return {saved:true,detail:old.detail};

  if(name==='history_search'||name==='history_read'){
    const history=await agentSessionHistory(run.session_id,run.owner_id),context=agentContext(history.runs.filter(r=>r.created_at<run.created_at),history.memories,liveIds);

    if(name==='history_search'){
      const {query,offset}=z.object({query:z.string(),offset:z.number().int().min(0)}).parse(input),terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean),hits=context.allRuns.filter(r=>terms.every(term=>(r.message+'\n'+r.answer).toLocaleLowerCase().includes(term)));

      return {total:hits.length,nextOffset:offset+20<hits.length?offset+20:null,runs:hits.slice(offset,offset+20).map(r=>({id:r.id,date:r.created_at,question:r.message.slice(0,240),answer:r.answer.slice(0,240)}))};
    }

    const {id,offset,length}=z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}).parse(input),prior=context.allRuns.find(r=>r.id===id);

    if(!prior)throw new Error('허용한 과거 대화를 찾지 못했습니다.');
    const text=prior.message+'\n\n'+prior.answer;

    return {id,text:text.slice(offset,offset+length),nextOffset:offset+length<text.length?offset+length:null};
  }

  if(name==='search'){
    const {query,offset}=z.object({query:z.string(),offset:z.number().int().min(0)}).parse(input),terms=query.normalize('NFC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const hits=available.filter(d=>terms.every(term=>(d.title+'\n'+d.text).normalize('NFC').toLocaleLowerCase().includes(term)));
    const sections=overlay.work?.navigation?.sections||overlay.navigation?.spaces?.find(s=>s.id===overlay.scope.id)?.sections||[],nodes=overlay.work?.navigation?.nodes||overlay.navigation?.nodes||[];
    await recordAgentEvent(run,{id:callId,title:'자료 검색',detail:query||'문서 목록'});

    return {total:hits.length,nextOffset:offset+30<hits.length?offset+30:null,documents:hits.slice(offset,offset+30).map(d=>({id:d.id,title:d.title,kind:d.kind,excerpt:d.text.slice(0,240),characters:d.text.length})),sections,folders:nodes.filter(n=>n.type==='folder')};
  }

  if(name==='read'){
    const {id,offset,length}=z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}).parse(input),doc=available.find(d=>d.id===id);

    if(!doc)throw new Error('허용한 자료를 찾지 못했습니다.');
    await recordAgentEvent(run,{id:callId,title:'문서 읽기',detail:doc.title,sources:[{id:doc.id,title:doc.title}]});

    return {id:doc.id,title:doc.title,text:doc.text.slice(offset,offset+length),nextOffset:offset+length<doc.text.length?offset+length:null,blocks:richBlocks(doc.content).map(b=>({id:b.id,index:b.index,characters:b.text.length})),characters:doc.text.length};
  }

  if(name==='stage_change'){
    if(run.mode==='discuss')throw new Error('함께 생각하기에서는 문서를 변경하지 않습니다.');
    const operation=agentOperationSchema.parse(input),op=(operation.type==='create'||operation.type==='folder')?{...operation,id:operationId(`${runId}:${callId}`)}:operation;

    if('id' in op&&op.type!=='create'&&op.type!=='folder'&&!available.some(d=>d.id===op.id)&&!overlay.work?.navigation?.nodes.some(n=>n.id===op.id)&&!overlay.navigation?.nodes.some(n=>n.id===op.id))throw new Error('자료 범위를 벗어났습니다.');
    agentOverlay(run.snapshot,[...run.operations,op]);
    await recordAgentEvent(run,{id:callId,title:op.type==='create'?'문서 만들기':op.type==='folder'?'폴더 만들기':op.type==='move'?'문서 이동':op.type==='rename'?'이름 변경':'문장 수정',detail:'title' in op?op.title:op.id},op);

    return {saved:true,id:op.id,changes:agentDiff(run.snapshot,[...run.operations,op])};
  }

  if(name==='inspect')return agentDiff(run.snapshot,run.operations);

  if(name==='web'){
    if(!run.web)throw new Error('이 작업의 웹 조사가 꺼져 있습니다.');
    const {query,url}=z.object({query:z.string().trim().min(1),url:z.string().nullable()}).parse(input),result=await researchAgentWeb(query,url||undefined);
    await recordAgentEvent(run,{id:callId,title:url?'웹 페이지 읽기':'Google 웹 조사',detail:result.text,sources:result.sources,...result.searchHtml&&{searchHtml:result.searchHtml}});

    return result;
  }

  if(name==='remember'){
    const {title,content,sourceIds}=z.object({title:z.string().max(300),content:z.string(),sourceIds:z.array(z.uuid())}).parse(input);
    const sources=sourceIds.map(id=>available.find(d=>d.id===id));

    if(sources.some(s=>!s))throw new Error('기억의 출처가 자료 범위를 벗어났습니다.');
    const result=await db.from('agent_memories').upsert({id:operationId(`${runId}:${callId}`),session_id:run.session_id,owner_id:run.owner_id,title,content,sources:sources.map(s=>({id:s!.id,title:s!.title})),updated_at:new Date().toISOString()});

    if(result.error)throw new Error('기억을 저장하지 못했습니다.');
    await recordAgentEvent(run,{id:callId,title:'작업 기억',detail:title});

    return {saved:true};
  }

  if(name==='plan'){
    const {plan}=z.object({plan:z.string()}).parse(input);
    await recordAgentEvent(run,{id:callId,title:'작업 계획',detail:plan});

    return {saved:true};
  }

  throw new Error('지원하지 않는 도구입니다.');
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
      stageChange:tool({description:'문서 생성·폴더 생성·정확히 한 번 나오는 문장 치환·이름 변경·문서 이동을 작업본에 반영한다. create/folder의 id는 임의 UUID를 넣으면 서버가 실제 ID를 반환한다. 먼저 검색에서 섹션과 폴더를 확인한다. 원고 전체를 다른 문체로 바꾸지 않는다.',inputSchema:agentOperationSchema,execute:async(input:AgentOperation,options)=>{return executeAgentTool(runId,workflow,'stage_change',input,options.toolCallId);}}),
    },
    ...web&&{
      researchWeb:tool({description:'Gemini의 Google 검색으로 공개 자료를 조사한다. query에는 필요한 개념만 넣고 원고 전체를 넣지 않는다. 특정 공개 HTTPS 페이지를 읽으려면 url을 지정한다. 검색·모델 비용이 발생할 수 있다.',inputSchema:z.object({query:z.string().min(1),url:z.string().nullable()}),execute:async(input,options)=>{return executeAgentTool(runId,workflow,'web',input,options.toolCallId);}}),
    },
  };
}
