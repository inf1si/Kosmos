// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
import { chooseOption, selectedValue } from './select.mjs';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/ai-limits-copy');

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


const { PALETTES }=await import('../../src/lib/theme.ts');

providers.forEach(p=>{p.configured=true;p.model='synthetic-model';p.source='server';});

scene.content=fromText('가'.repeat(13001));

data.notes.find(n=>n.id===note.id).content=fromText('나'.repeat(13001));

const sources=Array.from({length:10},(_,i)=>({...structuredClone(setting),id:uid(),title:`긴 참고 ${i}`,content:fromText('다'.repeat(3001))}));

work.documents.push(...sources);

work.aiConversations=[{docId:scene.id,messages:Array.from({length:24},(_,i)=>[{id:uid(),role:'user',text:`과거 질문 ${i}`,createdAt:scene.updatedAt},{id:uid(),role:'assistant',provider:'openai',model:'synthetic-model',version:scene.updatedAt,createdAt:scene.updatedAt,sources:[],result:{review:`과거 답변 ${i}`,suggestions:[]}}]).flat()}];

const longQuestion='긴 질문입니다.'.repeat(501);

const chat=()=>page.locator('.ai-chat');

const editor=()=>page.locator('.editor-panes > .editor-shell .manuscript');

const synced=()=>page.waitForFunction(()=>document.body.textContent.includes('클라우드 동기화됨'));

const q=()=>page.getByRole('textbox',{name:'AI에게 질문',exact:true});

const screenshot=async name=>page.screenshot({path:resolve(output,name+'.png'),animations:'disabled',timeout:30000});

try{
 await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await editor().waitFor();await button('AI 대화').click();await chat().waitFor();
 assert.equal(await q().getAttribute('maxlength'),null);
 await chat().locator('summary').click();await button('참고 자료 선택').click();

 for(const input of await page.locator('.chat-source-picker input:checked').all())await input.uncheck();

 for(const source of sources)await page.getByRole('checkbox',{name:source.title,exact:false}).check();
 assert.equal(await page.locator('.chat-source-picker input:checked').count(),10);await button('선택 완료 · 10개').click();

 for(let i=0;i<12;i++){
  await chooseOption(page.getByRole('combobox',{name:'AI 제공자',exact:true}),providers[i%3].id);
  await q().fill(longQuestion+String(i));await button('질문 보내기').click();await page.waitForFunction(()=>document.querySelector('.ai-chat textarea')?.value==='');
 }

 assert.equal(requests.length,12);assert.equal(requests[0].sourceIds.length,10);assert.equal(requests[0].history.length,48);assert(requests[0].message.length>2000);
 await synced();assert.equal(data.works[0].aiConversations[0].messages.length,72);assert.equal(data.works[0].documents[0].content.content[0].content[0].text.length,13001);

 for(const width of [1280,360])for(const palette of PALETTES)for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(({palette,theme})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});
  const name=`${palette}-${theme}-${width}`;

  const layout=await chat().evaluate(el=>{const b=el.getBoundingClientRect(),send=el.querySelector('[aria-label="질문 보내기"]'),s=send.getBoundingClientRect(),style=getComputedStyle(send);

return {x:b.x,right:b.right,sendRight:s.right,sendBottom:s.bottom,color:style.color,background:style.backgroundColor,text:el.innerText};});

  assert(layout.x>=0&&layout.right<=width+1,name);assert(layout.sendRight<=width&&layout.sendBottom<=900,name);assert(!/2,000자|하루 10회|20회|Enter 전송|12,000자까지/.test(layout.text),name);
  await button('AI 설정').click();await page.getByRole('dialog',{name:'AI 설정'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'스킬 요청'}).getAttribute('maxlength'),null);assert.equal(await page.getByRole('textbox',{name:'시스템 프롬프트'}).getAttribute('maxlength'),null);
  assert.equal(await page.getByRole('dialog',{name:'AI 설정'}).evaluate(el=>el.scrollWidth<=el.clientWidth),true,name);

  if(['violet','cyber','orbit'].includes(palette)&&theme==='dark')await screenshot(`settings-${name}`);
  await page.keyboard.press('Escape');await chat().waitFor();layouts.push({name,...layout,text:undefined});
 }

 await page.setViewportSize({width:1280,height:900});await button('참고 패널 닫기').click();
 // The full paragraph goes through inline AI as well; text does not change until applied.
 await editor().locator('p').first().click();await page.keyboard.press('Alt+Enter');await page.locator('.note-ai-popover').waitFor();
 await q().fill(longQuestion);await button('AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert.equal(requests.at(-1).documentRange.text.length,13001);await button('취소').click();
 await page.goto(`${base}/studio#notes/${note.id}`);await page.locator('.notes-workspace .manuscript').waitFor();
 await page.locator('.notes-workspace .manuscript p').first().click();await page.keyboard.press('Alt+Enter');await page.locator('.note-ai-popover').waitFor();await q().fill(longQuestion);await button('AI 질문 보내기').click();await page.getByRole('textbox',{name:'적용할 AI 답변'}).waitFor();assert.equal(requests.at(-1).noteRange.text.length,13001);await button('취소').click();
 await until(()=>data.notes.find(n=>n.id===note.id).aiMessages?.length===2,'노트 대화 서버 저장');
 await page.reload();await page.locator('.notes-workspace .manuscript').waitFor();assert.equal(data.notes.find(n=>n.id===note.id).aiMessages[0].text,longQuestion);
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,requests:requests.length,saves,layouts,errors},null,2));console.log(JSON.stringify({passed:true,requests:requests.length,saves,layouts:layouts.length,errors}));
}catch(error){await screenshot('failure');console.error(await page.locator('body').innerText().then(s=>s.slice(-1500)));throw error;}finally{await browser.close();}
