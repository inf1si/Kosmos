import { z } from 'zod';
import { createHash } from 'node:crypto';
import { agentSessionHistory,agentAdmin,agentWorkspace,readAgentRun,recordAgentEvent,readAgentWiki } from './agent-server';
import { wikiDocuments,wikiFingerprint,wikiMissing,wikiReadableKeys,wikiScopeKey,wikiSearch,wikiView,wikiWriteSchema,wikiCategoryNames } from './agent-wiki';
import { agentContext,agentDocuments,agentLibrary,agentReferences,agentValidate,agentLiveIds,agentOverlay,agentOperationSchema,agentSearch,captureAgentScope,agentDiff,richBlocks,type AgentOperation,type AgentMode } from './writing-agent';
import { providerConfig } from './ai-provider';
import { researchAgentWeb } from './agent-web';
import { indexMeaning,searchMeaning } from './agent-meaning-server';

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
  // Other works and note spaces are read live and never staged; only the run's own scope can change.
  const library=()=>agentLibrary(state,run.snapshot.scope);

  if(old&&name==='stage_change'){
    const op=agentOperationSchema.parse(input);

    return {saved:true,id:op.type==='create'||op.type==='folder'?operationId(`${runId}:${callId}`):op.id,changes:agentDiff(run.snapshot,run.operations)};
  }

  if(old&&(name==='remember'||name==='plan'))return {saved:true,detail:old.detail};

  if(name==='history_search'||name==='history_read'){
    const history=await agentSessionHistory(run.session_id,run.owner_id),context=agentContext(history.runs.filter(r=>r.created_at<run.created_at),history.memories,agentLiveIds(state));

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
    const {query,offset}=z.object({query:z.string(),offset:z.number().int().min(0)}).parse(input);
    const sections=overlay.work?.navigation?.sections||overlay.navigation?.spaces?.find(s=>s.id===overlay.scope.id)?.sections||[],nodes=overlay.work?.navigation?.nodes||overlay.navigation?.nodes||[];
    await recordAgentEvent(run,{id:callId,title:'자료 검색',detail:query||'문서 목록'});

    return {...agentSearch(available,query,offset),sections,folders:nodes.filter(n=>n.type==='folder')};
  }

  // Meaning search reads the saved manuscript, not the run's working copy, so staged edits are found once applied.
  if(name==='meaning_search'){
    const {query,everywhere}=z.object({query:z.string().trim().min(1).max(2000),everywhere:z.boolean()}).parse(input),docs=[...agentDocuments(live),...everywhere?library():[]];
    const index=await indexMeaning(run.owner_id,run.workspace_id,docs,agentLiveIds(state)),result=await searchMeaning(run.owner_id,docs,query);
    await recordAgentEvent(run,{id:callId,title:'의미 검색',detail:[query,everywhere&&'다른 작품·노트 포함',index.indexed&&`새로 색인한 문서 ${index.indexed}개`,index.waiting&&`색인 대기 ${index.waiting}개`,`임베딩 토큰 ${index.tokens+result.tokens}`].filter(Boolean).join(' · '),sources:[...new Map(result.passages.map(p=>[p.id,{id:p.id,title:p.title}])).values()].slice(0,10)});
    const places=everywhere?new Map(library().map(d=>[d.id,d.place])):new Map<string,string>();

    return {passages:result.passages.map(p=>({...p,...places.has(p.id)&&{place:places.get(p.id),readOnly:true}})),...index.waiting&&{waiting:index.waiting,note:'아직 색인하지 못한 문서가 있다. 같은 검색을 다시 부르면 이어서 색인한다.'}};
  }

  if(name==='library_search'){
    const {query,offset}=z.object({query:z.string(),offset:z.number().int().min(0)}).parse(input),docs=library(),places=new Map(docs.map(d=>[d.id,d.place]));
    await recordAgentEvent(run,{id:callId,title:'다른 작품·노트 검색',detail:query||'문서 목록'});
    const result=agentSearch(docs,query,offset);

    return {...result,documents:result.documents.map(d=>({...d,place:places.get(d.id),readOnly:true}))};
  }

  if(name==='read'){
    const {id,offset,length}=z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}).parse(input),own=available.find(d=>d.id===id),other=own?undefined:library().find(d=>d.id===id),doc=own||other;

    if(!doc)throw new Error('자료를 찾지 못했습니다. 휴지통에 있거나 지워진 문서일 수 있습니다.');
    await recordAgentEvent(run,{id:callId,title:other?'다른 자료 읽기':'문서 읽기',detail:other?`${other.place} · ${doc.title}`:doc.title,sources:[{id:doc.id,title:doc.title}]});

    return {id:doc.id,title:doc.title,kind:doc.kind,...other&&{place:other.place,readOnly:true},properties:doc.properties,text:doc.text.slice(offset,offset+length),nextOffset:offset+length<doc.text.length?offset+length:null,blocks:richBlocks(doc.content).map(b=>({id:b.id,index:b.index,characters:b.text.length})),characters:doc.text.length};
  }

  if(name==='stage_change'){
    if(run.mode==='discuss')throw new Error('함께 생각하기에서는 문서를 변경하지 않습니다.');
    const operation=agentOperationSchema.parse(input),op=(operation.type==='create'||operation.type==='folder')?{...operation,id:operationId(`${runId}:${callId}`)}:operation;

    if('id' in op&&op.type!=='create'&&op.type!=='folder'&&!available.some(d=>d.id===op.id)&&!overlay.work?.navigation?.nodes.some(n=>n.id===op.id)&&!overlay.navigation?.nodes.some(n=>n.id===op.id))throw new Error(library().some(d=>d.id===op.id)?'다른 작품이나 노트 작업공간의 문서는 읽기만 할 수 있습니다.':'자료 범위를 벗어났습니다.');
    agentOverlay(run.snapshot,[...run.operations,op]);
    // The work log names the changed document or folder; an ID alone tells the writer nothing.
    const folder=[...overlay.work?.navigation?.nodes||[],...overlay.navigation?.nodes||[]].find(n=>n.id===op.id),named=docs.find(d=>d.id===op.id)?.title||(folder?.type==='folder'?folder.title:'제목 없음');
    await recordAgentEvent(run,{id:callId,title:op.type==='create'?'문서 만들기':op.type==='folder'?'폴더 만들기':op.type==='move'?'문서 이동':op.type==='rename'?'이름 변경':op.type==='properties'?'속성 변경':op.type==='insert'?'이어 쓰기':'문장 수정',detail:'title' in op?op.title:named},op);

    return {saved:true,id:op.id,changes:agentDiff(run.snapshot,[...run.operations,op])};
  }

  if(name==='inspect')return agentDiff(run.snapshot,run.operations);

  if(name==='references'){
    const {id}=z.object({id:z.uuid()}).parse(input),result=agentReferences(state,id);
    await recordAgentEvent(run,{id:callId,title:'연결 찾기',detail:`${result.title} · 나가는 연결 ${result.outgoing.length}개 · 들어오는 연결 ${result.incoming.length}개`,sources:[{id:result.id,title:result.title}]});

    return result;
  }

  if(name==='validate'){
    const result=agentValidate(state,run.snapshot,run.operations);
    await recordAgentEvent(run,{id:callId,title:'변경 점검',detail:result.issues.length?result.issues.map(i=>`${i.title}: ${i.issue}`).join('\n'):`문서 ${result.checked}개 · 문제 없음`});

    return result;
  }

  if(name==='web'){
    if(!run.web||!providerConfig('gemini',process.env,process.env.VERTEX_SEARCH_MODEL))throw new Error('웹 조사 연결이 없습니다.');
    const {query,url}=z.object({query:z.string().trim().min(1),url:z.string().nullable()}).parse(input),result=await researchAgentWeb(query,url||undefined);
    await recordAgentEvent(run,{id:callId,title:url?'웹 페이지 읽기':'Google 웹 조사',detail:result.text,sources:result.sources,...result.searchHtml&&{searchHtml:result.searchHtml}});

    return result;
  }

  if(name==='remember'){
    const {title,content,sourceIds}=z.object({title:z.string().max(300),content:z.string(),sourceIds:z.array(z.uuid())}).parse(input);
    const others=sourceIds.some(id=>!available.some(d=>d.id===id))?library():[],sources=sourceIds.map(id=>available.find(d=>d.id===id)||others.find(d=>d.id===id));

    if(sources.some(s=>!s))throw new Error('기억의 출처를 찾지 못했습니다.');
    const result=await db.from('agent_memories').upsert({id:operationId(`${runId}:${callId}`),session_id:run.session_id,owner_id:run.owner_id,title,content,sources:sources.map(s=>({id:s!.id,title:s!.title})),updated_at:new Date().toISOString()});

    if(result.error)throw new Error('기억을 저장하지 못했습니다.');
    await recordAgentEvent(run,{id:callId,title:'작업 기억',detail:title});

    return {saved:true};
  }

  // The wiki is the agent's own notes: writing a page never touches the manuscript, so every mode may keep it.
  if(name==='wiki_write'){
    const write=wikiWriteSchema.parse(input),key=wikiScopeKey(run.snapshot.scope),id=write.id||operationId(`${runId}:${callId}`);

    if(old)return {saved:true,id};

    if(write.id){
      const existing=await db.from('agent_wiki_pages').select('scope_key').eq('id',write.id).eq('owner_id',run.owner_id).maybeSingle();

      if(wikiMissing(existing.error))throw new Error('위키 저장소가 아직 준비되지 않았습니다.');

      if(existing.data?.scope_key!==key)throw new Error('이 범위의 위키 페이지만 고칠 수 있습니다. 새 페이지는 id를 null로 둔다.');
    }

    const docs=wikiDocuments(state),sources=write.sourceIds.map(source=>docs.get(source));

    if(sources.some(source=>!source))throw new Error('위키의 출처를 찾지 못했습니다. 원고에 반영되지 않은 새 문서는 출처가 될 수 없습니다.');
    const result=await db.from('agent_wiki_pages').upsert({id,owner_id:run.owner_id,workspace_id:run.workspace_id,scope_key:key,title:write.title,category:write.category,content:write.content,sources:sources.map(source=>({id:source!.id,title:source!.title,hash:wikiFingerprint(source!)})),run_id:run.id,updated_at:new Date().toISOString()});

    if(wikiMissing(result.error))throw new Error('위키 저장소가 아직 준비되지 않았습니다.');

    if(result.error)throw new Error('위키를 저장하지 못했습니다.');
    await recordAgentEvent(run,{id:callId,title:write.id?'위키 고침':'위키 정리',detail:`${wikiCategoryNames[write.category]} · ${write.title}`,sources:sources.map(source=>({id:source!.id,title:source!.title}))});

    return {saved:true,id};
  }

  if(name==='wiki_search'||name==='wiki_read'){
    const wiki=await readAgentWiki(run.owner_id,wikiReadableKeys(run.snapshot.scope));

    if(!wiki.available)throw new Error('위키 저장소가 아직 준비되지 않았습니다.');
    const docs=wikiDocuments(state),pages=wiki.pages.map(page=>wikiView(page,docs));

    if(name==='wiki_search'){
      const {query,offset}=z.object({query:z.string(),offset:z.number().int().min(0)}).parse(input);
      await recordAgentEvent(run,{id:callId,title:'위키 검색',detail:query||'위키 목차'});

      return wikiSearch(pages,query,offset);
    }

    const {id,offset,length}=z.object({id:z.uuid(),offset:z.number().int().min(0),length:z.number().int().min(1).max(50000)}).parse(input),page=pages.find(item=>item.id===id);

    if(!page)throw new Error('위키 페이지를 찾지 못했습니다.');
    await recordAgentEvent(run,{id:callId,title:'위키 읽기',detail:page.title});

    return {id:page.id,title:page.title,category:wikiCategoryNames[page.category],scope:page.scope_key==='common'?'공통':'이 작품',updated:page.updated_at,stale:page.stale,sources:page.sources,content:page.content.slice(offset,offset+length),nextOffset:offset+length<page.content.length?offset+length:null};
  }

  if(name==='plan'){
    const {plan}=z.object({plan:z.string()}).parse(input);
    await recordAgentEvent(run,{id:callId,title:'작업 계획',detail:plan});

    return {saved:true};
  }

  throw new Error('지원하지 않는 도구입니다.');
}

