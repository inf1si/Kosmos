// Synthetic workspace only. Run through tsx; Supabase and same-origin endpoints are intercepted.
// The toolbar's 줄·문단 간격 changes the same device values as 설정 › 원고 표시; old untouched defaults move to the narrower ones.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {workspaceSchema} from '../../src/lib/model.ts';
import {newNote,addNote} from '../../src/lib/personal-notes.ts';
import {PALETTES} from '../../src/lib/theme.ts';

const require=createRequire(import.meta.url),playwright=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/manuscript-spacing/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const errors=[],results=[],quick=process.env.KOSMOS_QUICK==='1';

let activePage;

const until=async(page,check,label)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(80);}

assert.fail(`Timed out: ${label}`);};

const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),bullets=(...items)=>({type:'bulletList',content:items.map(text=>({type:'listItem',content:[paragraph(text)]}))});

try{
 for(const width of [1280,360]){
  let data=seedWorkspace();const scene=data.works[0].documents.find(doc=>doc.kind==='scene');

  scene.title='합성 원고';scene.content={type:'doc',content:[paragraph('첫 문단입니다.'),paragraph('둘째 문단입니다.'),bullets('항목 하나','항목 둘')]};
  const note={...newNote(),title:'합성 노트',content:{type:'doc',content:[paragraph('노트 문단입니다.'),paragraph('노트 둘째 문단.')]}};data=addNote(data,note);workspaceSchema.parse(data);
  let version=1,cloudSeen=false,closing=false;
  const context=await browser.newContext({viewport:{width,height:900}});
  const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-10-25T00:00:00.000Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  // A preference object saved before the change: the old defaults written out in full, plus a dragged sidebar width.
  await context.addInitScript(({profile,token})=>{
   if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last',lineHeight:2,paragraphIndent:1,paragraphGap:1.2,manuscriptWidth:680,sidebarWidth:300}));}

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

  const shell=page.locator('.editor-panes > .editor-shell'),body=shell.locator('.manuscript');

  const spacing=()=>body.evaluate(el=>{const p=el.querySelector(':scope > p'),li=el.querySelector('li p'),size=parseFloat(getComputedStyle(el).fontSize);

return {line:Math.round(parseFloat(getComputedStyle(el).lineHeight)/size*100)/100,gap:Math.round(parseFloat(getComputedStyle(p).marginBottom)/size*100)/100,item:Math.round(parseFloat(getComputedStyle(li).marginBottom)/size*100)/100};});

  const shows=(line,gap,label)=>until(page,async()=>{const s=await spacing();

return s.line===line&&s.gap===gap&&s.item===gap;},`${label}: ${line}/${gap}`);

  const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kosmos-app-preferences')||'null'));
  const button=shell.getByRole('button',{name:'줄·문단 간격',exact:true}),popover=page.getByRole('dialog',{name:'줄·문단 간격',exact:true});
  const choice=(group,label)=>popover.getByRole('group',{name:group,exact:true}).getByRole('button',{name:label,exact:true});
  const pressed=async group=>(await popover.getByRole('group',{name:group,exact:true}).locator('[aria-pressed=true]').allTextContents()).join();

  // The untouched old defaults now show the narrower layout; the other saved values stay.
  await shows(1.8,0.6,'old defaults follow the new ones');
  assert.equal((await stored()).sidebarWidth,300);

  // Toolbar: both groups, two choices in a row without closing, Escape returns to the manuscript.
  await body.locator('p').first().click();
  await button.click();await popover.waitFor();
  assert.equal(await pressed('줄간격'),'1.8');assert.equal(await pressed('문단 간격'),'0.6줄');

  const fits=await popover.evaluate(el=>{const box=el.getBoundingClientRect();

return [...el.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();

return r.left>=box.left-.5&&r.right<=box.right+.5;})&&box.left>=0&&box.right<=innerWidth;});

  assert(fits,'popover buttons stay inside the popover and the screen');
  await page.screenshot({path:resolve(output,`toolbar-${width}.png`)});
  await choice('줄간격','2.2').click();await shows(2.2,0.6,'toolbar line height');
  await choice('문단 간격','1.2줄').click();await shows(2.2,1.2,'toolbar paragraph gap');
  assert.equal(await popover.isVisible(),true,'stays open for the next choice');
  assert.equal(await pressed('줄간격'),'2.2');assert.equal(await pressed('문단 간격'),'1.2줄');
  await page.keyboard.press('Escape');await popover.waitFor({state:'detached'});
  await until(page,()=>body.evaluate(el=>el===document.activeElement),'focus returns to the manuscript');
  assert.deepEqual((({lineHeight,paragraphGap,spacingDefaults,sidebarWidth})=>({lineHeight,paragraphGap,spacingDefaults,sidebarWidth}))(await stored()),{lineHeight:2.2,paragraphGap:1.2,spacingDefaults:2,sidebarWidth:300});

  // One click moves from this popover to the paragraph format panel, whose default names the line height the manuscript shows.
  await button.click();await popover.waitFor();
  await shell.getByRole('button',{name:'문단 서식',exact:true}).click();
  const formatPanel=page.getByRole('dialog',{name:'문단 서식',exact:true});await formatPanel.waitFor();await popover.waitFor({state:'detached'});
  assert.match(await formatPanel.getByRole('combobox',{name:'줄간격',exact:true}).textContent(),/기본 · 2\.2배/);
  await page.keyboard.press('Escape');await formatPanel.waitFor({state:'detached'});

  // Settings shows the toolbar's values, and a change there reaches the manuscript and the toolbar.
  const tools=page.locator('.studio-tools');

  if(!await tools.isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
  await tools.getByRole('button',{name:'설정',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'설정',exact:true});await settings.getByRole('button',{name:'원고 표시',exact:true}).click();
  const row=name=>settings.getByRole('group',{name,exact:true});
  assert.equal(await row('줄간격').getByRole('button',{name:'2.2',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await row('문단 간격').getByRole('button',{name:'1.2줄',exact:true}).getAttribute('aria-pressed'),'true');
  await row('줄간격').getByRole('button',{name:'1.6',exact:true}).click();
  await page.keyboard.press('Escape');await settings.waitFor({state:'detached'});

  if(width<700&&await page.locator('.studio-sidebar').isVisible())await page.keyboard.press('Escape');
  await shows(1.6,1.2,'settings change');
  await button.click();await popover.waitFor();assert.equal(await pressed('줄간격'),'1.6');await page.keyboard.press('Escape');

  // Survives a reload, and the old-default rule does not take the 2 / 1.2 chosen afterwards back.
  await button.click();await popover.waitFor();await choice('줄간격','2').click();await shows(2,1.2,'chosen 2');await page.keyboard.press('Escape');
  await page.reload({waitUntil:'networkidle'});await body.waitFor();await shows(2,1.2,'after reload');

  // Notes keep their own spacing and have no manuscript spacing control.
  await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'networkidle'});const notes=page.locator('.notes-workspace .editor-shell');await notes.locator('.manuscript').waitFor();
  assert.equal(await notes.getByRole('button',{name:'줄·문단 간격',exact:true}).count(),0);

  const noteSpacing=await notes.locator('.manuscript').evaluate(el=>{const size=parseFloat(getComputedStyle(el).fontSize);

return [Math.round(parseFloat(getComputedStyle(el).lineHeight)/size*100)/100,Math.round(parseFloat(getComputedStyle(el.querySelector('p')).marginBottom)/size*100)/100];});

  assert.deepEqual(noteSpacing,[1.85,0.6]);
  await notes.getByRole('button',{name:'문단 서식',exact:true}).click();
  assert.match(await page.getByRole('dialog',{name:'문단 서식',exact:true}).getByRole('combobox',{name:'줄간격',exact:true}).textContent(),/기본 · 1\.85배/);
  await page.keyboard.press('Escape');

  // The open popover in every palette and mode.
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await body.waitFor();
  const combos=quick?[['violet','light'],['cassette','dark'],['cyber','dark'],['ink','light']]:PALETTES.flatMap(p=>[[p,'light'],[p,'dark']]);
  const sheet=[];

  await button.click();await popover.waitFor();

  for(const [palette,mode] of combos){
   await page.evaluate(([palette,mode])=>{document.documentElement.setAttribute('data-palette',palette);document.documentElement.setAttribute('data-theme',mode);},[palette,mode]);

   const check=await popover.evaluate(el=>{const box=el.getBoundingClientRect(),buttons=[...el.querySelectorAll('.segmented button')];

return {inside:buttons.every(b=>{const r=b.getBoundingClientRect();

return r.left>=box.left-.5&&r.right<=box.right+.5&&r.height>=20;}),onScreen:box.left>=0&&box.right<=innerWidth,pressed:buttons.flatMap(b=>b.getAttribute('aria-pressed')==='true'?[[getComputedStyle(b).backgroundColor,getComputedStyle(b).color]]:[])};});

   assert(check.inside&&check.onScreen,`${palette}/${mode} ${width}: popover layout`);
   assert.equal(check.pressed.length,2,`${palette}/${mode}: two pressed choices`);
   assert(check.pressed.every(([bg,fg])=>bg!==fg),`${palette}/${mode}: pressed text is visible`);
   sheet.push(`${palette}-${mode}`);

   if(['violet','cassette','cyber','ink','tron','empire'].includes(palette))await popover.screenshot({path:resolve(output,`popover-${palette}-${mode}-${width}.png`)});
  }

  results.push({width,combos:sheet.length});
  closing=true;await context.close();
 }

 assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}catch(error){
 if(activePage)await activePage.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});
 throw error;
}finally{await browser.close();}
