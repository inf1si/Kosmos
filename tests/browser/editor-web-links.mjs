// Synthetic workspace only. Supabase and same-origin write endpoints are intercepted on deployed runs.
import assert from 'node:assert/strict';
import {chooseOption} from './select.mjs';
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

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/editor-web-links/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const palettes=process.env.KOSMOS_LINK_QUICK==='1'?PALETTES.slice(0,1):PALETTES;

const errors=[],results=[],schema=getSchema([...editorExtensions,...noteExtensions,NoteImage]);

let activePage;

const until=async(page,check,label)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(80);}

assert.fail(`Timed out: ${label}`);};

try{
 for(const width of [1280,360]){
  let data=seedWorkspace();const work=data.works[0],scene=work.documents.find(doc=>doc.kind==='scene'),wiki=work.documents.find(doc=>doc.kind==='wiki'),memo=work.documents.find(doc=>doc.kind==='memo');
  const target={...newNote(),title:'참조 원문',content:fromText('지우면 안 되는 원문입니다.')},footId=uid();

  const body={type:'doc',content:[
    ...fromText('첫 번째 문단 보존.\n\n두 번째 문단 변경 위치.').content,
    {type:'paragraph',content:[{type:'text',text:'각주 앞 '},{type:'footnote',attrs:{noteId:footId,text:'기존 각주 내용'}},{type:'text',text:' 참조 앞 '},{type:'internalReference',attrs:{kind:'note',targetId:target.id,workId:null,label:target.title}},{type:'text',text:' 끝.'}]},
    {type:'table',content:['A','B'].map(row=>({type:'tableRow',content:['1','2'].map(col=>({type:'tableCell',content:fromText(row+col).content}))}))},
    ...fromText('마지막 문단.').content,
  ]};

  body.content[0].content[0].marks=[{type:'bold'}];
  scene.title='합성 원고';scene.content=structuredClone(body);wiki.content=structuredClone(body);memo.content=structuredClone(body);
  const note={...newNote(),title:'합성 노트',content:structuredClone(body)};data=addNote(addNote(data,target),note);workspaceSchema.parse(data);
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
   else if(path.endsWith('/save_workspace')){const input=request.postDataJSON();assert.equal(input.p_base_version,version);const parsed=workspaceSchema.safeParse(input.p_payload);

if(!parsed.success){await writeFile(resolve(output,`invalid-${width}.json`),JSON.stringify(input.p_payload,null,2));throw parsed.error;}

data=parsed.data;version++;writes++;value={status:'saved',version};}
   else if(path.endsWith('/publish_work')){const input=request.postDataJSON(),w=data.works.find(w=>w.id===input.p_work_id);value=makePublication(w,input.p_scene_ids);}

   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await context.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"connected":false,"configured":false,"providers":[{"id":"openai","label":"OpenAI","configured":false,"model":null,"source":null,"browserStored":false,"browserInvalid":false}],"storageAvailable":true}'}));

  if(context.routeWebSocket)await context.routeWebSocket('**/realtime/**',ws=>ws.close());
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(15000);page.on('pageerror',error=>{if(!closing)errors.push(error.message);});
  await page.goto(`${base}/studio`,{waitUntil:'networkidle'});await page.locator('.manuscript[contenteditable=true]').first().waitFor();

  if(!cloudSeen){
   await page.evaluate(data=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put({namespace:'preview',data,localVersion:1,cloudVersion:0,dirty:false,lastExportAt:null});tx.oncomplete=()=>{db.close();resolve();};

tx.onerror=()=>reject(tx.error);};}),data);
   await page.reload({waitUntil:'networkidle'});
  }

  await context.route('https://example.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>합성 웹 링크 대상</p>'}));
  const editor=()=>page.locator('.editor-panes > .editor-shell .manuscript'),field=()=>page.getByRole('textbox',{name:'웹 링크 주소',exact:true}),label=()=>page.getByRole('textbox',{name:'웹 링크 표시할 글',exact:true}),dialog=()=>page.getByRole('dialog',{name:/^웹 링크 (추가|수정)$/}),item=name=>page.getByRole('menuitem',{name,exact:true});
  const tool=async body=>{const button=body.locator('xpath=ancestor::div[contains(@class,"editor-shell")][1]').getByRole('button',{name:'웹 링크',exact:true});await button.scrollIntoViewIfNeeded();await button.click();await field().waitFor();assert.equal(await field().evaluate(el=>el===document.activeElement),true);};

  const bubble=()=>page.locator('.editor-link-bubble');

  const openEdit=async link=>{await link.click();await bubble().waitFor();await bubble().getByRole('button',{name:'웹 링크 수정',exact:true}).click();await field().waitFor();};

  const right=async locator=>{await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.mouse.click(b.x+Math.min(b.width/2,25),b.y+b.height/2,{button:'right'});};

  const undo=async body=>{await body.focus();await page.keyboard.press('ControlOrMeta+z');};

  const drag=async p=>{await p.scrollIntoViewIfNeeded();

const r=await p.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const b=range.getBoundingClientRect();

return {x:b.x,y:b.y,width:b.width,height:b.height};});

await page.mouse.move(r.x,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width,r.y+r.height/2,{steps:10});await page.mouse.up();};

  const waitSave=()=>until(page,async()=>{
   const rows=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').getAll();let rows;get.onsuccess=()=>{rows=get.result;};

get.onerror=()=>reject(get.error);tx.oncomplete=()=>{db.close();resolve(rows);};};

request.onerror=()=>reject(request.error);}));

   return rows.some(row=>row.data.id===data.id&&!row.dirty&&row.cloudVersion===version);
  },'synthetic save complete');

  const insert=async(body,name,href='https://example.invalid/new')=>{await body.locator(':scope > p').nth(1).click();await page.keyboard.press('End');await tool(body);await field().fill(href);await label().fill(name);await dialog().getByRole('button',{name:'추가',exact:true}).click();await body.locator(`a[href="${href}"]`).waitFor();};

  const themeCheck=async(name,popup)=>{
   for(const palette of palettes)for(const mode of ['light','dark']){
    await page.evaluate(([p,m])=>{document.documentElement.dataset.palette=p;document.documentElement.dataset.theme=m;},[palette,mode]);const b=await popup.boundingBox();assert(b.x>=0&&b.x+b.width<=width+1&&b.y>=0&&b.y+b.height<=901,`${name}/${palette}/${mode}/${width} bounds`);
    const style=await popup.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,size:getComputedStyle(el).fontSize,overflow:el.scrollWidth>el.clientWidth}));assert.notEqual(style.bg,'rgba(0, 0, 0, 0)');assert.equal(style.size,'13px');assert.equal(style.overflow,false);

if(name==='edit'){const aligned=await popup.getByRole('button',{name:'링크 해제',exact:true}).evaluate(el=>{const icon=el.querySelector('svg').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el.lastChild);const text=range.getBoundingClientRect();

return icon.bottom>text.top&&icon.top<text.bottom;});

assert(aligned,`${palette}/${mode}/${width} unlink icon stays on the text line`);}

await popup.screenshot({path:resolve(output,`${name}-${palette}-${mode}-${width}.png`)});
   }

   await page.evaluate(()=>{document.documentElement.dataset.palette='violet';document.documentElement.dataset.theme='light';});
  };

  await page.getByLabel(`${scene.title} 원고`,{exact:true}).waitFor();
  // Real drag, toolbar focus and exact selection formatting.
  await drag(editor().locator(':scope > p').first());const selected=await page.evaluate(()=>getSelection().toString());assert.equal(selected,'첫 번째 문단 보존.');await tool(editor());assert.equal(await label().count(),0);
  await field().fill('javascript:alert(1)');await field().press('Enter');await dialog().getByText('웹 주소를 확인하세요.',{exact:true}).waitFor();assert.equal(await editor().locator('a').count(),0);await dialog().getByRole('button',{name:'취소',exact:true}).click();await dialog().waitFor({state:'hidden'});assert.equal(await page.getByText('웹 주소를 확인하세요.',{exact:true}).count(),0);await tool(editor());
  await field().fill('example.invalid/source');await field().press('Enter');const original=editor().locator('a[href="https://example.invalid/source"]');await original.waitFor();assert.equal(await original.innerText(),selected);assert.equal(await editor().locator('strong').count(),1);
  await undo(editor());assert.equal(await editor().locator('a').count(),0);await page.keyboard.press('ControlOrMeta+Shift+z');await original.waitFor();
  // A plain click keeps the caret in the text and only shows the address; typing closes it, the bubble unlinks in one undo step.
  await original.click();await bubble().waitFor();assert.equal(await editor().evaluate(el=>el===document.activeElement),true);assert.equal(await bubble().getByRole('link').innerText(),'https://example.invalid/source');await themeCheck('bubble',bubble());
  await page.keyboard.type('X');await bubble().waitFor({state:'detached'});assert((await original.innerText()).includes('X'));await undo(editor());assert.equal(await original.innerText(),selected);
  await original.click();await bubble().getByRole('button',{name:'링크 해제',exact:true}).click();assert.equal(await editor().locator('a').count(),0);assert.equal(await editor().locator('strong').count(),1);await undo(editor());await original.waitFor();
  // The bubble's edit button opens the address form, a modifier click/open button navigates only the safe URL in a new tab.
  await openEdit(original);assert.equal(await field().inputValue(),'https://example.invalid/source');await field().fill('https://example.invalid/changed');await field().press('Enter');assert.equal(await editor().locator('a').first().innerText(),selected);await undo(editor());await original.waitFor();
  await openEdit(original);await themeCheck('edit',dialog());
  const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'웹 링크 새 탭에서 열기',exact:true}).click()]);await popup.waitForLoadState();assert.equal(popup.url(),'https://example.invalid/source');assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();await page.bringToFront();await page.keyboard.press('Escape');
  await drag(editor().locator(':scope > p').first());assert.equal(await page.evaluate(()=>getSelection().toString()),selected);await right(original);await page.getByRole('menu',{name:'선택한 글 메뉴',exact:true}).waitFor();assert.equal(await item('웹 링크 수정').count(),0);await page.keyboard.press('Escape');await openEdit(original);await page.keyboard.press('Escape');await until(page,()=>editor().evaluate(el=>el===document.activeElement&&el.editor.state.selection.empty),'collapsed link caret');
  await right(original);await page.getByRole('menu',{name:'웹 링크 메뉴',exact:true}).waitFor();await themeCheck('context',page.locator('.editor-position-menu'));const [contextPopup]=await Promise.all([page.waitForEvent('popup'),item('새 탭에서 열기').click()]);await contextPopup.waitForLoadState();assert.equal(contextPopup.url(),'https://example.invalid/source');assert.equal(await contextPopup.evaluate(()=>window.opener),null);await contextPopup.close();await page.bringToFront();await right(original);await item('웹 링크 수정').click();await field().waitFor();await dialog().getByRole('button',{name:'취소',exact:true}).click();
  await right(original);await item('링크 해제').click();assert.equal(await editor().locator('a').count(),0);assert.equal(await editor().locator('strong').count(),1);await undo(editor());await original.waitFor();const [modifierPopup]=await Promise.all([page.waitForEvent('popup'),original.click({modifiers:['Control']})]);await modifierPopup.waitForLoadState();assert.equal(modifierPopup.url(),'https://example.invalid/source');await modifierPopup.close();await page.bringToFront();
  // Cursor insertion remains literal; typing afterwards does not extend the link.
  await editor().locator(':scope > p').nth(1).click();await page.keyboard.press('End');await tool(editor());await themeCheck('insert',dialog());await field().fill('https://example.invalid/new');await label().fill('<b>웹</b>');await field().press('Enter');await editor().locator('a[href="https://example.invalid/new"]').waitFor();assert.equal(await editor().locator('b').count(),0);await page.keyboard.insertText('뒤');assert.equal(await editor().locator('a[href="https://example.invalid/new"]').innerText(),'<b>웹</b>');await undo(editor());await undo(editor());
  // Slash and nonselected context insertion both open the same form without deleting surrounding prose.
  await editor().locator(':scope > p').nth(1).click();await page.keyboard.press('End');await page.keyboard.insertText('/웹');await page.getByRole('listbox',{name:'문서 입력 명령',exact:true}).waitFor();await page.keyboard.press('Enter');await field().waitFor();await field().fill('https://example.invalid/slash');await label().fill('슬래시 링크');await field().press('Enter');await editor().locator('a[href="https://example.invalid/slash"]').waitFor();assert((await editor().innerText()).includes('두 번째 문단 변경 위치.'));
  await editor().locator(':scope > p').last().click();await page.keyboard.press('End');await right(editor().locator(':scope > p').last());await item('삽입').click();await item('웹 링크').click();await field().waitFor();await field().fill('https://example.invalid/menu');await label().fill('메뉴 링크');await field().press('Enter');await editor().locator('a[href="https://example.invalid/menu"]').waitFor();
  // Typed names with a dot stay prose; only an address written with its scheme links itself.
  await editor().locator(':scope > p').last().click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type(' Mr.Kim readme.md naver.com https://example.invalid/typed ');await editor().locator('a[href="https://example.invalid/typed"]').waitFor();assert.deepEqual(await editor().locator(':scope > p').last().locator('a').evaluateAll(links=>links.map(link=>link.textContent)).then(texts=>texts.filter(text=>/Kim|readme|naver/.test(text))),[]);
  await until(page,()=>JSON.stringify(data.works[0].documents.find(d=>d.id===scene.id).content).includes('https://example.invalid/menu'),'saved scene link');await waitSave();await page.reload({waitUntil:'networkidle'});await editor().locator('a[href="https://example.invalid/menu"]').waitFor();await editor().locator('strong').waitFor();

  if(width===1280){const before=await editor().innerText();await page.getByRole('button',{name:'옆에 열기',exact:true}).click();const split=page.locator('.split-pane .manuscript');await split.waitFor();await insert(split,'분할 링크','https://example.invalid/split');assert.equal(await editor().innerText(),before);await undo(split);assert.equal(await split.locator('a').count(),0);await page.getByRole('button',{name:'분할 닫기',exact:true}).click();}

  await waitSave();await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'networkidle'});const notes=page.locator('.notes-workspace .manuscript');await notes.waitFor();await insert(notes,'노트 링크','https://example.invalid/note');await openEdit(notes.locator('a'));await field().fill('https://example.invalid/note-edited');await field().press('Enter');
  await until(page,()=>JSON.stringify(data.notes.find(n=>n.id===note.id).content).includes('https://example.invalid/note-edited'),'saved note link');await waitSave();await page.reload({waitUntil:'networkidle'});await notes.locator('a[href="https://example.invalid/note-edited"]').waitFor();
  results.push({width,palettes:palettes.length,modes:2,cloud:cloudSeen,simulatedSaves:writes});closing=true;await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({engine,results,errors},null,2));console.log(JSON.stringify({engine,results,errors,output}));
}catch(error){console.log(JSON.stringify({errors,diagnostic:await activePage?.evaluate(()=>({selection:getSelection()?.toString(),pm:document.querySelector('.manuscript')?.editor?.state.selection.toJSON(),menus:[...document.querySelectorAll('[role=menu]')].map(el=>el.getAttribute('aria-label')),active:document.activeElement?.getAttribute('aria-label')}))}));

if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
