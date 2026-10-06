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
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/manuscript-fonts');
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

const fontRequests=[];page.on('response',r=>{if(/\.woff2?(\?|$)/.test(r.url()))fontRequests.push({url:r.url(),status:r.status()});});
const editor=()=>page.locator('.editor-panes > .editor-shell .manuscript');
const select=()=>page.locator('.editor-panes > .editor-shell').getByRole('combobox',{name:'본문 글꼴',exact:true});
const added=[['pretendard','프리텐다드','Pretendard Variable'],['wanted-sans','원티드 산스','Wanted Sans Variable'],['nanum-barun-gothic','나눔바른고딕','나눔바른고딕'],['maruburi','마루부리','마루 부리']];
const results=[];
try{
  await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await editor().waitFor();await page.waitForTimeout(1500);
  // New families are declared globally but fetched only once selected.
  assert.equal(fontRequests.filter(r=>/pretendard|wanted|nanumbarun|maruburi/i.test(r.url)).length,0,'no new font fetched before selection');
  const labels=await select().locator('option').allInnerTexts();assert.equal(labels.length,20);for(const [,label] of added)assert(labels.includes(label),label);
  for(const [id,label,family] of added){
    const before=fontRequests.length;
    await select().selectOption(id);
    await page.waitForFunction(f=>document.fonts.check(`18px "${f}"`,'가나다')&&[...document.fonts].some(x=>x.family.replace(/"/g,'')===f&&x.status==='loaded'),family,{timeout:20000});
    const computed=await editor().evaluate(el=>getComputedStyle(el).fontFamily);
    assert(computed.includes(family),`${label}: ${computed}`);
    const fetched=fontRequests.slice(before);assert(fetched.length>0&&fetched.every(r=>r.status===200&&r.url.startsWith(base)),`${label} fetched from app: ${JSON.stringify(fetched)}`);
    // Width of a sample differs from the fallback, i.e. the face actually renders.
    const widths=await page.evaluate(f=>{const c=document.createElement('canvas').getContext('2d');c.font=`18px "${f}", monospace`;const a=c.measureText('갈매기 나는 바다와 하늘').width;c.font='18px monospace';return [a,c.measureText('갈매기 나는 바다와 하늘').width];},family);
    assert.notEqual(widths[0],widths[1],`${label} renders`);
    results.push({label,computed,files:fetched.length,bytes:fetched.map(r=>r.url.split('/').pop())});
    await editor().screenshot({path:`${output}/${id}.png`});
  }
  // The choice is a device preference and survives reload.
  await select().selectOption('pretendard');await page.reload({waitUntil:'domcontentloaded'});await editor().waitFor();assert.equal(await select().inputValue(),'pretendard');
  await page.waitForFunction(()=>document.fonts.check('18px "Pretendard Variable"','가'));
  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(({palette,theme})=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});await page.waitForTimeout(200);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert(!overflow,`${palette}-${theme}-${width} overflow`);
    await page.screenshot({path:`${output}/${palette}-${theme}-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(results,null,1));console.log('manuscript fonts ok');
}finally{await browser.close();}
