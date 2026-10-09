// Run through tsx; see docs/settings.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { workspaceSchema } from '../../src/lib/model.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/work-actions');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });

// The seed has two works and the first one is published.
let data = workspaceSchema.parse(seedWorkspace()), version = 1, saves = 0, missingRpc = false;

const [first, second] = data.works, unpublished = [], errors = [], layouts = [];

assert(first.activePublicationId && !second.activePublicationId);

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
    else if (path.endsWith('/unpublish_work')) {
        // A database without the 2026-10-07 migration answers like PostgREST does for an unknown function.
        if (missingRpc)
            return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.unpublish_work(p_work_id) in the schema cache' }) });
        unpublished.push(request.postDataJSON().p_work_id);
        value = 1;
    }
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

page.on('pageerror', error => errors.push(error.message));

const until = async (check, label) => { for (let i = 0; i < 100; i++) { if (check()) return; await page.waitForTimeout(100); }

 throw new Error(`Timed out: ${label}`); };

const home=()=>page.locator('.studio-home');

// Work cards live in bookshelves; their corner buttons share the title prefix, so match the card itself.
const card=name=>home().locator('[data-work-shelf] .reference-card').filter({hasText:name});

const cards=()=>home().locator('[data-work-shelf] .reference-card');

const menu=()=>page.locator('.menu[role=menu]');

const item=name=>menu().getByRole('menuitem',{name,exact:true});

const dialog=name=>page.getByRole('dialog',{name});

const openMenu=async name=>{await card(name).click({button:'right'});await menu().waitFor();};

const pick=async(name,label)=>{await openMenu(name);await item(label).click();};

const saved=until;

try{
  await page.goto(`${base}/studio`,{waitUntil:'domcontentloaded'});await home().waitFor();
  assert.match(await card(first.title).innerText(),/게시 중/,'published work says so on its card');
  assert.doesNotMatch(await card(second.title).innerText(),/게시 중/);

  // 1. Right-click opens the work menu; Escape closes it and leaves focus on the card.
  await openMenu(first.title);
  assert.deepEqual(await menu().getByRole('menuitem').allInnerTexts(),['열기','작품 정보 편집','즐겨찾기 추가','책장 이동','게시 철회','휴지통으로 이동']);
  await page.screenshot({path:resolve(output,'menu-violet-light-1280.png')});
  await page.keyboard.press('Escape');await menu().waitFor({state:'detached'});
  await openMenu(second.title);
  assert.deepEqual(await menu().getByRole('menuitem').allInnerTexts(),['열기','작품 정보 편집','즐겨찾기 추가','책장 이동','휴지통으로 이동'],'no withdraw for an unpublished work');
  await page.keyboard.press('Escape');
  // Keyboard: Shift+F10 on a focused card opens the same menu; arrows and Enter pick an item.
  await card(second.title).focus();await page.keyboard.press('Shift+F10');await menu().waitFor();
  await page.keyboard.press('Home');assert.equal(await menu().locator('[data-highlighted]').innerText(),'열기');await page.keyboard.press('Enter');
  await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
  assert.equal(await page.locator('.work-card strong').innerText(),second.title,'열기 opens that work');
  await page.getByRole('button',{name:'뒤로'}).click();await home().waitFor();

  // 2. 작품 정보 편집 edits the clicked work, not the current one, and persists.
  await pick(second.title,'작품 정보 편집');
  const info=dialog('작품 정보');await info.waitFor();
  assert.equal(await info.getByRole('textbox',{name:'작품명'}).inputValue(),second.title);
  assert.equal(await info.locator('.work-public-state').innerText(),'공개 서재에 게시하지 않음');
  await info.getByRole('combobox',{name:'형식'}).selectOption('장편');
  await info.getByRole('textbox',{name:'부제'}).fill('합성 부제');
  await saved(()=>data.works[1].form==='장편'&&data.works[1].subtitle==='합성 부제','info saved');
  assert.equal(data.works[0].form,first.form,'other work untouched');
  await page.keyboard.press('Escape');await info.waitFor({state:'detached'});
  assert.match(await card(second.title).innerText(),/^.*\n?장편/m);

  // 3. 게시 철회 asks first, then turns off the edition on the server and in the workspace.
  await pick(first.title,'게시 철회');
  const confirm=dialog('게시 철회');await confirm.waitFor();
  await page.screenshot({path:resolve(output,'unpublish-violet-light-1280.png')});
  await confirm.getByRole('button',{name:'취소'}).click();await confirm.waitFor({state:'detached'});
  assert.deepEqual(unpublished,[],'cancel sends nothing');
  // The same step from 작품 정보: the dialog stays open and reports the result.
  await pick(first.title,'작품 정보 편집');await info.waitFor();
  assert.match(await info.locator('.work-public-state').innerText(),/^공개 서재에 게시 중 · .+ 판본$/);
  await page.screenshot({path:resolve(output,'info-published-violet-light-1280.png')});
  await info.getByRole('button',{name:'게시 철회'}).click();await confirm.waitFor();await confirm.getByRole('button',{name:'게시 철회'}).click();await confirm.waitFor({state:'detached'});
  await saved(()=>data.works[0].activePublicationId===null,'withdrawn saved');
  assert.equal(await info.getByRole('status').innerText(),'게시를 철회했습니다. 다시 게시하면 새 판본을 만듭니다.');
  assert.equal(await info.locator('.work-public-state').innerText(),'공개 서재에 게시하지 않음');assert.equal(await info.getByRole('button',{name:'게시 철회'}).count(),0);
  await page.keyboard.press('Escape');await info.waitFor({state:'detached'});
  assert.deepEqual(unpublished,[first.id]);assert.equal(data.works[0].publications.length,first.publications.length,'edition history kept');
  assert.doesNotMatch(await card(first.title).innerText(),/게시 중/);

  // 4. A database without the new function stops the move before anything changes.
  missingRpc=true;const before=saves;
  await pick(second.title,'휴지통으로 이동');
  const trash=dialog('작품을 휴지통으로 이동');await trash.waitFor();
  await trash.getByRole('button',{name:'휴지통으로 이동'}).click();
  await trash.getByRole('alert').waitFor();
  assert.match(await trash.getByRole('alert').innerText(),/데이터베이스 업데이트/);
  await page.waitForTimeout(500);assert.equal(saves,before);assert.equal(data.works.length,2);
  await trash.getByRole('button',{name:'취소'}).click();missingRpc=false;

  // 5. Trash the current work from the home: one card left, the other work becomes current, the last work stays.
  await pick(first.title,'휴지통으로 이동');await trash.waitFor();
  assert.match(await trash.innerText(),new RegExp(`${first.title}.*문서 ${first.documents.length}개`));
  await page.screenshot({path:resolve(output,'trash-violet-light-1280.png')});
  await trash.getByRole('button',{name:'휴지통으로 이동'}).click();await trash.waitFor({state:'detached'});
  await saved(()=>data.works.length===1&&data.trash?.[0]?.type==='work','trash saved');
  assert.deepEqual(unpublished,[first.id,first.id],'trash always withdraws first');
  assert.equal(await cards().count(),1);assert.equal(await card(second.title).getAttribute('aria-current'),'true');
  await openMenu(second.title);assert.equal(await item('휴지통으로 이동').getAttribute('aria-disabled'),'true','last work stays');
  assert.equal(await item('휴지통으로 이동').getAttribute('title'),'마지막 작품은 유지해야 합니다');await page.keyboard.press('Escape');
  await page.reload({waitUntil:'domcontentloaded'});await home().waitFor();assert.equal(await cards().count(),1,'persists after reload');

  // 6. The shared trash lists the work and restores it to its place.
  await page.locator('.studio-sidebar').getByRole('button',{name:/^휴지통/}).click();
  const bin=dialog('휴지통');await bin.waitFor();
  const row=bin.locator(`[data-trash-id="${first.id}"]`);assert.match(await row.innerText(),new RegExp(`${first.title}[\\s\\S]*작품 · 문서 ${first.documents.length}개`));
  await row.getByRole('button',{name:'복원'}).click();await saved(()=>data.works.length===2&&!data.trash.length,'restore saved');
  assert.deepEqual(data.works.map(w=>w.id),[first.id,second.id]);await page.keyboard.press('Escape');
  assert.equal(await cards().count(),2);assert.doesNotMatch(await card(first.title).innerText(),/게시 중/,'restored work is not republished');

  // 7. From the editor: sidebar 작품 정보 -> 휴지통으로 이동 leaves the editor on the remaining work.
  await card(second.title).click();await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
  await page.locator('.sidebar-footer').getByRole('button',{name:'작품 정보'}).click();await info.waitFor();
  await info.getByRole('button',{name:'휴지통으로 이동'}).click();await trash.waitFor();await trash.getByRole('button',{name:'휴지통으로 이동'}).click();
  await trash.waitFor({state:'detached'});await info.waitFor({state:'detached'});
  await saved(()=>data.works.length===1,'editor trash saved');
  assert.equal(await page.locator('.work-card strong').innerText(),first.title);
  assert(await page.locator('.editor-panes > .editor-shell .manuscript').isVisible(),'editor stays open on the other work');
  await page.locator('.studio-sidebar').getByRole('button',{name:/^휴지통/}).click();await bin.waitFor();
  await bin.locator(`[data-trash-id="${second.id}"]`).getByRole('button',{name:'복원'}).click();await saved(()=>data.works.length===2,'second restore');await page.keyboard.press('Escape');
  await page.locator('.studio-tools').getByRole('button',{name:'집필실 홈'}).click();await home().waitFor();

  // 8. Six palettes x two widths: the menu and both dialogs stay inside the viewport.
  const inside=async label=>{const boxes=await page.evaluate(()=>[...document.querySelectorAll('.menu,.modal')].map(n=>{const r=n.getBoundingClientRect();

return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:innerWidth,h:innerHeight,over:n.scrollWidth>n.clientWidth+1};}));

assert(boxes.length,label);

for(const b of boxes)assert(b.l>=0&&b.r<=b.w&&b.t>=0&&b.b<=b.h&&!b.over,`${label} ${JSON.stringify(b)}`);};

  for(const width of [1280,360])for(const palette of ['violet','cassette','cyber'])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===360?740:900});
    await page.evaluate(({palette,theme})=>{localStorage.setItem('orbis-palette',palette);localStorage.setItem('orbis-theme',theme);},{palette,theme});
    await page.reload({waitUntil:'domcontentloaded'});await home().waitFor();await page.waitForTimeout(150);
    const name=`${palette}-${theme}-${width}`;
    await openMenu(first.title);await inside(`${name} menu`);await page.screenshot({path:resolve(output,`menu-${name}.png`)});
    await item('작품 정보 편집').click();await info.waitFor();await inside(`${name} info`);await page.screenshot({path:resolve(output,`info-${name}.png`)});
    await info.getByRole('button',{name:'휴지통으로 이동'}).click();await trash.waitFor();await inside(`${name} trash`);await page.screenshot({path:resolve(output,`trash-${name}.png`)});
    await trash.getByRole('button',{name:'취소'}).click();await trash.waitFor({state:'detached'});await page.keyboard.press('Escape');await info.waitFor({state:'detached'});
    layouts.push(name);
  }

  assert.equal(data.works.length,2,'layout pass changed nothing');assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'summary.json'),JSON.stringify({layouts,saves,unpublished},null,2));
  console.log(`work actions: ${layouts.length} layouts, ${saves} saves, ${unpublished.length} withdrawals`);
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error(errors);throw error;}
finally{await browser.close();}
