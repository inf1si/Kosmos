// Run through tsx with the browser/module configuration in docs/personal-notes.md.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applyNavigation, resolveNavigation } from '../../src/lib/document-navigation.ts';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, newDocument, uid, workspaceSchema } from '../../src/lib/model.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/work-shelves');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const visibilityOnly = process.env.KOSMOS_SHELF_VISIBILITY_ONLY === '1';

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: !visibilityOnly });

let data = seedWorkspace(), version = 1, failSave = false;

data.works[0].title = '작업 중인 작품';

data.works[1].title = '보관할 작품';

const document = newDocument('scene', '합성 문서');

document.content = fromText('다른 책장으로 옮겨도 보존할 합성 원고.');

data.works.push({ id: uid(), title: '긴 제목의 작품 '.repeat(10), subtitle: '', description: '', form: '단편', documents: [document], publications: [], activePublicationId: null });

data.works = data.works.map(work => applyNavigation(work, resolveNavigation(work)));

if (visibilityOnly) data.workShelves = [{ id: 'default', title: '기본 책장', workIds: data.works.map(w => w.id) }, { id: uid(), title: '다른 책장', workIds: [] }];

const original = structuredClone(data), errors = [], layouts = [], saveRequests = [], unexpectedWrites = [];

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-08T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

await context.addInitScript(({ profile, token, key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile }));
    localStorage.setItem('kosmos-app-preferences', JSON.stringify({ studioStart: 'home' }));
}, { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });

await context.route('**/*.supabase.co/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value = {};

    if (path.includes('/auth/v1/user')) value = profile;
    else if (path.endsWith('/authors')) value = { user_id: profile.id };
    else if (path.endsWith('/workspaces')) value = { id: data.id, payload: data, version };
    else if (path.endsWith('/save_workspace')) {
        const input = request.postDataJSON();
        saveRequests.push(input);

        if (failSave) {
            await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic save unavailable"}' });

            return;
        }

        assert.equal(input.p_base_version, version);
        data = workspaceSchema.parse(input.p_payload);
        value = { status: 'saved', version: ++version };
    } else if (request.method() !== 'GET') unexpectedWrites.push(path);

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});

await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));

await context.route('**/api/ai/**', route => route.abort());

if (context.routeWebSocket) await context.routeWebSocket('**/realtime/**', ws => ws.close());

const page = await context.newPage();

const cdp = await context.newCDPSession(page);

page.setDefaultTimeout(15000);

page.on('pageerror', error => errors.push(error.message));

const button = name => page.getByRole('button', { name, exact: true });

const home = () => page.locator('.studio-home');

const shelf = title => page.getByRole('region', { name: `${title} 책장`, exact: true });

const card = id => home().locator(`[data-work-id="${id}"]`);

async function createShelf(name) {
    await button('새 책장').click();
    await page.getByLabel('책장 이름', { exact: true }).fill(name);
    await button('책장 만들기').click();
    await shelf(name).waitFor();
}

async function moveWork(work, title) {
    await button(`${work.title} 책장 이동`).click();
    await page.getByLabel('옮길 책장', { exact: true }).selectOption({ label: title });
    await button('옮기기').click();
    await shelf(title).locator(`[data-work-id="${work.id}"]`).waitFor();
}

async function menu(title, action) {
    await button(`${title} 책장 메뉴`).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
}

const stored = () => page.evaluate(namespace => new Promise((resolve, reject) => {
    const request = indexedDB.open('orbit-novel-studio-v1');
    request.onsuccess = () => {
        const db = request.result, tx = db.transaction('workspaces', 'readonly'), get = tx.objectStore('workspaces').get(namespace);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => db.close();
    };

    request.onerror = () => reject(request.error);
}), `author:${profile.id}`);

const shelfById = id => home().locator(`[data-work-shelf="${id}"]`);

const order = () => home().locator('[data-work-shelf]').evaluateAll(nodes => nodes.map(n => n.dataset.workShelf));

const workOrder = id => shelfById(id).locator('[data-work-id]').evaluateAll(nodes => nodes.map(n => n.dataset.workId));

async function cleanSave() {
    const expected = await home().locator('[data-work-shelf]').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.workShelf, workIds: n.querySelector('[aria-expanded="false"]') ? null : [...n.querySelectorAll('[data-work-id]')].map(w => w.dataset.workId) })));
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
        const row = await stored(), shelves = row?.data.workShelves;

        if (row?.dirty === false && shelves?.length === expected.length && shelves.every((s, i) => s.id === expected[i].id && (!expected[i].workIds || JSON.stringify(s.workIds) === JSON.stringify(expected[i].workIds))) && JSON.stringify(shelves) === JSON.stringify(data.workShelves)) return;
        await page.waitForTimeout(50);
    }

    assert.fail('현재 화면의 배치가 IndexedDB와 합성 저장 응답에 함께 반영되어야 합니다.');
}

async function beginDrag(kind, id, target, edge, touch = false) {
    const handle = (kind === 'shelf' ? shelfById(id) : card(id)).locator(`.work-${kind}-grip`);
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox(), to = await target.boundingBox();
    const x = from.x + from.width / 2, y = from.y + from.height / 2;
    const horizontal = kind === 'work' && !await target.getAttribute('data-work-shelf') && await target.evaluate(n => [...n.parentElement.children].some(s => s !== n && Math.abs(s.getBoundingClientRect().top - n.getBoundingClientRect().top) < 4));
    const point = { x: horizontal ? edge === 'before' ? to.x + 4 : to.x + to.width - 4 : to.x + to.width / 2, y: edge === 'inside' ? to.y + Math.min(12, to.height / 2) : horizontal ? to.y + to.height / 2 : edge === 'before' ? to.y + 4 : to.y + to.height - 4 };

    if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    } else {
        await page.mouse.move(x, y);await page.mouse.down();await page.mouse.move(point.x, point.y, { steps: 8 });
    }

    await page.waitForFunction(({ selector, edge }) => document.querySelector(selector)?.dataset.dropEdge === edge, { selector: await target.evaluate(n => n.dataset.workShelf ? `[data-work-shelf="${n.dataset.workShelf}"]` : `[data-work-id="${n.dataset.workId}"]`), edge });
}

async function endDrag(touch = false) {
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await page.locator('.work-shelf-ghost').waitFor({ state: 'hidden' });
}

async function checkDrag() {
    const [a, b, c] = original.works.map(w => w.id);

    for (let i = 0; i < 2; i++) {
        await button('새 책장').click();
        assert(await button('책장 만들기').isEnabled());await button('책장 만들기').click();
        await page.waitForFunction(count => document.querySelectorAll('[data-work-shelf]').length === count, i + 2);
    }

    const [defaultId, blankA, blankB] = await order();
    assert.equal(await shelf('이름 없는 책장').count(), 2);
    await beginDrag('shelf', blankB, shelfById(defaultId), 'before');await endDrag();
    assert.deepEqual(await order(), [blankB, defaultId, blankA]);
    await shelfById(blankB).locator('.work-shelf-grip').press('ArrowDown');
    assert.deepEqual(await order(), [defaultId, blankB, blankA]);
    await beginDrag('shelf', blankB, shelfById(blankA), 'after', true);await endDrag(true);
    assert.deepEqual(await order(), [defaultId, blankA, blankB]);
    const gapFrom = await shelfById(blankB).locator('.work-shelf-grip').boundingBox(), gapTarget = await shelfById(defaultId).boundingBox();
    await page.mouse.move(gapFrom.x + gapFrom.width / 2, gapFrom.y + gapFrom.height / 2);await page.mouse.down();
    await page.mouse.move(gapTarget.x + gapTarget.width / 2, gapTarget.y + gapTarget.height + 12, { steps: 8 });
    await page.waitForFunction(id => document.querySelector(`[data-work-shelf="${id}"]`)?.dataset.dropEdge === 'before', blankA);
    await endDrag();assert.deepEqual(await order(), [defaultId, blankB, blankA]);
    await shelfById(blankB).locator('.work-shelf-grip').press('ArrowDown');
    assert.deepEqual(await order(), [defaultId, blankA, blankB]);
    await beginDrag('work', c, card(a), 'before');await endDrag();
    assert.deepEqual(await workOrder(defaultId), [c, a, b]);
    await card(c).locator('.work-work-grip').press('ArrowDown');
    assert.deepEqual(await workOrder(defaultId), [a, c, b]);
    await shelfById(blankA).getByRole('button', { name: '이름 없는 책장 접기', exact: true }).click();
    await beginDrag('work', a, shelfById(blankA), 'inside');await endDrag();
    assert.deepEqual(await workOrder(blankA), [a]);
    assert.equal(await shelfById(blankA).getByRole('button', { name: '이름 없는 책장 접기', exact: true }).getAttribute('aria-expanded'), 'true');
    await page.waitForFunction(id => document.activeElement?.closest('[data-work-id]')?.getAttribute('data-work-id') === id, a);
    await beginDrag('work', b, card(a), 'before', true);await endDrag(true);
    assert.deepEqual(await workOrder(blankA), [b, a]);
    await card(a).locator('.work-work-grip').press('Alt+ArrowDown');
    assert.deepEqual(await workOrder(blankB), [a]);
    await cleanSave();
    const saved = await stored();
    const snapshot = structuredClone(saved.data.workShelves), requests = saveRequests.length;
    await beginDrag('work', b, shelfById(defaultId), 'inside');
    await page.keyboard.press('Escape');await endDrag();
    assert.deepEqual(await workOrder(blankA), [b]);assert.equal((await stored()).dirty, false);
    await beginDrag('work', b, shelfById(defaultId), 'inside', true);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.locator('.work-shelf-ghost').waitFor({ state: 'hidden' });
    assert.deepEqual(data.workShelves, snapshot);assert.equal(saveRequests.length, requests);
    await beginDrag('work', b, shelfById(defaultId), 'inside');
    await page.mouse.move(2, 2);await endDrag();assert.deepEqual(await workOrder(blankA), [b]);
    await shelfById(blankA).locator('[data-shelf-menu]').click();
    await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
    assert.equal(await page.getByLabel('책장 이름', { exact: true }).inputValue(), '');
    await page.getByLabel('책장 이름', { exact: true }).fill('임시 이름');await button('이름 저장').click();
    await menu('임시 이름', '이름 변경');await page.getByLabel('책장 이름', { exact: true }).fill('');await button('이름 저장').click();
    await button(`${original.works[1].title} 책장 이동`).click();
    const options = await page.getByLabel('옮길 책장', { exact: true }).locator('option').allTextContents();
    assert.deepEqual(options, ['기본 책장', '이름 없는 책장', '이름 없는 책장']);
    await page.getByLabel('옮길 책장', { exact: true }).selectOption(blankB);
    await button('옮기기').click();assert.deepEqual(await workOrder(blankB), [a, b]);
    await card(b).locator('.reference-card').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '작품 정보 편집', exact: true }).click();
    const blankInfo = page.getByRole('dialog', { name: '작품 정보', exact: true });
    assert.deepEqual(await blankInfo.getByLabel('책장', { exact: true }).locator('option').allTextContents(), options);
    await blankInfo.getByLabel('책장', { exact: true }).selectOption(blankA);
    await blankInfo.getByRole('button', { name: '닫기', exact: true }).click();
    assert.deepEqual(await workOrder(blankA), [b]);
    await shelfById(blankA).getByRole('button', { name: '이름 없는 책장 새 작품', exact: true }).click();
    const blankNew = page.getByRole('dialog', { name: '새 작품', exact: true });
    assert.equal(await blankNew.getByLabel('책장', { exact: true }).inputValue(), blankA);
    assert.deepEqual(await blankNew.getByLabel('책장', { exact: true }).locator('option').allTextContents(), options);
    await page.keyboard.press('Escape');await cleanSave();
    await page.locator('.work-card').click();
    assert.deepEqual(await page.locator('.work-menu-shelf').allTextContents(), options);
    await page.locator('.work-card').click();
    await page.reload({ waitUntil: 'domcontentloaded' });await home().waitFor();
    assert.deepEqual(await workOrder(blankA), [b]);assert.deepEqual(await workOrder(blankB), [a]);
    assert.deepEqual(data.workShelves.filter(s => s.id !== defaultId).map(s => s.title), ['', '']);

    for (const id of [blankA, blankB]) {
        await shelfById(id).locator('[data-shelf-menu]').click();
        await page.getByRole('menuitem', { name: '책장 삭제', exact: true }).click();
        await page.getByRole('dialog', { name: '책장 삭제', exact: true }).getByRole('button', { name: '책장 삭제', exact: true }).click();
    }

    // Restore the original default order through the actual drag control.
    await beginDrag('work', a, card(c), 'before');await endDrag();
    await beginDrag('work', b, card(c), 'before');await endDrag();
    assert.deepEqual(await workOrder(defaultId), [a, b, c]);

    for (let i = 0; i < 10; i++) await createShelf(`스크롤 책장 ${i}`);
    await page.setViewportSize({ width: 360, height: 740 });
    await shelfById(defaultId).locator('.work-shelf-grip').scrollIntoViewIfNeeded();
    const handle = await shelfById(defaultId).locator('.work-shelf-grip').boundingBox(), bounds = await home().locator('.notes-home-body').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 8);
    const before = await home().locator('.notes-home-body').evaluate(n => n.scrollTop);
    await page.waitForFunction(before => document.querySelector('.studio-home .notes-home-body').scrollTop > before + 80, before);
    await page.keyboard.press('Escape');await endDrag();
    await page.setViewportSize({ width: 1280, height: 900 });

    for (let i = 0; i < 10; i++) {
        await menu(`스크롤 책장 ${i}`, '책장 삭제');
        await page.getByRole('dialog', { name: '책장 삭제', exact: true }).getByRole('button', { name: '책장 삭제', exact: true }).click();
    }

    await cleanSave();

    if (!await page.locator('.work-card').count()) await page.locator('#sidebar-toggle').click();
    console.log('PASS drag: mouse/touch, keyboard, empty/collapsed targets, cancellation, scrolling, duplicate blank names and reload');
}

async function checkGripVisibility() {
    await page.evaluate(async () => { await document.fonts.ready; });
    const shelfGrip = shelfById('default').locator('.work-shelf-grip'), workGrip = card(original.works[0].id).locator('.work-work-grip');
    const idle = async () => { await button('새 작품').focus();await page.mouse.move(2, 2); };

    const opacity = target => target.evaluate(n => Number(getComputedStyle(n).opacity));
    const hidden = async () => assert.deepEqual(await home().locator('.work-drag-grip').evaluateAll(nodes => nodes.map(n => Number(getComputedStyle(n).opacity))), Array(original.works.length + 2).fill(0));

    for (const width of [1280, 360]) for (const palette of ['violet', 'cassette', 'cyber']) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
        await page.evaluate(({ palette, theme }) => { document.documentElement.dataset.palette = palette;document.documentElement.dataset.theme = theme; }, { palette, theme });
        assert(await page.evaluate(() => matchMedia('(hover:hover)').matches));
        await idle();await hidden();
        const before = await workGrip.boundingBox();
        await page.screenshot({ path: resolve(output, `idle-${palette}-${theme}-${width}.png`) });
        await shelfById('default').locator('.work-shelf-heading').hover();
        assert.equal(await opacity(shelfGrip), 1);assert.equal(await opacity(workGrip), 0);
        assert.equal(await opacity(shelf('다른 책장').locator('.work-shelf-grip')), 0);
        await idle();await hidden();
        await card(original.works[0].id).hover();assert.equal(await opacity(workGrip), 1);assert.equal(await opacity(shelfGrip), 0);
        assert.equal(await opacity(card(original.works[1].id).locator('.work-work-grip')), 0);
        assert.deepEqual(await workGrip.boundingBox(), before, '손잡이 표시가 카드 배치를 바꾸면 안 됩니다.');
        await page.screenshot({ path: resolve(output, `hover-${palette}-${theme}-${width}.png`) });
        await idle();await hidden();
        await card(original.works[0].id).locator('.reference-card').focus();await page.keyboard.press('Shift+Tab');
        assert(await workGrip.evaluate(n => document.activeElement === n));assert.equal(await opacity(workGrip), 1);
        await idle();await hidden();
        await shelfById('default').getByRole('button', { name: '기본 책장 접기', exact: true }).focus();await page.keyboard.press('Shift+Tab');
        assert(await shelfGrip.evaluate(n => document.activeElement === n));assert.equal(await opacity(shelfGrip), 1);
        await idle();await hidden();
        await beginDrag('work', original.works[1].id, card(original.works[0].id), 'before');
        assert.equal(await opacity(card(original.works[1].id).locator('.work-work-grip')), 1);
        await page.keyboard.press('Escape');await endDrag();await idle();await hidden();
        layouts.push({ width, palette, theme, idle: 0, hover: 1, keyboard: 1 });
    }

    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    assert(await page.evaluate(() => matchMedia('(hover:none)').matches));

    for (const palette of ['violet', 'cassette', 'cyber']) for (const theme of ['light', 'dark']) {
        await page.evaluate(({ palette, theme }) => { document.documentElement.dataset.palette = palette;document.documentElement.dataset.theme = theme; }, { palette, theme });
        await idle();
        const opacities = await home().locator('.work-drag-grip').evaluateAll(nodes => nodes.map(n => Number(getComputedStyle(n).opacity)));
        assert(opacities.every(value => value > 0), '호버 없는 터치 기기의 손잡이는 보여야 합니다.');
        await page.screenshot({ path: resolve(output, `touch-${palette}-${theme}-360.png`) });
    }

    assert.equal(saveRequests.length, 0);assert.deepEqual(errors, []);assert.deepEqual(unexpectedWrites, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, visibility: true, layouts, touchThemes: 6, saveRequests: 0, pageErrors: errors }, null, 2));
    console.log('PASS grip visibility: hidden at rest, only hovered row, keyboard focus, active drag, no layout shift; 12 desktop layouts and 6 touch themes, no saves');
}

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await home().waitFor();
    await button('새 책장').waitFor({ timeout: 4000 });

    if (visibilityOnly) {
        await checkGripVisibility();
    } else {
    assert.equal(await shelf('기본 책장').locator('[data-work-id]').count(), 3);
    await checkDrag();
    await createShelf('보관');
    await button('새 책장').click();
    await page.getByLabel('책장 이름', { exact: true }).fill('보관');
    await button('책장 만들기').click();
    await page.locator('.popover [role="alert"]').filter({ hasText: '같은 이름' }).waitFor();
    await page.getByLabel('책장 이름', { exact: true }).fill('구상');
    await button('책장 만들기').click();
    await shelf('구상').waitFor();
    // Opening the next control with one click must keep its own focus and form.
    await button('새 책장').click();
    await button(`${original.works[1].title} 책장 이동`).click();
    await page.getByLabel('옮길 책장', { exact: true }).waitFor();
    assert.equal(await page.locator('.popover').count(), 1);
    await page.keyboard.press('Escape');
    await button('새 책장').click();
    await home().locator('.board-bar>span').click();
    await page.locator('.popover').waitFor({ state: 'hidden' });
    await moveWork(original.works[1], '보관');
    await page.waitForFunction(() => document.activeElement?.matches('[data-work-id] .reference-card'));
    await card(original.works[1].id).locator('.reference-card').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '책장 이동', exact: true }).click();
    await page.getByLabel('옮길 책장', { exact: true }).selectOption({ label: '구상' });
    await button('옮기기').click();
    await shelf('구상').locator(`[data-work-id="${original.works[1].id}"]`).waitFor();
    await moveWork(original.works[1], '보관');
    await page.locator('.work-card').click();
    // The switcher lists only shelves that hold a work; '구상' is empty after the move.
    assert.deepEqual(await page.locator('.work-menu-shelf').allTextContents(), ['기본 책장', '보관']);
    await page.locator('#work-menu').getByRole('button', { name: /^보관할 작품/ }).click();
    await page.locator('.manuscript').first().waitFor();
    await page.locator('.studio-tools').getByRole('button', { name: '집필실 홈', exact: true }).click();
    await button('보관 접기').click();
    assert.equal(await shelf('보관').locator('[data-work-id]').count(), 0);
    await cleanSave();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await button('보관 펼치기').waitFor();
    await menu('보관', '이름 변경');
    await page.getByLabel('책장 이름', { exact: true }).fill('잠시 멈춘 작품');
    await button('이름 저장').click();
    await button('잠시 멈춘 작품 펼치기').waitFor();
    await menu('잠시 멈춘 작품', '책장 위로');
    assert.equal(await home().locator('[data-work-shelf]').first().getAttribute('aria-label'), '잠시 멈춘 작품 책장');
    await button('잠시 멈춘 작품 펼치기').click();
    const pausedShelfId = await shelf('잠시 멈춘 작품').getAttribute('data-work-shelf');
    await button('잠시 멈춘 작품 새 작품').click();
    const newDialog = page.getByRole('dialog', { name: '새 작품', exact: true });
    assert.equal(await newDialog.getByLabel('책장', { exact: true }).inputValue(), pausedShelfId);
    await newDialog.getByLabel('작품명', { exact: true }).fill('책장에서 만든 작품');
    await newDialog.getByRole('button', { name: '작품 만들기', exact: true }).click();
    await shelf('잠시 멈춘 작품').getByRole('button', { name: /^책장에서 만든 작품/ }).first().waitFor();
    await card(original.works[1].id).locator('.reference-card').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '작품 정보 편집', exact: true }).click();
    const info = page.getByRole('dialog', { name: '작품 정보', exact: true });
    await info.getByLabel('책장', { exact: true }).selectOption({ label: '구상' });
    await info.getByRole('button', { name: '닫기', exact: true }).click();
    await shelf('구상').locator(`[data-work-id="${original.works[1].id}"]`).waitFor();
    await menu('잠시 멈춘 작품', '책장 삭제');
    const deletion = page.getByRole('dialog', { name: '책장 삭제', exact: true });

    // The default shelf's title already ends in 책장, so the help must not repeat the word.
    await deletion.getByText(/^작품 \d+개를 ‘기본 책장’에 옮깁니다\. 원고와 게시 상태는 그대로입니다\.$/).waitFor();
    await deletion.getByRole('button', { name: '취소', exact: true }).click();
    await shelf('잠시 멈춘 작품').waitFor();
    await menu('잠시 멈춘 작품', '책장 삭제');
    await deletion.getByRole('button', { name: '책장 삭제', exact: true }).click();
    await shelf('잠시 멈춘 작품').waitFor({ state: 'hidden' });
    await shelf('기본 책장').getByRole('button', { name: /^책장에서 만든 작품/ }).first().waitFor();
    await button('기본 책장 책장 메뉴').click();
    assert(await page.getByRole('menuitem', { name: '책장 삭제', exact: true }).isDisabled());
    await page.keyboard.press('Escape');

    failSave = true;
    await moveWork(original.works[2], '구상');
    await page.locator('.studio-error').filter({ hasText: 'synthetic save unavailable' }).waitFor();
    const pending = await stored();
    assert.equal(pending.dirty, true);
    assert(pending.data.workShelves.find(s => s.title === '구상').workIds.includes(original.works[2].id));
    failSave = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await cleanSave();
    assert.equal(saveRequests.at(-1).p_request_id, pending.pendingRequest.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await shelf('구상').locator(`[data-work-id="${original.works[2].id}"]`).waitFor();

    for (const work of original.works) assert.deepEqual(data.works.find(w => w.id === work.id), work);
    assert.deepEqual(data.works.slice(0, original.works.length).map(w => w.id), original.works.map(w => w.id));

    const ideaTitle = '긴 이름의 책장 '.repeat(8).trim();
    await menu('구상', '이름 변경');
    await page.getByLabel('책장 이름', { exact: true }).fill(ideaTitle);
    await page.getByLabel('책장 이름', { exact: true }).press('Enter');
    await shelf(ideaTitle).waitFor();

    for (const width of [1280, 768, 360]) for (const palette of ['violet', 'cassette', 'cyber']) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
        await page.evaluate(({ palette, theme }) => {
            document.documentElement.dataset.palette = palette;
            document.documentElement.dataset.theme = theme;
        }, { palette, theme });

        await home().waitFor();

        const header = await home().locator('.board-bar').evaluate(node => {
            const bottom = node.getBoundingClientRect().bottom;

            return [...node.querySelectorAll('button')].every(button => button.getBoundingClientRect().bottom <= bottom + 1);
        });

        assert(header, `home actions stay inside the header at ${width}px`);
        const overflow = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll('.studio-home,.notes-home-body,.work-shelf-heading,.work-shelf-card')].flatMap(n => n.scrollWidth > n.clientWidth + 1 ? [n.className || n.tagName] : []));
        assert.deepEqual(overflow, []);

        // Work cards fill their grid cell, so cards in the same row share one height.
        assert.deepEqual(await page.locator('.work-shelf-card').evaluateAll(cells => cells.filter(cell => Math.abs(cell.querySelector('.reference-card').getBoundingClientRect().height - cell.getBoundingClientRect().height) > 1).length), 0);

        const typography = await page.locator('.work-shelf-heading h3').first().evaluate(node => {
            const style = getComputedStyle(node);

            return { size: style.fontSize, weight: style.fontWeight, color: style.color };
        });

        assert.equal(typography.size, '12px');
        assert.equal(typography.weight, '600');
        await button(`${original.works[2].title} 책장 이동`).hover();
        await page.getByRole('tooltip', { name: '책장 이동', exact: true }).waitFor();
        const tooltip = await page.locator('.tooltip').boundingBox();
        assert(tooltip.x >= 0 && tooltip.x + tooltip.width <= width + 1);
        await beginDrag('work', original.works[2].id, card(original.works[1].id), 'after');
        const ghost = await page.locator('.work-shelf-ghost').boundingBox();
        assert(ghost.x >= 0 && ghost.y >= 0 && ghost.x + ghost.width <= width + 1 && ghost.y + ghost.height <= (width === 360 ? 740 : 900) + 1);
        assert.equal(await card(original.works[2].id).locator('.work-work-grip').evaluate(n => getComputedStyle(n).touchAction), 'none');
        const indicator = await card(original.works[1].id).evaluate(n => ({ axis: n.dataset.dropAxis, width: getComputedStyle(n, '::after').width, height: getComputedStyle(n, '::after').height, color: getComputedStyle(n, '::after').backgroundColor }));

        // Cards side by side get a vertical line in the column gap; a single column keeps the horizontal line.
        if (width === 1280) assert.equal(indicator.axis, 'x');

        if (width === 360) assert.equal(indicator.axis, 'y');

        assert.equal(indicator.axis === 'x' ? indicator.width : indicator.height, '2px');assert.notEqual(indicator.color, 'rgba(0, 0, 0, 0)');
        await page.screenshot({ path: resolve(output, `drag-${palette}-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');await endDrag();
        await page.screenshot({ path: resolve(output, `home-${palette}-${theme}-${width}.png`) });
        await button('새 책장').click();
        await page.getByLabel('책장 이름', { exact: true }).waitFor();
        await page.screenshot({ path: resolve(output, `create-${palette}-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        await button(`${original.works[2].title} 책장 이동`).click();
        await page.getByLabel('옮길 책장', { exact: true }).waitFor();
        const bounds = await page.locator('.popover').boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        await page.screenshot({ path: resolve(output, `move-${palette}-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        const ideaShelfId = await shelf(ideaTitle).getAttribute('data-work-shelf');
        await button(`${ideaTitle} 새 작품`).click();
        await newDialog.waitFor();
        assert.equal(await newDialog.getByLabel('책장', { exact: true }).inputValue(), ideaShelfId);
        await page.screenshot({ path: resolve(output, `new-work-${palette}-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');

        await card(original.works[1].id).locator('.reference-card').click({ button: 'right' });
        await page.getByRole('menuitem', { name: '작품 정보 편집', exact: true }).click();
        await info.waitFor();
        assert.equal(await info.getByLabel('책장', { exact: true }).inputValue(), ideaShelfId);
        await page.screenshot({ path: resolve(output, `work-info-${palette}-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        await button(`${ideaTitle} 책장 메뉴`).click();
        await page.getByRole('menuitem', { name: '책장 삭제', exact: true }).waitFor();
        await page.screenshot({ path: resolve(output, `shelf-menu-${palette}-${theme}-${width}.png`) });
        await page.getByRole('menuitem', { name: '책장 삭제', exact: true }).click();
        await deletion.waitFor();
        await page.screenshot({ path: resolve(output, `delete-${palette}-${theme}-${width}.png`) });
        await deletion.getByRole('button', { name: '취소', exact: true }).click();

        // Sidebar is a drawer on mobile; open it before checking the grouped switcher.
        if (width <= 900 && !await page.locator('.work-card').count()) await page.locator('#sidebar-toggle').click();
        await page.locator('.work-card').click();
        assert.deepEqual(await page.locator('.work-menu-shelf').allTextContents(), ['기본 책장', ideaTitle]);
        await page.screenshot({ path: resolve(output, `switcher-${palette}-${theme}-${width}.png`) });
        await page.locator('.work-card').click();

        if (width <= 900) await button('작품 탐색 닫기').click();
        layouts.push({ width, palette, theme, screens: 9, typography });
    }

    assert.deepEqual(unexpectedWrites, []);
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, dragAndUnnamed: true, layouts, saveRequests: saveRequests.length, sourceWorksPreserved: true, originalWorkOrderPreserved: true, pageErrors: errors, unexpectedWrites }, null, 2));
    console.log(`PASS work shelves: create/rename/reorder/collapse/move/new work/delete, save retry/reload, ${layouts.length * 9} layouts, originals preserved`);
    }
} catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    console.error(JSON.stringify({ errors, layouts: layouts.length, saves: saveRequests.length }));
    throw error;
} finally {
    await browser.close();
}
