// Synthetic workspace only. Supabase and same-origin write endpoints are intercepted on deployed runs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {getSchema} from '@tiptap/core';
import {editorExtensions,noteExtensions,NoteImage} from '../../src/lib/editor-extensions.ts';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {fromText,workspaceSchema,makePublication,newDocument,uid} from '../../src/lib/model.ts';
import {newNote,addNote} from '../../src/lib/personal-notes.ts';
import {PALETTES} from '../../src/lib/theme.ts';

const require=createRequire(import.meta.url),playwright=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/workspace-search/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const palettes=process.env.KOSMOS_SEARCH_QUICK==='1'?PALETTES.slice(0,1):PALETTES;

const errors=[],results=[],schema=getSchema([...editorExtensions,...noteExtensions,NoteImage]);

let activePage;

const until=async(page,check,label)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(80);}

assert.fail(`Timed out: ${label}`);};

try{
 for(const width of [1280,360]){
  let data=seedWorkspace();const work=data.works[0],scene=work.documents.find(doc=>doc.kind==='scene'),wiki=work.documents.find(doc=>doc.kind==='wiki');
  scene.title='현재 원고';scene.content=fromText('보존할 원고 문장.\n\n은하의 별빛을 기다렸다.');wiki.title='별빛 기록';wiki.content=fromText('현재 작품의 설정 기록.');
  const note={...newNote(),title:'별빛',content:fromText('별빛을 적은 노트 본문.')},taskNote={...newNote(),title:'할 일 자료',content:{type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:'보랏빛 확인점'}]}]}]}]}};
  data=addNote(addNote(data,note),taskNote);

  for(let i=0;i<56;i++)data=addNote(data,{...newNote(),title:`나눔자료 ${i}`,content:fromText('페이지넘김 시험 본문.')});
  const foreign=newDocument('memo','다른 작품 기록');foreign.content=fromText([...Array.from({length:75},(_,i)=>`배경 설명 ${i}입니다.`),'멀리서 수신좌표를 확인했다.','푸른 별빛을 찾았다.'].join('\n\n'));
  const foreignWork={...work,id:uid(),title:`별도 작품 ${'긴 제목 '.repeat(20)}`,documents:[foreign],navigation:undefined,publications:[],activePublicationId:null};data.works.push(foreignWork);workspaceSchema.parse(data);
  let version=1,cloudSeen=false,closing=false,writes=0;
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
   else if(path.endsWith('/save_workspace')){const input=request.postDataJSON();assert.equal(input.p_base_version,version);data=workspaceSchema.parse(input.p_payload);version++;writes++;value={status:'saved',version};}
   else if(path.endsWith('/publish_work')){const input=request.postDataJSON(),w=data.works.find(w=>w.id===input.p_work_id);value=makePublication(w,input.p_scene_ids);}

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

  const stored=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').getAll();get.onsuccess=()=>resolve(get.result.map(row=>row.data));get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};}));
  const contents=(state,normalize=false)=>JSON.stringify([...state.works.flatMap(work=>work.documents.map(doc=>({id:doc.id,content:normalize?schema.nodeFromJSON(doc.content).toJSON():doc.content}))),...(state.notes||[]).map(note=>({id:note.id,content:normalize?schema.nodeFromJSON(note.content).toJSON():note.content}))].sort((a,b)=>a.id.localeCompare(b.id)));
  const original=contents(data),normalizedOriginal=contents(data,true);await page.getByLabel(`${scene.title} 원고`,{exact:true}).waitFor();
  const dialog=page.getByRole('dialog',{name:'전체 검색',exact:true}),input=dialog.getByRole('combobox',{name:'전체 검색어',exact:true}),scope=dialog.getByLabel('검색 범위',{exact:true}),list=dialog.getByRole('listbox',{name:'전체 검색 결과'});
  const open=async()=>{await page.keyboard.press('ControlOrMeta+k');await dialog.waitFor();assert.equal(await input.evaluate(el=>el===document.activeElement),true);};

  const query=async value=>{await input.fill(value);await until(page,()=>list.getAttribute('aria-busy').then(value=>value==='false'),'deferred search complete');};

  await page.getByLabel(`${scene.title} 원고`,{exact:true}).click();

  if(width===1280){await page.locator('[data-workspace-search-opener]').click();await dialog.waitFor();assert.equal(await input.evaluate(el=>el===document.activeElement),true);}else await open();assert.equal(await scope.inputValue(),'all');await query('별빛');
  await until(page,()=>list.getByRole('option').count().then(count=>count===4),'all work and note results');
  assert.equal(await list.getByRole('option').first().locator('strong').innerText(),'별빛');assert.equal(await list.getByRole('option').nth(1).locator('strong').innerText(),'별빛 기록');assert((await list.locator('mark').count())>0);
  await dialog.getByRole('button',{name:'전체 검색어 지우기',exact:true}).click();assert.equal(await input.inputValue(),'');assert.equal(await input.evaluate(el=>el===document.activeElement),true);await query('별빛');
  await scope.selectOption('notes');await until(page,()=>list.getByRole('option').count().then(count=>count===1),'notes scope');
  await scope.selectOption('current');await until(page,()=>list.getByRole('option').count().then(count=>count===2),'current work scope');
  await scope.selectOption(foreignWork.id);await until(page,()=>list.getByRole('option').count().then(count=>count===1),'specific work scope');
  await scope.selectOption('all');await until(page,()=>list.getByRole('option').count().then(count=>count===4),'all scope restored');

  for(const palette of palettes)for(const mode of ['light','dark']){
   await page.evaluate(([p,m])=>{document.documentElement.dataset.palette=p;document.documentElement.dataset.theme=m;},[palette,mode]);
   const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,`${palette}/${mode}/${width} dialog bounds`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
   const styles=await list.getByRole('option').last().locator('.workspace-search-snippet').evaluate(el=>({clamp:getComputedStyle(el).webkitLineClamp,size:getComputedStyle(el).fontSize}));assert.equal(styles.clamp,'2');assert.equal(styles.size,'12px');
   await dialog.screenshot({path:resolve(output,`${palette}-${mode}-${width}.png`)});
  }

  await page.evaluate(()=>{document.documentElement.dataset.palette='violet';document.documentElement.dataset.theme='light';});
  await query('수신좌표');await until(page,()=>list.getByRole('option').count().then(count=>count===1),'late body match');assert((await list.getByRole('option').innerText()).includes('수신좌표'));await input.press('Enter');
  const foreignEditor=page.getByLabel(`${foreign.title} 원고`,{exact:true});await foreignEditor.waitFor();
  await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(text=>text==='수신좌표'),'foreign work text selection');
  const mark=foreignEditor.locator('.editor-search-match.current');await mark.waitFor();assert.equal(await mark.innerText(),'수신좌표');assert.equal(await foreignEditor.evaluate(el=>el===document.activeElement),true);
  const bounds=await mark.boundingBox(),scrollBounds=await page.locator('.editor-scroll').first().boundingBox();assert(bounds.y>=scrollBounds.y&&bounds.y+bounds.height<=scrollBounds.y+scrollBounds.height,'search target scrolls into the editor viewport');
  assert((await page.locator('.editor-scroll').first().evaluate(el=>el.scrollTop))>0);await page.screenshot({path:resolve(output,`body-jump-${width}.png`)});
  await until(page,async()=>{const states=await stored();

return states.some(state=>contents(state)===original);},'search does not mutate persisted documents');
  await foreignEditor.press('Escape');assert.equal(await mark.count(),0);await foreignEditor.press('ArrowRight');await page.keyboard.insertText('!');await until(page,()=>foreignEditor.innerText().then(text=>text.includes('좌표!')),'intentional edit at selected search result');await foreignEditor.press('ControlOrMeta+z');
  await until(page,()=>foreignEditor.innerText().then(text=>!text.includes('좌표!')),'undo only the intentional edit');
  await open();await query('별빛');await scope.selectOption('notes');await list.getByRole('option').first().click();
  const noteEditor=page.getByLabel('노트 본문',{exact:true});await noteEditor.waitFor();await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(text=>text==='별빛'),'work to note body jump');assert.equal(await noteEditor.evaluate(el=>el===document.activeElement),true);
  await open();assert.equal(await scope.inputValue(),'all');await query('보랏빛');await input.press('Enter');await until(page,()=>noteEditor.locator('.editor-search-match.current').innerText().then(text=>text==='보랏빛'),'checklist note jump');
  await open();await query('.*');await until(page,()=>list.getByRole('option').count().then(count=>count===0),'literal regex characters');await dialog.getByText('검색 결과가 없습니다.',{exact:true}).waitFor();
  await query('페이지넘김');await until(page,()=>list.getByRole('option').count().then(count=>count===50),'first result page');await dialog.getByRole('button',{name:'더 보기',exact:true}).focus();await page.keyboard.press('Enter');await until(page,()=>list.getByRole('option').count().then(count=>count===56),'expanded result page');assert.equal(await input.evaluate(el=>el===document.activeElement),true);await list.getByRole('option').last().click();await until(page,()=>noteEditor.locator('.editor-search-match.current').innerText().then(text=>text==='페이지넘김'),'paginated note jump');
  await noteEditor.press('ArrowRight');await open();await query('현재 원고');await input.press('Enter');await page.getByLabel(`${scene.title} 원고`,{exact:true}).waitFor();
  await until(page,()=>page.getByLabel(`${scene.title} 원고`,{exact:true}).evaluate(el=>el===document.activeElement),'title result focuses body');
  await open();await query('없음검색확인');await input.press('Escape');assert.equal(await dialog.count(),0);await until(page,()=>page.getByLabel(`${scene.title} 원고`,{exact:true}).evaluate(el=>el===document.activeElement),'Escape returns focus after dialog cleanup');
  await page.getByLabel(`${scene.title} 원고`,{exact:true}).press('ControlOrMeta+f');await page.getByRole('textbox',{name:'찾을 내용',exact:true}).waitFor();await page.getByRole('textbox',{name:'찾을 내용',exact:true}).fill('별빛');await page.getByRole('button',{name:'다음 검색 결과',exact:true}).click();await until(page,()=>page.getByLabel(`${scene.title} 원고`,{exact:true}).locator('.editor-search-match.current').innerText().then(text=>text==='별빛'),'local Ctrl F remains scoped');await page.keyboard.press('Escape');await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(text=>text==='별빛'),'local find returns the document selection');

  if(width===1280){await page.getByRole('button',{name:'옆에 열기',exact:true}).click();const split=page.locator('.split-pane .manuscript');await split.waitFor();await split.click();await open();await query('수신좌표');await input.press('Enter');await foreignEditor.waitFor();await until(page,()=>foreignEditor.evaluate(el=>el===document.activeElement),'global search from split focuses the opened target');}

  const states=await stored();

  if(!states.some(state=>contents(state,true)===normalizedOriginal)){const before=JSON.parse(normalizedOriginal),after=JSON.parse(contents(states[0],true));await writeFile(resolve(output,'body-differences.json'),JSON.stringify(before.flatMap(doc=>{const next=after.find(value=>value.id===doc.id);

return JSON.stringify(doc)===JSON.stringify(next)?[]:[{before:doc,after:next}];}),null,2));}

  assert(states.some(state=>contents(state,true)===normalizedOriginal),'search and intentional edit undo preserve every body and formatting after editor schema normalization');
  results.push({width,palettes:palettes.length,modes:2,cloud:cloudSeen,simulatedSaves:writes});closing=true;await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({engine,results,errors},null,2));console.log(JSON.stringify({engine,results,errors,output}));
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
