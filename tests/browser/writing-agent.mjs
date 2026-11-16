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
import {uid,fromText,plainText,workspaceSchema} from '../../src/lib/model.ts';
import {addNote,newNote} from '../../src/lib/personal-notes.ts';
import {agentRunSchema,agentDiff} from '../../src/lib/writing-agent.ts';
import {PALETTES} from '../../src/lib/theme.ts';
import {chooseOption,readOptions,selectedValue} from './select.mjs';

const require=createRequire(import.meta.url),pw=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/cua/lib/node_modules/playwright-core');

const output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/writing-agent'),port=Number(process.env.KOSMOS_AGENT_TEST_PORT||3230),base=`http://127.0.0.1:${port}`,quick=process.env.KOSMOS_AGENT_QUICK==='1';

const mentionsOnly=process.env.KOSMOS_CHAT_MENTIONS_ONLY==='1',browserBase=process.env.KOSMOS_AGENT_BROWSER_URL||base;

assert(browserBase===base||mentionsOnly,'Remote browser checks must use the synthetic mention-only flow');

await mkdir(output,{recursive:true});

const pg=new PGlite(),profile={id:uid(),aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-11-09T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[]},enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`,workspaceId=uid();

let state=seedWorkspace();

state.works[0].documents[0].content=fromText('달의 관측소에는 아무도 없었다.');

const note={...newNote(),title:'관측 노트',content:fromText('관측은 새벽에 시작한다.')};

state=addNote(state,note);

const mentionA={...newNote(),title:'공통 자료',content:fromText('첫 번째 합성 참고 자료의 전문이다.')},mentionB={...newNote(),title:'공통 자료',content:fromText('두 번째 노트는 선택하지 않았다.')},longMention={...newNote(),title:'긴 제목 '+ '노트'.repeat(130),content:fromText('긴 제목의 합성 자료.')};

if(mentionsOnly)state=addNote(addNote(addNote(state,mentionA),mentionB,{parentId:note.id}),longMention);

const initial=structuredClone(state),errors=[],results=[],modelCalls=[],longModel='gemini-'+ 'x'.repeat(193);

await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table public.authors(user_id uuid primary key);create table public.workspaces(id uuid primary key,owner_id uuid not null,payload jsonb not null,version bigint not null default 1,updated_at timestamptz default now());create table public.workspace_revisions(id uuid default gen_random_uuid(),workspace_id uuid,owner_id uuid,payload jsonb,created_at timestamptz default now());`);

await pg.exec(await readFile('supabase/migrations/20261109135502_personal_writing_agent.sql','utf8'));

await pg.exec(await readFile('supabase/migrations/20261117040000_agent_wiki.sql','utf8'));

await pg.query('insert into public.authors values($1)',[profile.id]);

await pg.query('insert into public.workspaces(id,owner_id,payload) values($1,$2,$3)',[workspaceId,profile.id,JSON.stringify(state)]);

const jsonColumns=new Set(['payload','scope','snapshot','operations','events','usage','sources','source_roles','p_payload','p_event','p_operation']);

const objectValue=(key,value)=>jsonColumns.has(key)&&value!==null?JSON.stringify(value):value;

const tables=new Set(['authors','workspaces','workspace_revisions','agent_sessions','agent_runs','agent_memories','agent_wiki_pages','agent_wiki_scopes']);

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

      // 위키 정리 writes a page from a document of the work, finds it and reads it back.
      const asks=(google?body.contents:anthropic?body.messages:body.input)||[],lastAsk=[...asks].reverse().find(message=>message.role==='user'&&(google?message.parts?.some(part=>'text' in part):!Array.isArray(message.content)||message.content.some(part=>part.type==='text'||part.type==='input_text')));

      if(JSON.stringify(lastAsk||'').includes('위키 정리해줘')){const written=outputs.find(o=>o.data.saved&&o.data.id)?.data;
        item=[()=>tool('writeWiki',{id:null,title:'관측소',category:'place',content:'달 관측소는 비어 있다(원문).\n누가 비웠는지는 열린 질문이다.',sourceIds:[initial.works[0].documents[1].id]}),()=>tool('searchWiki',{query:'관측소',offset:0}),()=>tool('readWiki',{id:written?.id,offset:0,length:12000})][step]?.()||{type:'message',id:uid(),role:'assistant',status:'completed',content:[{type:'output_text',text:'위키에 관측소를 정리했습니다.',annotations:[]}]};
      }
      else if(step===0&&JSON.stringify(google?body.contents?.at(-1):body.messages?.at(-1)).includes('이 장면은 어디야'))item={type:'message',id:uid(),role:'assistant',status:'completed',content:[{type:'output_text',text:'열어 둔 문서를 확인했습니다.',annotations:[]}]};
      // Questions asked in the reference-panel chat are answered directly.
      else if(step===0&&/문서 질문|노트 질문|비교해줘/.test(JSON.stringify(google?body.contents?.at(-1):body.messages?.at(-1))))item={type:'message',id:uid(),role:'assistant',status:'completed',content:[{type:'output_text',text:'합성 문서 답변',annotations:[]}]};
      else if(step===0)item=tool('searchSources',{query:'',offset:0});
      else if(step===1)item=tool('readSource',{id:search.documents[0].id,offset:0,length:12000});
      else if(!names.has('stageChange'))item={type:'message',id:uid(),role:'assistant',status:'completed',content:[{type:'output_text',text:'원문을 읽었고 다른 전개를 함께 생각했습니다.',annotations:[]}]};
      else if(step===2)item=tool('stageChange',{type:'create',id:uid(),kind:'memo',title:'에이전트 개요',text:'달에 도착한 인물은 관측소를 찾는다.',parentId:null,sectionId:search.sections[0].id,beforeId:null});
      else if(step===3)item=tool('readSource',{id:created.id,offset:0,length:12000});
      else if(step===4)item=tool('stageChange',{type:'replace',id:created.id,quote:'달에 도착한',replacement:'달로 돌아온'});
      else if(step===5)item=tool('stageChange',{type:'insert',id:created.id,after:'관측소를 찾는다',text:'문은 열려 있었다.'});
      else if(step===6)item=tool('remember',{title:'열린 질문',content:'관측소가 비어 있는 이유를 다음에 검토한다.',sourceIds:[search.documents[0].id]});
      // After editing, the agent looks things up on the web and in the other works and note spaces it may only read.
      // It also follows links, fills in the new document's properties and checks the staged result with code.
      else if(step>=7&&step<7+(names.has('researchWeb')?7:6)){
        const library=outputs.find(o=>o.data.documents?.[0]?.readOnly)?.data,notesScope=systemOf({provider,body}).includes('노트 작업공간: ');
        const properties={type:'properties',id:created.id,summary:notesScope?null:'관측소를 찾는 장면',status:null,pov:null,storyTime:null,category:null,tags:notesScope?['개요']:null};
        const later=[...names.has('researchWeb')?[()=>tool('researchWeb',{query:'기억의 재구성 연구',url:null})]:[],()=>tool('searchLibrary',{query:'',offset:0}),()=>tool('readSource',{id:library.documents[0].id,offset:0,length:12000}),()=>tool('findReferences',{id:search.documents[0].id}),()=>tool('stageChange',properties),()=>tool('validateChanges',{}),()=>tool('inspectChanges',{})];
        item=later[step-7]();
      }
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
      if(['select','order','limit','offset','on_conflict','columns'].includes(key))continue;assert(/^[a-z_]+$/.test(key));

      if(raw==='is.null'){conditions.push(`${key} is null`);continue;}

      if(raw.startsWith('in.(')){const values=raw.slice(4,-1).split(',');conditions.push(`${key} in (${values.map(value=>{parameters.push(value);

return `$${parameters.length}`;}).join(',')})`);}
      else{const dot=raw.indexOf('.'),operator={eq:'=',neq:'<>',gt:'>'}[raw.slice(0,dot)];assert(operator,raw);parameters.push(raw.slice(dot+1));conditions.push(`${key}${operator}$${parameters.length}`);}
    }

    const where=conditions.length?` where ${conditions.join(' and ')}`:'',single=String(req.headers.accept).includes('vnd.pgrst.object');let rows;

    if(req.method==='POST'){
      // A branch copies its memories in one bulk insert.
      rows=[];

      for(const item of Array.isArray(body)?body:[body]){
        const keys=Object.keys(item);assert(keys.every(key=>/^[a-z_]+$/.test(key)));const prefer=String(req.headers.prefer),conflict=(url.searchParams.get('on_conflict')||'id').split(','),update=prefer.includes('merge-duplicates')?` on conflict(${conflict.join(',')}) do update set ${keys.filter(k=>!conflict.includes(k)).map(k=>`${k}=excluded.${k}`).join(',')}`:prefer.includes('ignore-duplicates')?` on conflict(${conflict.join(',')}) do nothing`:'';assert(conflict.every(key=>/^[a-z_]+$/.test(key)));
        rows.push(...(await pg.query(`insert into public.${name}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})${update} returning *`,keys.map(key=>objectValue(key,item[key])))).rows);
      }
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

const proxyUrl=browserBase!==base&&process.env.HTTPS_PROXY?new URL(process.env.HTTPS_PROXY):null;

const browser=await pw.chromium.launch({headless:true,...proxyUrl&&{proxy:{server:proxyUrl.origin,bypass:'127.0.0.1,localhost'}},executablePath:process.env.KOSMOS_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});

const systemOf=call=>call.provider==='gemini'?(call.body.systemInstruction?.parts||[]).map(part=>part.text).join(''):Array.isArray(call.body.system)?call.body.system.map(part=>part.text).join(''):String(call.body.system||'');

const until=async(check,label)=>{for(let i=0;i<240;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,250));}

assert.fail(label);};

let page;

/** Opens a work document and its reference-panel AI 대화. */
async function openPanel(doc){
  await page.getByRole('button',{name:/^사이드바 (열기|닫기)$/}).waitFor();
  const row=page.locator(`[data-navigation-row="${doc.id}"]`),panel=page.locator('.reference-panel.is-chat');

  if(!await row.isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
  await row.getByTitle(doc.title,{exact:true}).click();

  if(!await panel.isVisible())await page.getByRole('button',{name:'AI 대화',exact:true}).click();
  await panel.getByRole('textbox',{name:'AI에게 질문',exact:true}).waitFor();

  return panel;
}

async function checkModelMenu(control){
  const width=page.viewportSize().width,box=await control.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1,'model control fits viewport');
  await control.click();const menu=page.getByRole('listbox');await menu.waitFor();const layout=await menu.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,overflow:el.scrollWidth>el.clientWidth+1}));assert(layout.left>=0&&layout.right<=width+1&&!layout.overflow,JSON.stringify(layout));await page.keyboard.press('Escape');
}

/** The thinking control is the shared Select in an existing row: in every palette and mode it and its menu stay inside the screen. */
async function checkThinkingPalettes(control,view){
  const width=page.viewportSize().width,original=await page.evaluate(()=>({palette:document.documentElement.dataset.palette,theme:document.documentElement.dataset.theme}));

  for(const palette of PALETTES)for(const mode of ['light','dark']){
    await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});await checkModelMenu(control);

    const row=await control.evaluate(el=>{const parent=el.closest('.chat-provider,.note-ai-settings,.agent-settings');

return {overflow:parent.scrollWidth>parent.clientWidth+1,page:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};});

    assert(!row.overflow&&!row.page,JSON.stringify({view,width,palette,mode,row}));

    if(['cassette-light','cyber-dark'].includes(`${palette}-${mode}`))await page.screenshot({path:resolve(output,`thinking-${view}-${width}-${palette}-${mode}.png`)});
  }

  await page.evaluate(({palette,theme})=>{for(const [key,value] of [['palette',palette],['theme',theme]]){if(value===undefined)delete document.documentElement.dataset[key];else document.documentElement.dataset[key]=value;}},original);results.push({width,view:`thinking-${view}`,combinations:PALETTES.length*2});
}

async function prepareRemoteContext(context){
  if(browserBase===base)return;
  await context.routeWebSocket('**/realtime/**',socket=>socket.close());
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());

    if(url.hostname.endsWith('.supabase.co')){await route.fulfill({response:await route.fetch({url:mockUrl+url.pathname+url.search})});

return;}

    if(url.origin===new URL(browserBase).origin&&url.pathname.startsWith('/api/')){
      const headers={...await request.allHeaders(),origin:base,host:new URL(base).host};
      await route.fulfill({response:await route.fetch({url:base+url.pathname+url.search,headers})});

return;
    }

    assert(['GET','HEAD'].includes(request.method()),'Unexpected live mutation blocked');await route.continue();
  });
}

async function verifySourceMentions(panel,width,scope){
  console.log(JSON.stringify({flow:'mention-start',scope,width}));
  const input=panel.getByRole('textbox',{name:'AI에게 질문',exact:true}),chips=panel.locator('.chat-source-chips button');

  while(await chips.count())await chips.first().click();
  const beforeCalls=modelCalls.length;
  await input.fill('앞 문장 @공통 뒤 문장');

  for(let i=0;i<' 뒤 문장'.length;i++)await input.press('ArrowLeft');
  const list=page.getByRole('listbox',{name:'AI 참고 자료',exact:true});await list.waitFor();
  assert.equal(await list.getByRole('option').count(),2);
  const paths=await list.locator('small').allTextContents();assert.notEqual(paths[0],paths[1]);
  await input.press('ArrowDown');await input.press('ArrowUp');await input.press('ArrowDown');await input.press('Enter');
  assert.equal(await input.inputValue(),'앞 문장 @공통 자료 뒤 문장');
  assert(await input.evaluate(el=>el===document.activeElement&&el.selectionStart==='앞 문장 @공통 자료 '.length));
  assert.equal(await list.count(),0);assert.equal(modelCalls.length,beforeCalls);
  await input.pressSequentially('이어서 ');assert.equal(await input.inputValue(),'앞 문장 @공통 자료 이어서 뒤 문장');assert.equal(await list.count(),0);
  await input.pressSequentially('@새검색');await page.getByText('일치하는 자료가 없습니다.',{exact:true}).waitFor();

  for(let i=0;i<'@새검색'.length;i++)await input.press('ArrowLeft');
  assert.equal(await list.count(),0);
  // A chosen source shows as a chip above the input; the chip takes it out again.
  assert.equal(await chips.count(),1);assert((await chips.first().innerText()).startsWith('공통 자료'));await chips.first().click();assert.equal(await chips.count(),0);
  await input.fill('@공통');await list.getByRole('option').first().click();
  await input.fill('@공통');assert.equal(await list.getByLabel('선택됨').count(),1);await list.getByRole('option').first().click();
  assert.equal(await chips.count(),1);
  await input.fill('name@example.com');assert.equal(await list.count(),0);
  await input.fill('@없는자료 같은 표기는 어떻게 써?');await page.getByText('일치하는 자료가 없습니다.',{exact:true}).waitFor({state:'detached'});assert.equal(await list.count(),0,'an ordinary @ in a sentence does not keep the source search open');
  await input.fill('@없는자료');await page.getByText('일치하는 자료가 없습니다.',{exact:true}).waitFor();assert.equal(await list.getByRole('option').count(),0);await input.press('Enter');assert.equal(modelCalls.length,beforeCalls);await input.press('Escape');assert(await panel.isVisible());
  await input.fill('@공통');await list.waitFor();await input.dispatchEvent('compositionstart',{data:'ㄱ'});assert.equal(await list.count(),0);await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(modelCalls.length,beforeCalls);await input.dispatchEvent('compositionend',{data:'공통'});await list.waitFor();await input.press('Escape');
  await input.fill('');await input.fill('@공통');await list.waitFor();await input.press('Tab');assert.equal(await list.count(),0);assert(await panel.getByRole('button',{name:'질문 보내기',exact:true}).evaluate(el=>el===document.activeElement));
  await input.fill('@긴 제목');await list.waitFor();

  for(const palette of quick?PALETTES.slice(0,1):PALETTES)for(const mode of ['light','dark']){
    await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});

    const layout=await page.getByRole('dialog',{name:'AI 참고 자료 검색',exact:true}).evaluate(el=>{const box=el.getBoundingClientRect(),row=el.querySelector('[role=option]'),style=getComputedStyle(row),title=getComputedStyle(row.querySelector('strong'));

return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,overflow:el.scrollWidth>el.clientWidth+1,padding:style.paddingTop,ellipsis:title.textOverflow,nowrap:title.whiteSpace};});

    assert(layout.left>=0&&layout.right<=width+1&&layout.top>=0&&layout.bottom<=950&&!layout.overflow,JSON.stringify({width,palette,mode,layout}));assert.equal(layout.padding,'4px');assert.equal(layout.ellipsis,'ellipsis');assert.equal(layout.nowrap,'nowrap');
    await page.screenshot({path:resolve(output,`ai-mention-${scope}-${width}-${palette}-${mode}.png`)});results.push({view:'ai-source-mention',scope,width,palette,mode,layout});
  }

  await input.press('Escape');await input.fill('줄바꿈');await input.press('Shift+Enter');assert.equal(await input.inputValue(),'줄바꿈\n');assert.equal(modelCalls.length,beforeCalls);await input.fill('선택한 @공통 자료를 비교해줘.');await page.getByText('일치하는 자료가 없습니다.',{exact:true}).waitFor({state:'detached'});assert.equal(await list.count(),0,'a finished sentence closes the source search by itself');
  const previous=await panel.locator('.chat-message.assistant').count(),request=page.waitForRequest(r=>r.url().includes('/api/agent/sessions/')&&r.url().endsWith('/messages')&&r.method()==='POST');
  await panel.getByRole('button',{name:'질문 보내기',exact:true}).click();assert.deepEqual((await request).postDataJSON().sourceIds,[mentionA.id]);
  await until(async()=>await panel.locator('.chat-message.assistant').count()===previous+1&&await panelAnswer(panel).count()>0,'mention reference answer');assert.equal(await chips.count(),0,'the pointed sources go with the request');
  // The agent is told which sources were pointed at and reads them itself.
  const sent=systemOf(modelCalls.findLast(call=>JSON.stringify(call.body).includes('비교해줘')));const pointedLine=sent.split('\n').find(line=>line.includes('@로 가리킨 자료'))||'';assert(pointedLine.includes(mentionA.id),pointedLine);assert(!pointedLine.includes(mentionB.id),'only the chosen one of two same-titled sources is pointed');
  results.push({flow:'ai-source-mention-keyboard/pointer/caret/chip/dedup/email/IME/escape/send',scope,width});console.log(JSON.stringify({flow:'mention-complete',scope,width}));
}

/** The answer of the latest run in the panel: its own paragraph, not the work log's details. */
const panelAnswer=panel=>panel.locator('.chat-message.assistant').last().locator(':scope > p:not(.chat-working)').first();

async function askPanel(panel,question){
  const response=page.waitForResponse(r=>r.url().includes('/api/agent/sessions/')&&r.url().endsWith('/messages')&&r.request().method()==='POST');
  await panel.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill(question);await panel.getByRole('button',{name:'질문 보내기',exact:true}).click();const answered=await response,body=answered.request().postDataJSON();assert.equal(answered.status(),202,`${question}: ${await answered.text()}`);
  // The exchange for this question is the last one and has its own answer, whatever was loaded before.
  await until(async()=>(await panel.locator('.agent-exchange').last().locator('.chat-message.user p').innerText().catch(()=>''))===question&&await panelAnswer(panel).count()>0,`panel answer: ${question}`);

  return body;
}

async function verifySharedAI(width){
  await page.getByRole('button',{name:/^사이드바 (열기|닫기)$/}).waitFor();
  const doc=initial.works[0].documents[0],row=page.locator(`[data-navigation-row="${doc.id}"]`);

  if(!await row.isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
  await row.getByTitle(doc.title,{exact:true}).click();
  await page.getByRole('button',{name:'AI 대화',exact:true}).click();
  // The reference-panel chat is the writing agent: no separate source or web switches, and the open document is its focus.
  const panel=page.locator('.reference-panel.is-chat');await panel.getByRole('textbox',{name:'AI에게 질문',exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:/웹 조사|참고 자료 선택/}).count(),0);assert.equal(await panel.locator('.chat-heading strong').innerText(),doc.title);

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

    await settings.getByRole('button',{name:'닫기',exact:true}).click();await chooseOption(panel.getByRole('combobox',{name:'에이전트 제공자',exact:true}),provider);
    const modelControl=panel.getByRole('combobox',{name:'에이전트 모델',exact:true});

    if(provider==='gemini'){await chooseOption(modelControl,longModel);await checkModelMenu(modelControl);}

    const chosenModel=provider==='gemini'?'gemini-fast':'claude-opus-5-5';await chooseOption(modelControl,chosenModel);
    // The thinking level sits under the model, offers what the model supports, and is sent with every agent step.
    const thinking=panel.getByRole('combobox',{name:'에이전트 생각 단계',exact:true}),level=provider==='gemini'?'high':'medium',labels=(await readOptions(thinking)).map(option=>option.label);

    if(provider==='gemini')assert.deepEqual(labels,['생각 · 자동','생각 · 낮음','생각 · 중간','생각 · 높음']);else assert(labels.includes('생각 · 최대'),'the agent offers Claude its full range');
    await chooseOption(thinking,level);assert.equal(await selectedValue(thinking),level);
    const body=await askPanel(panel,`${provider} 문서 질문`);assert.equal(body.focusId,doc.id,'the open document is the request focus');assert.equal(body.provider,provider);
    assert.equal(await panelAnswer(panel).innerText(),'합성 문서 답변');assert.equal(await panel.locator('.chat-message.assistant').last().locator('header small').innerText(),chosenModel);
    const call=modelCalls.findLast(c=>JSON.stringify(c.body).includes(`${provider} 문서 질문`));assert.equal(call.model,chosenModel);
    // The open document's text is in the instructions, so "이 장면" needs no extra step.
    assert(systemOf(call).includes(`작가가 지금 열어 둔 문서: "${doc.title}" (id ${doc.id})`));assert(systemOf(call).includes(JSON.stringify(plainText(doc.content)).slice(1,21)),'the open document text is in the instructions');

    if(provider==='gemini'){assert.equal(call.body.generationConfig.thinkingConfig.thinkingLevel,'high');await page.screenshot({path:resolve(output,`thinking-chat-${width}.png`)});await checkThinkingPalettes(thinking,'chat');}
    else{assert.equal(call.body.thinking.type,'adaptive');assert.equal(call.body.output_config.effort,'medium');}

    if(provider==='anthropic'){
      await panel.getByRole('button',{name:'AI 설정',exact:true}).click();const settings=page.getByRole('dialog',{name:'AI 설정',exact:true});
      assert.equal(await settings.getByRole('combobox',{name:'설정할 AI 모델',exact:true}).getAttribute('data-value'),'claude-selected@20260101');
      await settings.getByRole('button',{name:'기본 모델 사용',exact:true}).click();await settings.getByText('기본 모델로 돌아갔습니다.',{exact:true}).waitFor();assert.equal(await settings.getByRole('combobox',{name:'설정할 AI 모델',exact:true}).getAttribute('data-value'),vertexTestEnvironment.VERTEX_CLAUDE_MODEL);await settings.getByRole('button',{name:'닫기',exact:true}).click();
    }
  }

  // Two questions in the panel are one session: the second run follows the first.
  let exchanges=await panel.locator('.agent-exchange').count();assert(exchanges>=2);const lastTwo=(await pg.query('select session_id from public.agent_runs order by created_at desc limit 2')).rows;assert.equal(lastTwo[0].session_id,lastTwo[1].session_id);await panel.locator('.chat-message.assistant').last().locator('summary').click();assert((await panel.locator('.chat-message.assistant').last().locator('li strong').allInnerTexts()).includes('열어 둔 문서'));

  if(mentionsOnly){await verifySourceMentions(panel,width,'work');exchanges=await panel.locator('.agent-exchange').count();}

  await panel.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();
  await page.locator('.ProseMirror').first().locator('p').first().click();await page.keyboard.press('Alt+Enter');
  await chooseOption(page.getByRole('combobox',{name:'AI 질문 제공자',exact:true}),'gemini');await chooseOption(page.getByRole('combobox',{name:'AI 질문 모델',exact:true}),longModel);await checkModelMenu(page.getByRole('combobox',{name:'AI 질문 모델',exact:true}));await chooseOption(page.getByRole('combobox',{name:'AI 질문 모델',exact:true}),'gemini-fast');
  // The level chosen in the chat panel is the same device preference here; changing it here changes the next request.
  const cursorThinking=page.getByRole('combobox',{name:'AI 질문 생각 단계',exact:true});assert.equal(await selectedValue(cursorThinking),'high');await chooseOption(cursorThinking,'low');await page.screenshot({path:resolve(output,`thinking-cursor-${width}.png`)});await checkThinkingPalettes(cursorThinking,'cursor');
  const cursorBox=await page.locator('.note-ai-settings').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,right:el.getBoundingClientRect().right}));assert(!cursorBox.overflow&&cursorBox.right<=width+1,JSON.stringify(cursorBox));
  await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill('현재 문단 질문');await page.getByRole('button',{name:'AI 질문 보내기',exact:true}).click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'적용할 AI 답변'}).inputValue(),'합성 문서 답변');assert.equal(modelCalls.at(-1).model,'gemini-fast');assert.deepEqual(modelCalls.at(-1).body.generationConfig.thinkingConfig,{thinkingLevel:'low'});
  // "AI 대화에서 계속" opens the panel with the quick exchange shown, and the next request carries it to the agent once.
  await page.getByRole('button',{name:'AI 대화에서 계속',exact:true}).click();const legacy=panel.locator('.agent-legacy');await legacy.waitFor();await until(async()=>await panel.locator('.agent-exchange').count()===exchanges,'the same session reloads in the reopened panel');assert(await legacy.evaluate(el=>el.open));assert((await legacy.innerText()).includes('현재 문단 질문'));
  const continued=await askPanel(panel,'gemini 문서 질문 이어서');assert.deepEqual(continued.previous.map(m=>m.text),['현재 문단 질문','합성 문서 답변']);assert(systemOf(modelCalls.findLast(c=>JSON.stringify(c.body).includes('문서 질문 이어서'))).includes('이어지는 대화'));await until(async()=>!await legacy.evaluate(el=>el.open),'carried exchanges fold away');
  const again=await askPanel(panel,'gemini 문서 질문 한 번 더');assert.equal(again.previous,undefined,'a carried exchange is sent once');
  await page.screenshot({path:resolve(output,`panel-chat-${width}.png`)});await checkPanelPalettes(panel,'work');
  await panel.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();
  await page.goto(`${browserBase}/studio#notes/${note.id}`,{waitUntil:'networkidle'});await page.getByRole('button',{name:'AI 대화',exact:true}).click();
  const notePanel=page.locator('.reference-panel.is-chat');await notePanel.getByRole('textbox',{name:'AI에게 질문',exact:true}).waitFor();
  // A note space has its own sessions; the work's conversation is not shown here.
  await until(async()=>await notePanel.locator('.chat-starters button').count()===5||await notePanel.locator('.agent-exchange').count()>0,'note panel loads');assert(!(await notePanel.locator('.chat-log').innerText()).includes('문서 질문'),'the work session is not in the note panel');
  // After a reload the level saved for this provider is still chosen; 자동 sends no thinking setting.
  const noteThinking=notePanel.getByRole('combobox',{name:'에이전트 생각 단계',exact:true});await until(async()=>await selectedValue(noteThinking)==='low','saved thinking level returns after reload');await chooseOption(noteThinking,'auto');
  const noteBody=await askPanel(notePanel,'노트 질문');assert.equal(noteBody.focusId,note.id);const noteCall=modelCalls.findLast(c=>JSON.stringify(c.body).includes('노트 질문'));assert.equal(noteCall.provider,'gemini');assert.equal(noteCall.body.generationConfig?.thinkingConfig,undefined);assert(systemOf(noteCall).includes('노트 작업공간: '));

  if(mentionsOnly)await verifySourceMentions(notePanel,width,'note');
  await notePanel.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();await page.locator('.ProseMirror').first().locator('p').first().click();await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill('노트 현재 문단 질문');await page.getByRole('button',{name:'AI 질문 보내기',exact:true}).click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();await page.keyboard.press('Escape');
  await page.goto(`${browserBase}/studio`,{waitUntil:'networkidle'});

}

/** The panel is built from the reference panel's existing parts: in every palette and mode it fits the screen without a sideways scroll. */
async function checkPanelPalettes(panel,scope){
  const width=page.viewportSize().width,original=await page.evaluate(()=>({palette:document.documentElement.dataset.palette,theme:document.documentElement.dataset.theme}));

  for(const palette of PALETTES)for(const mode of ['light','dark']){
    await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});

    const layout=await panel.evaluate(el=>{const box=el.getBoundingClientRect(),inside=[...el.querySelectorAll('.chat-provider,.chat-heading,.chat-composer,.agent-panel-views,.chat-message')].flatMap(child=>{const b=child.getBoundingClientRect();

return b.width>0&&(b.left<box.left-1||b.right>box.right+1||child.scrollWidth>child.clientWidth+1)?[child.className]:[];});

return {left:box.left,right:box.right,inside,page:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};});

    assert(layout.left>=0&&layout.right<=width+1&&!layout.inside.length&&!layout.page,JSON.stringify({scope,width,palette,mode,layout}));

    if(['violet-light','cassette-light','cyber-dark'].includes(`${palette}-${mode}`))await page.screenshot({path:resolve(output,`panel-${scope}-${width}-${palette}-${mode}.png`)});
  }

  await page.evaluate(({palette,theme})=>{for(const [key,value] of [['palette',palette],['theme',theme]]){if(value===undefined)delete document.documentElement.dataset[key];else document.documentElement.dataset[key]=value;}},original);results.push({width,view:`panel-${scope}`,combinations:PALETTES.length*2});
}

try{
  await until(async()=>{try{return (await fetch(base)).ok;}catch{return false;}},'Next server starts');

  for(const width of process.env.KOSMOS_AGENT_INTERACTIONS_ONLY==='1'?[1280]:[1280,360]){
    const context=await browser.newContext({viewport:{width,height:950}});context.setDefaultNavigationTimeout(90000);
    await context.addInitScript(({profile,token,key})=>{if(window!==window.top)return;localStorage.setItem(key,JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));},{profile,token,key:browserBase===base?'sb-127-auth-token':'sb-krakjollsufgnwealroh-auth-token'});
    await prepareRemoteContext(context);
    page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${browserBase}/studio`,{waitUntil:'networkidle'});
    await verifySharedAI(width);

    if(mentionsOnly){await context.close();continue;}

    // The whole agent flow runs in the reference-panel AI 대화; there is no separate 작업 대화 window.
    assert.equal(await page.getByRole('button',{name:'작업 대화',exact:true}).count(),0,'the sidebar has no separate agent window');
    const panel=await openPanel(initial.works[0].documents[0]),input=panel.getByRole('textbox',{name:'AI에게 질문',exact:true}),changesView=panel.getByRole('button',{name:/^변경 \d+$/});
    await panel.getByRole('button',{name:'새 대화',exact:true}).click();await chooseOption(panel.getByRole('combobox',{name:'에이전트 실행 방식'}),'review');await chooseOption(panel.getByRole('combobox',{name:'에이전트 제공자'}),'gemini');await chooseOption(panel.getByRole('combobox',{name:'에이전트 모델'}),longModel);await checkModelMenu(panel.getByRole('combobox',{name:'에이전트 모델'}));await chooseOption(panel.getByRole('combobox',{name:'에이전트 모델'}),'gemini-selected');
    const agentThinking=panel.getByRole('combobox',{name:'에이전트 생각 단계',exact:true});assert.equal(await selectedValue(agentThinking),'auto','the agent starts from the level last saved for this provider, 자동 from the note chat');assert.deepEqual((await readOptions(agentThinking)).map(option=>option.label),['생각 · 자동','생각 · 낮음','생각 · 중간','생각 · 높음']);await chooseOption(agentThinking,'medium');
    const settingsBox=await panel.locator('.agent-panel-settings').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,right:el.getBoundingClientRect().right}));assert(!settingsBox.overflow&&settingsBox.right<=width+1,JSON.stringify(settingsBox));await page.screenshot({path:resolve(output,`thinking-agent-${width}.png`)});await checkThinkingPalettes(agentThinking,'agent');
    await input.fill('개요를 만들고 열린 질문을 기억해줘.');await panel.getByRole('button',{name:'질문 보내기',exact:true}).click();await until(async()=>await input.isEnabled()&&await input.evaluate(el=>el===document.activeElement),'accepted request returns focus to the input');
    await until(async()=>await panel.getByRole('button',{name:'중단',exact:true}).isVisible()||(await pg.query("select * from public.agent_runs where status='completed' and message=$1",['개요를 만들고 열린 질문을 기억해줘.'])).rows.length>0,'running task visible');

    if(await panel.getByRole('button',{name:'중단',exact:true}).isVisible()){
      assert(await panel.getByRole('combobox',{name:'에이전트 실행 방식'}).isDisabled());assert(await panel.getByRole('combobox',{name:'에이전트 제공자'}).isDisabled());assert(await panel.getByRole('combobox',{name:'에이전트 모델'}).isDisabled());assert(await agentThinking.isDisabled());assert.equal(await selectedValue(agentThinking),'medium');
    }

    await until(async()=>{const rows=await pg.query("select * from public.agent_runs order by created_at desc limit 1");const row=rows.rows[0];

if(row?.status==='failed')assert.fail(row.error);

return row?.status==='completed'&&!row.reverted;},'durable agent finishes');
    const run=agentRunSchema.parse(JSON.parse(JSON.stringify((await pg.query('select * from public.agent_runs order by created_at desc limit 1')).rows[0])));assert.equal(run.error,'');assert.equal(run.model,'gemini-selected');assert.equal(run.operations.length,4);assert.equal(run.events.find(event=>event.title==='문장 수정')?.detail,'에이전트 개요','a sentence edit names its document, not an ID');assert.equal(run.events.find(event=>event.title==='이어 쓰기')?.detail,'에이전트 개요');
    const firstSystem=systemOf(modelCalls.findLast(call=>JSON.stringify(call.body).includes('개요를 만들고 열린 질문을 기억해줘.')));
    // Every step of the run carries the level it was sent with, and the run keeps it in its log without counting it as work.
    const steps=modelCalls.filter(call=>JSON.stringify(call.body).includes('개요를 만들고 열린 질문을 기억해줘.'));assert(steps.length>3);assert(steps.every(call=>call.body.generationConfig?.thinkingConfig?.thinkingLevel==='medium'),'each agent step is sent at the chosen level');
    assert.deepEqual(run.events.find(event=>event.id==='reasoning-medium'),{id:'reasoning-medium',title:'생각 단계',detail:'중간'});const worked=`완료 · 작업 ${run.events.filter(event=>!['focus','previous','pointed','reasoning-medium'].includes(event.id)).length}개`;assert(run.usage&&run.usage.input>0,'the provider-reported tokens are kept with the run');await until(async()=>await panel.locator('.chat-message.assistant').last().locator('summary').innerText()===`${worked} · 토큰 ${(run.usage.input+run.usage.output).toLocaleString('ko-KR')}`,'the work count leaves out the open document, carried AI 대화 and the thinking level, and the run shows its tokens');

    for(const part of ['현재 실행 방식: 검토하며 실행','작가가 따로 말하지 않아도 researchWeb으로 조사','searchLibrary로 찾아 readSource로 읽는다',`- 노트 `,'창작 파트너','상상력과 문학성이 최우선',`작품: ${initial.works[0].title}`,`id ${initial.works[0].documents[0].id}`])assert(firstSystem.includes(part),`agent instructions carry: ${part}`);assert.equal(run.events.some(event=>event.title==='Google 웹 조사'),true);assert(run.events.some(event=>event.title==='다른 작품·노트 검색'));assert.match(run.events.find(event=>event.title==='다른 자료 읽기')?.detail||'',/^(작품|노트) .+ · .+$/,'the work log says where a read-only source lives');assert.equal(run.operations.length,4,'reading another space stages nothing');assert.equal(run.operations[3].type,'properties');assert(run.events.some(event=>event.title==='연결 찾기'));assert.equal(run.events.find(event=>event.title==='변경 점검')?.detail,'문서 1개 · 문제 없음');assert.equal(run.events.find(event=>event.title==='속성 변경')?.detail,'에이전트 개요');assert.equal(run.applied_version,null);
    await changesView.click();await panel.getByText('달로 돌아온 인물은 관측소를 찾는다.').waitFor();assert.equal(await panel.locator('.agent-diff pre').last().innerText(),'달로 돌아온 인물은 관측소를 찾는다.\n\n문은 열려 있었다.','the continued paragraph is staged after the quoted one');assert.deepEqual(await panel.locator('.agent-properties div').allInnerTexts(),['요약\n없음 → 관측소를 찾는 장면'],'the new summary shows beside the text change');
    // The structure list says where the new document goes; the summary counts it.
    const placed=panel.locator('.agent-structure li').filter({hasText:'에이전트 개요'});assert.equal(await placed.count(),1);assert.match(await placed.innerText(),/새로 만듦[\s\S]*\S/);assert.match(await panel.locator('.agent-change-actions>span').innerText(),/구조 변경 1개$/);await page.screenshot({path:resolve(output,`changes-${width}.png`)});
    const before=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload;assert(!before.works[0].documents.some(doc=>doc.id===run.operations[0].id));
    // Another device saved an edit to a different document after the run read the work; the change applies beside it.
    const elsewhere=initial.works[0].documents[1].id,editElsewhere=async text=>{const row=(await pg.query('select payload,version from public.workspaces where id=$1',[workspaceId])).rows[0],payload=structuredClone(row.payload);payload.works[0].documents.find(doc=>doc.id===elsewhere).content=fromText(text);state=workspaceSchema.parse(payload);await pg.query('update public.workspaces set payload=$1,version=version+1 where id=$2',[JSON.stringify(state),workspaceId]);};

    const elsewhereText=async()=>plainText((await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload.works[0].documents.find(doc=>doc.id===elsewhere).content);

    if(width===1280)await editElsewhere('다른 기기에서 적용 전에 쓴 문장.');
    await panel.getByRole('button',{name:'변경 적용',exact:true}).click();await until(async()=>{const row=(await pg.query('select applied_version from public.agent_runs where id=$1',[run.id])).rows[0];

return row.applied_version!==null;},'review changes apply');
    await panel.getByRole('button',{name:'되돌리기',exact:true}).waitFor();

    if(width===1280){const after=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload;assert(after.works[0].documents.some(doc=>doc.id===run.operations[0].id),'the change is applied');assert.equal(await elsewhereText(),'다른 기기에서 적용 전에 쓴 문장.','an edit to another document made after the run survives the apply');}

    await panel.getByRole('button',{name:'문서 열기',exact:true}).click();
    await writeFile(resolve(output,'after-source-open.txt'),await page.locator('body').innerText());await page.screenshot({path:resolve(output,'after-source-open.png')});
    // The panel opens a source of this work beside the open document, so the conversation stays in view.
    const opened=page.locator('.ProseMirror').filter({hasText:'달로 돌아온'});await opened.waitFor();assert.deepEqual(await opened.locator('p').allInnerTexts(),['달로 돌아온 인물은 관측소를 찾는다.','문은 열려 있었다.'],'applied document opens in an actual editor');assert(await panel.isVisible());
    await openPanel({id:run.operations[0].id,title:'에이전트 개요'});
    // The newly opened document is the panel's focus; it reaches the model and the work log and is not counted as a step.
    await panel.getByRole('button',{name:'대화',exact:true}).click();await until(async()=>await panel.locator('.chat-heading strong').innerText()==='에이전트 개요','the panel follows the opened document');
    await input.fill('이 장면은 어디야?');const focused=page.waitForRequest(request=>request.url().endsWith('/messages')&&request.method()==='POST');await panel.getByRole('button',{name:'질문 보내기',exact:true}).click();assert.equal((await focused).postDataJSON().focusId,run.operations[0].id);
    await panel.locator('.chat-message.assistant').filter({hasText:'열어 둔 문서를 확인했습니다.'}).waitFor();
    const focusSystem=systemOf(modelCalls.findLast(call=>JSON.stringify(call.body).includes('이 장면은 어디야')));assert(focusSystem.includes(`작가가 지금 열어 둔 문서: "에이전트 개요" (id ${run.operations[0].id})`),'the open document is named to the model');assert(focusSystem.includes(`- 에이전트 개요 · memo · ${'달로 돌아온 인물은 관측소를 찾는다.\n\n문은 열려 있었다.'.length}자 · id ${run.operations[0].id}`),'the applied document is on the map');
    const focusTurn=panel.locator('.chat-message.assistant').last();assert.match(await focusTurn.locator('summary').innerText(),/^완료 · 토큰 [\d,]+$/);assert.match(await panel.locator('.agent-usage').innerText(),/^이 대화 · 토큰 [\d,]+$/,'the conversation total shows once there are two runs');await focusTurn.locator('summary').click();assert.deepEqual(await focusTurn.locator('li strong').allInnerTexts(),['열어 둔 문서','생각 단계']);assert.equal(await focusTurn.locator('li p').innerText(),'중간');await focusTurn.getByRole('button',{name:'에이전트 개요',exact:true}).waitFor();await page.screenshot({path:resolve(output,`open-document-${width}.png`)});
    await panel.getByRole('button',{name:'기억',exact:true}).click();await panel.getByText('관측소가 비어 있는 이유를 다음에 검토한다.',{exact:true}).waitFor();
    // Editing a memory changes what the next run reads; the sources stay.
    await panel.getByRole('button',{name:'고치기',exact:true}).click();const memoryText=panel.getByRole('textbox',{name:'기억 내용',exact:true});assert(await panel.getByRole('textbox',{name:'기억 제목',exact:true}).evaluate(el=>el===document.activeElement));await memoryText.fill('관측소가 비어 있는 이유는 3장에서 밝힌다.');await panel.getByRole('button',{name:'저장',exact:true}).click();await memoryText.waitFor({state:'detached'});await panel.locator('.agent-memories p').filter({hasText:'관측소가 비어 있는 이유는 3장에서 밝힌다.'}).waitFor();
    const edited=(await pg.query('select content,sources from public.agent_memories where session_id=$1',[run.session_id])).rows;assert.equal(edited.length,1);assert.equal(edited[0].content,'관측소가 비어 있는 이유는 3장에서 밝힌다.');assert(edited[0].sources.length>0,'editing keeps the sources');
    await panel.getByRole('button',{name:'잊기',exact:true}).click();await until(async()=>(await pg.query('select * from public.agent_memories where session_id=$1',[run.session_id])).rows.length===0,'forget memory');

    if(width===1280)await editElsewhere('다른 기기에서 적용 뒤에 쓴 문장.');
    await changesView.click();await panel.getByRole('button',{name:'되돌리기',exact:true}).click();await until(async()=>(await pg.query('select reverted from public.agent_runs where id=$1',[run.id])).rows[0].reverted,'undo batch');

    if(width===1280){const after=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload;assert(!after.works[0].documents.some(doc=>doc.id===run.operations[0].id),'the undo takes the created document back');assert.equal(await elsewhereText(),'다른 기기에서 적용 뒤에 쓴 문장.','an edit to another document made after the apply survives the undo');}

    await panel.getByRole('button',{name:'대화',exact:true}).click();

    for(const palette of quick?PALETTES.slice(0,1):PALETTES){for(const mode of ['light','dark']){
      await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});

      for(const [name,view] of [['chat',panel.getByRole('button',{name:'대화',exact:true})],['changes',changesView],['memory',panel.getByRole('button',{name:'기억',exact:true})]]){
        await view.click();

const layout=await panel.evaluate(el=>{const box=el.getBoundingClientRect();

return {left:box.left,right:box.right,overflow:el.scrollWidth>el.clientWidth+1,page:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};});

assert(layout.left>=0&&layout.right<=width+1&&!layout.overflow&&!layout.page,JSON.stringify({width,palette,mode,name,layout}));

        results.push({width,palette,mode,view:name});
      }

      await panel.getByRole('combobox',{name:'에이전트 실행 방식'}).click();
      const menu=page.getByRole('listbox'),menuBox=await menu.boundingBox();assert(menuBox&&menuBox.x>=0&&menuBox.x+menuBox.width<=width+1);await page.keyboard.press('Escape');

      if(['violet','cyber','orbit'].includes(palette))await page.screenshot({path:resolve(output,`${width}-${palette}.png`)});
    }}

    await panel.getByRole('button',{name:'대화',exact:true}).click();
    // A branch starts a new conversation in the same scope from the chosen request; deleting it removes its rows and leaves the source.
    await panel.locator('.agent-exchange').first().getByRole('button',{name:'여기서 분기',exact:true}).click();const sessionSelect=panel.getByRole('combobox',{name:'작업 대화 선택'});await until(async()=>await selectedValue(sessionSelect)!==run.session_id&&await selectedValue(sessionSelect)!=='','the branch becomes the chosen conversation');
    const branchId=await selectedValue(sessionSelect),branchRow=(await pg.query('select * from public.agent_sessions where id=$1',[branchId])).rows[0];assert.equal(branchRow.title.endsWith(' · 분기'),true);assert.deepEqual(branchRow.scope,{kind:'work',id:initial.works[0].id});assert.equal(await panel.locator('.agent-exchange').count(),0);
    const carried=(await pg.query('select title,content from public.agent_memories where session_id=$1',[branchId])).rows;assert.equal(carried.length,1);assert.match(carried[0].title,/^분기 전 대화: /);assert(carried[0].content.includes('작가: 개요를 만들고 열린 질문을 기억해줘.')&&!carried[0].content.includes('이 장면은 어디야'),'only the conversation up to the chosen request is carried');
    await panel.getByRole('button',{name:'기억',exact:true}).click();await panel.getByText(carried[0].title,{exact:true}).waitFor();await panel.getByRole('button',{name:'대화',exact:true}).click();
    await panel.getByRole('button',{name:'대화 삭제',exact:true}).click();const confirm=page.getByRole('dialog',{name:'대화 삭제'});await confirm.getByText(`‘${branchRow.title}’ 대화를 삭제할까요?`).waitFor();await confirm.getByRole('button',{name:'삭제',exact:true}).click();await confirm.waitFor({state:'hidden'});await until(async()=>await input.evaluate(el=>el===document.activeElement),'focus returns to the input after deleting');
    await until(async()=>(await pg.query('select id from public.agent_sessions where id=$1',[branchId])).rows.length===0,'the branch is deleted');assert.equal((await pg.query('select id from public.agent_memories where session_id=$1',[branchId])).rows.length,0);assert.equal((await pg.query('select id from public.agent_sessions where id=$1',[run.session_id])).rows.length,1);assert.equal(await selectedValue(sessionSelect),'');assert(!(await readOptions(sessionSelect)).some(option=>option.value===branchId));
    await chooseOption(sessionSelect,run.session_id);await panel.locator('.agent-exchange').first().waitFor();
    await panel.getByRole('button',{name:'새 대화',exact:true}).click();assert.equal(await panel.locator('.agent-exchange').count(),0);assert(await input.evaluate(el=>el===document.activeElement));await chooseOption(panel.getByRole('combobox',{name:'작업 대화 선택'}),run.session_id);await panel.locator('.agent-exchange').first().waitFor();
    // 위키: the open document's role reaches the next run; the agent writes a page from a source it read, and the panel lists it.
    const wikiSource=initial.works[0].documents[1],wikiKey=`work:${initial.works[0].id}`;

    // After the undo took the opened document away the editor falls back to the first one; the panel follows it.
    if(await panel.locator('.chat-heading strong').innerText()!==initial.works[0].documents[0].title)await openPanel(initial.works[0].documents[0]);
    await panel.getByRole('button',{name:'위키',exact:true}).click();const roleSelect=panel.getByRole('combobox',{name:'자료 역할',exact:true});await roleSelect.waitFor();await chooseOption(roleSelect,'canon');
    await until(async()=>(await pg.query('select source_roles from public.agent_wiki_scopes where owner_id=$1 and scope_key=$2',[profile.id,wikiKey])).rows[0]?.source_roles?.[initial.works[0].documents[0].id]==='canon','the role is saved in the work wiki scope');
    const pagesBefore=(await pg.query('select id from public.agent_wiki_pages')).rows.map(row=>row.id);
    await panel.getByRole('button',{name:'대화',exact:true}).click();await input.fill('위키 정리해줘.');await panel.getByRole('button',{name:'질문 보내기',exact:true}).click();await panel.locator('.chat-message.assistant').filter({hasText:'위키에 관측소를 정리했습니다.'}).waitFor();
    const wikiRow=(await pg.query('select * from public.agent_wiki_pages order by created_at desc limit 1')).rows[0];assert(!pagesBefore.includes(wikiRow.id));assert.equal(wikiRow.scope_key,wikiKey);assert.equal(wikiRow.category,'place');assert.equal(wikiRow.owner_id,profile.id);assert.deepEqual(wikiRow.sources.map(source=>source.id),[wikiSource.id]);
    const wikiRun=(await pg.query("select events from public.agent_runs where message='위키 정리해줘.' order by created_at desc limit 1")).rows[0];assert.deepEqual(wikiRun.events.filter(event=>event.title.startsWith('위키')).map(event=>event.title),['위키 정리','위키 검색','위키 읽기']);
    const wikiSystem=systemOf(modelCalls.findLast(call=>JSON.stringify(call.body).includes('위키 정리해줘')));assert(wikiSystem.includes('## 위키 목차')&&wikiSystem.includes(`확정 설정: ${JSON.stringify([initial.works[0].documents[0].title])}`),'the wiki index and source roles reach the agent');
    assert(wikiSystem.includes(width===1280?'(아직 위키 페이지가 없다.)':'"관측소" (장소·조직 · 출처 바뀜)'),'the index lists earlier pages and marks one whose source changed');
    await panel.getByRole('button',{name:'위키',exact:true}).click();const wikiArticle=panel.locator('.agent-wiki article').first();await wikiArticle.locator('summary').filter({hasText:'관측소'}).click();
    assert.equal(await wikiArticle.locator('.agent-wiki-sources .chip').innerText(),wikiRow.sources[0].title);assert.equal(await wikiArticle.locator('.agent-wiki-stale').count(),0);await page.screenshot({path:resolve(output,`wiki-${width}.png`)});

    if(width===1280){
      // A source edited after the page was written marks the page; the next look at the wiki shows it.
      await editElsewhere('위키를 쓴 뒤 바꾼 문장.');await panel.getByRole('button',{name:'기억',exact:true}).click();await panel.getByRole('button',{name:'위키',exact:true}).click();
      await panel.locator('.agent-wiki article').first().locator('.agent-wiki-stale').waitFor();await panel.locator('.agent-wiki article').first().locator('summary').click();assert.equal(await panel.locator('.agent-wiki article').first().locator('.agent-wiki-sources .chip').innerText(),`${wikiRow.sources[0].title} · 바뀜`);
    }else{
      // 지우기 removes the page the wider run left.
      const older=panel.locator('.agent-wiki article').nth(1);await older.locator('summary').click();await older.getByRole('button',{name:'지우기',exact:true}).click();await until(async()=>(await pg.query('select id from public.agent_wiki_pages')).rows.length===1,'the older page is deleted');
    }

    for(const [palette,mode] of [['violet','light'],['cyber','dark']]){await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});const layout=await panel.evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,page:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}));assert(!layout.overflow&&!layout.page,JSON.stringify({width,palette,mode,layout}));results.push({width,palette,mode,view:'wiki'});}

    await panel.getByRole('button',{name:'대화',exact:true}).click();
    // AI 자료 내보내기 lives with the other exports in 설정 › 저장 · 백업.
    await panel.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();

    if(!await page.locator('.studio-tools').getByRole('button',{name:'설정',exact:true}).isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
    await page.locator('.studio-tools').getByRole('button',{name:'설정',exact:true}).click();const settingsDialog=page.getByRole('dialog',{name:'설정',exact:true});await settingsDialog.getByRole('button',{name:'저장 · 백업',exact:true}).click();
    const downloadPromise=page.waitForEvent('download');await settingsDialog.getByRole('button',{name:'AI 자료 내보내기',exact:true}).click();const download=await downloadPromise,archive=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(archive.format,'orbis-writing-agent');assert(archive.runs.some(row=>row.id===run.id));
    // AI 자료 가져오기 brings a deleted conversation back from that file and skips what is still there.
    assert(archive.wikiPages.some(row=>row.id===wikiRow.id)&&archive.wikiScopes.some(row=>row.scope_key===wikiKey),'the wiki and its roles are exported');
    await pg.query('delete from public.agent_wiki_pages where id=$1',[wikiRow.id]);await pg.query('delete from public.agent_sessions where id=$1',[run.session_id]);const restored=archive.runs.filter(row=>row.session_id===run.session_id).length,remembered=archive.memories.filter(row=>row.session_id===run.session_id).length;
    await settingsDialog.getByLabel('AI 자료 파일').setInputFiles(await download.path());const importedNote=settingsDialog.getByRole('status').filter({hasText:'가져왔습니다'});await importedNote.waitFor();
    assert.match(await importedNote.innerText(),new RegExp(`^대화 1개 · 실행 ${restored}개 · 기억 ${remembered}개 · 위키 1개를 가져왔습니다\\.( 이미 있거나 읽지 못한 ${archive.sessions.length+archive.runs.length+archive.memories.length+archive.wikiPages.length+archive.wikiScopes.length-2-restored-remembered}개는 건너뛰었습니다\\.)?$`));
    assert.equal((await pg.query('select id from public.agent_runs where session_id=$1',[run.session_id])).rows.length,restored);assert.equal((await pg.query('select owner_id from public.agent_sessions where id=$1',[run.session_id])).rows[0]?.owner_id,profile.id);assert.equal((await pg.query('select owner_id from public.agent_wiki_pages where id=$1',[wikiRow.id])).rows[0]?.owner_id,profile.id,'the wiki page comes back');
    await page.screenshot({path:resolve(output,`settings-agent-export-${width}.png`)});await settingsDialog.getByRole('button',{name:'닫기',exact:true}).click();
    await page.reload({waitUntil:'networkidle'});const reopened=await openPanel(initial.works[0].documents[0]);await reopened.locator('.agent-exchange .chat-message.user').filter({hasText:run.message}).waitFor();await context.close();
  }

  if(!mentionsOnly){
  const api=async(path,method='GET',body,origin=base)=>{
    const response=await fetch(`${base}/api/agent/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'},...body&&{body:JSON.stringify(body)}});

    return {status:response.status,data:await response.json()};
  };

  assert.equal((await fetch(`${base}/api/agent/sessions`)).status,401);
  assert.equal((await api('sessions','POST',{},'https://elsewhere.invalid')).status,403);

  const createTask=async(scope,mode,message,provider='gemini',model,reasoning)=>{
    const sessionId=uid(),id=uid();assert.equal((await api('sessions','POST',{id:sessionId,title:message,scope,mode,provider,web:false})).status,201);
    const result=await api(`sessions/${sessionId}/messages`,'POST',{id,message,mode,provider,model,reasoning,web:false});assert.equal(result.status,202,JSON.stringify(result));

    return {sessionId,id,message,mode};
  };

  const finish=async(id)=>{
    await until(async()=>{const row=(await pg.query('select * from public.agent_runs where id=$1',[id])).rows[0];

if(row.status==='failed')assert.fail(row.error);

return row.status==='completed';},'API task completes');

    return agentRunSchema.parse(JSON.parse(JSON.stringify((await pg.query('select * from public.agent_runs where id=$1',[id])).rows[0])));
  };

  // A level the model lacks is stored and sent as the nearest lower one it has.
  const talk=await createTask({kind:'work',id:initial.works[0].id},'discuss','원문을 읽고 다른 가능성을 의논해줘.','gemini',undefined,'max');
  const discussed=await finish(talk.id);assert.equal(discussed.operations.length,0);assert(discussed.answer.includes('생각했습니다'));assert(discussed.events.some(event=>event.id==='reasoning-high'));assert(modelCalls.filter(call=>JSON.stringify(call.body).includes('원문을 읽고 다른 가능성을 의논해줘.')).every(call=>call.body.generationConfig.thinkingConfig.thinkingLevel==='high'));
  assert.equal((await api(`sessions/${talk.sessionId}/messages`,'POST',{id:uid(),message:'모르는 단계',mode:talk.mode,provider:'gemini',reasoning:'huge',web:false})).status,400);
  const replay=await api(`sessions/${talk.sessionId}/messages`,'POST',{id:talk.id,message:talk.message,mode:talk.mode,provider:'gemini',web:false});assert.equal(replay.status,200);assert.equal((await pg.query('select * from public.agent_runs where id=$1',[talk.id])).rows.length,1);

  for(const provider of ['anthropic']){
    const task=await createTask({kind:'work',id:initial.works[0].id},'review',`${provider} 연결로 개요를 준비해줘.`,provider,'claude-opus-5-5','max'),run=await finish(task.id);assert.equal(run.operations.length,4);assert(run.events.some(event=>event.id==='reasoning-max'));assert(modelCalls.filter(call=>call.provider==='anthropic'&&JSON.stringify(call.body).includes('연결로 개요를 준비해줘')).every(call=>call.body.thinking?.type==='adaptive'&&call.body.output_config?.effort==='max'),'Claude agent steps carry the full-range level');assert(systemOf(modelCalls.findLast(call=>call.provider==='anthropic'&&JSON.stringify(call.body).includes('연결로 개요를 준비해줘'))).includes('researchWeb으로 조사'),'web research is offered whenever its connection exists, whatever the agent provider');assert.equal(run.provider,provider);assert.equal(run.model,'claude-opus-5-5');assert(run.events.some(event=>event.title==='문서 읽기'));assert.equal((await api(`changes/${run.id}/discard`,'POST',{})).status,200);assert.equal((await api(`changes/${run.id}/apply`,'POST',{})).status,409);
  }

  const notes=await createTask({kind:'notes',id:'default'},'execute','노트에 개요를 만들고 정리해줘.');
  const executed=await finish(notes.id);assert(executed.applied_version);assert((await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload.notes.some(n=>n.id===executed.operations[0].id));
  const noteContext=await browser.newContext({viewport:{width:360,height:950}});noteContext.setDefaultNavigationTimeout(90000);
  await noteContext.addInitScript(({profile,token})=>{if(window!==window.top)return;localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));},{profile,token});
  page=await noteContext.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${browserBase}/studio#notes/${executed.operations[0].id}`,{waitUntil:'networkidle'});await page.getByLabel('노트 본문',{exact:true}).waitFor();assert((await page.getByLabel('노트 본문',{exact:true}).innerText()).includes('달로 돌아온'));
  await page.getByRole('button',{name:'AI 대화',exact:true}).click();const notePanel=page.locator('.reference-panel.is-chat'),noteChanges=notePanel.getByRole('button',{name:/^변경 \d+$/});await notePanel.getByRole('textbox',{name:'AI에게 질문',exact:true}).waitFor();
  await chooseOption(notePanel.getByRole('combobox',{name:'작업 대화 선택'}),notes.sessionId);await notePanel.locator('.agent-exchange').first().waitFor();await noteChanges.click();await notePanel.getByRole('button',{name:'문서 열기',exact:true}).click();await page.getByLabel('노트 본문',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'사이드바 열기',exact:true}).count(),1);

  if(!await notePanel.isVisible())await page.getByRole('button',{name:'AI 대화',exact:true}).click();
  await notePanel.getByRole('button',{name:'대화',exact:true}).click();await notePanel.locator('.agent-exchange').first().waitFor();
  await notePanel.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill('이 장면은 어디야? 노트에서 묻는다.');await notePanel.getByRole('button',{name:'질문 보내기',exact:true}).click();await notePanel.locator('.chat-message.assistant').filter({hasText:'열어 둔 문서를 확인했습니다.'}).waitFor();
  const noteSystem=systemOf(modelCalls.findLast(call=>JSON.stringify(call.body).includes('노트에서 묻는다')));assert(noteSystem.includes(`작가가 지금 열어 둔 문서: "에이전트 개요" (id ${executed.operations[0].id})`),'the open note is named to the model');assert(noteSystem.includes('노트 작업공간: '));assert(noteSystem.includes('현재 실행 방식: 맡겨 실행'));
  // Even a cancellation after the commit must leave undo available.
  await pg.query("update public.agent_runs set status='cancelled' where id=$1",[notes.id]);assert.equal((await api(`changes/${notes.id}/revert`,'POST',{})).status,200);await until(async()=>await page.getByLabel('노트 본문',{exact:true}).count()===0,'remote undo refreshes open note without realtime');await noteContext.close();
  const stale=await createTask({kind:'work',id:initial.works[0].id},'review','개요를 제안해줘.');assert((await finish(stale.id)).operations.some(op=>op.type==='create'),'the stale change adds a document');
  // The writer renamed one document and a folder after the run read the work.
  const current=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload,folder=current.works[0].navigation.nodes.find(node=>node.type==='folder'),folderTitle=folder.title;
  current.works[0].documents[0].title='작성자가 새로 고친 제목';folder.title='작성자가 바꾼 부';await pg.query('update public.workspaces set payload=$1,version=version+1 where id=$2',[JSON.stringify(current),workspaceId]);
  // A change that adds a document needs the tree as the run read it, so the folder rename stops it and nothing is written.
  assert.equal((await api(`changes/${stale.id}/apply`,'POST',{})).status,409);const kept=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload;assert.equal(kept.works[0].documents[0].title,'작성자가 새로 고친 제목');assert.equal(kept.works[0].navigation.nodes.find(node=>node.id===folder.id).title,'작성자가 바꾼 부');
  // With the tree back as it was, the rename of an untouched document no longer blocks the change and survives it.
  kept.works[0].navigation.nodes.find(node=>node.id===folder.id).title=folderTitle;await pg.query('update public.workspaces set payload=$1,version=version+1 where id=$2',[JSON.stringify(kept),workspaceId]);
  assert.equal((await api(`changes/${stale.id}/apply`,'POST',{})).status,200);const joined=(await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload;assert.equal(joined.works[0].documents[0].title,'작성자가 새로 고친 제목');assert.equal(joined.works[0].documents.length,kept.works[0].documents.length+1,'the staged document is added');
  assert.equal((await api(`changes/${stale.id}/revert`,'POST',{})).status,200);assert.equal((await pg.query('select payload from public.workspaces where id=$1',[workspaceId])).rows[0].payload.works[0].documents.length,kept.works[0].documents.length);
  const cancelled=await createTask({kind:'work',id:initial.works[0].id},'execute','이 실행은 중단한다.');assert.equal((await api(`runs/${cancelled.id}/cancel`,'POST',{})).status,200);assert.equal((await pg.query('select status from public.agent_runs where id=$1',[cancelled.id])).rows[0].status,'cancelled');
  const exported=await api('export');assert.equal(exported.status,200);assert.equal(exported.data.format,'orbis-writing-agent');assert(exported.data.runs.some(r=>r.id===notes.id));assert(!JSON.stringify(exported.data).includes('synthetic-openai'));
  // An execute run that commits while the writer keeps typing elsewhere is joined, not turned into a save conflict.
  const cloudPayload=async()=>(await pg.query('select payload,version from public.workspaces where id=$1',[workspaceId])).rows[0],noteText=async()=>plainText((await cloudPayload()).payload.notes.find(n=>n.id===note.id).content);
  const typingContext=await browser.newContext({viewport:{width:1280,height:900}});typingContext.setDefaultNavigationTimeout(90000);
  await typingContext.addInitScript(({profile,token})=>{if(window!==window.top)return;localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));},{profile,token});
  page=await typingContext.newPage();page.on('pageerror',error=>errors.push(error.message));let saves='pass';
  await page.route('**/rpc/save_workspace',async route=>{while(saves==='hold')await new Promise(done=>setTimeout(done,100));

if(saves==='abort')await route.abort();else await route.continue();});
  await page.goto(`${browserBase}/studio#notes/${note.id}`,{waitUntil:'networkidle'});
  const noteBody=page.getByLabel('노트 본문',{exact:true}),conflictDialog=page.getByRole('dialog',{name:'저장 충돌',exact:true});await noteBody.waitFor();await noteBody.click();await page.keyboard.press('Control+End');
  const joinWork={kind:'work',id:initial.works[0].id},agentDocs=async run=>(await cloudPayload()).payload.works[0].documents.filter(d=>d.id===run.operations[0].id).length;

  saves='hold';await page.keyboard.type(' 맡긴 동안 이어 쓴 문장.');
  const held=await finish((await createTask(joinWork,'execute','작품에 개요를 만들어줘.')).id);assert(held.applied_version);assert.equal(await agentDocs(held),1);assert(!(await noteText()).includes('이어 쓴 문장'),'the note edit is still unsent when the agent commits');
  saves='pass';await until(async()=>(await noteText()).includes('맡긴 동안 이어 쓴 문장.'),'unsent note text is saved after the agent commit');
  assert.equal(await agentDocs(held),1,'the agent document survives the joined save');assert.equal(await conflictDialog.count(),0,'no save conflict dialog');
  assert(await noteBody.evaluate(el=>el.contains(document.activeElement)),'the note being typed keeps focus');await page.keyboard.type(' 합친 뒤에도 계속.');await until(async()=>(await noteText()).endsWith('합친 뒤에도 계속.'),'typing continues after the join');
  assert.equal((await api(`changes/${held.id}/revert`,'POST',{})).status,200,'a joined agent change can still be reverted');assert.equal(await agentDocs(held),0);assert((await noteText()).endsWith('합친 뒤에도 계속.'));

  // The same join when the studio is opened again with unsent text and a newer agent commit.
  await page.reload({waitUntil:'networkidle'});await noteBody.waitFor();await noteBody.click();await page.keyboard.press('Control+End');saves='abort';await page.keyboard.type(' 닫기 전에 쓴 문장.');
  await until(()=>page.evaluate(()=>new Promise(done=>{const open=indexedDB.open('orbit-novel-studio-v1');open.onerror=()=>done(false);open.onsuccess=()=>{const rows=open.result.transaction('workspaces').objectStore('workspaces').getAll();rows.onsuccess=()=>done(rows.result.some(row=>row.dirty&&JSON.stringify(row.data.notes).includes('닫기 전에 쓴 문장.')));};})),'unsent text is stored on the device');
  const reopened=await finish((await createTask(joinWork,'execute','작품에 개요를 다시 만들어줘.')).id);assert(reopened.applied_version);
  await page.reload({waitUntil:'networkidle'});await noteBody.waitFor();assert.equal(await conflictDialog.count(),0,'no save conflict dialog on reopening');assert((await noteBody.innerText()).includes('닫기 전에 쓴 문장.'));
  saves='pass';await noteBody.click();await page.keyboard.press('Control+End');await page.keyboard.type(' 다시 연 뒤.');await until(async()=>(await noteText()).endsWith('닫기 전에 쓴 문장. 다시 연 뒤.'),'text from before and after reopening is saved');
  assert.equal(await agentDocs(reopened),1,'the agent document survives reopening');assert.equal(await conflictDialog.count(),0);

  // Unsent edits inside the agent's own scope still stop for the writer to choose.
  saves='hold';await page.keyboard.type(' 같은 공간에서 쓴 문장.');
  const same=await finish((await createTask({kind:'notes',id:'default'},'execute','노트에 개요를 만들어줘.')).id);assert(same.applied_version);
  saves='pass';await conflictDialog.waitFor();await page.screenshot({path:resolve(output,'same-scope-conflict.png')});await typingContext.close();
  assert(modelCalls.some(call=>call.provider==='gemini'&&JSON.stringify(call.body.tools||[]).includes('googleSearch')),'native Google search tool is sent');
  results.push({flow:'discuss/execute/note-scope/idempotency/cancelled-undo/stale-source/export/execute-join/auth/origin'});

  }

  assert.equal(errors.length,0,errors.join('\n'));await writeFile(resolve(output,'report.json'),JSON.stringify({browserBase,syntheticOnly:true,results,errors,modelCalls:modelCalls.length},null,2));
  console.log(JSON.stringify({cases:results.length,errors,modelCalls:modelCalls.length}));
}catch(error){console.error(JSON.stringify({errors,runs:(await pg.query('select id,status,error,events from public.agent_runs')).rows,models:modelCalls.length}));

if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});throw error;}
finally{await browser.close();

try{process.kill(-app.pid,'SIGTERM');}catch{}

mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));await pg.close();}
