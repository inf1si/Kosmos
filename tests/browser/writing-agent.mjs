import { vertexTestEnvironment,vertexReviewResponse } from '../fixtures/vertex.ts';
// Real local Next.js + Workflow + SDK calls + a synthetic Postgres/Supabase/model service.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {uid,fromText,workspaceSchema} from '../../src/lib/model.ts';
import {addNote,newNote} from '../../src/lib/personal-notes.ts';
import {agentRunSchema,agentDiff} from '../../src/lib/writing-agent.ts';
import {PALETTES} from '../../src/lib/theme.ts';
import {chooseOption} from './select.mjs';

const require=createRequire(import.meta.url),pw=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright-core');

const output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/writing-agent'),port=Number(process.env.KOSMOS_AGENT_TEST_PORT||3230),base=`http://127.0.0.1:${port}`,quick=process.env.KOSMOS_AGENT_QUICK==='1';

await mkdir(output,{recursive:true});

const pg=new PGlite(),profile={id:uid(),aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-11-09T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[]},enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`,workspaceId=uid();

let state=seedWorkspace();

state.works[0].documents[0].content=fromText('달의 관측소에는 아무도 없었다.');

const note={...newNote(),title:'관측 노트',content:fromText('관측은 새벽에 시작한다.')};

state=addNote(state,note);

const initial=structuredClone(state),errors=[],results=[],modelCalls=[],longModel='gemini-'+ 'x'.repeat(193);

await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table public.authors(user_id uuid primary key);create table public.workspaces(id uuid primary key,owner_id uuid not null,payload jsonb not null,version bigint not null default 1,updated_at timestamptz default now());create table public.workspace_revisions(id uuid default gen_random_uuid(),workspace_id uuid,owner_id uuid,payload jsonb,created_at timestamptz default now());`);

await pg.exec(await readFile('supabase/migrations/20261109135502_personal_writing_agent.sql','utf8'));

await pg.query('insert into public.authors values($1)',[profile.id]);

await pg.query('insert into public.workspaces(id,owner_id,payload) values($1,$2,$3)',[workspaceId,profile.id,JSON.stringify(state)]);

const jsonColumns=new Set(['payload','scope','snapshot','operations','events','usage','sources','p_payload','p_event','p_operation']);

const objectValue=(key,value)=>jsonColumns.has(key)&&value!==null?JSON.stringify(value):value;

const tables=new Set(['authors','workspaces','workspace_revisions','agent_sessions','agent_runs','agent_memories']);

const mock=createServer(async(req,res)=>{
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};

  try{
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,apikey,X-Client-Info,Content-Type,Prefer,Accept,Content-Profile,Accept-Profile,cache-control');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');

    if(req.method==='OPTIONS'){res.writeHead(204);res.end();

return;}

    const url=new URL(req.url,'http://localhost'),bytes=Buffer.concat(await Array.fromAsync(req)),body=bytes.length?JSON.parse(bytes.toString()):{};

    if(url.pathname==='/fixture-model'){
      const provider=url.searchParams.get('provider');modelCalls.push({provider,model:url.searchParams.get('model'),body});

      const google=provider==='gemini',anthropic=provider==='anthropic';

      if(google&&body.tools?.some(tool=>tool.googleSearch||tool.urlContext))return send({candidates:[{content:{role:'model',parts:[{text:'합성 자료에서는 기억의 재구성 가능성을 설명한다.'}]},finishReason:'STOP',groundingMetadata:{groundingChunks:[{web:{uri:'https://example.com/paper',title:'합성 연구 자료'}}],groundingSupports:[{segment:{startIndex:0,endIndex:27,text:'합성 자료에서는 기억의 재구성 가능성을 설명한다.'},groundingChunkIndices:[0]}],webSearchQueries:['기억 연구'],searchEntryPoint:{renderedContent:'<a href="https://www.google.com/search?q=memory" target="_blank">Google 검색 제안</a>'}}}],usageMetadata:{promptTokenCount:24,candidatesTokenCount:12,totalTokenCount:36}});

      if(google&&body.generationConfig?.responseMimeType==='application/json'||anthropic&&(!body.tools?.length||body.tools?.some(tool=>tool.name==='json')))return send(vertexReviewResponse(google?'gemini':'anthropic',{review:'합성 문서 답변',suggestions:[]}));
      const content=google?(body.contents||[]).flatMap(message=>message.parts||[]):anthropic?(body.messages||[]).flatMap(message=>Array.isArray(message.content)?message.content:[]):body.input||[];
      const decode=value=>{try{return JSON.parse(Array.isArray(value)?value.map(part=>part.text||'').join(''):value);}catch{return value;}};

      const calls=content.filter(item=>google?item.functionCall:anthropic?item.type==='tool_use':item.type==='function_call');
      const outputs=content.filter(item=>google?item.functionResponse:anthropic?item.type==='tool_result':item.type==='function_call_output').map(item=>({data:decode(google?item.functionResponse.response.content:anthropic?item.content:item.output)})),step=calls.length;
      const definitions=google?(body.tools||[]).flatMap(tool=>tool.functionDeclarations||[]):body.tools||[];

      for(const definition of definitions){const schema=google?definition.parametersJsonSchema||definition.parameters:anthropic?definition.input_schema:definition.parameters;assert.equal(String(schema.type).toLowerCase(),'object',`${definition.name}: tool arguments must have an object root`);assert(!schema.oneOf&&!schema.anyOf,'root union tool schemas are unsupported');}

      const tool=(name,args)=>({type:'function_call',id:`fc_${step}`,call_id:`call_${step}`,name,arguments:JSON.stringify(name==='stageChange'?{change:args}:args)});
      const search=outputs.find(o=>o.data.documents)?.data,created=outputs.find(o=>o.data.saved&&o.data.id)?.data;
      const names=new Set((google?(body.tools||[]).flatMap(tool=>tool.functionDeclarations||[]):body.tools||[]).map(tool=>tool.name));let item;

      if(step===0)item=tool('searchSources',{query:'',offset:0});
      else if(step===1)item=tool('readSource',{id:search.documents[0].id,offset:0,length:12000});
      else if(!names.has('stageChange'))item={type:'message',id:uid(),role:'assistant',status:'completed',content:[{type:'output_text',text:'원문을 읽었고 다른 전개를 함께 생각했습니다.',annotations:[]}]};
      else if(step===2)item=tool('stageChange',{type:'create',id:uid(),kind:'memo',title:'에이전트 개요',text:'달에 도착한 인물은 관측소를 찾는다.',parentId:null,sectionId:search.sections[0].id,beforeId:null});
      else if(step===3)item=tool('readSource',{id:created.id,offset:0,length:12000});
      else if(step===4)item=tool('stageChange',{type:'replace',id:created.id,quote:'달에 도착한',replacement:'달로 돌아온'});
      else if(step===5)item=tool('remember',{title:'열린 질문',content:'관측소가 비어 있는 이유를 다음에 검토한다.',sourceIds:[search.documents[0].id]});
      else if(step===6&&names.has('researchWeb'))item=tool('researchWeb',{query:'기억의 재구성 연구',url:null});
      else if((step===6&&!names.has('researchWeb'))||step===7&&names.has('researchWeb'))item=tool('inspectChanges',{});
      else item={type:'message',id:uid(),role:'assistant',status:'completed',content:[{type:'output_text',text:'자료를 읽고 개요를 만든 뒤 문장을 다듬었습니다. 변경과 열린 질문을 확인할 수 있습니다.',annotations:[]}]};

      if(google)return send({candidates:[{content:{role:'model',parts:item.type==='function_call'?[{functionCall:{name:item.name,args:JSON.parse(item.arguments)}}]:[{text:item.content[0].text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:30,candidatesTokenCount:20,totalTokenCount:50}});

      if(anthropic)return send({id:uid(),type:'message',role:'assistant',model:body.model,content:item.type==='function_call'?[{type:'tool_use',id:item.call_id,name:item.name,input:JSON.parse(item.arguments)}]:[{type:'text',text:item.content[0].text}],stop_reason:item.type==='function_call'?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:30,output_tokens:20}});

      return send({id:uid(),object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[item],usage:{input_tokens:30,output_tokens:20,total_tokens:50,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
    }

    const author=req.headers.authorization===`Bearer ${token}`,service=req.headers.apikey==='synthetic-service';

    if(url.pathname==='/auth/v1/user')return author?send(profile):send({message:'unauthorized'},401);

    if(!author&&!service)return send({message:'unauthorized'},401);
    const name=url.pathname.split('/').at(-1);

    if(url.pathname.includes('/rpc/')){
      if(name==='save_workspace'){
        const row=(await pg.query('select * from public.workspaces where id=$1',[workspaceId])).rows[0];

        if(row.version!==body.p_base_version)return send({status:'conflict',version:row.version,payload:row.payload});
        state=workspaceSchema.parse(body.p_payload);await pg.query('update public.workspaces set payload=$1,version=version+1 where id=$2',[JSON.stringify(state),workspaceId]);

return send({status:'saved',version:row.version+1});
      }

      if(!service||!['agent_claim_run','agent_record_step','agent_commit_workspace'].includes(name))return send({message:'permission denied'},403);
      const keys=Object.keys(body);assert(keys.every(key=>/^p_[a-z_]+$/.test(key)));const value=await pg.query(`select public.${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) value`,keys.map(key=>objectValue(key,body[key])));

return send(value.rows[0].value);
    }

    if(!tables.has(name))return send([]);
    const parameters=[],conditions=[];

    for(const [key,raw] of url.searchParams){
      if(['select','order','limit','offset','on_conflict'].includes(key))continue;assert(/^[a-z_]+$/.test(key));

      if(raw==='is.null'){conditions.push(`${key} is null`);continue;}

      if(raw.startsWith('in.(')){const values=raw.slice(4,-1).split(',');conditions.push(`${key} in (${values.map(value=>{parameters.push(value);

return `$${parameters.length}`;}).join(',')})`);}
      else{const dot=raw.indexOf('.'),operator={eq:'=',neq:'<>',gt:'>'}[raw.slice(0,dot)];assert(operator,raw);parameters.push(raw.slice(dot+1));conditions.push(`${key}${operator}$${parameters.length}`);}
    }

    const where=conditions.length?` where ${conditions.join(' and ')}`:'',single=String(req.headers.accept).includes('vnd.pgrst.object');let rows;

    if(req.method==='POST'){
      const keys=Object.keys(body);assert(keys.every(key=>/^[a-z_]+$/.test(key)));const update=String(req.headers.prefer).includes('merge-duplicates')?` on conflict(id) do update set ${keys.filter(k=>k!=='id').map(k=>`${k}=excluded.${k}`).join(',')}`:'';
      rows=(await pg.query(`insert into public.${name}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})${update} returning *`,keys.map(key=>objectValue(key,body[key])))).rows;
    }else if(req.method==='PATCH'){
      const keys=Object.keys(body);assert(keys.every(key=>/^[a-z_]+$/.test(key)));

const assignments=keys.map(key=>{parameters.push(objectValue(key,body[key]));

return `${key}=$${parameters.length}`;});

rows=(await pg.query(`update public.${name} set ${assignments.join(',')}${where} returning *`,parameters)).rows;
    }else if(req.method==='DELETE')rows=(await pg.query(`delete from public.${name}${where} returning *`,parameters)).rows;
    else{
      const order=url.searchParams.get('order'),sort=order?` order by ${order.split(',').map(part=>{const [key,direction]=part.split('.');assert(/^[a-z_]+$/.test(key));

return `${key} ${direction==='desc'?'desc':'asc'}`;}).join(',')}`:'',limit=Number(url.searchParams.get('limit'));

      rows=(await pg.query(`select * from public.${name}${where}${sort}${limit?` limit ${Math.min(limit,1000)}`:''}${Number(url.searchParams.get('offset'))?` offset ${Number(url.searchParams.get('offset'))}`:''}`,parameters)).rows;
    }

    return send(single?rows[0]||null:rows);
  }catch(error){errors.push(`fixture: ${error.message}`);

return send({message:error.message},500);}
});

await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));

const mockUrl=`http://127.0.0.1:${mock.address().port}`,log=createWriteStream(resolve(output,'server.log'));

const app=spawn('pnpm',['exec','next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),detached:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:mockUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',...vertexTestEnvironment,VERTEX_GEMINI_MODELS:'gemini-test,gemini-fast',VERTEX_CLAUDE_MODELS:'claude-opus-5-5',AI_CREDENTIAL_SECRET:'synthetic-encryption-secret-'.repeat(3),KOSMOS_AGENT_FIXTURE_URL:mockUrl,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${resolve('tests/fixtures/agent-fetch.mjs')}`}});

app.stdout.pipe(log);

app.stderr.pipe(log);

const browser=await pw.chromium.launch({headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});

const until=async(check,label)=>{for(let i=0;i<240;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,250));}

assert.fail(label);};

let page;

async function openAgent(){await page.getByRole('button',{name:/^사이드바 (열기|닫기)$/}).waitFor();

if(!await page.getByRole('button',{name:'작업 대화',exact:true}).isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();await page.getByRole('button',{name:'작업 대화',exact:true}).click();}

async function checkModelMenu(control){
  const width=page.viewportSize().width,box=await control.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1,'model control fits viewport');
  await control.click();const menu=page.getByRole('listbox');await menu.waitFor();const layout=await menu.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,overflow:el.scrollWidth>el.clientWidth+1}));assert(layout.left>=0&&layout.right<=width+1&&!layout.overflow,JSON.stringify(layout));await page.keyboard.press('Escape');
}

async function verifySharedAI(width){
  await page.getByRole('button',{name:/^사이드바 (열기|닫기)$/}).waitFor();
  const row=page.locator(`[data-navigation-row="${initial.works[0].documents[0].id}"]`);

  if(!await row.isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
  await row.getByTitle(initial.works[0].documents[0].title,{exact:true}).click();
  await page.getByRole('button',{name:'AI 대화',exact:true}).click();
  const panel=page.locator('.reference-panel.is-chat');await panel.getByRole('textbox',{name:'AI에게 질문',exact:true}).waitFor();

  for(const provider of ['gemini','anthropic']){
    await panel.getByRole('button',{name:'AI 설정',exact:true}).click();const settings=page.getByRole('dialog',{name:'AI 설정',exact:true});
    await chooseOption(settings.getByRole('combobox',{name:'설정할 AI 제공자'}),provider);
    assert.equal(await settings.locator('input[type="password"]').count(),0);
    await settings.getByRole('textbox',{name:'AI 모델 목록',exact:true}).fill(provider==='gemini'?`gemini-selected\ngemini-fast\n${longModel}`:'claude-selected@20260101\nclaude-opus-5-5');
    await settings.getByRole('button',{name:'모델 저장',exact:true}).click();await settings.getByText('모델 목록을 저장했습니다.',{exact:true}).waitFor();

    if(provider==='gemini'){
      for(const palette of quick?PALETTES.slice(0,1):PALETTES)for(const mode of ['light','dark']){
        await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});
        const layout=await settings.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,overflow:el.scrollWidth>el.clientWidth+1}));assert(layout.left>=0&&layout.right<=width+1&&!layout.overflow,JSON.stringify({width,palette,mode,layout}));
        await settings.getByRole('combobox',{name:'설정할 AI 제공자'}).click();await page.getByRole('listbox').waitFor();assert.equal(await page.getByRole('option').count(),2);await page.keyboard.press('Escape');
        await checkModelMenu(settings.getByRole('combobox',{name:'설정할 AI 모델',exact:true}));
        await page.screenshot({path:resolve(output,`vertex-settings-${width}-${palette}-${mode}.png`)});results.push({width,palette,mode,view:'vertex-settings'});
      }
    }

    await settings.getByRole('button',{name:'닫기',exact:true}).click();

    if(provider==='gemini'){await chooseOption(panel.getByRole('combobox',{name:'AI 모델',exact:true}),longModel);await checkModelMenu(panel.getByRole('combobox',{name:'AI 모델',exact:true}));}

    const chosenModel=provider==='gemini'?'gemini-fast':'claude-opus-5-5';await chooseOption(panel.getByRole('combobox',{name:'AI 모델',exact:true}),chosenModel);
    const previousAnswers=await panel.locator('.chat-message.assistant').count();
    await panel.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill(`${provider} 문서 질문`);await panel.getByRole('button',{name:'질문 보내기',exact:true}).click();
    await until(async()=>await panel.locator('.chat-message.assistant').count()===previousAnswers+1,'ordinary document AI answer');
    assert.equal(await panel.locator('.chat-message.assistant').last().locator('p').first().innerText(),'합성 문서 답변');assert.equal(modelCalls.at(-1).model,chosenModel);assert.equal(await panel.locator('.chat-message.assistant').last().locator('header small').innerText(),chosenModel);

    if(provider==='anthropic'){
      await panel.getByRole('button',{name:'AI 설정',exact:true}).click();const settings=page.getByRole('dialog',{name:'AI 설정',exact:true});
      assert.equal(await settings.getByRole('combobox',{name:'설정할 AI 모델',exact:true}).getAttribute('data-value'),'claude-selected@20260101');
      await settings.getByRole('button',{name:'기본 모델 사용',exact:true}).click();await settings.getByText('기본 모델로 돌아갔습니다.',{exact:true}).waitFor();assert.equal(await settings.getByRole('combobox',{name:'설정할 AI 모델',exact:true}).getAttribute('data-value'),vertexTestEnvironment.VERTEX_CLAUDE_MODEL);await settings.getByRole('button',{name:'닫기',exact:true}).click();
    }

  }

  await panel.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();
  await page.locator('.ProseMirror').first().locator('p').first().click();await page.keyboard.press('Alt+Enter');
  await chooseOption(page.getByRole('combobox',{name:'AI 질문 제공자',exact:true}),'gemini');await chooseOption(page.getByRole('combobox',{name:'AI 질문 모델',exact:true}),longModel);await checkModelMenu(page.getByRole('combobox',{name:'AI 질문 모델',exact:true}));await chooseOption(page.getByRole('combobox',{name:'AI 질문 모델',exact:true}),'gemini-fast');
  await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill('현재 문단 질문');await page.getByRole('button',{name:'AI 질문 보내기',exact:true}).click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'적용할 AI 답변'}).inputValue(),'합성 문서 답변');assert.equal(modelCalls.at(-1).model,'gemini-fast');await page.keyboard.press('Escape');
  await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'networkidle'});await page.getByRole('button',{name:'AI 대화',exact:true}).click();
  const notePanel=page.locator('.reference-panel.is-chat');await notePanel.getByRole('textbox',{name:'AI에게 질문',exact:true}).waitFor();const previousNotes=await notePanel.locator('.chat-message.assistant').count();await notePanel.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill('노트 질문');await notePanel.getByRole('button',{name:'질문 보내기',exact:true}).click();await until(async()=>await notePanel.locator('.chat-message.assistant').count()===previousNotes+1,'ordinary note AI answer');
  await notePanel.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();await page.locator('.ProseMirror').first().locator('p').first().click();await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill('노트 현재 문단 질문');await page.getByRole('button',{name:'AI 질문 보내기',exact:true}).click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();await page.keyboard.press('Escape');
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});

}

try{
  await until(async()=>{try{return (await fetch(base)).ok;}catch{return false;}},'Next server starts');

  for(const width of process.env.KOSMOS_AGENT_INTERACTIONS_ONLY==='1'?[1280]:[1280,360]){
    const context=await browser.newContext({viewport:{width,height:950}});context.setDefaultNavigationTimeout(90000);
    await context.addInitScript(({profile,token,key})=>{if(window!==window.top)return;localStorage.setItem(key,JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));},{profile,token,key:'sb-127-auth-token'});
    page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${base}/studio`,{waitUntil:'networkidle'});
    await verifySharedAI(width);
    await openAgent();const dialog=page.getByRole('dialog',{name:'작업 대화',exact:true});await dialog.waitFor();
    await chooseOption(dialog.getByRole('combobox',{name:'작업 대화 선택'}),'');await chooseOption(dialog.getByRole('combobox',{name:'에이전트 실행 방식'}),'review');await chooseOption(dialog.getByRole('combobox',{name:'에이전트 모델'}),longModel);await checkModelMenu(dialog.getByRole('combobox',{name:'에이전트 모델'}));await chooseOption(dialog.getByRole('combobox',{name:'에이전트 모델'}),'gemini-selected');
    await dialog.getByRole('button',{name:'웹 조사 · Gemini',exact:true}).click();await dialog.getByRole('textbox',{name:'에이전트에게 요청'}).fill('개요를 만들고 열린 질문을 기억해줘.');await dialog.getByRole('button',{name:'에이전트 요청 보내기'}).click();assert(await dialog.getByRole('textbox',{name:'에이전트에게 요청'}).isDisabled());await until(async()=>!await dialog.getByRole('textbox',{name:'에이전트에게 요청'}).isDisabled()&&await dialog.getByRole('textbox',{name:'에이전트에게 요청'}).evaluate(el=>el===document.activeElement),'accepted request returns focus without losing new typing');
    await until(async()=>await dialog.getByRole('button',{name:'중단',exact:true}).isVisible()||(await pg.query("select * from public.agent_runs where status='completed'")).rows.length>0,'running task visible');

    if(await dialog.getByRole('button',{name:'중단',exact:true}).isVisible()){
      assert(await dialog.getByRole('combobox',{name:'에이전트 실행 방식'}).isDisabled());assert(await dialog.getByRole('combobox',{name:'에이전트 제공자'}).isDisabled());assert(await dialog.getByRole('combobox',{name:'에이전트 모델'}).isDisabled());assert(await dialog.getByRole('button',{name:'웹 조사 · Gemini',exact:true}).isDisabled());
    }

    await until(async()=>{const rows=await pg.query("select * from public.agent_runs order by created_at desc limit 1");const row=rows.rows[0];

if(row?.status==='failed')assert.fail(row.error);

return row?.status==='completed'&&!row.reverted;},'durable agent finishes');
    const run=agentRunSchema.parse(JSON.parse(JSON.stringify((await pg.query('select * from public.agent_runs order by created_at desc limit 1')).rows[0])));assert.equal(run.error,'');assert.equal(run.model,'gemini-selected');assert.equal(run.operations.length,2);assert.equal(run.events.some(event=>event.title==='Google 웹 조사'),true);assert.equal(run.applied_version,null);
    await dialog.getByRole('button',{name:/^변경 /}).click();await page.getByText('달로 돌아온 인물은 관측소를 찾는다.',{exact:true}).waitFor();
    const before=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload;assert(!before.works[0].documents.some(doc=>doc.id===run.operations[0].id));
    await dialog.getByRole('button',{name:'변경 적용',exact:true}).click();await until(async()=>{const row=(await pg.query('select applied_version from public.agent_runs where id=$1',[run.id])).rows[0];

return row.applied_version!==null;},'review changes apply');
    await dialog.getByRole('button',{name:'되돌리기',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'문서 열기',exact:true}).click();
    await writeFile(resolve(output,'after-source-open.txt'),await page.locator('body').innerText());await page.screenshot({path:resolve(output,'after-source-open.png')});
    await until(async()=>await page.getByRole('textbox',{name:'문서 제목',exact:true}).count()>0&&await page.getByRole('textbox',{name:'문서 제목',exact:true}).first().inputValue({timeout:1000})==='에이전트 개요','applied document opens in actual editor');
    assert((await page.locator('.ProseMirror').first().innerText()).includes('달로 돌아온'));
    await openAgent();
    await dialog.getByRole('button',{name:'기억',exact:true}).click();await dialog.getByText('관측소가 비어 있는 이유를 다음에 검토한다.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'잊기',exact:true}).click();await until(async()=>(await pg.query('select * from public.agent_memories where session_id=$1',[run.session_id])).rows.length===0,'forget memory');
    await dialog.getByRole('button',{name:/^변경 /}).click();await dialog.getByRole('button',{name:'되돌리기',exact:true}).click();await until(async()=>(await pg.query('select reverted from public.agent_runs where id=$1',[run.id])).rows[0].reverted,'undo batch');
    await dialog.getByRole('button',{name:'대화',exact:true}).click();

    for(const palette of quick?PALETTES.slice(0,1):PALETTES){for(const mode of ['light','dark']){
      await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});

      for(const [name,label] of [['chat','대화'],['changes','변경'],['memory','기억']]){
        await dialog.getByRole('button',{name:label==='변경'?/^변경 /:label,exact:label!=='변경'}).click();

const layout=await dialog.evaluate(el=>{const box=el.getBoundingClientRect();

return {left:box.left,right:box.right,bottom:box.bottom,overflow:el.scrollWidth>el.clientWidth+1};});

assert(layout.left>=0&&layout.right<=width+1&&!layout.overflow,JSON.stringify({width,palette,mode,name,layout}));const toolbar=await dialog.locator('.agent-toolbar').boundingBox();

        for(const control of [dialog.getByRole('combobox',{name:'작업 대화 선택'}),dialog.getByRole('button',{name:'새 작업 대화'}),dialog.getByRole('button',{name:'AI 자료 내보내기'})]){
          const box=await control.boundingBox();assert(box&&toolbar&&box.y>=toolbar.y-1&&box.y+box.height<=toolbar.y+toolbar.height+1&&box.x>=0&&box.x+box.width<=width+1,'session controls remain visible, without scrolling their toolbar');
        }

        results.push({width,palette,mode,view:name});
      }

      await dialog.getByRole('combobox',{name:'에이전트 실행 방식'}).click();
      const menu=page.getByRole('listbox'),menuBox=await menu.boundingBox();assert(menuBox&&menuBox.x>=0&&menuBox.x+menuBox.width<=width+1);await page.keyboard.press('Escape');

      if(['violet','cyber','orbit'].includes(palette))await page.screenshot({path:resolve(output,`${width}-${palette}.png`)});
    }}

    const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'AI 자료 내보내기',exact:true}).click();const download=await downloadPromise,archive=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(archive.format,'orbis-writing-agent');assert(archive.runs.some(row=>row.id===run.id));
    await dialog.getByRole('button',{name:'새 작업 대화',exact:true}).click();assert(await dialog.getByRole('combobox',{name:'작업 자료 범위'}).isEnabled());assert(await dialog.getByRole('textbox',{name:'에이전트에게 요청'}).evaluate(el=>el===document.activeElement));await chooseOption(dialog.getByRole('combobox',{name:'작업 대화 선택'}),run.session_id);await dialog.locator('.agent-question').waitFor();
    await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.reload({waitUntil:'networkidle'});await openAgent();await page.getByRole('dialog',{name:'작업 대화',exact:true}).locator('.agent-question').filter({hasText:run.message}).waitFor();await context.close();
  }

  const api=async(path,method='GET',body,origin=base)=>{
    const response=await fetch(`${base}/api/agent/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'},...body&&{body:JSON.stringify(body)}});

    return {status:response.status,data:await response.json()};
  };

  assert.equal((await fetch(`${base}/api/agent/sessions`)).status,401);
  assert.equal((await api('sessions','POST',{},'https://elsewhere.invalid')).status,403);

  const createTask=async(scope,mode,message,provider='gemini',model)=>{
    const sessionId=uid(),id=uid();assert.equal((await api('sessions','POST',{id:sessionId,title:message,scope,mode,provider,web:false})).status,201);
    const result=await api(`sessions/${sessionId}/messages`,'POST',{id,message,mode,provider,model,web:false});assert.equal(result.status,202,JSON.stringify(result));

    return {sessionId,id,message,mode};
  };

  const finish=async(id)=>{
    await until(async()=>{const row=(await pg.query('select * from public.agent_runs where id=$1',[id])).rows[0];

if(row.status==='failed')assert.fail(row.error);

return row.status==='completed';},'API task completes');

    return agentRunSchema.parse(JSON.parse(JSON.stringify((await pg.query('select * from public.agent_runs where id=$1',[id])).rows[0])));
  };

  const talk=await createTask({kind:'work',id:initial.works[0].id},'discuss','원문을 읽고 다른 가능성을 의논해줘.');
  const discussed=await finish(talk.id);assert.equal(discussed.operations.length,0);assert(discussed.answer.includes('생각했습니다'));
  const replay=await api(`sessions/${talk.sessionId}/messages`,'POST',{id:talk.id,message:talk.message,mode:talk.mode,provider:'gemini',web:false});assert.equal(replay.status,200);assert.equal((await pg.query('select * from public.agent_runs where id=$1',[talk.id])).rows.length,1);

  for(const provider of ['anthropic']){
    const task=await createTask({kind:'work',id:initial.works[0].id},'review',`${provider} 연결로 개요를 준비해줘.`,provider,'claude-opus-5-5'),run=await finish(task.id);assert.equal(run.operations.length,2);assert.equal(run.provider,provider);assert.equal(run.model,'claude-opus-5-5');assert(run.events.some(event=>event.title==='문서 읽기'));assert.equal((await api(`changes/${run.id}/discard`,'POST',{})).status,200);assert.equal((await api(`changes/${run.id}/apply`,'POST',{})).status,409);
  }

  const notes=await createTask({kind:'notes',id:'default'},'execute','노트에 개요를 만들고 정리해줘.');
  const executed=await finish(notes.id);assert(executed.applied_version);assert((await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload.notes.some(n=>n.id===executed.operations[0].id));
  const noteContext=await browser.newContext({viewport:{width:360,height:950}});noteContext.setDefaultNavigationTimeout(90000);
  await noteContext.addInitScript(({profile,token})=>localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user:profile})),{profile,token});
  page=await noteContext.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${base}/studio#notes/${executed.operations[0].id}`,{waitUntil:'networkidle'});await page.getByLabel('노트 본문',{exact:true}).waitFor();assert((await page.getByLabel('노트 본문',{exact:true}).innerText()).includes('달로 돌아온'));
  await openAgent();const noteDialog=page.getByRole('dialog',{name:'작업 대화',exact:true});await chooseOption(noteDialog.getByRole('combobox',{name:'작업 대화 선택'}),notes.sessionId);await noteDialog.locator('.agent-question').waitFor();await noteDialog.getByRole('button',{name:/^변경 /}).click();await noteDialog.getByRole('button',{name:'문서 열기',exact:true}).click();await page.getByLabel('노트 본문',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'사이드바 열기',exact:true}).count(),1);await openAgent();await page.getByRole('dialog',{name:'작업 대화',exact:true}).getByRole('button',{name:'대화',exact:true}).click();await page.getByRole('dialog',{name:'작업 대화',exact:true}).locator('.agent-question').waitFor();
  // Even a cancellation after the commit must leave undo available.
  await pg.query("update public.agent_runs set status='cancelled' where id=$1",[notes.id]);assert.equal((await api(`changes/${notes.id}/revert`,'POST',{})).status,200);await until(async()=>await page.getByLabel('노트 본문',{exact:true}).count()===0,'remote undo refreshes open note without realtime');await noteContext.close();
  const stale=await createTask({kind:'work',id:initial.works[0].id},'review','개요를 제안해줘.');await finish(stale.id);
  const current=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload;
  current.works[0].documents[0].title='작성자가 새로 고친 제목';await pg.query('update public.workspaces set payload=$1,version=version+1 where id=$2',[JSON.stringify(current),workspaceId]);
  assert.equal((await api(`changes/${stale.id}/apply`,'POST',{})).status,409);assert.equal((await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload.works[0].documents[0].title,'작성자가 새로 고친 제목');
  const cancelled=await createTask({kind:'work',id:initial.works[0].id},'execute','이 실행은 중단한다.');assert.equal((await api(`runs/${cancelled.id}/cancel`,'POST',{})).status,200);assert.equal((await pg.query('select status from public.agent_runs where id=$1',[cancelled.id])).rows[0].status,'cancelled');
  const exported=await api('export');assert.equal(exported.status,200);assert.equal(exported.data.format,'orbis-writing-agent');assert(exported.data.runs.some(r=>r.id===notes.id));assert(!JSON.stringify(exported.data).includes('synthetic-openai'));
  assert(modelCalls.some(call=>call.provider==='gemini'&&JSON.stringify(call.body.tools||[]).includes('googleSearch')),'native Google search tool is sent');
  results.push({flow:'discuss/execute/note-scope/idempotency/cancelled-undo/stale-source/export/auth/origin'});

  assert.equal(errors.length,0,errors.join('\n'));await writeFile(resolve(output,'report.json'),JSON.stringify({results,errors,modelCalls:modelCalls.length},null,2));
  console.log(JSON.stringify({cases:results.length,errors,modelCalls:modelCalls.length}));
}catch(error){console.error(JSON.stringify({errors,runs:(await pg.query('select id,status,error,events from public.agent_runs')).rows,models:modelCalls.length}));

if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});throw error;}
finally{await browser.close();

try{process.kill(-app.pid,'SIGTERM');}catch{}

mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));await pg.close();}
