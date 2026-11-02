// A real local Next.js server and synthetic Supabase HTTP service. No production credentials or data writes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {bookFixture} from '../fixtures/book-work.ts';
import {makePublication} from '../../src/lib/model.ts';
import {PALETTES} from '../../src/lib/theme.ts';
import {chooseOption} from './select.mjs';
import JSZip from 'jszip';

const require=createRequire(import.meta.url),pw=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/book-downloads'),port=Number(process.env.KOSMOS_BOOK_TEST_PORT||3220),base=`http://127.0.0.1:${port}`;

await mkdir(output,{recursive:true});

const errors=[],results=[],records=new Map(),objects=new Map(),fixture=bookFixture(),work=fixture.work;

const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-11-02T15:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[]};

const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;

const pub=makePublication(work,[fixture.first.id,fixture.second.id]);

work.publications=[pub];

work.activePublicationId=pub.id;

let active=true,failUpload=false,failRegistration=false,registrations=0,removals=0,workspaceSaves=0;

const mock=createServer(async(req,res)=>{
 try{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,apikey,X-Client-Info,Content-Type,Prefer,Accept,Content-Profile,Accept-Profile,x-upsert,cache-control');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,PUT,OPTIONS');

  if(req.method==='OPTIONS'){res.writeHead(204);res.end();

return;}

  const url=new URL(req.url,'http://localhost'),path=url.pathname,author=req.headers.authorization===`Bearer ${token}`;
  const bytes=Buffer.concat(await Array.fromAsync(req)),json=()=>JSON.parse(bytes.toString()||'{}');
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};

  if(path.endsWith('/auth/v1/user'))return send(profile);

  if(path.includes('/rest/v1/authors'))return send({user_id:profile.id});

  if(path.includes('/rest/v1/author_profile'))return send({name:'합성 작가',bio:'',published_at:'2026-11-02T15:00:00Z'});

  if(path.includes('/rest/v1/workspaces'))return send({id:fixture.data.id,payload:fixture.data,version:1});

  if(path.includes('/rest/v1/publications'))return send(active?[{payload:pub,library_position:1}]:[]);

  if(path.includes('/rest/v1/rpc/save_workspace')){workspaceSaves++;

return send({status:'saved',version:2});}

  if(path.includes('/rest/v1/book_downloads')){
   const matches=row=>[...url.searchParams].every(([key,value])=>!['owner_id','work_id','format','file_id'].includes(key)||value===`eq.${row[key]}`);

   if(req.method==='POST'||req.method==='PATCH'){
    if(!author||failRegistration)return send({message:'synthetic registration rejected'},409);
    const row=json(),key=row.format;

    if(req.method==='PATCH'&&(!records.has(key)||!matches(records.get(key))))return send({message:'stale file'},409);

    if(req.method==='POST'&&records.has(key))return send({message:'duplicate'},409);
    records.set(key,row);registrations++;

return send(row);
   }

   if(req.method==='DELETE'){
    const row=[...records.values()].find(matches);

    if(!author||!row)return send({message:'stale file'},409);
    records.delete(row.format);removals++;

return send({file_id:row.file_id});
   }

   const rows=[...records.values()].filter(matches).filter(()=>author||active).sort((a,b)=>a.format.localeCompare(b.format));

   return send(rows);
  }

  if(path.includes('/storage/v1/object/')){
   const marker='/book-downloads',at=path.indexOf(marker),objectPath=decodeURIComponent(path.slice(at+marker.length+1));

   if(req.method==='POST'){
    if(!author||failUpload)return send({message:'synthetic upload failed'},503);
    let body=bytes;

    if(String(req.headers['content-type']).includes('multipart/form-data')){
     const form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData();
     const part=[...form.values()].find(value=>value instanceof Blob);body=Buffer.from(await part.arrayBuffer());
    }

    objects.set(objectPath,body);

return send({Key:`book-downloads/${objectPath}`});
   }

   if(req.method==='DELETE'){
    if(!author)return send({},403);

    for(const path of json().prefixes||[])if(![...records.values()].some(row=>row.object_path===path))objects.delete(path);

    return send([]);
   }

   const registered=[...records.values()].find(row=>row.object_path===objectPath);

   if(!objects.has(objectPath)||!author&&(!registered||!active))return send({message:'not found'},404);
   res.writeHead(200,{'Content-Type':registered?.format==='epub'?'application/epub+zip':registered?.format==='html'?'text/html':'application/pdf'});res.end(objects.get(objectPath));

return;
  }

  return send({connected:false,configured:false,providers:[],storageAvailable:true});
 }catch(error){errors.push(`mock: ${error.message}`);res.writeHead(500);res.end();}
});

await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));

const mockUrl=`http://127.0.0.1:${mock.address().port}`,log=createWriteStream(resolve(output,'server.log'));

const app=spawn('pnpm',['exec','next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),detached:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:mockUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon'}});

app.stdout.pipe(log);

app.stderr.pipe(log);

const browser=await pw.chromium.launch({headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});

let currentPage;

try{
 for(let attempt=0;attempt<180;attempt++){
  if(app.exitCode!==null)throw new Error(`Next exited: ${app.exitCode}`);

  try{const response=await fetch(base);

if(response.ok)break;}catch{}

  await new Promise(resolve=>setTimeout(resolve,500));

  if(attempt===179)throw new Error('Next startup timed out');
 }

 // Compile all routes before interactions so development HMR cannot cancel a file navigation or reset an open dialog.
 for(const path of ['/studio','/library',`/read/${work.id}`,'/api/books',`/api/books/${work.id}/pdf`]){
  const response=await fetch(`${base}${path}`);assert.equal(response.status,path.endsWith('/pdf')?404:200);
 }

 for(const width of [1280,360]){
  records.clear();objects.clear();active=true;
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});
  await context.addInitScript(({profile,token})=>{
   if(window!==window.top)return;
   localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));
   localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
  },{profile,token});

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',socket=>socket.close());
  const page=await context.newPage();currentPage=page;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/studio`,{waitUntil:'networkidle',timeout:120000});await page.locator('.manuscript[contenteditable=true]').first().waitFor();

  const open=async()=>{
   if(width===360)await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
   await page.locator('[data-settings-opener]').first().click();await page.getByRole('button',{name:'저장 · 백업',exact:true}).click();await page.getByRole('button',{name:'책으로 내보내기',exact:true}).click();
  };

  await open();
  const dialog=()=>page.getByRole('dialog',{name:'책으로 내보내기',exact:true}),format=value=>dialog().getByRole('group',{name:'책 파일 형식',exact:true}).getByRole('button',{name:value.toUpperCase(),exact:true}),share=()=>dialog().getByRole('checkbox',{name:'서재에서 다운로드 허용',exact:true});
  assert.equal(await share().isChecked(),false);
  await chooseOption(dialog().getByRole('combobox',{name:'책 글꼴',exact:true}),'wanted');
  await format('epub').click();await dialog().getByRole('button',{name:'EPUB 만들기',exact:true}).click();
  await dialog().getByRole('link',{name:/^파일 저장/}).waitFor({timeout:60000});assert.equal(records.size,0);assert.equal(objects.size,0);
  await share().check();

  for(const kind of ['epub','html','pdf']){
   await format(kind).click();await dialog().getByRole('button',{name:`${kind.toUpperCase()} 만들고 공개`,exact:true}).click();
   await dialog().getByRole('button',{name:`${kind.toUpperCase()} 다운로드 공개 해제`,exact:true}).waitFor({timeout:60000});
   const row=records.get(kind),bytes=objects.get(row.object_path);assert(bytes.length>1000);

   if(kind==='html'){assert(bytes.toString().includes('한글과'));assert(!bytes.toString().includes('미선택 비밀 원고'));assert(!bytes.toString().includes('비공개참조제목'));}

   if(kind==='epub'){const zip=await JSZip.loadAsync(bytes);assert.equal(await zip.file('mimetype').async('string'),'application/epub+zip');}

   if(kind==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');
  }

  const old=records.get('pdf'),original=objects.get(old.object_path);
  failUpload=true;await dialog().getByRole('button',{name:'PDF 만들고 교체',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'파일을 올리지 못했습니다'}).waitFor();assert.equal(records.get('pdf').file_id,old.file_id);failUpload=false;
  await dialog().getByRole('button',{name:'새로 불러오기',exact:true}).click();await share().check();
  failRegistration=true;await dialog().getByRole('button',{name:'PDF 만들고 교체',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'등록 결과를 확인하지 못했습니다'}).waitFor();assert.equal(records.get('pdf').file_id,old.file_id);assert.equal(objects.size,3);failRegistration=false;
  await dialog().getByRole('button',{name:'새로 불러오기',exact:true}).click();await share().check();
  await dialog().getByRole('textbox',{name:'책 제목',exact:true}).fill('교체한 공개 책');await dialog().getByRole('button',{name:'PDF 만들고 교체',exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('.book-shared-file [title="교체한 공개 책.pdf"]'),undefined,{timeout:60000});assert.notEqual(records.get('pdf').file_id,old.file_id);assert.equal(objects.has(old.object_path),false);

  for(const palette of PALETTES)for(const mode of ['light','dark']){
   await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});
   const metrics=await dialog().evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,checkSize:el.querySelector('.book-export-sharing input').getBoundingClientRect().width}));assert.equal(metrics.overflow,false);assert(metrics.checkSize>=12);

   if(['violet','cyber','orbit'].includes(palette)&&mode==='dark')await dialog().screenshot({path:resolve(output,`studio-${width}-${palette}.png`)});
   results.push({area:'studio',width,palette,mode,...metrics});
  }

  await dialog().getByRole('button',{name:'닫기',exact:true}).click();await page.reload({waitUntil:'networkidle'});await open();assert.equal(await share().isChecked(),false);assert.equal(await dialog().locator('.book-shared-file').count(),3);
  const publicContext=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true}),reader=await publicContext.newPage();reader.on('pageerror',error=>errors.push(error.message));
  await reader.goto(`${base}/library`,{waitUntil:'networkidle'});await reader.getByRole('button',{name:'다운로드',exact:true}).click();

  for(const kind of ['pdf','epub','html']){
   const menu=reader.getByRole('dialog',{name:'다운로드',exact:true});

   if(!await menu.isVisible())await reader.getByRole('button',{name:'다운로드',exact:true}).click();
   const promise=reader.waitForEvent('download');await menu.getByRole('link',{name:new RegExp(`^${kind.toUpperCase()}`)}).click();const download=await promise;
   const path=resolve(output,`received-${width}.${kind}`);await download.saveAs(path);assert.deepEqual(await readFile(path),objects.get(records.get(kind).object_path));assert.equal(await download.suggestedFilename(),records.get(kind).filename);
  }

  await reader.getByRole('link',{name:/작품 읽기/}).click();await reader.locator('.reading-body').first().waitFor();await reader.getByRole('button',{name:'다운로드',exact:true}).click();

  for(const palette of PALETTES)for(const mode of ['light','dark']){
   await reader.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});
   const menu=reader.getByRole('dialog',{name:'다운로드',exact:true}),metrics=await menu.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,overflow:document.documentElement.scrollWidth>innerWidth+1}));
   assert(metrics.left>=0&&metrics.right<=width+1);assert.equal(metrics.overflow,false);assert.notEqual(metrics.bg,'rgba(0, 0, 0, 0)');assert.notEqual(metrics.bg,metrics.color);

   if(['violet','cyber','orbit'].includes(palette)&&mode==='dark')await reader.screenshot({path:resolve(output,`reader-${width}-${palette}.png`)});
   results.push({area:'reader',width,palette,mode,...metrics});
  }

  await reader.keyboard.press('Escape');assert.equal(await reader.getByRole('button',{name:'다운로드',exact:true}).evaluate(el=>el===document.activeElement),true);
  const current=records.get('pdf');active=false;assert.equal((await fetch(`${base}/api/books/${work.id}/pdf`)).status,404);assert.deepEqual(await (await fetch(`${base}/api/books`)).json(),[]);
  active=true;assert.equal((await fetch(`${base}/api/books/${work.id}/pdf`)).status,200);

  for(const kind of ['pdf','epub','html'])await dialog().getByRole('button',{name:`${kind.toUpperCase()} 다운로드 공개 해제`,exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.book-shared-file').length===0);
  assert.equal(records.size,0);assert.equal((await fetch(`${base}/api/books/${work.id}/pdf`)).status,404);await reader.reload({waitUntil:'networkidle'});assert.equal(await reader.getByRole('button',{name:'다운로드',exact:true}).count(),0);
  assert(original.length>0&&current.file_id!==old.file_id);await publicContext.close();await context.close();
  console.log(JSON.stringify({width,roundTrip:true}));
 }

 assert.equal(workspaceSaves,0);assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({base,results,registrations,removals,workspaceSaves,errors},null,2));console.log(JSON.stringify({cases:results.length,registrations,removals,workspaceSaves,errors}));
}catch(error){if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();process.kill(-app.pid,'SIGTERM');mock.close();log.end();}
