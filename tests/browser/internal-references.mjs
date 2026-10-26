// Synthetic workspace only. Supabase and same-origin write endpoints are intercepted on deployed runs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {seedWorkspace} from '../../src/lib/seed.ts';
import {fromText,workspaceSchema,makePublication,newDocument,uid} from '../../src/lib/model.ts';
import {newNote,addNote} from '../../src/lib/personal-notes.ts';
import {resolveNavigation} from '../../src/lib/document-navigation.ts';
import {resolveNoteNavigation} from '../../src/lib/note-navigation.ts';
import {internalReferences} from '../../src/lib/internal-reference-node.ts';
import {PALETTES} from '../../src/lib/theme.ts';

const require=createRequire(import.meta.url),playwright=require(process.env.KOSMOS_PLAYWRIGHT_MODULE||'playwright-core');

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/internal-references/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const errors=[],results=[];

let activePage;

const until=async(page,check,label)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(80);}

assert.fail(`Timed out: ${label}`);};

try{
 for(const width of [1280,360]){
  let data=addNote(addNote(seedWorkspace(),{...newNote(),title:'도시 설정',content:fromText('합성 도시의 참조 본문입니다.')}),{...newNote(),title:'출발 노트',content:fromText('시작 문장.\n\n')});
  const source=data.notes.find(n=>n.title==='출발 노트'),target=data.notes.find(n=>n.title==='도시 설정'),work=data.works[0],scene=work.documents.find(d=>d.kind==='scene'),wiki=work.documents.find(d=>d.kind==='wiki');
  scene.content=fromText('본문 문장.\n\n');wiki.title='도시 설정';wiki.content=fromText('합성 설정집의 원문입니다.');
  const foreign=newDocument('memo','다른 작품 자료');foreign.content=fromText('다른 작품의 합성 자료입니다.');
  const foreignWork={...work,id:uid(),title:`별도 작품 ${'긴 작품 이름 '.repeat(12)}`,documents:[foreign],navigation:undefined,publications:[],activePublicationId:null};data.works.push(foreignWork);
  const noteFolder=uid(),nestedNoteFolder=uid(),documentFolder=uid(),nestedDocumentFolder=uid(),shelf=uid(),emptyShelf=uid();
  data.noteNavigation=resolveNoteNavigation(data);data.noteNavigation.nodes.push({id:noteFolder,type:'folder',title:'자료 폴더',parentId:null},{id:nestedNoteFolder,type:'folder',title:'하위 자료',parentId:noteFolder});data.noteNavigation.nodes.find(node=>node.id===target.id).parentId=nestedNoteFolder;
  work.navigation=resolveNavigation(work);const sceneNode=work.navigation.nodes.find(node=>node.id===scene.id);
  work.navigation.nodes.push({id:documentFolder,type:'folder',title:'원고 폴더',parentId:null,sectionId:sceneNode.sectionId},{id:nestedDocumentFolder,type:'folder',title:'하위 원고',parentId:documentFolder,sectionId:sceneNode.sectionId});sceneNode.parentId=nestedDocumentFolder;
  data.workShelves=[{id:'default',title:'',workIds:data.works.filter(value=>value.id!==work.id).map(value=>value.id)},{id:shelf,title:'보관 책장',workIds:[work.id]},{id:emptyShelf,title:'빈 책장',workIds:[]}];workspaceSchema.parse(data);
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

  const stored=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').getAll();get.onsuccess=()=>resolve(get.result.map(r=>r.data));get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};}));

  const settle=async check=>{await until(page,async()=>{const states=await stored();

return states.some(check);},'persisted reference content');

if(cloudSeen)await until(page,()=>check(data),'cloud save');};

  await page.goto(`${base}/studio#notes/${source.id}`,{waitUntil:'networkidle'});const editor=page.locator('.manuscript[contenteditable=true]').first();await editor.waitFor();
  await editor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type('a@b');assert.equal(await page.getByRole('listbox',{name:'참조할 항목'}).count(),0);
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('@/');
  const slash=page.getByRole('listbox',{name:'노트 입력 명령'});await slash.waitFor();assert.equal(await page.getByRole('listbox',{name:'참조할 항목'}).count(),0,'slash replaces reference search');
  assert.equal(await editor.getAttribute('aria-controls'),await slash.getAttribute('id'));
  await page.keyboard.press('Backspace');await page.getByRole('listbox',{name:'참조할 항목'}).waitFor();assert.equal(await slash.count(),0,'removing slash restores the @ search');await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('시작 문장. ');await page.keyboard.type('@');await page.getByRole('listbox',{name:'참조할 항목'}).waitFor();
  const rows=await page.getByRole('listbox',{name:'참조할 항목'}).locator('.internal-reference-option').evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width,listWidth:node.parentElement.getBoundingClientRect().width,align:getComputedStyle(node).textAlign})));
  assert(rows.length>=10,'unfiltered results exercise a populated list');

  for(const row of rows){assert(row.height>=32&&row.height<=42,'reference rows remain compact even with long paths');assert(Math.abs(row.width-row.listWidth)<1,'result rows fill the list width');assert.equal(row.align,'left');}

  for(const label of ['노트 연결','문서 연결','폴더 멘션','작품 멘션','책장 멘션'])assert.equal(await page.getByRole('listbox',{name:'참조할 항목'}).getByRole('group',{name:label,exact:true}).count(),1);
  const documentsGroup=page.getByRole('listbox',{name:'참조할 항목'}).getByRole('group',{name:'문서 연결',exact:true}),more=documentsGroup.getByRole('option',{name:'문서 연결 더 보기',exact:true});

  if(await more.count()){const before=await documentsGroup.locator('.internal-reference-option').count();const optionId=await more.getAttribute('id');

   for(let i=0;i<100&&await editor.getAttribute('aria-activedescendant')!==optionId;i++)await editor.press('ArrowDown');
   assert.equal(await editor.getAttribute('aria-activedescendant'),optionId);await editor.press('Enter');assert((await documentsGroup.locator('.internal-reference-option').count())>before,'show more expands its own group');assert.equal(await more.count(),0);}

  await page.locator('.internal-reference-search').screenshot({path:resolve(output,`populated-list-${width}.png`)});
  await page.keyboard.insertText('도시');
  const list=page.getByRole('listbox',{name:'참조할 항목'});await until(page,()=>list.getByRole('option').count().then(n=>n===2),'duplicate-title search options');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
  const chip=editor.locator('[data-internal-reference]');await chip.first().waitFor();assert.match(await chip.first().innerText(),/도시 설정/);
  await page.keyboard.press('ControlOrMeta+z');await until(page,()=>chip.count().then(n=>n===0),'undo reference insertion');await page.keyboard.press('ControlOrMeta+Shift+z');await chip.first().waitFor();
  await settle(s=>!!s.notes?.find(n=>n.id===source.id)?.content&&internalReferences(s.notes.find(n=>n.id===source.id).content).length===1);
  await chip.first().hover();await page.getByRole('dialog',{name:'참조 미리보기'}).waitFor();
  await chip.first().focus();await page.keyboard.press('Enter');const panel=page.getByRole(width===360?'dialog':'complementary',{name:'노트 참고 패널'});await panel.waitFor();await panel.getByText('합성 도시의 참조 본문입니다.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'원문 열기',exact:true}).focus();

  for(const palette of PALETTES)for(const mode of ['light','dark']){
   await page.evaluate(([p,m])=>{document.documentElement.dataset.palette=p;document.documentElement.dataset.theme=m;},[palette,mode]);
   const b=await panel.boundingBox();assert(b.x>=0&&b.x+b.width<=width+1,`${palette}/${mode}/${width} preview bounds`);
   assert.equal(await panel.getByRole('button',{name:'원문 열기',exact:true}).isVisible(),true);
   assert.deepEqual(await panel.locator('.internal-reference-preview>h3').first().evaluate(el=>[getComputedStyle(el).fontSize,getComputedStyle(el).fontWeight]),['15px','600'],`${palette}/${mode}/${width} preview title matches the note preview title`);
   await panel.screenshot({path:resolve(output,`preview-${palette}-${mode}-${width}.png`)});
  }

  await page.evaluate(()=>{document.documentElement.dataset.palette='violet';document.documentElement.dataset.theme='light';});
  await page.screenshot({path:resolve(output,`reference-panel-${width}.png`)});
  await panel.getByRole('button',{name:'원문 열기',exact:true}).click();await until(page,()=>page.url().includes(target.id),'target note navigation');

  if(!await panel.count())await page.getByRole('button',{name:'글 참조와 백링크',exact:true}).click();await page.getByText('이 글을 참조한 글 1개',{exact:true}).waitFor();
  await page.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();
  const title=page.getByRole('textbox',{name:'노트 제목'});await title.fill('변경된 도시');
  await settle(s=>s.notes?.some(n=>n.id===target.id&&n.title==='변경된 도시'));
  await page.goto(`${base}/studio#notes/${source.id}`,{waitUntil:'networkidle'});await editor.locator('[data-internal-reference]').first().getByText('변경된 도시',{exact:true}).waitFor();
  // Notes can also refer to a work's setting document, without replacing the existing public wiki link tool.
  await editor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type(' @');await page.keyboard.insertText('도시');await list.waitFor();await list.getByRole('option').filter({hasText:'설정집'}).click();
  await settle(s=>internalReferences(s.notes.find(n=>n.id===source.id).content).some(r=>r.kind==='document'&&r.targetId===wiki.id));
  // Current writing stays open while a referenced work document is previewed.
  await editor.locator('[data-internal-reference]').last().click();await panel.getByText('합성 설정집의 원문입니다.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'원문 열기',exact:true}).click();await page.locator('.manuscript[contenteditable=true]').first().waitFor();
  await page.getByRole('button',{name:'글 참조와 백링크',exact:true}).first().click();await page.getByText('이 글을 참조한 글 1개',{exact:true}).waitFor();
  await page.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();
  // Studio document insertion uses the same @ menu.
  const workEditor=page.locator('.manuscript[contenteditable=true]').first();await workEditor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type(' @');await page.keyboard.insertText('변경된 도시');await list.getByRole('option').first().click();
  await settle(s=>internalReferences(s.works[0].documents.find(d=>d.id===wiki.id).content).some(r=>r.targetId===target.id));

  await workEditor.press('ControlOrMeta+End');await page.keyboard.type(' @');await page.keyboard.insertText('보관 책장');await list.getByRole('group',{name:'책장 멘션',exact:true}).getByRole('option').first().click();
  await settle(s=>internalReferences(s.works[0].documents.find(d=>d.id===wiki.id).content).some(r=>r.kind==='shelf'&&r.targetId===shelf));
  await workEditor.locator(`[data-internal-reference*='${shelf}']`).click();const studioPanel=page.getByRole(width===360?'dialog':'complementary',{name:'참고 패널',exact:true});await studioPanel.getByRole('heading',{name:'보관 책장',exact:true}).waitFor();await page.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();

  if(await page.getByRole('button',{name:'사이드바 열기',exact:true}).count())await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();
  await page.locator(`[data-navigation-row="${scene.id}"]`).getByTitle(scene.title,{exact:true}).click();
  const sceneEditor=page.getByLabel(`${scene.title} 원고`,{exact:true});await sceneEditor.waitFor();
  await sceneEditor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await sceneEditor.press('ControlOrMeta+e');await page.keyboard.type('@literal');
  await sceneEditor.locator('code').last().waitFor();assert.equal(await list.count(),0,'inline code stays literal');assert.equal(await sceneEditor.locator('code').last().innerText(),'@literal');
  await sceneEditor.press('ControlOrMeta+e');assert.equal(await list.count(),0,'an @ inside code cannot become a trigger after leaving its mark');await page.keyboard.press('Enter');await page.keyboard.type('@');await page.keyboard.insertText('변경된 도시');await list.waitFor();
  await sceneEditor.dispatchEvent('compositionstart',{data:'도시',bubbles:true});
  await sceneEditor.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true});
  await sceneEditor.dispatchEvent('compositionend',{data:'',bubbles:true});
  assert.equal(await sceneEditor.locator('[data-internal-reference]').count(),0,'IME confirmation does not insert a reference');
  await page.keyboard.press('Escape');await sceneEditor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type(' @');await page.keyboard.insertText('변경된 도시');await list.getByRole('option').first().click();await sceneEditor.locator('[data-internal-reference]').waitFor();
  await settle(s=>internalReferences(s.works[0].documents.find(d=>d.id===scene.id).content).some(r=>r.targetId===target.id));

  if(width===1280){
   await page.getByRole('button',{name:'옆에 열기',exact:true}).click();
   const split=page.locator('.split-pane .manuscript');await split.waitFor();
   await split.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type(' @');await page.keyboard.insertText('출발 노트');await list.getByRole('option').first().click();
   await settle(s=>internalReferences(s.works[0].documents.find(d=>d.id===wiki.id).content).some(r=>r.targetId===source.id));
   await split.press('ControlOrMeta+End');await page.keyboard.type(' @');await page.keyboard.insertText('원고 폴더');await list.getByRole('group',{name:'폴더 멘션',exact:true}).getByRole('option').filter({has:page.getByText('원고 폴더',{exact:true})}).click();
   await settle(s=>internalReferences(s.works[0].documents.find(d=>d.id===wiki.id).content).some(r=>r.kind==='document-folder'&&r.targetId===documentFolder));
   assert.equal(await sceneEditor.locator('[data-internal-reference]').count(),1,'split insertion leaves the primary document unchanged');
   await page.locator('.split-pane').getByRole('button',{name:'글 참조와 백링크',exact:true}).click();
   await until(page,()=>page.getByRole('complementary',{name:'참고 패널',exact:true}).getByRole('button').filter({hasText:'출발 노트'}).count().then(n=>n===2),'split outgoing and incoming references');
   await page.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();await page.getByRole('button',{name:'분할 닫기',exact:true}).click();
  }

  await page.goto(`${base}/studio#notes/${source.id}`,{waitUntil:'networkidle'});await editor.waitFor();
  await editor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type(' @');await page.keyboard.insertText('별도 작품');await list.getByRole('option').first().click();
  await settle(s=>internalReferences(s.notes.find(n=>n.id===source.id).content).some(r=>r.workId===foreignWork.id));
  await editor.locator('[data-internal-reference]').last().click();await panel.getByText('다른 작품의 합성 자료입니다.',{exact:true}).waitFor();await panel.getByRole('button',{name:'원문 열기',exact:true}).click();
  await page.getByLabel(`${foreign.title} 원고`,{exact:true}).waitFor();
  await page.goto(`${base}/studio#notes/${source.id}`,{waitUntil:'networkidle'});await page.reload({waitUntil:'networkidle'});await editor.waitFor();assert.equal(await editor.locator('[data-internal-reference]').count(),3,'references survive a full reload');
  await editor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type(' @');await page.keyboard.insertText('도시');await list.waitFor();

  await page.keyboard.press('Escape');

  const insertMention=async(label,group)=>{
   const paragraph=editor.locator('p').last(),bounds=await paragraph.boundingBox(),before=await editor.locator('[data-internal-reference]').count();
   await paragraph.click({position:{x:bounds.width-3,y:bounds.height-3}});await editor.press('End');await editor.press('ArrowRight');await page.keyboard.type(' @');await page.keyboard.insertText(label);await list.getByRole('group',{name:group,exact:true}).getByRole('option').filter({has:page.getByText(label,{exact:true})}).click();
   await until(page,()=>editor.locator('[data-internal-reference]').count().then(count=>count===before+1),'insert at an explicit caret without replacing a selected chip');
  };

  await insertMention('자료 폴더','폴더 멘션');await editor.locator(`[data-internal-reference*='${noteFolder}']`).waitFor();
  await editor.press('ControlOrMeta+z');assert.equal(await editor.locator('[data-internal-reference]').count(),3,'container insertion undoes once');await editor.press('ControlOrMeta+Shift+z');assert.equal(await editor.locator('[data-internal-reference]').count(),4);
  await editor.locator('[data-internal-reference]').last().click();await panel.getByRole('heading',{name:'자료 폴더',exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'원문 열기',exact:true}).count(),0,'containers show lists instead of pretending to have bodies');
  await panel.getByRole('button').filter({has:page.getByText('하위 자료',{exact:true})}).click();await panel.getByRole('heading',{name:'하위 자료',exact:true}).waitFor();
  await panel.getByRole('button').filter({has:page.getByText('변경된 도시',{exact:true})}).press('Enter');await panel.getByText('합성 도시의 참조 본문입니다.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'이전 참조로',exact:true}).click();await panel.getByRole('heading',{name:'하위 자료',exact:true}).waitFor();
  await panel.getByRole('button',{name:'이전 참조로',exact:true}).click();await panel.getByRole('heading',{name:'자료 폴더',exact:true}).waitFor();
  assert(page.url().includes(source.id),'browsing a folder keeps the source note open');

  for(const palette of PALETTES)for(const mode of ['light','dark']){
   await page.evaluate(([p,m])=>{document.documentElement.dataset.palette=p;document.documentElement.dataset.theme=m;},[palette,mode]);
   const bounds=await panel.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,`${palette}/${mode}/${width} folder panel bounds`);
   await panel.screenshot({path:resolve(output,`folder-${palette}-${mode}-${width}.png`)});
  }

  await page.evaluate(()=>{document.documentElement.dataset.palette='violet';document.documentElement.dataset.theme='light';});
  await panel.screenshot({path:resolve(output,`folder-preview-${width}.png`)});await page.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();
  await insertMention('원고 폴더','폴더 멘션');await editor.locator(`[data-internal-reference*='${documentFolder}']`).click();await panel.getByRole('heading',{name:'원고 폴더',exact:true}).waitFor();await panel.getByRole('button').filter({has:page.getByText('하위 원고',{exact:true})}).waitFor();await page.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();
  await insertMention(work.title,'작품 멘션');await editor.locator(`[data-internal-reference*='${work.id}']`).filter({has:page.getByText(work.title,{exact:true})}).click();await panel.getByRole('heading',{name:work.title,exact:true}).waitFor();await panel.getByRole('button').filter({has:page.getByText('원고 폴더',{exact:true})}).waitFor();await page.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();
  await insertMention('보관 책장','책장 멘션');await editor.locator(`[data-internal-reference*='${shelf}']`).click();await panel.getByRole('heading',{name:'보관 책장',exact:true}).waitFor();await panel.getByRole('button').filter({has:page.getByText(work.title,{exact:true})}).waitFor();await page.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();
  await insertMention('빈 책장','책장 멘션');await editor.locator(`[data-internal-reference*='${emptyShelf}']`).click();await panel.getByText('항목이 없습니다.',{exact:true}).waitFor();await page.getByRole('button',{name:'노트 참고 패널 닫기',exact:true}).click();
  await settle(s=>internalReferences(s.notes.find(n=>n.id===source.id).content).length===8);
  await page.reload({waitUntil:'networkidle'});await editor.waitFor();assert.equal(await editor.locator('[data-internal-reference]').count(),8,'all target kinds survive reload');
  await editor.locator(`[data-internal-reference*='${shelf}']`).click();await panel.getByRole('button').filter({has:page.getByText(work.title,{exact:true})}).click();await panel.getByRole('button').filter({has:page.getByText('원고 폴더',{exact:true})}).click();await panel.getByRole('button').filter({has:page.getByText('하위 원고',{exact:true})}).click();await panel.getByRole('button').filter({has:page.getByText(scene.title,{exact:true})}).click();await panel.getByRole('button',{name:'원문 열기',exact:true}).click();await page.getByLabel(`${scene.title} 원고`,{exact:true}).waitFor();
  await page.goto(`${base}/studio#notes/${source.id}`,{waitUntil:'networkidle'});await editor.waitFor();await editor.locator('p').last().click({position:{x:2,y:4}});await page.keyboard.press('End');await page.keyboard.type(' @');await list.waitFor();

  for(const palette of PALETTES)for(const mode of ['light','dark']){
   await page.evaluate(([p,m])=>{document.documentElement.dataset.palette=p;document.documentElement.dataset.theme=m;},[palette,mode]);
   const popup=page.locator('.internal-reference-search'),b=await popup.boundingBox();assert(b.x>=0&&b.x+b.width<=width+1,`${palette}/${mode}/${width} search bounds`);
   const row=await list.getByRole('option').first().boundingBox();assert(row.height>=32&&row.height<=42,`${palette}/${mode}/${width} compact row`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
   await popup.screenshot({path:resolve(output,`${palette}-${mode}-${width}.png`)});
  }

  await page.keyboard.insertText('폴더');await list.waitFor();await page.keyboard.press('Escape');assert.equal(await list.count(),0);await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');assert.equal(await list.count(),0,'Escape does not immediately reopen the same query');
  await page.screenshot({path:resolve(output,`reference-chips-${width}.png`)});
  results.push({width,palettes:PALETTES.length,modes:2,cloud:cloudSeen,simulatedSaves:writes});closing=true;await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({engine,results,errors},null,2));console.log(JSON.stringify({engine,results,errors,output}));
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
