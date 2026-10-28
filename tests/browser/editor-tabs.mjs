// Uses synthetic account/workspace responses, including on production. No writer credentials or writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {bookFixture} from '../fixtures/book-work.ts';
import {workspaceSchema,newDocument,fromText,uid} from '../../src/lib/model.ts';
import {PALETTES} from '../../src/lib/theme.ts';

const require=createRequire(import.meta.url),playwright=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/editor-tabs/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const results=[],errors=[],failedRequests=[],palettes=process.env.KOSMOS_TABS_QUICK==='1'?PALETTES.slice(0,1):PALETTES;

let activePage;

try{
 for(const width of [1280,360]){
  const fixture=bookFixture();fixture.first.title='가';fixture.second.title='나';fixture.memo.title='다';

  for(const title of ['라','마','아주 긴 문서 제목으로 탭 말줄임도 확인합니다']){const doc=newDocument('scene',title);doc.content=fromText(`보존할 ${title} 본문`);fixture.work.documents.push(doc);fixture.work.navigation.nodes.push({id:doc.id,type:'document',sectionId:'scene',parentId:null});}

  const other={id:uid(),title:'다른 작품',subtitle:'',description:'',form:'단편',documents:[newDocument('scene','다른 문서')],publications:[],activePublicationId:null};fixture.data.works.push(other);
  let data=workspaceSchema.parse(fixture.data),version=1,cloudSeen=false,writes=0;
  const context=await browser.newContext({viewport:{width,height:1000}}),profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-10-26T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  await context.addInitScript(({profile,token})=>{
   if(window!==window.top)return;

   // Safari before 18.4 has no Iterator helpers; tabs must still work there.
   const iterator=Object.getPrototypeOf(Object.getPrototypeOf([].values()));

   for(const name of ['map','filter','take','drop','flatMap','reduce','toArray','forEach','some','every','find'])delete iterator[name];

   localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));
   localStorage.setItem('sb-krakjollsufgnwealroh-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
  },{profile,token});
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}));
  await context.route('**/rest/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;cloudSeen=true;let value={};

   if(path.endsWith('/authors'))value={user_id:profile.id};
   else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version};
   else if(path.endsWith('/save_workspace')){const input=request.postDataJSON();data=workspaceSchema.parse(input.p_payload);version++;writes++;value={status:'saved',version};}

   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',request=>{const url=new URL(request.url());failedRequests.push({url:url.origin+url.pathname,error:request.failure()?.errorText});});
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();

  if(!cloudSeen){
   await page.evaluate(data=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put({namespace:'preview',data,localVersion:1,cloudVersion:0,dirty:false,lastExportAt:null});tx.oncomplete=()=>{db.close();resolve();};

tx.onerror=()=>reject(tx.error);};}),data);
   await page.reload({waitUntil:'networkidle'});
  }

  const stored=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').getAll();get.onsuccess=()=>resolve(get.result.map(record=>record.data));tx.oncomplete=()=>db.close();};}));
  const before=JSON.stringify(await stored());

  const tabs=()=>page.locator('[data-editor-tabs]'),labels=()=>tabs().getByRole('tab'),ids=()=>tabs().locator('[data-tab-id]').evaluateAll(rows=>rows.map(row=>row.dataset.tabId)),active=()=>tabs().getByRole('tab',{selected:true}).innerText();

  const sidebar=async()=>{const toggle=page.locator('#sidebar-toggle');

if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();};

  const openDoc=async doc=>{await sidebar();await page.locator(`[data-navigation-row="${doc.id}"]`).getByTitle(doc.title,{exact:true}).click();};

  const openView=async title=>{await sidebar();await page.locator('.studio-sidebar').getByRole('button',{name:title,exact:true}).click();};

  for(const doc of fixture.work.documents)await openDoc(doc);

  for(const title of ['집필실 홈','플롯보드','문서 그래프'])await openView(title);
  await openDoc(fixture.second);
  const original=await ids(),selected=await active(),body=await page.locator('.editor-panes .manuscript').allTextContents();

  async function start(index=0){
   const button=labels().nth(index);await button.scrollIntoViewIfNeeded();const b=await button.boundingBox(),r=await tabs().boundingBox();
   const left=Math.max(b.x,r.x),right=Math.min(b.x+b.width,r.x+r.width);assert(right>left,'tab label is reachable');
   const x=(left+right)/2,y=b.y+b.height/2;await page.mouse.move(x,y);await page.mouse.down();

return {x,y};
  }

  // Cross the 6px drag threshold even when the authenticated mobile toolbar leaves a narrow tab list.
  async function enterEdge(side){const b=await tabs().boundingBox();await page.mouse.move(side==='end'?b.x+b.width+12:b.x-12,b.y+b.height/2,{steps:8});await page.mouse.move(side==='end'?b.x+b.width-2:b.x+2,b.y+b.height/2);

return b;}

  async function edge(side){const b=await enterEdge(side);await tabs().locator('.doc-tab[data-tab-dragging=true]').waitFor();await page.waitForFunction(({side})=>{const el=document.querySelector('[data-editor-tabs]');

return side==='end'?el.scrollLeft>=el.scrollWidth-el.clientWidth-2:el.scrollLeft<=1;},{side});await page.mouse.move(side==='end'?b.x+b.width-2:b.x+2,b.y+b.height/2);}

  // Across the overflow area, real pointer capture and edge scrolling must keep working.
  await start();await edge('end');await page.mouse.up();assert.deepEqual(await ids(),[...original.slice(1),original[0]]);assert.equal(await active(),selected);assert.deepEqual(await page.locator('.editor-panes .manuscript').allTextContents(),body);
  await start(original.length-1);await edge('start');await page.mouse.up();assert.deepEqual(await ids(),original);assert.equal(await active(),selected);
  // A cancelled drag and an outside release do not navigate or reorder.
  await start();let r=await enterEdge('end');await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await ids(),original);assert.equal(await active(),selected);
  await start();r=await enterEdge('end');await page.mouse.move(r.x+r.width-2,r.y+r.height+55,{steps:6});await page.mouse.up();assert.deepEqual(await ids(),original);assert.equal(await active(),selected);
  // Reordering by keyboard leaves the focused/selected document intact.
  await labels().first().focus();await page.keyboard.press('Alt+ArrowRight');assert.deepEqual(await ids(),[original[1],original[0],...original.slice(2)]);await page.keyboard.press('Alt+ArrowLeft');assert.deepEqual(await ids(),original);
  const smallTitle=await labels().nth(1).innerText(),small=await start(1);await page.mouse.move(small.x+3,small.y);await page.mouse.up();assert.equal(await active(),smallTitle);assert.deepEqual(await ids(),original);
  // The hover title names the tab only; how to move tabs belongs in the guide, not a tooltip on every tab.
  assert.equal(await labels().first().getAttribute('title'),await labels().first().innerText());
  const first=await labels().first().innerText();await labels().first().click();assert.equal(await active(),first);assert.deepEqual(await ids(),original);
  const menu=()=>page.getByRole('menu',{name:/탭 메뉴$/}),action=name=>menu().getByRole('menuitem',{name,exact:true});

  async function right(index){const button=labels().nth(index);await button.scrollIntoViewIfNeeded();await button.click({button:'right'});await menu().waitFor();}

  await right(0);assert.equal(await action('왼쪽으로 이동').isDisabled(),true);await action('오른쪽으로 이동').click();assert.deepEqual(await ids(),[original[1],original[0],...original.slice(2)]);assert.equal(await active(),first);
  await right(1);await action('왼쪽으로 이동').click();assert.deepEqual(await ids(),original);
  await right(1);assert.equal(await active(),first);await action('옆에 열기').click();assert.equal(await page.locator('.editor-panes .manuscript').count(),2);assert.equal(await active(),first);await page.getByRole('button',{name:'옆에 열기',exact:true}).click();
  await labels().first().focus();await page.keyboard.press('Shift+F10');await menu().waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-editor-tabs] [role=tab]'));
  // Split panes and close buttons keep their existing targets.
  await page.getByRole('button',{name:'옆에 열기',exact:true}).click();assert.equal(await page.locator('.editor-panes .manuscript').count(),2);const splitBody=await page.locator('.editor-panes .manuscript').allTextContents();await labels().first().focus();await page.keyboard.press('Alt+ArrowRight');assert.deepEqual(await page.locator('.editor-panes .manuscript').allTextContents(),splitBody);await page.keyboard.press('Alt+ArrowLeft');await page.getByRole('button',{name:'옆에 열기',exact:true}).click();

  for(const palette of palettes)for(const mode of ['light','dark']){
   await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});
   await page.evaluate(()=>document.fonts.ready);
   await start();r=await enterEdge('end');await tabs().locator('[data-drop-edge]').first().waitFor();

   const metrics=await tabs().evaluate(root=>{const row=root.querySelector('[data-drop-edge]'),source=root.querySelector('[data-tab-dragging]'),style=getComputedStyle(row,'::after'),bounds=root.getBoundingClientRect();

return {lineWidth:style.width,lineColor:style.backgroundColor,link:getComputedStyle(root).getPropertyValue('--link').trim(),opacity:getComputedStyle(source).opacity,font:getComputedStyle(root.querySelector('[role=tab]')).fontSize,left:bounds.left,right:bounds.right,viewport:innerWidth};});

   assert.equal(metrics.lineWidth,'2px');assert.equal(metrics.opacity,'0.5');assert(metrics.left>=0&&metrics.right<=width+1);assert.equal(await active(),first);results.push({width,palette,mode,...metrics});

   if(palette===palettes[0]||palette===palettes.at(-1))await page.locator('.panel-tabs').screenshot({path:resolve(output,`${width}-${palette}-${mode}.png`)});
   await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await ids(),original);
   await right(0);const menuBounds=await menu().boundingBox();assert(menuBounds.x>=0&&menuBounds.x+menuBounds.width<=width+1);assert(menuBounds.y>=0&&menuBounds.y+menuBounds.height<=1001);assert.equal(await action('왼쪽으로 이동').isDisabled(),true);

   if(palette===palettes[0]||palette===palettes.at(-1))await page.screenshot({path:resolve(output,`${width}-${palette}-${mode}-menu.png`)});
   await page.keyboard.press('Escape');
  }

  if(engine==='chromium'&&width===360){
   const session=await context.newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
   await labels().first().scrollIntoViewIfNeeded();const r=await tabs().boundingBox(),beforeScroll=await tabs().evaluate(el=>el.scrollLeft),x=r.x+r.width-10,y=r.y+r.height/2;
   const touch=(type,x,y)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
   await touch('touchStart',x,y);

for(let step=1;step<=6;step++){await touch('touchMove',x-step*8,y);await page.waitForTimeout(20);}

await touch('touchEnd');
   await page.waitForFunction(before=>document.querySelector('[data-editor-tabs]').scrollLeft>before,beforeScroll);assert.deepEqual(await ids(),original,'touch swipes scroll instead of moving tabs');
   const button=labels().nth(1);await button.scrollIntoViewIfNeeded();const b=await button.boundingBox(),clip=await tabs().boundingBox(),tx=(Math.max(b.x,clip.x)+Math.min(b.x+b.width,clip.x+clip.width))/2,ty=b.y+b.height/2;
   await touch('touchStart',tx,ty);await menu().waitFor();await touch('touchEnd');assert.equal(await active(),first,'long press does not activate the tab');
   const option=await action('왼쪽으로 이동').boundingBox();await touch('touchStart',option.x+option.width/2,option.y+option.height/2);await touch('touchEnd');await page.waitForFunction(id=>document.querySelector('[data-editor-tabs] [data-tab-id]').dataset.tabId===id,original[1]);assert.deepEqual(await ids(),[original[1],original[0],...original.slice(2)]);
   await labels().first().focus();await page.keyboard.press('Alt+ArrowRight');assert.deepEqual(await ids(),original);await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  }

  await tabs().getByRole('button',{name:`${first} 탭 닫기`,exact:true}).scrollIntoViewIfNeeded();await tabs().getByRole('button',{name:`${first} 탭 닫기`,exact:true}).click();assert.equal((await ids()).length,original.length-1);assert(!(await ids()).includes(original[0]));
  await openDoc(fixture.first);assert.equal((await ids()).at(-1),fixture.first.id,'reopened tab is appended');
  const closingOrder=await ids(),keep=await labels().nth(1).innerText();await right(1);await action('오른쪽 탭 닫기').click();assert.deepEqual(await ids(),closingOrder.slice(0,2));assert.equal(await active(),keep);
  const only=await labels().first().innerText(),onlyId=(await ids())[0];await right(0);await action('다른 탭 닫기').click();assert.deepEqual(await ids(),[onlyId]);assert.equal(await active(),only);
  await right(0);

for(const name of ['탭 닫기','다른 탭 닫기','오른쪽 탭 닫기','왼쪽으로 이동','오른쪽으로 이동'])assert.equal(await action(name).isDisabled(),true,name);await page.keyboard.press('Escape');
  await openDoc(fixture.first);await right(1);await action('탭 닫기').click();assert.deepEqual(await ids(),[onlyId]);assert.equal(await active(),only);
  await sidebar();await page.getByTitle('작품 전환',{exact:true}).click();await page.locator('#work-menu').getByRole('button',{name:/다른 작품/}).click();assert((await ids()).every(id=>id==='home'||id===other.documents[0].id),'work changes reset tabs');
  assert.equal(JSON.stringify(await stored()),before,'tab movement must not alter source/navigation/backup payload');assert.equal(writes,0);
  await page.reload({waitUntil:'networkidle'});assert.equal(JSON.stringify(await stored()),before);
  await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({base,engine,results,errors},null,2));console.log(JSON.stringify({engine,base,cases:results.length,sourceUnchanged:true}));
}catch(error){if(activePage&&!activePage.isClosed()){await activePage.screenshot({path:resolve(output,'failure.png'),fullPage:true});await writeFile(resolve(output,'failure.json'),JSON.stringify({errors,failedRequests,page:await activePage.evaluate(()=>{const root=document.querySelector('[data-editor-tabs]');

return {palette:document.documentElement.dataset.palette,mode:document.documentElement.dataset.theme,scroll:root?.scrollLeft,bounds:root?.getBoundingClientRect().toJSON(),rows:[...root?.querySelectorAll('[data-tab-id]')||[]].map(row=>({id:row.dataset.tabId,drag:row.dataset.tabDragging,edge:row.dataset.dropEdge,rect:row.getBoundingClientRect().toJSON()}))};})},null,2));}

throw error;}
finally{await browser.close();}
