// Run through tsx; see docs/settings.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, newDocument, uid, workspaceSchema } from '../../src/lib/model.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/studio-home');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });

// Two works so the home, the work cards and the per-work remembered document all have something to choose between.
let data = seedWorkspace(), version = 1, saves = 0;

const first = data.works[0], setting = first.documents.find(d => d.kind === 'wiki');

const secondScene = newDocument('scene', '둘째 작품 첫 장면'), secondMemo = newDocument('memo', '둘째 작품 메모');

secondScene.content = fromText('\n\n둘째 작품 본문.');

data.works.push({ id: uid(), title: '합성 둘째 작품', subtitle: '', description: '', form: '단편', documents: [secondScene, secondMemo], publications: [], activePublicationId: null });

setting.updatedAt = new Date(Date.now() + 60000).toISOString();

data = workspaceSchema.parse(data);

const second = data.works.at(-1);

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

const editor=()=>page.locator('.editor-panes > .editor-shell .manuscript');

const home=()=>page.locator('.studio-home');

const title=()=>page.getByRole('textbox',{name:'문서 제목'}).first();

const card=(section,name)=>home().getByRole('region',{name:section}).getByRole('button',{name:new RegExp(`^${name}`)});

const dialog=()=>page.getByRole('dialog',{name:'설정'});

const openSettings=async()=>{await page.locator('.studio-tools').getByRole('button',{name:'설정',exact:true}).click();await dialog().waitFor();};

const close=async()=>{await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});};

const chooseStart=async name=>{await openSettings();await dialog().locator('.settings-nav').getByRole('button',{name:'집필 도구',exact:true}).click();await dialog().getByRole('group',{name:'집필실 첫 화면',exact:true}).getByRole('button',{name,exact:true}).click();await close();};

const workCardTitle=()=>page.locator('.work-card strong').innerText();

const activeTab=()=>page.locator('.doc-tab.active').innerText();

const position=async()=>JSON.parse(await page.evaluate(()=>localStorage.getItem('kosmos-studio-position'))||'null');

try{
  // 1. A fresh device opens the home, not the editor.
  await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await home().waitFor();
  assert.equal(await editor().count(),0,'home replaces the editor on entry');
  assert.equal(await activeTab(),'집필실 홈');
  assert.equal(await page.locator('.studio-tools').getByRole('button',{name:'집필실 홈'}).getAttribute('aria-pressed'),'true');
  assert.match(await home().locator('.board-bar>span').innerText(),new RegExp(`^작품 ${data.works.length} · 원고 \\d+ · [\\d,]+자$`));
  assert.equal(await card('작품','').count(),data.works.length,'one card per work');
  assert.equal(await card('작품',first.title).getAttribute('aria-current'),'true');
  assert.match(await card('이어 쓰기','').innerText(),new RegExp(first.documents.find(d=>d.kind==='scene').title));
  assert.match(await card('최근 수정','').first().innerText(),new RegExp(setting.title),'newest edit leads the recent list');

  // 2. A work card opens that work; back returns to the home tab.
  await card('작품',second.title).click();await editor().waitFor();
  assert.equal(await title().inputValue(),secondScene.title);assert.equal(await workCardTitle(),second.title);
  assert.deepEqual((await page.locator('.doc-tab').allInnerTexts()).map(t=>t.trim()),['집필실 홈',secondScene.title],'home tab stays open across works');
  await page.getByRole('button',{name:'뒤로'}).click();await home().waitFor();
  assert.equal(await card('작품',second.title).getAttribute('aria-current'),'true');

  // 3. A recent document in another work opens there and becomes the place to resume.
  await card('최근 수정',setting.title).click();await editor().waitFor();
  assert.equal(await title().inputValue(),setting.title);assert.equal(await workCardTitle(),first.title);
  assert.deepEqual(await position(),{workId:first.id,docs:{[second.id]:secondScene.id,[first.id]:setting.id}});
  await page.reload({waitUntil:'domcontentloaded'});await home().waitFor();
  assert.match(await card('이어 쓰기','').innerText(),new RegExp(`${setting.title}[\\s\\S]*${first.title}`));
  await card('이어 쓰기','').click();await editor().waitFor();assert.equal(await title().inputValue(),setting.title);

  // 4. The work menu reopens each work on its own last document.
  const switchTo=async name=>{await page.locator('.work-card').click();await page.locator('#work-menu').getByRole('button',{name:new RegExp(`^${name}`)}).click();await editor().waitFor();};

  await switchTo(second.title);assert.equal(await title().inputValue(),secondScene.title);
  await switchTo(first.title);assert.equal(await title().inputValue(),setting.title);

  // 5. "마지막 문서" skips the home; the sidebar still reaches it.
  await chooseStart('마지막 문서');
  await page.reload({waitUntil:'domcontentloaded'});await editor().waitFor();
  assert.equal(await home().count(),0);assert.equal(await title().inputValue(),setting.title);assert.equal(await workCardTitle(),first.title);
  await page.locator('.studio-tools').getByRole('button',{name:'집필실 홈'}).click();await home().waitFor();
  await chooseStart('집필실 홈');
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('kosmos-app-preferences'))).studioStart,'home');
  // Main page entry points still lead here.
  await page.goto(`${base}/`,{waitUntil:'domcontentloaded'});await page.getByRole('link',{name:'집필실',exact:true}).first().click();await home().waitFor();

  // 6. Six palettes x two widths: no horizontal overflow on the home.
  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===360?740:900});
    await page.evaluate(({palette,theme})=>{localStorage.setItem('orbis-palette',palette);localStorage.setItem('orbis-theme',theme);document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},{palette,theme});
    await page.reload({waitUntil:'domcontentloaded'});await home().waitFor();await page.waitForTimeout(150);
    const overflow=await page.evaluate(()=>[document.documentElement,...document.querySelectorAll('.studio-home,.studio-home .board-bar,.notes-home-body,.studio-home .reference-card')].flatMap(n=>n.scrollWidth>n.clientWidth+1?[n.className||n.tagName]:[]));
    assert.deepEqual(overflow,[],`${palette}-${theme}-${width} no overflow`);
    layouts.push(`${palette}-${theme}-${width}`);
    await page.screenshot({path:resolve(output,`home-${palette}-${theme}-${width}.png`)});
  }

  assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'summary.json'),JSON.stringify({layouts,saves},null,2));
  console.log(`studio home: ${layouts.length} layouts, ${saves} saves`);
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error(errors);throw error;}
finally{await browser.close();}
