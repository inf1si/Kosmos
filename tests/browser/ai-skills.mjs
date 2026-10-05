// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/ai-skills');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
const prompt='보낸 글을 인물의 존댓말 말투로 바꿔 줘. 설명 없이 바꾼 글만 답해 줘.';
const skillBox=()=>page.getByRole('combobox',{name:'AI 질문 스킬',exact:true});
const question=()=>page.getByRole('textbox',{name:'AI에게 질문',exact:true});
const slash=async(text,body=editor(),index=1)=>{await body.locator('p').nth(index).click();await page.keyboard.press('End');await page.keyboard.insertText(text);};
const manage=async()=>{await slash('/스킬');await page.getByRole('option',{name:'스킬 관리',exact:true}).click();await page.getByRole('dialog',{name:'AI 설정'}).waitFor();};
try{
  await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await editor().waitFor();
  // `/스킬 관리` opens AI settings at the skill section and removes the typed query.
  await slash('/스킬');await page.getByRole('listbox',{name:'문서 입력 명령'}).waitFor();assert.equal(await page.getByRole('listbox',{name:'문서 입력 명령'}).getByRole('option').count(),1);await page.keyboard.press('Enter');
  await page.getByRole('dialog',{name:'AI 설정'}).waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='편집할 스킬');
  assert.equal(await editor().locator('p').nth(1).innerText(),'반복 문장.');
  await page.getByRole('textbox',{name:'스킬 이름'}).fill('존댓말로');await page.getByRole('textbox',{name:'스킬 설명'}).fill('대사 말투 바꾸기');await page.getByRole('textbox',{name:'스킬 요청'}).fill(prompt);
  await button('새 스킬 저장').click();await page.getByRole('status').filter({hasText:'스킬을 저장했습니다'}).waitFor();await synced();
  const skill=data.aiPreferences.skills[0];assert.equal(skill.title,'존댓말로');assert.equal(skill.prompt,prompt);assert.equal(requests.length,0);
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'AI 설정'}).waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.matches('.editor-panes > .editor-shell .manuscript'));
  // `/` runs the skill on the current paragraph; the request is the saved prompt.
  await slash('/존댓');await page.getByRole('option',{name:'존댓말로',exact:true}).waitFor();assert.equal(await page.locator('.note-command-menu .note-command-caption').filter({hasText:'내 스킬'}).count(),1);await page.keyboard.press('Enter');
  await question().waitFor();assert.equal(await question().inputValue(),prompt);assert.equal(await skillBox().inputValue(),`skill:${skill.id}`);assert((await page.locator('.note-ai-popover summary').innerText()).includes('현재 문단'));
  assert.equal(await editor().locator('p').nth(1).innerText(),'반복 문장.');
  reply='반복되는 문장입니다.';await button('AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();
  assert.equal(requests.at(-1).message,prompt);assert.equal(requests.at(-1).documentRange.kind,'paragraph');assert.equal(requests.at(-1).documentRange.text,'반복 문장.');assert.equal(requests.at(-1).docId,scene.id);
  await button('문단 바꾸기').click();await page.locator('.note-ai-popover').waitFor({state:'hidden'});assert.equal(await editor().locator('p').nth(1).innerText(),reply);await tool('실행 취소').click();assert.equal(await editor().locator('p').nth(1).innerText(),'반복 문장.');
  // The description is searchable.
  await slash('/대사');await page.getByRole('option',{name:'존댓말로',exact:true}).waitFor();await page.keyboard.press('Escape');for(let i=0;i<3;i++)await page.keyboard.press('Backspace');assert.equal(await editor().locator('p').nth(1).innerText(),'반복 문장.');
  // Right-click on a selection offers the skill with the selected range; switching to a built-in action replaces the request.
  await selectParagraph(2);let r=await editor().locator('p').nth(2).boundingBox();await page.mouse.click(r.x+20,r.y+r.height/2,{button:'right'});
  for(const label of ['요약','문장 다듬기','아이디어 확장','질문하기','존댓말로'])await page.getByRole('menuitem',{name:label,exact:true}).waitFor();
  const icons=await page.locator('.note-command-menu [role=menuitem] svg').evaluateAll(list=>list.slice(0,4).map(svg=>svg.getAttribute('class')));assert.equal(new Set(icons).size,4,'AI 항목마다 다른 아이콘');
  await page.getByRole('menuitem',{name:'존댓말로',exact:true}).click();await question().waitFor();assert.equal(await question().inputValue(),prompt);assert((await page.locator('.note-ai-popover summary').innerText()).includes('선택한 글'));
  await skillBox().selectOption('summarize');assert.match(await question().inputValue(),/요약/);await skillBox().selectOption(`skill:${skill.id}`);assert.equal(await question().inputValue(),prompt);
  reply='선택 답변';await button('AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert.equal(requests.at(-1).documentRange.kind,'selection');assert.equal(requests.at(-1).message,prompt);await page.keyboard.press('Escape');
  // Notes use the same skills.
  await page.goto(`${base}/studio#notes/${note.id}`);const noteBody=()=>page.locator('.notes-workspace .manuscript');await noteBody().waitFor();
  await slash('/존댓',noteBody());await page.getByRole('listbox',{name:'노트 입력 명령'}).waitFor();await page.keyboard.press('Enter');await question().waitFor();assert.equal(await question().inputValue(),prompt);
  reply='노트 답변';await button('AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert.equal(requests.at(-1).noteId,note.id);assert.equal(requests.at(-1).noteRange.text,'반복 문장.');assert.equal(requests.at(-1).message,prompt);await page.keyboard.press('Escape');await synced();
  // Persistence after reload.
  await page.goto(`${base}/studio`);await editor().waitFor();await slash('/존댓');await page.getByRole('option',{name:'존댓말로',exact:true}).waitFor();await page.keyboard.press('Escape');for(let i=0;i<3;i++)await page.keyboard.press('Backspace');
  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(({palette,theme})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});
    const name=`${palette}-${theme}-${width}`,inside=box=>assert(box.x>=10&&box.x+box.width<=width-10,name);
    await slash('/스킬');await page.getByRole('option',{name:'존댓말로',exact:true}).waitFor();const menu=await page.locator('.note-command-menu').boundingBox();inside(menu);await page.screenshot({path:resolve(output,`slash-${name}.png`)});await page.keyboard.press('Escape');for(let i=0;i<3;i++)await page.keyboard.press('Backspace');
    await selectParagraph(2);r=await editor().locator('p').nth(2).boundingBox();await page.mouse.click(r.x+20,r.y+r.height/2,{button:'right'});await page.getByRole('menuitem',{name:'존댓말로',exact:true}).waitFor();inside(await page.locator('.note-command-menu').boundingBox());await page.screenshot({path:resolve(output,`context-${name}.png`)});
    await page.getByRole('menuitem',{name:'존댓말로',exact:true}).click();await question().waitFor();const ai=await page.locator('.note-ai-popover').boundingBox();inside(ai);const select=await skillBox().boundingBox();assert(select.x+select.width<=ai.x+ai.width,name);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(output,`panel-${name}.png`)});await page.keyboard.press('Escape');await page.locator('.note-ai-popover').waitFor({state:'hidden'});
    await manage();await page.getByRole('heading',{name:'내 스킬'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'편집할 스킬'}).inputValue(),skill.id);const dialog=await page.getByRole('dialog',{name:'AI 설정'}).evaluate(el=>({scroll:el.scrollWidth<=el.clientWidth}));assert(dialog.scroll,name);await page.screenshot({path:resolve(output,`settings-${name}.png`)});await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'AI 설정'}).waitFor({state:'hidden'});
    layouts.push({name,menu,ai});
  }
  await page.setViewportSize({width:1280,height:900});
  // Edit, then delete with a recovery snapshot.
  await manage();await page.getByRole('textbox',{name:'스킬 이름'}).fill('존댓말 바꾸기');await button('스킬 저장').click();await synced();assert.equal(data.aiPreferences.skills[0].title,'존댓말 바꾸기');await page.keyboard.press('Escape');
  await slash('/존댓');await page.getByRole('option',{name:'존댓말 바꾸기',exact:true}).waitFor();await page.keyboard.press('Escape');for(let i=0;i<3;i++)await page.keyboard.press('Backspace');
  await manage();await button('스킬 삭제').click();await button('삭제').click();await page.getByRole('status').filter({hasText:'스킬을 삭제했습니다'}).waitFor();await synced();assert.equal(data.aiPreferences.skills.length,0);await page.keyboard.press('Escape');
  await slash('/존댓');await page.waitForTimeout(200);assert.equal(await page.getByRole('listbox',{name:'문서 입력 명령'}).count(),0);for(let i=0;i<3;i++)await page.keyboard.press('Backspace');
  assert.equal(errors.length,0,errors.join('\n'));await writeFile(resolve(output,'report.json'),JSON.stringify({requests:requests.length,saves,layouts,errors},null,2));console.log(JSON.stringify({passed:true,requests:requests.length,saves,layouts:layouts.length,errors}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error(JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.getAttribute('aria-label'),menus:[...document.querySelectorAll('[role=dialog],[role=listbox]')].map(n=>n.getAttribute('aria-label'))}))));throw error;}finally{await browser.close();}
