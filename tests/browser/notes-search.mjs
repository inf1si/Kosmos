// Synthetic workspace/auth responses on local and production runs. No real account or manuscript writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {fromText,newDocument,uid,workspaceSchema} from '../../src/lib/model.ts';
import {addNote,newNote} from '../../src/lib/personal-notes.ts';
import {editNoteTree,moveNote} from '../../src/lib/note-navigation.ts';
import {insertFolder} from '../../src/lib/document-navigation.ts';
import {PALETTES} from '../../src/lib/theme.ts';
import {chooseOption,selectedValue} from './select.mjs';

const require=createRequire(import.meta.url),pw=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',out=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/notes-search'),quick=process.env.KOSMOS_SEARCH_QUICK==='1';

await mkdir(out,{recursive:true});

const browser=await pw.chromium.launch({headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}),errors=[],results=[];

const until=async(page,check,label)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(50);}

assert.fail(label);};

let currentPage;

try{
 for(const width of [1280,360]){
  let data=seedWorkspace(),writes=0;
  const late={...newNote(),title:'항해 자료',tags:['조사'],linkedWorkIds:[data.works[0].id],content:fromText([...Array.from({length:75},(_,i)=>`배경 설명 ${i}. 먼 행성을 관측하는 사람들의 기록입니다.`),'수신좌표를 확인했다. 수신좌표와 출발지를 기록했다.'].join('\n\n'))};
  const exact={...newNote(),title:'수신좌표',content:fromText('제목이 먼저 나오는 노트.')};
  const ice={...newNote(),title:'보류한 기록',box:'icebox',tags:['보류'],linkedWorkIds:[data.works[1].id],content:fromText('수신좌표를 비교한 아이스박스 기록.')};
  const property={...newNote(),title:'속성 자료',content:fromText('본문에는 없는 속성을 찾는다.'),customProperties:[{id:uid(),name:'추진제',type:'text',value:'중수소'}]};

  for(const note of [late,exact,ice,property,...Array.from({length:55},(_,i)=>({...newNote(),title:`공용자료 ${i}`,content:fromText('페이지검색어를 찾는 노트.')}))])data=addNote(data,note);
  data=editNoteTree(data,work=>insertFolder(work,'관측일지',{sectionId:'notes',parentId:null}));const folder=data.noteNavigation.nodes.find(node=>node.type==='folder'&&node.title==='관측일지');data=moveNote(data,late.id,{parentId:folder.id});
  const foreign=newDocument('memo','다른 작품 기록');foreign.content=fromText('다른 작품의 수신좌표를 확인했다.');data.works[1].documents.push(foreign);workspaceSchema.parse(data);
  data.works[0].documents.find(doc=>doc.kind==='scene').content=fromText('집필실의 수신좌표를 확인했다.');
  const original=JSON.stringify(data),context=await browser.newContext({viewport:{width,height:1000}});
  const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-11-08T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[]};
  const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  await context.addInitScript(({profile,token})=>{
   if(window!==window.top)return;
   localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));localStorage.setItem('sb-krakjollsufgnwealroh-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));
  },{profile,token});
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}));
  await context.route('**/rest/v1/**',route=>{
   const request=route.request(),path=new URL(request.url()).pathname;let value={};

   if(request.method()!=='GET'){writes++;

return route.abort();}

   if(path.endsWith('/authors'))value={user_id:profile.id};else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version:1};

   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',socket=>socket.close());
  const page=await context.newPage();currentPage=page;page.setDefaultTimeout(process.env.KOSMOS_SEARCH_RED==='1'?5000:20000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/studio#notes`,{waitUntil:'networkidle',timeout:120000});await page.locator('.notes-workspace').waitFor();
  const sidebar=page.locator('.notes-workspace .studio-sidebar'),openSidebar=async()=>{if(!await sidebar.isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();};

  await openSidebar();
  assert.equal(await sidebar.locator('input').count(),0,'notes uses the studio search dialog, without a second sidebar search');
  assert.equal(await sidebar.getByRole('listbox').count(),0,'sidebar stays a navigation list');
  const view=sidebar.getByRole('group',{name:'노트 목록 보기'}),cards=()=>sidebar.locator('.notes-list .reference-card');
  await view.getByRole('button',{name:'최근 수정순',exact:true}).click();assert.equal(await cards().count(),59);
  await sidebar.getByRole('button',{name:'노트 필터',exact:true}).click();const filter=page.getByRole('dialog',{name:'노트 필터',exact:true});
  await chooseOption(filter.getByRole('combobox',{name:'태그로 노트 찾기',exact:true}),'조사');await until(page,()=>cards().count().then(count=>count===1),'tag filters navigation');
  await chooseOption(filter.getByRole('combobox',{name:'연결된 작품으로 노트 찾기',exact:true}),data.works[1].id);await until(page,()=>cards().count().then(count=>count===0),'combined filters exclude other works');
  await filter.getByRole('button',{name:'필터 초기화',exact:true}).click();await page.keyboard.press('Escape');await until(page,()=>cards().count().then(count=>count===59),'reset filters');
  await sidebar.getByRole('group',{name:'노트 보기',exact:true}).getByRole('button',{name:/^아이스박스/}).click();await until(page,()=>cards().count().then(count=>count===1),'icebox filters navigation');
  await sidebar.getByRole('group',{name:'노트 보기',exact:true}).getByRole('button',{name:/^전체/}).click();await until(page,()=>cards().count().then(count=>count===59),'all notes navigation');
  await view.getByRole('button',{name:'폴더',exact:true}).click();await sidebar.getByRole('button',{name:'노트 필터',exact:true}).click();await chooseOption(filter.getByRole('combobox',{name:'태그로 노트 찾기',exact:true}),'조사');await page.keyboard.press('Escape');
  const dialog=page.getByRole('dialog',{name:'전체 검색',exact:true}),input=dialog.getByRole('combobox',{name:'전체 검색어',exact:true}),scope=dialog.getByRole('combobox',{name:'검색 범위',exact:true}),list=dialog.getByRole('listbox',{name:'전체 검색 결과',exact:true}),options=()=>list.getByRole('option');
  const open=async()=>{await openSidebar();await sidebar.locator('[data-workspace-search-opener]').click();await dialog.waitFor();assert.equal(await input.evaluate(el=>el===document.activeElement),true);};

  const query=async(value,count)=>{await input.fill('');await input.fill(value);await until(page,async()=>await list.getAttribute('aria-busy')==='false'&&await options().count()===count,`query ${value} = ${count}`);};

  await open();assert.equal(await selectedValue(scope),'all');await query('수신좌표',5);
  await chooseOption(scope,'current');await until(page,()=>options().count().then(count=>count===1),'current work scope from notes');
  await chooseOption(scope,data.works[1].id);await until(page,()=>options().count().then(count=>count===1),'specific work scope from notes');
  await chooseOption(scope,'notes');await until(page,()=>options().count().then(count=>count===3),'notes scope includes notes outside navigation filters');
  assert.equal(await options().first().locator('strong').innerText(),exact.title);
  const lateResult=()=>options().filter({has:page.locator('strong',{hasText:late.title})});
  assert.equal(await lateResult().locator('.workspace-search-count').innerText(),'2곳');assert((await lateResult().locator('.workspace-search-snippet').innerText()).includes('수신좌표'));assert((await lateResult().locator('mark').count())>0);
  await query('중수소',1);assert((await options().first().innerText()).includes('추진제 · 중수소'));
  await query('관측일지',1);assert.equal(await options().first().locator('strong').innerText(),late.title);assert.equal(await options().first().locator('small mark').innerText(),'관측일지');
  await query('수신좌표',3);await page.keyboard.press('Escape');await until(page,()=>sidebar.locator('[data-workspace-search-opener]').evaluate(el=>el===document.activeElement),'cancel restores notes search button');
  await open();assert.equal(await input.inputValue(),'수신좌표');assert.equal(await selectedValue(scope),'notes');
  const noteStyles=new Map(),themes=quick?PALETTES.slice(0,1):PALETTES;

  const measure=()=>dialog.evaluate(el=>{const controls=[...el.querySelectorAll('.workspace-search-controls .sidebar-search,.workspace-search-controls .select')],snippet=el.querySelector('.workspace-search-snippet');

return {controls:controls.map(c=>({height:Math.round(c.getBoundingClientRect().height),fontSize:getComputedStyle(c).fontSize})),snippet:{size:getComputedStyle(snippet).fontSize,clamp:getComputedStyle(snippet).webkitLineClamp},width:el.getBoundingClientRect().width};});

  const display=async(space)=>{
   for(const palette of themes)for(const mode of ['light','dark']){
    await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});
    const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    const metrics=await measure();

if(space==='notes'){const bar=await sidebar.locator('.notes-list-controls').boundingBox();assert(bar.x>=0&&bar.x+bar.width<=width+1);assert.equal(await sidebar.locator('.notes-list-controls').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);}

    assert.equal(metrics.controls.length,2);assert(metrics.controls[0].height>=30);assert.equal(metrics.controls[0].height,metrics.controls[1].height);assert.equal(metrics.snippet.size,'12px');assert.equal(metrics.snippet.clamp,'2');
    const key=`${palette}/${mode}`;

if(space==='notes')noteStyles.set(key,metrics);else assert.deepEqual(metrics,noteStyles.get(key),`same search layout in both spaces: ${key}`);
    results.push({viewportWidth:width,space,palette,mode,...metrics});

    if(['violet','cyber','orbit'].includes(palette)&&mode==='dark')await page.screenshot({path:resolve(out,`${space}-${width}-${palette}.png`)});
   }
  };

  await display('notes');await lateResult().click();const editor=page.getByLabel('노트 본문',{exact:true});await editor.waitFor();
  await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(text=>text==='수신좌표'),'note result selects matching body text');await page.waitForTimeout(300);assert.equal(await editor.evaluate(el=>el===document.activeElement),true);assert(await page.locator('.editor-scroll').first().evaluate(el=>el.scrollTop>0));
  await editor.press('ControlOrMeta+f');const localFind=page.getByRole('textbox',{name:'찾을 내용',exact:true});await localFind.waitFor();assert.equal(await localFind.inputValue(),'수신좌표');await page.keyboard.press('Escape');
  await open();assert.equal(await input.inputValue(),'수신좌표');assert.equal(await selectedValue(scope),'notes');const lateIndex=(await options().locator('strong').allTextContents()).indexOf(late.title);

  for(let i=0;i<lateIndex;i++)await input.press('ArrowDown');await input.press('Enter');await until(page,()=>editor.evaluate(el=>el===document.activeElement),'keyboard result focuses current note again');await page.waitForTimeout(300);assert.equal(await editor.evaluate(el=>el===document.activeElement),true,'drawer focus stays in the editor');
  await page.keyboard.press('ControlOrMeta+k');await dialog.waitFor();assert.equal(await input.inputValue(),'수신좌표');assert.equal(await selectedValue(scope),'notes');
  await query('페이지검색어',50);await dialog.getByRole('button',{name:'더 보기',exact:true}).click();await until(page,()=>options().count().then(count=>count===55),'more shows every note');assert.equal(await input.evaluate(el=>el===document.activeElement),true);await options().last().click();await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(text=>text==='페이지검색어'),'paginated result opens match');
  await open();await chooseOption(scope,'all');await query('수신좌표',5);await options().filter({hasText:foreign.title}).click();await page.getByLabel(`${foreign.title} 원고`,{exact:true}).waitFor();await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(text=>text==='수신좌표'),'search from notes opens other work');
  const studioSidebar=page.locator('.studio-sidebar');

if(!await studioSidebar.isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();await studioSidebar.locator('[data-workspace-search-opener]').click();await dialog.waitFor();assert.equal(await input.inputValue(),'수신좌표');assert.equal(await selectedValue(scope),'all');
  await chooseOption(scope,'notes');await until(page,()=>options().count().then(count=>count===3),'same notes scope from studio');await display('studio');
  await page.keyboard.press('Escape');await until(page,()=>studioSidebar.locator('[data-workspace-search-opener]').evaluate(el=>el===document.activeElement),'cancel restores studio search button');await page.keyboard.press('ControlOrMeta+k');await dialog.waitFor();assert.equal(await input.inputValue(),'수신좌표');assert.equal(await selectedValue(scope),'notes');
  await lateResult().click();await editor.waitFor();await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(text=>text==='수신좌표'),'studio search returns to note body');
  await open();await query('.*',0);await dialog.getByText('검색 결과가 없습니다.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'전체 검색어 지우기',exact:true}).click();assert.equal(await input.inputValue(),'');assert.equal(await input.evaluate(el=>el===document.activeElement),true);await page.keyboard.press('ControlOrMeta+k');await until(page,()=>dialog.count().then(count=>count===0),'same shortcut closes shared search');
  await openSidebar();await sidebar.getByRole('group',{name:'노트 목록 보기'}).waitFor();assert.equal(await sidebar.locator('input').count(),0);await sidebar.getByRole('group',{name:'노트 목록 보기'}).getByRole('button',{name:'최근 수정순',exact:true}).click();assert.equal(await cards().count(),59);
  assert.equal(writes,0);assert.equal(JSON.stringify(data),original);await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(out,'report.json'),JSON.stringify({base,results,errors,writes:0},null,2));console.log(JSON.stringify({base,cases:results.length,errors,writes:0}));
}catch(error){if(currentPage&&!currentPage.isClosed())console.log(await currentPage.evaluate(()=>({url:location.href,active:document.activeElement?.outerHTML.slice(0,250),selection:window.getSelection()?.toString(),matches:document.querySelectorAll('.editor-search-match').length})));

if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:resolve(out,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();}
