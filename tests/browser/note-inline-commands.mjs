// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { inlineSlashScenarios } from './inline-slash-scenarios.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { deflateSync,crc32 } from 'node:zlib';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
function png(width, height, rgb) {
    const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => rgb).flat()])));
    const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const picture=png(20,10,[120,90,200]);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/note-inline-commands');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const note = { ...newNote(), title: '합성 노트', content: fromText('\n\n반복 문장.\n\n반복 문장.\n\n마지막 문장.'), tags: ['생각'] };
const other = { ...newNote(), title: '보관 노트', content: fromText('다른 태그'), tags: ['자료'] };
const richId=uid(),richContent=[{type:'text',text:'서식 보존',marks:[{type:'bold'},{type:'fontSize',attrs:{size:24}}]},{type:'footnote',attrs:{noteId:uid(),text:'보존할 각주'}},{type:'text',text:'노트 링크',marks:[{type:'wikiLink',attrs:{targetId:other.id}}]}];
note.content.content.push({type:'paragraph',attrs:{blockId:richId},content:richContent});
let data = addNote(addNote(seedWorkspace(), other), note), version = 1, saves = 0;
const workIds = data.works.map(w => w.id), initialContent = structuredClone(note.content), errors = [], layouts = [];
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
const popover = () => page.locator('.popover');
const until = async (check, label) => { for (let i = 0; i < 100; i++) { if (check()) return; await page.waitForTimeout(100); } throw new Error(`Timed out: ${label}`); };
const indent = scope => page.locator(`${scope} .manuscript p`).nth(1).evaluate(el => getComputedStyle(el).textIndent);
const providers=[{id:'openai',label:'OpenAI',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'anthropic',label:'Claude',configured:true,model:'synthetic-model',source:'server',browserStored:false,browserInvalid:false},{id:'gemini',label:'Gemini',configured:false,model:null,source:null,browserStored:false,browserInvalid:false}];
let requests=[],reply='합성 AI 답변',failure=false,delay=0;
await context.route('**/api/ai/providers',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({providers,storageAvailable:true})}));
await context.route('**/api/ai/chat',async route=>{
  const input=route.request().postDataJSON();requests.push(input);if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  await route.fulfill({status:failure?503:200,contentType:'application/json',body:JSON.stringify(failure?{error:'합성 제공자 오류'}:{result:{review:reply,suggestions:[{quote:input.noteRange?.text||'반복 문장.',replacement:reply,reason:'합성 수정'}]},model:'synthetic-model',version:input.version,sources:[]})});
});
const editor=()=>page.locator('.notes-workspace .manuscript');
const start=async()=>{await editor().locator('p').first().click({position:{x:2,y:10}});await page.keyboard.press('Home');await page.waitForTimeout(50);};
const selectParagraph=async index=>{await editor().locator('p').nth(index).click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.waitForFunction(()=>!!getSelection()?.toString().trim());};
const synced=()=>page.waitForFunction(()=>document.body.textContent.includes('클라우드 동기화됨'));
try{
  await page.goto(`${base}/studio#notes/${note.id}`,{waitUntil:'domcontentloaded'});await editor().waitFor();
  await start();await page.keyboard.insertText('/');await page.getByRole('listbox',{name:'노트 입력 명령'}).waitFor();
  assert(await editor().evaluate(el=>el===document.activeElement),'Typing keeps the editor focus');
  await page.keyboard.insertText('표');assert.equal(await page.getByRole('listbox',{name:'노트 입력 명령'}).getByRole('option').count(),1);await page.keyboard.press('Enter');await editor().locator('table').waitFor();assert.equal(await editor().locator('table tr').count(),3);assert.equal(await editor().locator('table th').count(),3);
  await button('실행 취소').click();await editor().locator('table').waitFor({state:'hidden'});
  await start();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.insertText('/체크');await page.keyboard.press('Enter');await editor().locator('[data-type="taskList"]').waitFor();
  await button('실행 취소').click();await start();await page.keyboard.press('Shift+End');await page.keyboard.insertText('/');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await editor().locator('h1').waitFor();
  await button('실행 취소').click();await start();await page.keyboard.press('Shift+End');await page.keyboard.insertText('/');await page.keyboard.press('Escape');assert(await editor().evaluate(el=>el===document.activeElement));assert.equal(await page.getByRole('listbox').count(),0);
  // Cancel preserves literal text, then remove it with ordinary keyboard editing.
  await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  // Other block commands, links and file insertion use the same actual cursor.
  for(const [query,selector] of [['글머리','ul'],['번호','ol'],['인용','blockquote'],['구분선','hr']]){await start();await page.keyboard.insertText('/'+query);await page.keyboard.press('Enter');await editor().locator(selector).waitFor();await button('실행 취소').click();await editor().locator(selector).waitFor({state:'hidden'});await start();await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');}
  await start();await page.keyboard.insertText('/링크');await page.keyboard.press('Enter');await page.getByRole('combobox',{name:'연결할 노트',exact:true}).waitFor();await page.getByRole('combobox',{name:'연결할 노트',exact:true}).selectOption(other.id);await button('연결').click();await editor().locator('[data-wiki-id]').first().waitFor();await button('실행 취소').click();await start();await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  await start();await page.keyboard.insertText('/이미지');await page.getByRole('listbox',{name:'노트 입력 명령'}).getByRole('option',{name:'이미지',exact:true}).waitFor();const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.keyboard.press('Enter')]);await chooser.setFiles({name:'synthetic.png',mimeType:'image/png',buffer:picture});await editor().locator('.note-image img').waitFor();assert(await editor().locator('.note-image img').evaluate(el=>el.naturalWidth===20));await button('실행 취소').click();await editor().locator('.note-image').waitFor({state:'hidden'});await start();await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  await start();await page.keyboard.insertText('https://example.invalid/path');assert.equal(await page.getByRole('listbox',{name:'노트 입력 명령'}).count(),0);await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.press('Backspace');
  await selectParagraph(2);await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'커서 AI에게 질문',exact:true}).waitFor();
  assert.equal((await page.locator('.note-ai-popover summary').innerText()).trim(),'선택한 글 · 6자');
  assert(await page.getByRole('textbox',{name:'커서 AI에게 질문'}).evaluate(el=>el===document.activeElement));
  await page.getByRole('combobox',{name:'커서 AI 제공자'}).selectOption('anthropic');
  await page.getByRole('textbox',{name:'커서 AI에게 질문'}).fill('다듬어 줘');await button('커서 AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();
  await page.getByRole('textbox',{name:'적용할 AI 답변'}).fill('');assert(await button('선택 부분 바꾸기').isDisabled());await page.getByRole('textbox',{name:'적용할 AI 답변'}).fill(reply);
  assert.equal(requests.length,1);assert.equal(requests[0].noteRange.text,'반복 문장.');assert.equal(requests[0].provider,'anthropic');assert.equal(requests[0].sourceIds.length,0);
  await button('선택 부분 바꾸기').click();await page.locator('.note-ai-popover').waitFor({state:'hidden'});assert.equal(await editor().locator('p').nth(1).innerText(),'반복 문장.');assert.equal(await editor().locator('p').nth(2).innerText(),reply);
  await button('실행 취소').click();assert.equal(await editor().locator('p').nth(2).innerText(),'반복 문장.');await button('다시 실행').click();assert.equal(await editor().locator('p').nth(2).innerText(),reply);
  await synced();assert.deepEqual(data.notes.find(n=>n.id===note.id).content.content.find(b=>b.attrs?.blockId===richId).content,richContent);assert.equal(data.notes.find(n=>n.id===note.id).aiMessages.length,2);assert.deepEqual(data.notes.find(n=>n.id===note.id).aiMessages[1].result.suggestions,[]);
  await page.reload();await editor().waitFor();assert.equal(await editor().locator('p').nth(2).innerText(),reply);
  // Selection/right-click action opens without sending or modifying the original text.
  await selectParagraph(1);const rect=await page.evaluate(()=>{const r=getSelection().getRangeAt(0).getClientRects()[0];return {x:r.x,y:r.y,width:r.width,height:r.height};});await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2,{button:'right'});await page.getByRole('menuitem',{name:'요약',exact:true}).waitFor();
  await page.getByRole('menuitem',{name:'문장 다듬기',exact:true}).click();assert((await page.getByRole('textbox',{name:'커서 AI에게 질문'}).inputValue()).includes('문장을 다듬어'));assert.equal(requests.length,1);
  await page.keyboard.press('Escape');await page.locator('.note-ai-popover').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.matches('.notes-workspace .manuscript'));
  // Regression: context-menu paste of one line stays inside the paragraph.
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.evaluate(()=>navigator.clipboard.writeText('붙임'));
  const paragraphs=await editor().locator('p').count();await editor().locator('p').nth(3).click();await page.keyboard.press('Home');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');
  const word=await page.evaluate(()=>{const r=getSelection().getRangeAt(0).getClientRects()[0];return {x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.click(word.x,word.y,{button:'right'});await page.getByRole('menuitem',{name:'붙여넣기',exact:true}).click();
  await until(()=>true,'paste');await page.waitForFunction(()=>document.querySelectorAll('.notes-workspace .manuscript p')[3]?.textContent==='붙임막 문장.');assert.equal(await editor().locator('p').count(),paragraphs);await button('실행 취소').click();assert.equal(await editor().locator('p').nth(3).innerText(),'마지막 문장.');
  await editor().locator('p').nth(3).click();await page.keyboard.press('End');await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'커서 AI에게 질문'}).waitFor();assert((await page.locator('.note-ai-popover summary').innerText()).includes('현재 문단'),await page.locator('.note-ai-popover summary').innerText());await page.getByRole('textbox',{name:'커서 AI에게 질문'}).fill('다음 아이디어');
  failure=true;await button('커서 AI 질문 보내기').click();await page.getByRole('alert').filter({hasText:'합성 제공자 오류'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'커서 AI에게 질문'}).inputValue(),'다음 아이디어');failure=false;
  reply='<b>실행되지 않는 글</b>\n다음 문단';await button('커서 AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();await button('커서에 삽입').click();await page.locator('.note-ai-popover').waitFor({state:'hidden'});assert((await editor().innerText()).includes('<b>실행되지 않는 글</b>'));assert.equal(await editor().locator('b').count(),0);await button('실행 취소').click();
  await synced();
  // Both surfaces share provider, preset and persisted exchanges.
  await editor().locator('p').nth(1).click();await page.keyboard.press('Alt+Enter');await button('AI 대화에서 계속').click();await page.getByRole('combobox',{name:'AI 제공자',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'AI 제공자',exact:true}).inputValue(),'anthropic');assert((await page.locator('.chat-log').innerText()).includes('다듬어 줘'));await button('노트 참고 패널 닫기').click();
  // Responses do not overwrite edits made while waiting.
  await selectParagraph(1);await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'커서 AI에게 질문'}).fill('지연 응답');delay=1000;await button('커서 AI 질문 보내기').click();await editor().locator('p').nth(1).click();await page.keyboard.press('End');await page.keyboard.insertText(' 수정');
  await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert(await button('선택 부분 바꾸기').isDisabled());assert((await editor().locator('p').nth(1).innerText()).endsWith(' 수정'));await page.keyboard.press('Escape');delay=0;
  // Connection settings can open inside cursor AI and return without losing the target.
  await editor().locator('p').nth(1).click();await page.keyboard.press('End');await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'커서 AI에게 질문'}).waitFor();await button('AI 설정').click();await page.getByRole('dialog',{name:'AI 설정',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'AI 설정',exact:true}).waitFor({state:'hidden'});await page.locator('.note-ai-popover').waitFor();await page.keyboard.press('Escape');await page.locator('.note-ai-popover').waitFor({state:'hidden'});
  // Each palette/mode at desktop and phone: actual menus, focus, contrast and bounds.
  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(({palette,theme})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});
    await editor().locator('p').last().click();await page.keyboard.press('Alt+Enter');await page.getByRole('textbox',{name:'커서 AI에게 질문'}).waitFor();
    const box=await page.locator('.note-ai-popover').boundingBox();assert(box.x>=10&&box.x+box.width<=width-10);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:resolve(output,`${palette}-${theme}-${width}.png`)});layouts.push({palette,theme,width,box});await page.keyboard.press('Escape');await page.locator('.note-ai-popover').waitFor({state:'hidden'});
    await editor().locator('p').nth(1).click();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.insertText('/');await page.getByRole('listbox',{name:'노트 입력 명령'}).waitFor();const menu=await page.locator('.note-command-menu').boundingBox();assert(menu.x>=10&&menu.x+menu.width<=width-10);const colors=await page.getByRole('listbox').getByRole('option').first().evaluate(el=>({ink:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));assert.notEqual(colors.ink,colors.background);await page.screenshot({path:resolve(output,`slash-${palette}-${theme}-${width}.png`)});await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
    await selectParagraph(1);const r=await page.evaluate(()=>{const r=getSelection().getRangeAt(0).getClientRects()[0];return {x:r.x,y:r.y,width:r.width,height:r.height};});await page.mouse.click(r.x+r.width/2,r.y+r.height/2,{button:'right'});await page.getByRole('menuitem',{name:'요약',exact:true}).waitFor();const right=await page.locator('.note-command-menu').boundingBox();assert(right.x>=10&&right.x+right.width<=width-10);await page.screenshot({path:resolve(output,`context-${palette}-${theme}-${width}.png`)});await page.keyboard.press('Escape');
  }
  await inlineSlashScenarios({page,body:editor,undo:()=>button('실행 취소'),redo:()=>button('다시 실행'),menuLabel:'노트 입력 명령',synced});
  await page.setViewportSize({width:1280,height:900});await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await page.locator('.studio-panel .manuscript').first().waitFor();await button('AI 대화').click();await page.getByRole('combobox',{name:'AI 제공자',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'AI 제공자',exact:true}).inputValue(),'anthropic');assert((await page.locator('.chat-heading').innerText()).trim());
  assert.equal(errors.length,0,errors.join('\n'));assert(saves>0);await writeFile(resolve(output,'report.json'),JSON.stringify({requests:requests.length,saves,layouts,errors},null,2));console.log(JSON.stringify({passed:true,requests:requests.length,saves,layouts:layouts.length,errors}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error(JSON.stringify(await page.evaluate(()=>({selection:getSelection()?.toString(),active:document.activeElement?.getAttribute('aria-label'),summary:document.querySelector('.note-ai-popover summary')?.textContent,body:document.querySelector('.notes-workspace .manuscript')?.innerHTML}))));throw error;}finally{await browser.close();}
