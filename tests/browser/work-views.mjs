// A real local Next.js server and synthetic Supabase HTTP service. No production credentials or data writes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {makePublication} from '../../src/lib/model.ts';
import {PALETTES} from '../../src/lib/theme.ts';

const require=createRequire(import.meta.url),pw=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/work-views'),port=Number(process.env.KOSMOS_VIEWS_TEST_PORT||3221),base=`http://127.0.0.1:${port}`;

await mkdir(output,{recursive:true});

const errors=[],recorded=[],data=seedWorkspace(),[published,draft]=data.works;

published.title='게시한 합성 작품';

published.description='검색 결과에 나올 합성 작품 소개.';

draft.title='게시하지 않은 합성 작품';

draft.publications=[];

draft.activePublicationId=null;

const pub=makePublication(published,published.documents.filter(doc=>doc.kind==='scene').map(doc=>doc.id));

published.publications=[pub];

published.activePublicationId=pub.id;

const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-11-15T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[]};

const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;

let installed=true,totalsReads=0;

const mock=createServer(async(req,res)=>{
 try{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,apikey,X-Client-Info,Content-Type,Prefer,Accept,Content-Profile,Accept-Profile,cache-control');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,PUT,OPTIONS');

  if(req.method==='OPTIONS'){res.writeHead(204);res.end();

return;}

  const path=new URL(req.url,'http://localhost').pathname,author=req.headers.authorization===`Bearer ${token}`;
  const body=Buffer.concat(await Array.fromAsync(req)).toString();
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};

  if(path.endsWith('/auth/v1/user'))return send(profile);

  if(path.includes('/rest/v1/authors'))return send({user_id:profile.id});

  if(path.includes('/rest/v1/author_profile'))return send({name:'합성 작가',bio:'합성 소개',published_at:'2026-11-15T00:00:00Z'});

  if(path.includes('/rest/v1/workspaces'))return send({id:data.id,payload:data,version:1});

  if(path.includes('/rest/v1/publications'))return send([{payload:pub,library_position:1}]);

  if(path.includes('/rest/v1/book_downloads'))return send([]);

  if(path.includes('/rest/v1/rpc/save_workspace'))return send({status:'saved',version:2});

  if(path.includes('/rest/v1/rpc/record_work_view')){
   // Only the server's service key may record; a browser never calls this address.
   if(req.headers.apikey!=='synthetic-service')return send({message:'permission denied'},403);
   recorded.push(JSON.parse(body).p_work_id);

   return send(null);
  }

  if(path.includes('/rest/v1/rpc/work_view_totals')){
   totalsReads++;

   if(!installed)return send({code:'PGRST202',message:'Could not find the function public.work_view_totals'},404);

   return send(author?[{work_id:published.id,total:1234,recent:56}]:[]);
  }

  return send({connected:false,configured:false,providers:[],storageAvailable:true});
 }catch(error){errors.push(`mock: ${error.message}`);res.writeHead(500);res.end();}
});

await new Promise(done=>mock.listen(0,'127.0.0.1',done));

const mockUrl=`http://127.0.0.1:${mock.address().port}`,log=createWriteStream(resolve(output,'server.log'));

const app=spawn('pnpm',['exec','next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),detached:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:mockUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'}});

app.stdout.pipe(log);

app.stderr.pipe(log);

const browser=await pw.chromium.launch({headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});

let currentPage;

const until=async(check,message)=>{
 for(let attempt=0;attempt<100;attempt++){
  if(await check())return;

  await new Promise(done=>setTimeout(done,100));
 }

 assert.fail(message);
};

const signIn=context=>context.addInitScript(({profile,token})=>{
 if(window!==window.top)return;

 localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'home'}));
 localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
},{profile,token});

// Headless Chromium names itself as automated, which the server rightly leaves out; readers are given an ordinary browser's name.
const userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const reading=`${base}/read/${published.id}`;

try{
 for(let attempt=0;attempt<180;attempt++){
  if(app.exitCode!==null)throw new Error(`Next exited: ${app.exitCode}`);

  try{const response=await fetch(base);

if(response.ok)break;}catch{}

  await new Promise(done=>setTimeout(done,500));

  if(attempt===179)throw new Error('Next startup timed out');
 }

 // Compile every route first so development HMR cannot interrupt an interaction.
 for(const path of ['/studio','/library',`/read/${published.id}`])assert.equal((await fetch(`${base}${path}`)).status,200);

 // A request without a browser's same-site headers, or from a crawler, records nothing.
 for(const headers of [{},{origin:base,'user-agent':'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'},{origin:'https://other.example','user-agent':'Mozilla/5.0 Chrome/130'}]){
  assert.equal((await fetch(`${base}/api/views`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({workId:published.id})})).status,204);
 }

 assert.deepEqual(recorded,[]);

 for(const width of [1280,360]){
  const before=recorded.length;

  // 1. A reader's first opening of the day is recorded once; reloading and coming back are not.
  const reader=await browser.newContext({viewport:{width,height:900},userAgent}),page=await reader.newPage();

  currentPage=page;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));

  const sent=[];

  page.on('request',request=>{if(request.url().includes('/api/views')||request.url().includes('record_work_view'))sent.push(new URL(request.url()).pathname);});
  await page.goto(reading,{waitUntil:'networkidle'});
  assert.equal(await page.title(),`${published.title} · Orbis Tertius`);
  await until(()=>recorded.length===before+1,'first opening is recorded');
  assert.equal(recorded[before],published.id);
  await page.reload({waitUntil:'networkidle'});await page.goto(`${base}/library`,{waitUntil:'networkidle'});
  await page.locator(`a[href="/read/${published.id}"]`).first().click();await page.waitForURL(reading);await page.waitForLoadState('networkidle');
  await page.goto(`${base}/read/00000000-0000-4000-8000-000000000000`,{waitUntil:'networkidle'});
  assert.equal(recorded.length,before+1,'same browser on the same day counts once, and an unpublished address not at all');
  assert.deepEqual(sent,['/api/views'],'the browser talks only to this site');
  await reader.close();

  // 2. Another reader counts again.
  const second=await browser.newContext({viewport:{width,height:900},userAgent}),other=await second.newPage();

  await other.goto(reading,{waitUntil:'networkidle'});
  await until(()=>recorded.length===before+2,'another browser is recorded');
  await second.close();

  // 3. The author's signed-in browser is left out, and sees the totals in the studio.
  const context=await browser.newContext({viewport:{width,height:900},userAgent});

  await signIn(context);

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',socket=>socket.close());

  const studio=await context.newPage();

  currentPage=studio;studio.setDefaultTimeout(20000);studio.on('pageerror',error=>errors.push(error.message));
  await studio.goto(reading,{waitUntil:'networkidle'});await studio.waitForTimeout(500);
  assert.equal(recorded.length,before+2,'the author reading their own work is not counted');

  installed=true;
  await studio.goto(`${base}/studio`,{waitUntil:'networkidle',timeout:120000});

  const card=title=>studio.locator('[data-work-shelf] .reference-card').filter({hasText:title}).first();

  await card(published.title).waitFor();
  await until(async()=>(await card(published.title).innerText()).includes('조회 1,234'),'published card shows its total');
  assert.match(await card(published.title).innerText(),/게시 중 · 조회 1,234/);
  assert.doesNotMatch(await card(draft.title).innerText(),/조회/);

  await card(published.title).click({button:'right'});await studio.getByRole('menuitem',{name:'작품 정보 편집',exact:true}).click();

  const info=studio.getByRole('dialog',{name:'작품 정보',exact:true});

  await info.waitFor();
  assert.match(await info.locator('.work-public-state').innerText(),/^공개 서재에 게시 중 · .+ 판본 · 조회 1,234 · 최근 7일 56$/);
  await studio.screenshot({path:resolve(output,`info-${width}.png`)});

  // The line stays inside the dialog and the card in every palette.
  for(const palette of PALETTES){
   for(const theme of ['light','dark']){
    const inside=await studio.evaluate(({palette,theme})=>{
     const root=document.documentElement;

     root.setAttribute('data-palette',palette);root.setAttribute('data-theme',theme);

     const line=document.querySelector('.work-public-state'),dialog=line.closest('[role=dialog]'),box=line.getBoundingClientRect(),frame=dialog.getBoundingClientRect();

     return box.left>=frame.left-1&&box.right<=frame.right+1&&box.right<=innerWidth+1&&getComputedStyle(line).fontSize==='12px';
    },{palette,theme});

    assert.equal(inside,true,`${width} ${palette} ${theme} info line`);
   }
  }

  await studio.keyboard.press('Escape');await info.waitFor({state:'hidden'});

  for(const palette of PALETTES){
   for(const theme of ['light','dark']){
    const inside=await studio.evaluate(({palette,theme,title})=>{
     const root=document.documentElement;

     root.setAttribute('data-palette',palette);root.setAttribute('data-theme',theme);

     const cardNode=[...document.querySelectorAll('[data-work-shelf] .reference-card')].find(node=>node.textContent.includes(title)),small=cardNode.querySelector('small'),box=small.getBoundingClientRect(),frame=cardNode.getBoundingClientRect();

     return box.left>=frame.left-1&&box.right<=frame.right+1&&frame.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;
    },{palette,theme,title:published.title});

    assert.equal(inside,true,`${width} ${palette} ${theme} card line`);
   }
  }

  await studio.evaluate(()=>{document.documentElement.setAttribute('data-palette','violet');document.documentElement.setAttribute('data-theme','light');});
  await studio.screenshot({path:resolve(output,`home-${width}.png`)});

  // 4. A server without the view tables shows the card and dialog as before.
  installed=false;

  const reads=totalsReads,fresh=await context.newPage();

  currentPage=fresh;fresh.on('pageerror',error=>errors.push(error.message));
  await fresh.goto(`${base}/studio`,{waitUntil:'networkidle',timeout:120000});
  await fresh.locator('[data-work-shelf] .reference-card').filter({hasText:published.title}).first().waitFor();
  await until(()=>totalsReads>reads,'totals are asked for again');await fresh.waitForTimeout(300);
  assert.match(await fresh.locator('[data-work-shelf] .reference-card').filter({hasText:published.title}).first().innerText(),/게시 중/);
  assert.doesNotMatch(await fresh.locator('.studio-home').innerText(),/조회/);
  installed=true;await context.close();
  console.log(JSON.stringify({width,recorded:recorded.length-before,palettes:PALETTES.length*2}));
 }

 assert.deepEqual(errors,[]);
}catch(error){if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();process.kill(-app.pid,'SIGTERM');mock.close();log.end();}
