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

const engine=process.env.KOSMOS_BROWSER_ENGINE||'chromium',base=process.env.KOSMOS_TEST_BASE_URL||'http://127.0.0.1:3210',output=resolve(process.env.KOSMOS_BROWSER_OUTPUT||`test-results/editor-position-menu/${engine}`);

await mkdir(output,{recursive:true});

const browser=await playwright[engine].launch(engine==='chromium'?{headless:true,executablePath:process.env.KOSMOS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{headless:true});

const palettes=process.env.KOSMOS_CONTEXT_QUICK==='1'?PALETTES.slice(0,1):PALETTES;

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

  const editor=()=>page.locator('.editor-panes > .editor-shell .manuscript'),item=name=>page.getByRole('menuitem',{name,exact:true}),menu=name=>page.getByRole('menu',{name,exact:true});
  const right=async locator=>{await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.mouse.click(b.x+Math.min(12,b.width/2),b.y+b.height/2,{button:'right'});};

  const undo=async body=>{await body.focus();await page.keyboard.press('ControlOrMeta+z');};

  const change=async body=>{await right(body.locator(':scope > p').nth(1));await item('문단 스타일').click();await item('제목 2').click();await body.locator(':scope > h2').waitFor();assert.equal(await body.locator(':scope > h2').innerText(),'두 번째 문단 변경 위치.');assert.equal(await body.locator(':scope > p').first().innerText(),'첫 번째 문단 보존.');await undo(body);await body.locator(':scope > h2').waitFor({state:'hidden'});};

  const waitSave=()=>until(page,async()=>{
   const rows=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('orbit-novel-studio-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').getAll();get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};

request.onerror=()=>reject(request.error);}));

   return rows.some(row=>row.data.id===data.id&&!row.dirty&&row.cloudVersion===version);
  },'synthetic cloud save');

  await page.getByLabel(`${scene.title} 원고`,{exact:true}).waitFor();
  // A stale caret in another paragraph must not decide the right-click target.
  await editor().locator(':scope > p').first().click();await page.keyboard.press('End');await change(editor());
  await right(editor().locator(':scope > p').nth(1));await item('문단 스타일').click();await page.keyboard.press('End');assert.equal(await item('인용').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');await until(page,()=>editor().evaluate(el=>el===document.activeElement),'Esc focus');
  // Clipboard permission is synthetic; the real menu inserts literal text at its captured caret.
  await page.evaluate(()=>{Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>Promise.resolve('<b>그대로</b>')});});
  await right(editor().locator(':scope > p').nth(1));

const expected=await editor().evaluate(el=>{const s=el.editor.state.selection,t=s.$from.parent.textContent,o=s.$from.parentOffset;

return t.slice(0,o)+'<b>그대로</b>'+t.slice(o);});

await item('붙여넣기').click();await until(page,()=>editor().locator(':scope > p').nth(1).innerText().then(t=>t===expected),'paste at clicked caret');assert.equal(await editor().locator('b').count(),0);await undo(editor());
  await page.evaluate(()=>{Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>new Promise(resolve=>{window.__paste=resolve;})});});
  await right(editor().locator(':scope > p').nth(1));await item('붙여넣기').click();await page.keyboard.press('Escape');await page.evaluate(()=>window.__paste('취소 후 삽입 금지'));await page.waitForTimeout(50);assert.equal(await editor().locator(':scope > p').nth(1).innerText(),'두 번째 문단 변경 위치.');

  // Existing selected text menu: same actions, order and selected range, with no paragraph submenu.
  const selectionBox=await editor().locator(':scope > p').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const b=range.getBoundingClientRect();

return {x:b.x,y:b.y,width:b.width,height:b.height};});

await page.mouse.move(selectionBox.x,selectionBox.y+selectionBox.height/2);await page.mouse.down();await page.mouse.move(selectionBox.x+selectionBox.width,selectionBox.y+selectionBox.height/2,{steps:12});await page.mouse.up();const selected=await page.evaluate(()=>getSelection().toString());await right(editor().locator(':scope > p').first());
  assert.deepEqual(await menu('선택한 글 메뉴').getByRole('menuitem').allTextContents(),['요약','문장 다듬기','아이디어 확장','질문하기','복사','잘라내기','붙여넣기']);await item('질문하기').click();await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).waitFor();assert.equal(await page.locator('.note-ai-popover .note-ai-target').textContent(),selected);await page.keyboard.press('Escape');await page.keyboard.press('ArrowRight');
  // Insertion opens the existing dialog, then edits exactly the clicked paragraph.
  await right(editor().locator(':scope > p').nth(1));await item('삽입').click();await item('각주 추가').click();await page.getByPlaceholder('각주 내용을 입력하세요').fill('추가 각주');await page.getByRole('button',{name:'각주 삽입',exact:true}).click();assert.equal(await editor().locator('[data-note-id]').count(),2);await undo(editor());await until(page,()=>editor().locator('[data-note-id]').count().then(n=>n===1),'undo footnote insertion');
  await right(editor().locator(':scope > p').nth(1));await item('삽입').click();await item('설정 링크 추가').click();await chooseOption(page.getByRole('combobox',{name:'연결할 설정',exact:true}),wiki.id);await page.getByRole('button',{name:'연결',exact:true}).click();await editor().locator('[data-wiki-id]').waitFor();assert((await editor().locator(':scope > p').nth(1).innerText()).includes(wiki.title));await undo(editor());await editor().locator('[data-wiki-id]').waitFor({state:'hidden'});
  // Existing atom, including pointer hover before right click.
  await right(editor().locator('[data-note-id]').first());await menu('각주 메뉴').waitFor();await item('각주 수정').click();const draft=page.getByRole('textbox',{name:'각주 내용',exact:true});await draft.waitFor();assert.equal(await draft.inputValue(),'기존 각주 내용');await draft.fill('우클릭에서 고친 각주');await page.getByRole('button',{name:'각주 저장',exact:true}).click();await editor().locator('[data-note-id]').hover();await page.getByText('우클릭에서 고친 각주',{exact:true}).waitFor();await undo(editor());
  await right(editor().locator('[data-note-id]').first());await item('각주 삭제').click();assert.equal(await editor().locator('[data-note-id]').count(),0);await undo(editor());await editor().locator('[data-note-id]').waitFor();
  await right(editor().locator('[data-internal-reference]').first());await menu('참조 메뉴').waitFor();await item('참조 제거').click();assert.equal(await editor().locator('[data-internal-reference]').count(),0);await undo(editor());await editor().locator('[data-internal-reference]').waitFor();assert.equal(data.notes.find(n=>n.id===target.id).content.content[0].content[0].text,'지우면 안 되는 원문입니다.');
  await right(editor().locator('[data-internal-reference]').first());await item('미리보기').click();await page.getByText('지우면 안 되는 원문입니다.',{exact:true}).waitFor();await page.getByRole('button',{name:'참고 패널 닫기',exact:true}).click();
  // The clicked second row, not the prior caret/cell; disabled actions and one-step undo.
  await right(editor().locator('tr').nth(1).locator('td').first());await menu('표 메뉴').waitFor();assert.equal(await item('셀 병합').isDisabled(),true);assert.equal(await item('셀 나누기').isDisabled(),true);await item('아래에 행 추가').click();assert.equal(await editor().locator('tr').count(),3);assert.equal(await editor().locator('tr').nth(1).locator('td').first().innerText(),'B1');await undo(editor());assert.equal(await editor().locator('tr').count(),2);

  for(const [label,check] of [['위에 행 추가',async()=>{assert.equal(await editor().locator('tr').count(),3);assert.equal(await editor().locator('tr').nth(2).locator('td').first().innerText(),'B1');}],['왼쪽 열 추가',async()=>{assert.equal(await editor().locator('tr').first().locator('td').count(),3);assert.equal(await editor().locator('tr').first().locator('td').nth(1).innerText(),'A1');}],['오른쪽 열 추가',async()=>assert.equal(await editor().locator('tr').first().locator('td').count(),3)],['행 삭제',async()=>{assert.equal(await editor().locator('tr').count(),1);assert.equal(await editor().locator('tr').first().locator('td').first().innerText(),'A1');}],['열 삭제',async()=>assert.equal(await editor().locator('tr').first().locator('td').count(),1)],['제목 행 전환',async()=>assert.equal(await editor().locator('tr').first().locator('th').count(),2)],['표 삭제',async()=>assert.equal(await editor().locator('table').count(),0)]]){
   await right(editor().locator('tr').nth(1).locator('td').first());await item(label).click();await check();await undo(editor());await editor().locator('tr').nth(1).locator('td').nth(1).waitFor();
  }

  // Drag a real multi-cell range; right click must preserve CellSelection for merging.
  const a=await editor().locator('tr').first().locator('td').first().boundingBox(),b=await editor().locator('tr').nth(1).locator('td').nth(1).boundingBox();await page.mouse.move(a.x+8,a.y+10);await page.mouse.down();await page.mouse.move(b.x+b.width-8,b.y+b.height-10,{steps:12});await page.mouse.up();
  await until(page,()=>editor().locator('.selectedCell').count().then(n=>n===4),'dragged table cells');await right(editor().locator('tr').first().locator('td').first());await item('셀 병합').click();assert.equal(await editor().locator('td[colspan="2"][rowspan="2"]').count(),1);await until(page,()=>JSON.stringify(data.works[0].documents.find(d=>d.id===scene.id).content).includes('"rowspan":2'),'merged table saved');await waitSave();await right(editor().locator('td').first());assert.equal(await item('셀 나누기').isEnabled(),true);await item('셀 나누기').click();assert.equal(await editor().locator('td').count(),4);await undo(editor());await undo(editor());

  // All palette/mode combinations: live menu size, computed tokens, focus state, and screenshots.
  for(const kind of ['문단','표','각주','참조']){
   const target=kind==='문단'?editor().locator(':scope > p').nth(1):kind==='표'?editor().locator('td').first():kind==='각주'?editor().locator('[data-note-id]'):editor().locator('[data-internal-reference]');await page.keyboard.press('ArrowRight');await right(target);const dialog=page.locator('.note-command-menu').filter({has:menu(kind+' 메뉴')});

   for(const palette of palettes)for(const mode of ['light','dark']){
    await page.evaluate(([p,m])=>{document.documentElement.dataset.palette=p;document.documentElement.dataset.theme=m;},[palette,mode]);const b=await dialog.boundingBox();assert(b.x>=0&&b.x+b.width<=width+1&&b.y>=0&&b.y+b.height<=901,`${kind}/${palette}/${mode}/${width} bounds`);
    const style=await dialog.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,token:getComputedStyle(el).getPropertyValue('--pop').trim(),size:getComputedStyle(el).fontSize,border:getComputedStyle(el).borderTopWidth}));assert.notEqual(style.bg,'rgba(0, 0, 0, 0)');assert.equal(style.size,'13px');assert.equal(style.border,'1px');assert(style.token);await dialog.screenshot({path:resolve(output,`${kind}-${palette}-${mode}-${width}.png`)});
   }

   await page.keyboard.press('Escape');
  }

  await page.evaluate(()=>{document.documentElement.dataset.palette='violet';document.documentElement.dataset.theme='light';});
  // Persistence is a real synthetic save and reload, not a DOM-only edit.
  await change(editor());await right(editor().locator(':scope > p').nth(1));await item('문단 스타일').click();await item('제목 3').click();await until(page,()=>data.works[0].documents.find(d=>d.id===scene.id).content.content[1].type==='heading','saved heading');await waitSave();await page.reload();await editor().locator('h3').waitFor();assert.equal(await editor().locator('h3').innerText(),'두 번째 문단 변경 위치.');

  // Shared studio consumers (wiki/memo), then split editor and notes.
  for(const doc of [wiki,memo]){
   if(width===360)await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();await page.locator(`[data-navigation-row="${doc.id}"]`).getByTitle(doc.title,{exact:true}).click();await page.getByLabel(`${doc.title} 원고`,{exact:true}).waitFor();await change(editor());
  }

  if(width===1280){await page.getByRole('button',{name:'옆에 열기',exact:true}).click();const split=page.locator('.split-pane .manuscript');await split.waitFor();await change(split);await page.getByRole('button',{name:'분할 닫기',exact:true}).click();}

  await waitSave();await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'networkidle'});const noteEditor=page.locator('.notes-workspace .manuscript');await noteEditor.waitFor();await change(noteEditor);
  await right(noteEditor.locator(':scope > p').nth(1));await item('문단 스타일').click();await item('체크리스트').click();await noteEditor.locator('ul[data-type="taskList"]').waitFor();await undo(noteEditor);
  await right(noteEditor.locator(':scope > p').nth(1));await item('삽입').click();const [chooser]=await Promise.all([page.waitForEvent('filechooser'),item('이미지').click()]);await chooser.setFiles([]);
  await right(noteEditor.locator('[data-note-id]'));await item('각주 수정').click();await page.getByRole('textbox',{name:'각주 내용',exact:true}).fill('노트 각주 수정');await page.getByRole('button',{name:'각주 저장',exact:true}).click();await until(page,()=>JSON.stringify(data.notes.find(n=>n.id===note.id).content).includes('노트 각주 수정'),'saved note footnote');await waitSave();await page.reload({waitUntil:'networkidle'});await noteEditor.waitFor();await right(noteEditor.locator('[data-note-id]'));await item('각주 수정').click();assert.equal(await page.getByRole('textbox',{name:'각주 내용',exact:true}).inputValue(),'노트 각주 수정');await page.keyboard.press('Escape');
  results.push({width,palettes:palettes.length,modes:2,menuKinds:4,cloud:cloudSeen,simulatedSaves:writes});closing=true;await context.close();
 }

 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({engine,results,errors},null,2));console.log(JSON.stringify({engine,results,errors,output}));
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
