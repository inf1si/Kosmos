// Synthetic auth, workspaces and writes only. Also runs against deployed assets without touching an account.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {fromText,uid,workspaceSchema} from '../../src/lib/model.ts';
import {addNote,newNote} from '../../src/lib/personal-notes.ts';
import {applyNavigation,resolveNavigation} from '../../src/lib/document-navigation.ts';
import {PALETTES} from '../../src/lib/theme.ts';
import {chooseOption,selectedValue} from './select.mjs';

const require=createRequire(import.meta.url),pw=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',out=resolve(process.env.KOSMOS_BROWSER_OUTPUT||'test-results/note-spaces'),quick=process.env.KOSMOS_SPACES_QUICK==='1';

await mkdir(out,{recursive:true});

const browser=await pw.chromium.launch({headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}),errors=[],results=[],saves=[];

let current;

/** Every menu button stays inside the menu, and the current space differs from the others. */
const menuLayout=el=>{const box=el.getBoundingClientRect(),items=[...el.querySelectorAll('button')],current=el.querySelector('[aria-current=true]'),other=items.find(b=>b!==current&&!b.disabled);

 const inside=items.every(b=>{const r=b.getBoundingClientRect();

return r.left>=box.left-0.5&&r.right<=box.right+0.5;});

 return {inside,current:current&&getComputedStyle(current).backgroundColor,other:other&&getComputedStyle(other).backgroundColor};};

const until=async(page,check,label)=>{for(let i=0;i<150;i++){if(await check())return;await page.waitForTimeout(60);}

assert.fail(label);};

try{
 for(const width of [1280,360]){
  let data=seedWorkspace(),version=1,writes=0;
  const a={...newNote(),title:'기존 자료',content:fromText('원본 우주 기록. 작업공간검색어를 기록했다.'),tags:['관측'],linkedWorkIds:[data.works[0].id]},b={...newNote(),title:'참조 노트',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'다른 공간에서도 '},{type:'internalReference',attrs:{kind:'note',targetId:a.id,workId:null,label:a.title}},{type:'text',text:'를 참조한다.'}]}]}},c={...newNote(),title:'폴더 안 문서',content:fromText('폴더 내부 원문.')};
  const attachment=uid();a.assetIds=[attachment];a.aiMessages=[{id:uid(),role:'user',text:'보관된 질문',createdAt:new Date().toISOString()},{id:uid(),role:'assistant',version:a.updatedAt,provider:'openai',model:'synthetic',sources:[],result:{review:'보관된 답변',suggestions:[]},createdAt:new Date().toISOString()}];
  data.assets.push({id:attachment,noteId:a.id,name:'관측.png',type:'image/png',size:8});

for(const n of [a,b,c])data=addNote(data,n);
  const folder=uid(),nested=uid();data.noteNavigation={version:1,nodes:[{id:folder,type:'folder',title:'기존 폴더',parentId:null},{id:nested,type:'folder',title:'하위 폴더',parentId:folder},{id:c.id,type:'note',parentId:nested},{id:a.id,type:'note',parentId:null},{id:b.id,type:'note',parentId:null}]};workspaceSchema.parse(data);
  data.works=data.works.map(work=>applyNavigation(work,resolveNavigation(work)));
  const original={notes:structuredClone(data.notes),assets:structuredClone(data.assets),works:structuredClone(data.works)},context=await browser.newContext({viewport:{width,height:1000}});
  const profile={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',created_at:'2026-11-08T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[]},enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.synthetic-signature`;
  await context.addInitScript(({profile,token})=>{if(window!==window.top)return;localStorage.setItem('kosmos-app-preferences',JSON.stringify({studioStart:'last'}));localStorage.setItem('sb-krakjollsufgnwealroh-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:profile}));},{profile,token});
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}));
  await context.route('**/rest/v1/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let value={};

   if(path.endsWith('/authors'))value={user_id:profile.id};else if(path.endsWith('/workspaces'))value={id:data.id,payload:data,version};
   else if(path.endsWith('/save_workspace')){const input=req.postDataJSON();assert.equal(input.p_base_version,version);data=workspaceSchema.parse(input.p_payload);writes++;version++;value={status:'saved',version};}
   else assert.equal(req.method(),'GET','unplanned service mutation');
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',s=>s.close());
  const page=await context.newPage();current=page;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(`${base}/studio#notes`,{waitUntil:'networkidle',timeout:120000});await page.locator('.notes-workspace').waitFor();
  const sidebar=page.locator('.notes-workspace .studio-sidebar'),openSidebar=async()=>{if(!await sidebar.isVisible())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();},opener=()=>sidebar.locator('[data-note-space-switcher]');

  const openSpaces=async()=>{await openSidebar();await opener().click();

const menu=sidebar.locator('#note-space-menu');await menu.waitFor();

return menu;};

  const selectSpace=async title=>{const popup=await openSpaces();await popup.getByRole('button',{name:new RegExp(`^${title}`)}).click();};

  await openSidebar();await sidebar.locator(`[data-navigation-row="${folder}"]`).waitFor();assert((await opener().innerText()).includes('기본 작업공간'));
  await sidebar.getByRole('button',{name:'기존 폴더 메뉴',exact:true}).click();assert.equal(await page.getByRole('menuitem',{name:'다른 작업공간으로 이동',exact:true}).count(),0,'one space and one section offers nowhere to move');await page.keyboard.press('Escape');
  await (await openSpaces()).getByRole('button',{name:'새 작업공간',exact:true}).click();let form=page.getByRole('dialog',{name:'새 작업공간',exact:true});await form.waitFor();assert.equal(await form.getByRole('textbox',{name:'작업공간 이름'}).evaluate(el=>el===document.activeElement),true);
  await form.getByRole('textbox',{name:'작업공간 이름'}).fill('구상실');await form.getByRole('button',{name:'만들기',exact:true}).click();await until(page,()=>data.noteNavigation?.spaces?.length===2,'new space saves migrated structure');
  const spaceId=data.noteNavigation.spaces.find(s=>s.title==='구상실').id;assert.deepEqual(data.notes,original.notes);assert.deepEqual(data.assets,original.assets);assert.deepEqual(data.works,original.works);assert.equal(data.noteNavigation.nodes.find(n=>n.id===c.id).parentId,nested);
  await openSidebar();assert((await opener().innerText()).includes('구상실'));assert.equal(await sidebar.locator(`[data-navigation-row="${a.id}"]`).count(),0);
  await sidebar.getByRole('button',{name:'섹션 추가',exact:true}).click();form=page.getByRole('dialog',{name:'섹션 추가',exact:true});await form.getByLabel('이름',{exact:true}).fill('자료');await form.getByRole('button',{name:'추가',exact:true}).click();await until(page,()=>data.noteNavigation.spaces.find(s=>s.id===spaceId).sections.length===2,'section persists');const sectionId=data.noteNavigation.spaces.find(s=>s.id===spaceId).sections.find(s=>s.title==='자료').id;
  await sidebar.getByRole('button',{name:'자료 섹션 메뉴',exact:true}).click();await page.getByRole('menuitem',{name:'폴더 추가',exact:true}).click();form=page.getByRole('dialog',{name:'폴더 만들기',exact:true});await form.getByLabel('이름',{exact:true}).fill('관측');await form.getByRole('button',{name:'추가',exact:true}).click();await until(page,()=>data.noteNavigation.nodes.some(n=>n.type==='folder'&&n.title==='관측'),'folder persists');const createdFolder=data.noteNavigation.nodes.find(n=>n.type==='folder'&&n.title==='관측').id;
  await sidebar.getByRole('button',{name:'관측 메뉴',exact:true}).click();await page.getByRole('menuitem',{name:'하위 노트 추가',exact:true}).click();const editor=page.getByLabel('노트 본문',{exact:true});await editor.waitFor();await page.getByRole('textbox',{name:'노트 제목',exact:true}).fill('관측 문서');await editor.fill('새 작업공간검색어를 기록한다.');await until(page,()=>data.notes.some(n=>n.title==='관측 문서'&&JSON.stringify(n.content).includes('새 작업공간검색어')),'new note stores in selected space and folder');const newId=data.notes.find(n=>n.title==='관측 문서').id;assert.equal(data.noteNavigation.nodes.find(n=>n.id===newId).sectionId,sectionId);assert.equal(data.noteNavigation.nodes.find(n=>n.id===newId).parentId,createdFolder);
  await selectSpace('기본 작업공간');await openSidebar();await sidebar.locator(`[data-navigation-row="${a.id}"] button`).filter({hasText:a.title}).first().click();await editor.waitFor();await page.getByRole('button',{name:'노트 더 보기',exact:true}).click();await page.getByRole('menuitem',{name:'작업공간으로 이동',exact:true}).click();form=page.getByRole('dialog',{name:'작업공간으로 이동',exact:true});await chooseOption(form.getByRole('combobox',{name:'옮길 작업공간'}),spaceId);await chooseOption(form.getByRole('combobox',{name:'옮길 섹션'}),sectionId);await form.getByRole('button',{name:'이동',exact:true}).click();await until(page,()=>data.noteNavigation.nodes.find(n=>n.id===a.id).sectionId===sectionId,'move note preserves body and records');assert.deepEqual(data.notes.find(n=>n.id===a.id),original.notes.find(n=>n.id===a.id));assert.deepEqual(data.assets,original.assets);
  await selectSpace('기본 작업공간');await openSidebar();await sidebar.getByRole('button',{name:'기존 폴더 메뉴',exact:true}).click();await page.getByRole('menuitem',{name:'다른 작업공간으로 이동',exact:true}).click();form=page.getByRole('dialog',{name:'작업공간으로 이동',exact:true});await chooseOption(form.getByRole('combobox',{name:'옮길 작업공간'}),spaceId);await chooseOption(form.getByRole('combobox',{name:'옮길 섹션'}),sectionId);await form.getByRole('button',{name:'이동',exact:true}).click();await until(page,()=>data.noteNavigation.nodes.find(n=>n.id===c.id).sectionId===sectionId,'folder subtree changes space together');assert.equal(data.noteNavigation.nodes.find(n=>n.id===c.id).parentId,nested);
  await selectSpace('기본 작업공간');await openSidebar();await sidebar.locator(`[data-navigation-row="${b.id}"] button`).filter({hasText:b.title}).first().click();await editor.getByRole('button',{name:`참조: ${a.title}`,exact:true}).click();await page.locator('.internal-reference-preview').waitFor();assert((await page.locator('.internal-reference-preview').innerText()).includes('기존 자료'));await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');const search=page.getByRole('dialog',{name:'전체 검색',exact:true}),input=search.getByRole('combobox',{name:'전체 검색어'}),scope=search.getByRole('combobox',{name:'검색 범위'}),list=search.getByRole('listbox',{name:'전체 검색 결과'});
  await input.fill('작업공간검색어');await chooseOption(scope,`space:${spaceId}`);await until(page,()=>list.getByRole('option').count().then(n=>n===2),'space scope searches its notes');assert((await list.innerText()).includes('구상실'));await chooseOption(scope,'space:default');await until(page,()=>list.getByRole('option').count().then(n=>n===0),'other space excludes moved notes');await chooseOption(scope,`space:${spaceId}`);await list.getByRole('option').filter({hasText:a.title}).click();await until(page,()=>page.evaluate(()=>window.getSelection()?.toString()).then(t=>t==='작업공간검색어'),'search jumps into the moved note');await openSidebar();assert((await opener().innerText()).includes('구상실'));

  if(width===1280){
    await sidebar.getByRole('button',{name:'노트 홈',exact:true}).click();await page.getByRole('group',{name:'노트 첫 화면 보기'}).getByRole('button',{name:'보드',exact:true}).click();
    const source=page.locator('.note-board-card').filter({hasText:b.title}),destination=page.getByRole('region',{name:'구상실 / 노트 / 폴더 밖',exact:true});
    await source.dragTo(destination);await until(page,()=>data.noteNavigation.nodes.find(n=>n.id===b.id).sectionId===data.noteNavigation.spaces.find(s=>s.id===spaceId).sections[0].id,'board drag moves note into another workspace');
    await page.getByRole('group',{name:'노트 첫 화면 보기'}).getByRole('button',{name:'최근',exact:true}).click();await selectSpace('구상실');await openSidebar();await sidebar.locator(`[data-navigation-row="${a.id}"] button`).filter({hasText:a.title}).first().click();await editor.waitFor();
  }

  await page.reload({waitUntil:'networkidle'});await editor.waitFor();await openSidebar();assert((await opener().innerText()).includes('구상실'));assert.equal(data.noteNavigation.nodes.find(n=>n.id===c.id).parentId,nested);assert.deepEqual(data.notes.find(n=>n.id===b.id),original.notes.find(n=>n.id===b.id));

  for(const palette of quick?PALETTES.slice(0,1):PALETTES)for(const mode of ['light','dark']){
   await page.evaluate(({palette,mode})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=mode;},{palette,mode});await openSidebar();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await sidebar.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);results.push({width,palette,mode,screen:'tree'});
   const popup=await openSpaces(),bounds=await popup.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.equal(await popup.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);const layout=await popup.evaluate(menuLayout);assert(layout.inside,'space actions stay inside the menu');assert(layout.current&&layout.current!==layout.other,'current space is highlighted');results.push({width,palette,mode,screen:'spaces'});await popup.getByRole('button',{name:'새 작업공간',exact:true}).click();form=page.getByRole('dialog',{name:'새 작업공간',exact:true});const fb=await form.boundingBox();assert(fb.x>=0&&fb.x+fb.width<=width+1);results.push({width,palette,mode,screen:'new'});

   if(['violet','cyber','orbit'].includes(palette)&&mode==='dark')await page.screenshot({path:resolve(out,`new-${width}-${palette}.png`)});await page.keyboard.press('Escape');await sidebar.locator('[data-workspace-search-opener]').click();await search.waitFor();await input.fill('작업공간검색어');await chooseOption(scope,`space:${spaceId}`);await until(page,()=>list.getByRole('option').count().then(n=>n===2),'theme search results');const sb=await search.boundingBox();assert(sb.x>=0&&sb.x+sb.width<=width+1);results.push({width,palette,mode,screen:'search'});

if(['violet','cyber','orbit'].includes(palette)&&mode==='dark')await page.screenshot({path:resolve(out,`search-${width}-${palette}.png`)});await page.keyboard.press('Escape');
  }

  let popup=await openSpaces();await popup.getByRole('button',{name:'이름 변경',exact:true}).click();form=page.getByRole('dialog',{name:'작업공간 이름 변경',exact:true});await form.getByRole('textbox',{name:'작업공간 이름'}).fill('');await form.getByRole('button',{name:'저장',exact:true}).click();await until(page,()=>data.noteNavigation.spaces.find(s=>s.id===spaceId).title==='','empty space title persists');assert((await opener().innerText()).includes('이름 없는 작업공간'));
  popup=await openSpaces();await popup.getByRole('button',{name:'삭제',exact:true}).click();form=page.getByRole('dialog',{name:'작업공간 삭제',exact:true});await form.getByRole('button',{name:'삭제',exact:true}).click();await until(page,()=>data.noteNavigation.spaces.length===1,'removing space retains its notes and sections in default');assert.equal(data.notes.length,4);assert(data.noteNavigation.spaces[0].sections.some(s=>s.id===sectionId));assert.deepEqual(data.assets,original.assets);assert.deepEqual(data.notes.find(n=>n.id===a.id),original.notes.find(n=>n.id===a.id));assert.deepEqual(data.works,original.works);
  saves.push({width,writes});await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(out,'report.json'),JSON.stringify({base,results,errors,saves},null,2));console.log(JSON.stringify({base,cases:results.length,errors,saves}));
}catch(error){console.error(error);

if(current&&!current.isClosed()){try{console.log(await current.evaluate(()=>({url:location.href,active:document.activeElement?.outerHTML.slice(0,200)})));await current.screenshot({path:resolve(out,'failure.png'),fullPage:true});}catch(captureError){console.error('Failure capture:',captureError.message);}}

throw error;}
finally{await browser.close();}
