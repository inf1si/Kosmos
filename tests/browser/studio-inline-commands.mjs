// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { inlineSlashScenarios } from './inline-slash-scenarios.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/studio-inline-commands');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// Older checks start in the editor; the studio home has its own check (studio-home.mjs).
await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}');

 if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });

const note = { ...newNote(), title: '합성 노트', content: fromText('\n\n반복 문장.\n\n반복 문장.\n\n마지막 문장.'), tags: ['생각'] };

const other = { ...newNote(), title: '보관 노트', content: fromText('다른 태그'), tags: ['자료'] };

const richId=uid(),richContent=[{type:'text',text:'서식 보존',marks:[{type:'bold'},{type:'fontSize',attrs:{size:24}}]},{type:'footnote',attrs:{noteId:uid(),text:'보존할 각주'}},{type:'text',text:'노트 링크',marks:[{type:'wikiLink',attrs:{targetId:other.id}}]}];

note.content.content.push({type:'paragraph',attrs:{blockId:richId},content:richContent});

let data = addNote(addNote(seedWorkspace(), other), note), version = 1, saves = 0;

const work=data.works[0],scene=work.documents[0],setting=work.documents.find(d=>d.kind==='wiki'),memo=work.documents.find(d=>d.kind==='memo');

scene.content=fromText('\n\n반복 문장.\n\n반복 문장.\n\n마지막 문장.');

scene.content.content.push({type:'paragraph',attrs:{blockId:richId},content:richContent.map(n=>n.marks?.some(m=>m.type==='wikiLink')?{...n,marks:[{type:'wikiLink',attrs:{targetId:setting.id}}]}:n)});

setting.content=fromText('\n\n설정 원문.');

memo.content=fromText('\n\n메모 원문.');

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

const until = async (check, label) => { for (let i = 0; i < 100; i++) { if (check()) return; await page.waitForTimeout(100); }

 throw new Error(`Timed out: ${label}`); };

const providers=[{id:'openai',label:'OpenAI',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'anthropic',label:'Claude',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'gemini',label:'Gemini',configured:false,model:null,source:null,browserStored:false,browserInvalid:false}];

let requests=[],reply='합성 AI 답변',failure=false,delay=0;

await context.route('**/api/ai/providers',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({providers,storageAvailable:true})}));

await context.route('**/api/ai/chat',async route=>{
  const input=route.request().postDataJSON();requests.push(input);

if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
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

try{
  await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await editor().waitFor();

  for(const [query,selector] of [['표','table'],['제목 3','h3'],['글머리','ul'],['번호','ol'],['인용','blockquote'],['구분선','hr']]){
    await start();await page.keyboard.insertText('/'+query);await page.getByRole('listbox',{name:'문서 입력 명령'}).waitFor();
    assert(await editor().evaluate(el=>el===document.activeElement));await page.keyboard.press('Enter');await editor().locator(selector).waitFor();

    if(query==='표')assert.equal(await editor().locator('table tr').count(),3);
    await tool('실행 취소').click();await editor().locator(selector).waitFor({state:'hidden'});await start();await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  }

  await start();await page.keyboard.insertText('/설정');await page.keyboard.press('Enter');await page.getByRole('combobox',{name:'연결할 설정',exact:true}).selectOption(setting.id);await button('연결').click();await editor().locator(`[data-wiki-id="${setting.id}"]`).first().waitFor();await tool('실행 취소').click();await start();await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  await start();await page.keyboard.insertText('/각주');await page.keyboard.press('Enter');await page.getByPlaceholder('각주 내용을 입력하세요').fill('합성 각주');await button('각주 삽입').click();assert.equal(await editor().locator('[data-note-id]').count(),2);await tool('실행 취소').click();assert.equal(await editor().locator('[data-note-id]').count(),1);await start();await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  await start();await page.keyboard.insertText('/');await page.getByRole('listbox',{name:'문서 입력 명령'}).waitFor();assert.equal(await page.getByRole('option',{name:'체크리스트',exact:true}).count(),0);assert.equal(await page.getByRole('option',{name:'이미지',exact:true}).count(),0);await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
  // Exact second occurrence, existing rich paragraph, apply/undo/redo/cloud save/reload.
  const preserved=structuredClone(scene.content.content.at(-1).content);
  await selectParagraph(2);await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'AI에게 질문'}).waitFor();assert((await page.locator('.note-ai-popover summary').innerText()).includes('선택한 글'));
  await page.getByRole('combobox',{name:'AI 질문 제공자'}).selectOption('anthropic');reply='다듬은 원고';await ask('두 번째 문장 다듬기');
  assert.equal(requests[0].docId,scene.id);assert.equal(requests[0].workId,work.id);assert.equal(requests[0].documentRange.text,'반복 문장.');assert.equal(requests[0].noteRange,undefined);
  await button('선택 부분 바꾸기').click();await page.locator('.note-ai-popover').waitFor({state:'hidden'});assert.equal(await editor().locator('p').nth(1).innerText(),'반복 문장.');assert.equal(await editor().locator('p').nth(2).innerText(),reply);
  await tool('실행 취소').click();assert.equal(await editor().locator('p').nth(2).innerText(),'반복 문장.');await tool('다시 실행').click();assert.equal(await editor().locator('p').nth(2).innerText(),reply);await synced();
  assert.deepEqual(data.works[0].documents[0].content.content.find(n=>n.attrs?.blockId===richId).content,preserved);assert.equal(data.works[0].aiConversations[0].messages.length,2);assert.deepEqual(data.works[0].aiConversations[0].messages[1].result.suggestions,[]);
  await page.reload();await editor().waitFor();assert.equal(await editor().locator('p').nth(2).innerText(),reply);

  // Each right-click action opens the correct prompt without sending.
  for(const label of ['요약','문장 다듬기','아이디어 확장','질문하기']){
    await selectParagraph(1);const r=await editor().locator('p').nth(1).boundingBox();await page.mouse.click(r.x+20,r.y+r.height/2,{button:'right'});await page.getByRole('menuitem',{name:label,exact:true}).click();await page.getByRole('textbox',{name:'AI에게 질문'}).waitFor();assert.equal(requests.length,1);await page.keyboard.press('Escape');await page.locator('.note-ai-popover').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.matches('.editor-panes > .editor-shell .manuscript'));assert(await editor().evaluate(el=>el===document.activeElement));
  }

  // Current paragraph insertion remains literal, provider failure retains the prompt.
  await editor().locator('p').nth(3).click();await page.keyboard.press('End');await page.keyboard.press('Alt+Enter');failure=true;await page.getByRole('textbox',{name:'AI에게 질문'}).fill('문단 질문');await button('AI 질문 보내기').click();await page.getByRole('alert').filter({hasText:'합성 제공자 오류'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'AI에게 질문'}).inputValue(),'문단 질문');failure=false;reply='<b>그대로 삽입</b>\n다음';await ask('문단 질문');assert.equal(requests.at(-1).documentRange.kind,'paragraph');await button('커서에 삽입').click();await page.locator('.note-ai-popover').waitFor({state:'hidden'});assert((await editor().innerText()).includes('<b>그대로 삽입</b>'));assert.equal(await editor().locator('b').count(),0);await tool('실행 취소').click();
  // Split settings pane has its own slash/selection/AI history and undo stack.
  await button('옆에 열기').click();await splitEditor().waitFor();await start(splitEditor());await page.keyboard.insertText('/표');await page.keyboard.press('Enter');await splitEditor().locator('table').waitFor();assert.equal(await editor().locator('table').count(),0);await tool('실행 취소',true).click();await start(splitEditor());await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  await splitEditor().locator('p').nth(1).click();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.insertText('/제목 3');await page.getByRole('listbox',{name:'문서 입력 명령'}).waitFor();await page.keyboard.press('Enter');await splitEditor().locator('h3').waitFor();assert.equal(await splitEditor().locator('h3').innerText(),'설정 원문.');await tool('실행 취소',true).click();await splitEditor().locator('p').nth(1).evaluate(el=>{el.closest('[contenteditable]').focus();const node=el.firstChild,text=node.textContent,from=text.indexOf('/제목 3'),range=document.createRange();range.setStart(node,from);range.setEnd(node,from+5);getSelection().removeAllRanges();getSelection().addRange(range);});await page.waitForTimeout(100);await page.keyboard.press('Backspace');assert.equal(await splitEditor().locator('p').nth(1).innerText(),'설정 원문.');
  await selectParagraph(1,splitEditor());await page.keyboard.press('Alt+Enter');reply='다듬은 설정';await ask('분할 설정 다듬기');assert.equal(requests.at(-1).docId,setting.id);assert.equal(requests.at(-1).documentRange.text,'설정 원문.');await button('선택 부분 바꾸기').click();await page.locator('.note-ai-popover').waitFor({state:'hidden'});assert.equal(await splitEditor().locator('p').nth(1).innerText(),reply);assert.equal(await editor().locator('p').nth(2).innerText(),'다듬은 원고');await tool('실행 취소',true).click();assert.equal(await splitEditor().locator('p').nth(1).innerText(),'설정 원문.');
  await selectParagraph(1,splitEditor());await page.keyboard.press('Alt+Enter');await button('AI 대화에서 계속').click();await page.locator(`.editor-panes > .editor-shell [aria-label="${setting.title} 원고"]`).waitFor();await page.locator('.chat-log').waitFor();assert.equal(await editor().getAttribute('aria-label'),`${setting.title} 원고`);assert((await page.locator('.chat-log').innerText()).includes('분할 설정 다듬기'));assert.equal(await page.getByRole('combobox',{name:'AI 제공자',exact:true}).inputValue(),'anthropic');await button('참고 패널 닫기').click();await button('분할 닫기').click();
  // A reply arriving after the document is switched stays on its origin.
  await openDoc(memo);await selectParagraph(1);await page.keyboard.press('Alt+Enter');delay=700;reply='메모 답변';const before=requests.length;await page.getByRole('textbox',{name:'AI에게 질문'}).fill('메모 질문');await button('AI 질문 보내기').click();await until(()=>requests.length>before,'memo request started');await openDoc(scene);await until(()=>data.works[0].aiConversations.some(c=>c.docId===memo.id&&c.messages.length===2),'memo response saved to origin');assert.equal(await editor().locator('p').nth(2).innerText(),'다듬은 원고');delay=0;
  // Stale body edits disable application instead of overwriting new text.
  await selectParagraph(1);await page.keyboard.press('Alt+Enter');delay=700;await page.getByRole('textbox',{name:'AI에게 질문'}).fill('지연 질문');await button('AI 질문 보내기').click();await editor().locator('p').nth(1).click();await page.keyboard.press('End');await page.keyboard.insertText(' 수정');await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert(await button('선택 부분 바꾸기').isDisabled());await page.keyboard.press('Escape');delay=0;
  // Shared notes retain the original controls and conversation scope.
  await page.goto(`${base}/studio#notes/${note.id}`);await page.locator('.notes-workspace .manuscript').waitFor();await page.locator('.notes-workspace .manuscript p').nth(1).click();await page.keyboard.press('Alt+Enter');reply='노트 답변';await ask('노트 질문');assert.equal(requests.at(-1).noteId,note.id);assert.equal(requests.at(-1).documentRange,undefined);await page.keyboard.press('Escape');await synced();
  await page.goto(`${base}/studio`);await editor().waitFor();

  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(({palette,theme})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});
    await editor().locator('p').last().click();await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'AI에게 질문'}).waitFor();const ai=await page.locator('.note-ai-popover').boundingBox();assert(ai.x>=10&&ai.x+ai.width<=width-10);assert(await page.getByRole('textbox',{name:'AI에게 질문'}).evaluate(el=>el===document.activeElement));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,`${palette}-${theme}-${width}.png`)});await page.keyboard.press('Escape');
    await editor().locator('p').nth(1).click();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.insertText('/');await page.getByRole('listbox',{name:'문서 입력 명령'}).waitFor();const slash=await page.locator('.note-command-menu').boundingBox();assert(slash.x>=10&&slash.x+slash.width<=width-10);const colors=await page.getByRole('option').first().evaluate(el=>({ink:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));assert.notEqual(colors.ink,colors.background);await page.screenshot({path:resolve(output,`slash-${palette}-${theme}-${width}.png`)});await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
    await selectParagraph(1);const r=await editor().locator('p').nth(1).boundingBox();await page.mouse.click(r.x+20,r.y+r.height/2,{button:'right'});await page.getByRole('menuitem',{name:'요약',exact:true}).waitFor();const menu=await page.locator('.note-command-menu').boundingBox();assert(menu.x>=10&&menu.x+menu.width<=width-10);await page.screenshot({path:resolve(output,`context-${palette}-${theme}-${width}.png`)});await page.keyboard.press('Escape');layouts.push({width,palette,theme,ai,slash,menu,colors});
  }

  await inlineSlashScenarios({page,body:editor,undo:()=>tool('실행 취소'),redo:()=>tool('다시 실행'),menuLabel:'문서 입력 명령',synced});
  assert.equal(errors.length,0,errors.join('\n'));assert(saves>0);await writeFile(resolve(output,'report.json'),JSON.stringify({requests:requests.length,saves,layouts,errors},null,2));console.log(JSON.stringify({passed:true,requests:requests.length,saves,layouts:layouts.length,errors}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error(JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.getAttribute('aria-label'),menus:[...document.querySelectorAll('[role=dialog],[role=listbox]')].map(n=>n.getAttribute('aria-label')),syntheticBody:document.querySelector('.editor-panes')?.innerText}))));throw error;}finally{await browser.close();}
