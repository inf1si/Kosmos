// Synthetic workspace only. Run through tsx; Supabase and same-origin endpoints are intercepted.
// Selected heading text reports the size it is drawn at; the cursor alone still reports the manuscript size.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {workspaceSchema} from '../../src/lib/model.ts';
import {newNote,addNote} from '../../src/lib/personal-notes.ts';

const require=createRequire(import.meta.url),playwright=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/heading-font-size/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const errors=[],results=[];

let activePage;

const until=async(page,check,label)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(80);}

assert.fail(`Timed out: ${label}`);};

const heading=(level,text)=>({type:'heading',attrs:{level},content:[{type:'text',text}]}),paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});

/** The multiples in studio.css, editor-content.css and personal-notes.css, kept here so the expected sizes do not come from the code under test. */
const ratios={h1:1.6,h2:1.3,h3:1.15,noteH2:1.15},shownSize=(size,ratio)=>Math.round(size*ratio*2)/2;

try{
 for(const width of [1280,360]){
  let data=seedWorkspace();const scene=data.works[0].documents.find(doc=>doc.kind==='scene');

  scene.title='합성 원고';scene.content={type:'doc',content:[heading(1,'큰 제목'),heading(2,'중간 제목'),heading(3,'작은 제목'),paragraph('본문 문단입니다.')]};
  const note={...newNote(),title:'합성 노트',content:{type:'doc',content:[heading(2,'노트 제목'),paragraph('노트 문단입니다.')]}};data=addNote(data,note);workspaceSchema.parse(data);
  let version=1,cloudSeen=false,closing=false;
  const context=await browser.newContext({viewport:{width,height:900}});
  const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-10-25T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  await context.addInitScript(({profile,token})=>{
   localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));
   localStorage.setItem('sb-krakjollsufgnwealroh-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
  },{profile,token});
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}));
  await context.route('**/rest/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;cloudSeen=true;let value={};

   if(path.endsWith('/authors'))value={user_id:profile.id};
   else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version};
   else if(path.endsWith('/save_workspace')){const input=request.postDataJSON();data=workspaceSchema.parse(input.p_payload);version++;value={status:'saved',version};}

   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(15000);page.on('pageerror',error=>{if(!closing)errors.push(error.message);});
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();

  if(!cloudSeen){
   await page.evaluate(data=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put({namespace:'preview',data,localVersion:1,cloudVersion:0,dirty:false,lastExportAt:null});tx.oncomplete=()=>{db.close();resolve();};

tx.onerror=()=>reject(tx.error);};}),data);
   await page.reload({waitUntil:'networkidle'});
  }

  /** Runs the same checks against one editor: its toolbar size box, a heading, and a body paragraph. */
  async function check(shell,tag,ratio,size){
   const body=shell.locator('.manuscript'),target=body.locator(tag).first(),para=body.locator('p').first();
   const box=name=>shell.getByRole('textbox',{name,exact:true}),list=shell.getByRole('button',{name:'글자 크기 목록',exact:true}),reset=page.getByRole('button',{name:'기본 크기로',exact:true});

   const rect=el=>el.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const b=range.getBoundingClientRect();

return {left:b.left,right:b.right,middle:b.top+b.height/2};});

   // Pressing the mouse on an existing selection would drag its text, so a click collapses the selection first.
   const drag=async(from,to=from)=>{await para.click();await from.scrollIntoViewIfNeeded();const a=await rect(from),b=await rect(to);await page.mouse.move(a.left,a.middle);await page.mouse.down();await page.mouse.move(b.right,b.middle,{steps:10});await page.mouse.up();};

   const pick=n=>page.getByRole('button',{name:new RegExp(`^${n}\\s*px$`)});

   const drawn=el=>el.evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),expected=shownSize(size,ratio);
   const shows=(name,value)=>until(page,async()=>await box(name).count()===1&&await box(name).inputValue()===value,`${tag} ${name} ${value}`);

   assert.notEqual(expected,size);assert(Math.abs(await drawn(target)-size*ratio)<.01,`${tag} is drawn at ${size}×${ratio}`);

   // The cursor alone: the box is the manuscript size in a paragraph and in a heading alike.
   await para.click();await shows('본문 크기',String(size));
   await target.click();await shows('본문 크기',String(size));

   // Selected heading text reports the size it is drawn at; it has no size of its own to clear.
   await drag(target);await shows('선택한 글자 크기',String(expected));
   await list.click();await reset.waitFor();assert.equal(await reset.isDisabled(),true);assert.equal(await pick(size).getAttribute('aria-pressed'),'false');
   await page.keyboard.press('Escape');await reset.waitFor({state:'detached'});

   // Selected body text is unchanged, and a heading plus a paragraph is a mix of two sizes.
   await drag(para);await shows('선택한 글자 크기',String(size));
   await drag(target,para);await shows('선택한 글자 크기','');assert.equal(await box('선택한 글자 크기').getAttribute('placeholder'),'–');
   await list.click();await reset.waitFor();assert.equal(await reset.isDisabled(),true);await page.keyboard.press('Escape');await reset.waitFor({state:'detached'});

   // A size given to the heading text is still its own size, and clearing or undoing it returns to the heading size.
   const sized=target.locator('span[data-font-size="32"]');

   await drag(target);await shows('선택한 글자 크기',String(expected));await list.click();await pick(32).click();
   await sized.waitFor();assert.equal(await drawn(sized),32);await shows('선택한 글자 크기','32');
   await list.click();await reset.waitFor();assert.equal(await reset.isDisabled(),false);await reset.click();
   await sized.waitFor({state:'detached'});await shows('선택한 글자 크기',String(expected));
   await list.click();await pick(32).click();await sized.waitFor();
   await body.focus();await page.keyboard.press('ControlOrMeta+z');await sized.waitFor({state:'detached'});
   assert.equal(await body.locator('span[data-font-size]').count(),0);assert(Math.abs(await drawn(target)-size*ratio)<.01);

   return {box,drag,shows,para,target,drawn};
  }

  const studio=page.locator('.editor-panes > .editor-shell');

  for(const tag of ['h1','h2','h3'])await check(studio,tag,ratios[tag],18);

  // Changing the manuscript size moves the heading with it, and the box follows.
  const {box,drag,shows,para,target,drawn}=await check(studio,'h2',ratios.h2,18);

  await para.click();await box('본문 크기').fill('20');await box('본문 크기').press('Enter');
  await until(page,async()=>Math.abs(await drawn(target)-20*ratios.h2)<.01,'heading follows the manuscript size');
  await drag(target);await shows('선택한 글자 크기',String(shownSize(20,ratios.h2)));
  await page.screenshot({path:resolve(output,`studio-${width}.png`)});
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('orbis-editor-preferences'))).size,20);
  assert.equal(JSON.stringify(data).includes('fontSize'),false);

  await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'networkidle'});const notes=page.locator('.notes-workspace .editor-shell');await notes.locator('.manuscript').waitFor();
  await check(notes,'h2',ratios.noteH2,20);
  await page.screenshot({path:resolve(output,`notes-${width}.png`)});
  results.push({width,cloud:cloudSeen});closing=true;await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({engine,results,errors},null,2));console.log(JSON.stringify({engine,results,errors,output}));
}catch(error){console.log(JSON.stringify({errors}));

if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
