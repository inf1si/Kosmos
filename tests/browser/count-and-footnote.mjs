// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
import { manuscriptStatistics } from '../../src/lib/text-statistics.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/count-and-footnote');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// Older checks start in the editor; the studio home has its own check (studio-home.mjs).
await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}'); if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });
const note = { ...newNote(), title: '합성 노트', content: fromText('\n\n반복 문장.\n\n반복 문장.\n\n마지막 문장.'), tags: ['생각'] };
const other = { ...newNote(), title: '보관 노트', content: fromText('다른 태그'), tags: ['자료'] };
const richId=uid(),richContent=[{type:'text',text:'서식 보존',marks:[{type:'bold'},{type:'fontSize',attrs:{size:24}}]},{type:'footnote',attrs:{noteId:uid(),text:'보존할 각주'}},{type:'text',text:'노트 링크',marks:[{type:'wikiLink',attrs:{targetId:other.id}}]}];
note.content.content.push({type:'paragraph',attrs:{blockId:richId},content:richContent});
let data = addNote(addNote(seedWorkspace(), other), note), version = 1, saves = 0;
const work=data.works[0],scene=work.documents[0],setting=work.documents.find(d=>d.kind==='wiki'),memo=work.documents.find(d=>d.kind==='memo');
scene.content=fromText('\n\n반복 문장.\n\n반복 문장.\n\n마지막 문장.');
scene.content.content.push({type:'paragraph',attrs:{blockId:richId},content:richContent.map(n=>n.marks?.some(m=>m.type==='wikiLink')?{...n,marks:[{type:'wikiLink',attrs:{targetId:setting.id}}]}:n)});
setting.content=fromText('\n\n설정 원문.');memo.content=fromText('\n\n메모 원문.');
const errors = [], layouts = [];
const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-04T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;
await context.addInitScript(({ profile, token, key }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile })), { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });
await context.route('**/*.supabase.co/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value = {};
    if (path.includes('/auth/v1/user'))
        value = profile;
    else if (path.endsWith('/authors'))
        value = { user_id: profile.id };
    else if (path.endsWith('/workspaces'))
        value = { id: data.id, payload: data, version };
    else if (path.endsWith('/save_workspace')) {
        const input = request.postDataJSON();
        assert.equal(input.p_base_version, version);
        data = workspaceSchema.parse(input.p_payload);
        version++;
        saves++;
        value = { status: 'saved', version };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});
await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));
if (context.routeWebSocket)
    await context.routeWebSocket('**/realtime/**', ws => ws.close());
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('filechooser',()=>{});
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const until = async (check, label) => { for (let i = 0; i < 100; i++) { if (check()) return; await page.waitForTimeout(100); } throw new Error(`Timed out: ${label}`); };
const providers=[{id:'openai',label:'OpenAI',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'anthropic',label:'Claude',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'gemini',label:'Gemini',configured:false,model:null,source:null,browserStored:false,browserInvalid:false}];
let requests=[],reply='합성 AI 답변',failure=false,delay=0;
await context.route('**/api/ai/providers',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({providers,storageAvailable:true})}));
await context.route('**/api/ai/chat',async route=>{
  const input=route.request().postDataJSON();requests.push(input);if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  await route.fulfill({status:failure?503:200,contentType:'application/json',body:JSON.stringify(failure?{error:'합성 제공자 오류'}:{result:{review:reply,suggestions:[{quote:(input.documentRange||input.noteRange)?.text||'반복 문장.',replacement:reply,reason:'합성 수정'}]},model:'synthetic-model',version:input.version,sources:[]})});
});
const editor=()=>page.locator('.editor-panes > .editor-shell .manuscript');
const splitEditor=()=>page.locator('.split-pane .manuscript');
const tool=(name,split=false)=>page.locator(split?'.split-pane .editor-shell':'.editor-panes > .editor-shell').getByRole('button',{name,exact:true});
const start=async(body=editor())=>{await body.locator('p').first().click({position:{x:2,y:10}});await page.keyboard.press('Home');await page.waitForTimeout(50);};
const selectParagraph=async(index,body=editor())=>{await body.locator('p').nth(index).click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');};
const synced=()=>page.waitForFunction(()=>document.body.textContent.includes('클라우드 동기화됨'));
const openDoc=async doc=>{await page.locator(`[data-navigation-row="${doc.id}"]`).getByTitle(doc.title,{exact:true}).click();await editor().waitFor();};
const ask=async question=>{await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill(question);await button('AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();};

const firstId=uid(),secondId=uid(),splitId=uid();
scene.content={type:'doc',content:[{type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:'가 나 🙂',marks:[{type:'bold'}]},{type:'footnote',attrs:{noteId:firstId,text:'같은 설명'}},{type:'text',text:' 끝',marks:[{type:'wikiLink',attrs:{targetId:setting.id}}]}]},{type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:'둘째 문장.'},{type:'footnote',attrs:{noteId:secondId,text:'같은 설명'}}]}]};
note.content=structuredClone(scene.content);note.content.content[0].content[2].marks[0].attrs.targetId=other.id;
data.notes.find(n=>n.id===note.id).content=structuredClone(note.content);
setting.content={type:'doc',content:[{type:'paragraph',attrs:{blockId:uid()},content:[{type:'text',text:'분할 설정 원문.'},{type:'footnote',attrs:{noteId:splitId,text:'분할 설명'}}]}]};
await context.addInitScript(()=>{if(!localStorage.getItem('orbis-editor-preferences'))localStorage.setItem('orbis-editor-preferences',JSON.stringify({font:'ibm-plex',size:20,countMetric:'charactersWithoutSpaces'}));});
const card=()=>page.locator('.note-preview-popover');
const noteAt=async(body,id)=>body.evaluate((el,id)=>{let found;el.editor.state.doc.descendants(node=>{if(node.type.name==='footnote'&&node.attrs.noteId===id)found={...node.attrs};});return found;},id);
const count=()=>page.locator('.editor-panes > .editor-shell .char-count');
const openFootnote=async(body,id)=>{await page.evaluate(()=>document.fonts.ready);await page.mouse.move(2,2);await body.locator(`[data-note-id="${id}"]`).hover();await card().waitFor();};
const editFootnote=async(body,id)=>{await openFootnote(body,id);await card().getByRole('button',{name:'각주 수정',exact:true}).click();await card().getByRole('textbox',{name:'각주 내용'}).waitFor();assert(await card().getByRole('textbox',{name:'각주 내용'}).evaluate(el=>document.activeElement===el));};
try{
  await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await editor().waitFor();
  await page.waitForFunction(()=>document.querySelector('.editor-panes > .editor-shell .char-count')?.getAttribute('aria-label')==='13자 · 공백 포함 · 문서 통계 열기');
  assert.equal(await page.getByRole('combobox',{name:'본문 글꼴',exact:true}).inputValue(),'ibm-plex');
  await count().click();await page.getByRole('combobox',{name:'통계 표시 기준'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'통계 표시 기준'}).inputValue(),'charactersWithSpaces');
  await page.getByRole('combobox',{name:'통계 표시 기준'}).selectOption('charactersWithoutSpaces');await page.keyboard.press('Escape');
  assert.equal(await count().getAttribute('aria-label'),'9자 · 공백 제외 · 문서 통계 열기');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('orbis-editor-preferences')).countMetricVersion),1);
  await page.reload();await editor().waitFor();assert.equal(await count().getAttribute('aria-label'),'9자 · 공백 제외 · 문서 통계 열기');
  const workCount=manuscriptStatistics(work.documents).charactersWithSpaces;
  assert((await page.locator('.work-card small').innerText()).includes(`${workCount.toLocaleString()}자`));
  await button('게시 준비').click();await page.locator('.publish-scene-list').waitFor();assert((await page.locator('.publish-scene').filter({hasText:scene.title}).innerText()).includes('13자'));await page.keyboard.press('Escape');
  await count().click();await page.getByRole('combobox',{name:'통계 표시 기준'}).selectOption('charactersWithSpaces');await page.keyboard.press('Escape');
  // The fixed sidebar/board counts use spaces even if the toolbar has another explicit metric.
  await button('플롯보드').click();await page.locator('.plot-card').first().waitFor();
  assert((await page.locator('.plot-card').filter({hasText:scene.title}).locator('.plot-card-meta').innerText()).includes('13자'));
  await openDoc(scene);assert.equal(await count().getAttribute('aria-label'),'13자 · 공백 포함 · 문서 통계 열기');
  await editor().focus();await page.keyboard.press('Tab');await card().waitFor();assert((await card().innerText()).includes('각주 1'));await page.keyboard.press('Escape');
  await editFootnote(editor(),firstId);await page.mouse.move(2,2);await page.waitForTimeout(250);assert(await card().isVisible());
  await card().getByRole('textbox',{name:'각주 내용'}).fill('저장하지 않은 설명');await page.keyboard.press('Escape');await card().waitFor({state:'hidden'});assert.equal((await noteAt(editor(),firstId)).text,'같은 설명');
  await editFootnote(editor(),firstId);await card().getByRole('textbox',{name:'각주 내용'}).fill('바깥 클릭으로 취소할 설명');await count().click();await card().waitFor({state:'hidden'});await page.getByRole('combobox',{name:'통계 표시 기준'}).waitFor();assert.equal((await noteAt(editor(),firstId)).text,'같은 설명');assert.equal(await page.getByRole('combobox',{name:'통계 표시 기준'}).inputValue(),'charactersWithSpaces');await page.keyboard.press('Escape');
  await editFootnote(editor(),firstId);await card().getByRole('textbox',{name:'각주 내용'}).fill(' ');assert(await card().getByRole('button',{name:'각주 저장'}).isDisabled());
  await card().getByRole('textbox',{name:'각주 내용'}).fill('수정한 첫 설명\n둘째 줄');const before=await editor().evaluate(el=>el.editor.getJSON());
  await card().getByRole('button',{name:'각주 저장'}).click();await card().waitFor({state:'hidden'});assert.equal((await noteAt(editor(),firstId)).text,'수정한 첫 설명\n둘째 줄');assert.equal((await noteAt(editor(),secondId)).text,'같은 설명');
  const expected=structuredClone(before);expected.content[0].content[1].attrs.text='수정한 첫 설명\n둘째 줄';assert.deepEqual(await editor().evaluate(el=>el.editor.getJSON()),expected);assert(await editor().evaluate(el=>document.activeElement===el));
  await tool('실행 취소').click();assert.equal((await noteAt(editor(),firstId)).text,'같은 설명');await tool('다시 실행').click();assert.equal((await noteAt(editor(),firstId)).text,'수정한 첫 설명\n둘째 줄');
  await synced();await page.reload();await editor().waitFor();await openFootnote(editor(),firstId);assert((await card().innerText()).includes('수정한 첫 설명'));await page.keyboard.press('Escape');
  // A background update is simulated while the UI draft is open; the stale draft cannot overwrite it.
  await editFootnote(editor(),firstId);await card().getByRole('textbox',{name:'각주 내용'}).fill('오래된 수정안');
  await editor().evaluate((el,id)=>{let pos;el.editor.state.doc.descendants((node,index)=>{if(node.type.name==='footnote'&&node.attrs.noteId===id)pos=index;});const node=el.editor.state.doc.nodeAt(pos);el.editor.view.dispatch(el.editor.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,text:'다른 창의 새 설명'}));},firstId);
  await card().getByRole('status').waitFor();assert(await card().getByRole('button',{name:'각주 저장'}).isDisabled());await card().getByRole('button',{name:'취소'}).click();assert.equal((await noteAt(editor(),firstId)).text,'다른 창의 새 설명');
  await button('옆에 열기').click();await splitEditor().waitFor();await editFootnote(splitEditor(),splitId);await card().getByRole('textbox',{name:'각주 내용'}).fill('수정한 분할 설명');await card().getByRole('button',{name:'각주 저장'}).click();
  assert.equal((await noteAt(splitEditor(),splitId)).text,'수정한 분할 설명');assert.equal((await noteAt(editor(),firstId)).text,'다른 창의 새 설명');await tool('실행 취소',true).click();assert.equal((await noteAt(splitEditor(),splitId)).text,'분할 설명');await tool('다시 실행',true).click();
  await synced();await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'domcontentloaded'});const noteBody=()=>page.locator('.notes-workspace .manuscript');await noteBody().waitFor();
  assert((await page.locator('.notes-workspace .char-count').innerText()).startsWith('13자'));
  await editFootnote(noteBody(),secondId);await card().getByRole('textbox',{name:'각주 내용'}).fill('수정한 노트 설명');await card().getByRole('button',{name:'각주 저장'}).click();assert.equal((await noteAt(noteBody(),secondId)).text,'수정한 노트 설명');assert.equal((await noteAt(noteBody(),firstId)).text,'같은 설명');
  await button('실행 취소').click();assert.equal((await noteAt(noteBody(),secondId)).text,'같은 설명');await button('다시 실행').click();await synced();await page.reload();await noteBody().waitFor();assert.equal((await noteAt(noteBody(),secondId)).text,'수정한 노트 설명');
  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(({palette,theme})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});
    await editFootnote(noteBody(),secondId);const box=await card().boundingBox();assert(box.x>=10&&box.x+box.width<=width-10&&box.y>=10&&box.y+box.height<=890);
    for(const name of ['취소','각주 저장']){const b=await card().getByRole('button',{name,exact:true}).boundingBox();assert(b.y>=box.y&&b.y+b.height<=box.y+box.height+1);}
    const inputBox=await card().getByRole('textbox',{name:'각주 내용'}).boundingBox();assert(inputBox.x>=box.x+8&&inputBox.x+inputBox.width<=box.x+box.width-8);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,`footnote-${palette}-${theme}-${width}.png`)});layouts.push({palette,theme,width,box});
    await card().getByRole('button',{name:'취소'}).click();await card().waitFor({state:'hidden'});assert.equal((await noteAt(noteBody(),secondId)).text,'수정한 노트 설명');
  }
  await page.setViewportSize({width:360,height:450});await editFootnote(noteBody(),secondId);const small=await card().boundingBox();assert(small.y>=10&&small.y+small.height<=440);await card().getByRole('button',{name:'취소'}).click();
  assert.equal(requests.length,0);assert.equal(errors.length,0);assert(saves>0);await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,saves,layouts,errors},null,2));console.log(JSON.stringify({passed:true,saves,layouts:layouts.length,aiCalls:requests.length,errors}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
