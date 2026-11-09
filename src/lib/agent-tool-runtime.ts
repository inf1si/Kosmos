import { z } from 'zod';
import { createHash } from 'node:crypto';
import { agentSessionHistory,agentAdmin,agentWorkspace,readAgentRun,recordAgentEvent } from './agent-server';
import { agentContext,agentDocuments,agentOverlay,agentOperationSchema,captureAgentScope,agentDiff,richBlocks,type AgentOperation,type AgentMode } from './writing-agent';
import { researchAgentWeb } from './agent-web';

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

