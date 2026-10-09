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

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/work-favorites');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: false });

let data = seedWorkspace(), version = 1, failSave = false;

data.works[0].title = '작업 중인 작품';

data.works[1].title = '보관할 작품';

const document = newDocument('scene', '합성 문서');

document.content = fromText('다른 책장으로 옮겨도 보존할 합성 원고.');

data.works.push({ id: uid(), title: '긴 제목의 작품 '.repeat(10), subtitle: '', description: '', form: '단편', documents: [document], publications: [], activePublicationId: null });

data.works = data.works.map(work => applyNavigation(work, resolveNavigation(work)));

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


const home = () => page.locator('.studio-home');

const card = id => home().locator(`[data-work-id="${id}"]`);

const favorites = () => home().getByRole('region', { name: '즐겨찾기', exact: true });

const star = id => card(id).locator('.work-favorite');

const opacity = locator => locator.evaluate(node => Number(getComputedStyle(node).opacity));

async function tap(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const until = async (check, label) => {
    for (let i = 0; i < 120; i++) {
        if (await check()) return;
        await page.waitForTimeout(100);
    }

    throw new Error(`Timed out: ${label}`);
};

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

async function cleanSave() {
    await until(async () => {
        const record = await stored();

        return record && !record.dirty && !record.pendingRequest;
    }, 'clean persisted favorite');
}

async function contextAction(id, action) {
    await card(id).locator('.reference-card').click({ button: 'right' });
    await page.getByRole('menuitem', { name: action, exact: true }).click();
}

const [first, second, third] = data.works;

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await home().waitFor();
    assert.equal(await favorites().count(), 0);
    await page.getByRole('button', { name: '새 책장', exact: true }).focus();
    await page.mouse.move(2, 2);
    assert.equal(await opacity(star(first.id)), 0);
    await card(first.id).hover();
    assert.equal(await opacity(star(first.id)), 1);
    assert.equal(await opacity(star(second.id)), 0);
    await star(first.id).click();
    await favorites().waitFor();
    assert.equal(await star(first.id).getAttribute('aria-pressed'), 'true');
    assert.equal(await favorites().locator('.reference-card').count(), 1);
    await cleanSave();
    assert.equal(data.works[0].favorite, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await favorites().waitFor();
    assert.equal(await star(first.id).getAttribute('aria-pressed'), 'true');
    await favorites().locator('.reference-card').click();
    await page.locator('.editor-panes .manuscript').first().waitFor();
    assert.equal(await page.locator('.work-card strong').innerText(), first.title);
    await page.getByRole('button', { name: '집필실 홈', exact: true }).click();
    await favorites().waitFor();
    await favorites().locator('.work-favorite').click();
    await favorites().waitFor({ state: 'detached' });
    await until(() => star(first.id).evaluate(node => node === document.activeElement), 'focus returns to source card');
    await contextAction(first.id, '즐겨찾기 추가');
    await favorites().waitFor();
    await favorites().locator('.reference-card').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '즐겨찾기 해제', exact: true }).click();
    await favorites().waitFor({ state: 'detached' });
    await until(() => card(first.id).locator('.reference-card').evaluate(node => node === document.activeElement), 'context removal returns focus');
    await contextAction(first.id, '즐겨찾기 추가');
    await contextAction(first.id, '책장 이동');
    await page.getByLabel('옮길 책장', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('옮길 책장', { exact: true }).waitFor({ state: 'detached' });
    await until(() => card(first.id).locator('.reference-card').evaluate(node => node === document.activeElement), 'move popover keeps its card anchor');
    await contextAction(first.id, '작품 정보 편집');
    const dialog = page.getByRole('dialog', { name: '작품 정보', exact: true });
    await dialog.getByRole('button', { name: '즐겨찾기 해제', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: '즐겨찾기 추가', exact: true }).getAttribute('aria-pressed'), 'false');
    await dialog.getByRole('button', { name: '즐겨찾기 추가', exact: true }).click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await contextAction(third.id, '즐겨찾기 추가');
    await cleanSave();
    assert.equal(await favorites().locator('.reference-card').count(), 2);

    for (const work of data.works) {
        const old = original.works.find(w => w.id === work.id);
        assert.deepEqual(work.documents, old.documents);
        assert.deepEqual(work.publications, old.publications);
        assert.equal(work.activePublicationId, old.activePublicationId);
    }

    assert.deepEqual(data.works.map(w => w.id), original.works.map(w => w.id));

    for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(({ palette, mode }) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = mode; }, { palette, mode });
        await page.evaluate(() => document.fonts.ready);
        await page.getByRole('button', { name: '새 책장', exact: true }).focus();
        await page.mouse.move(2, 2);
        assert.equal(await opacity(star(first.id)), 1, 'selected favorite remains visible');
        assert.equal(await opacity(star(second.id)), 0, 'unselected favorite stays hidden');
        assert.equal(await card(second.id).locator('.work-drag-grip').evaluate(n => Number(getComputedStyle(n).opacity)), 0);
        await card(second.id).scrollIntoViewIfNeeded();
        const before = await star(second.id).boundingBox();
        await page.screenshot({ path: `${output}/${palette}-${mode}-${width}-idle.png`, fullPage: false });
        await card(second.id).hover();
        assert.equal(await opacity(star(second.id)), 1);
        assert.deepEqual(await star(second.id).boundingBox(), before, 'hover never shifts the card');
        // The star sits after the move button in the card's corner group.
        await card(second.id).getByRole('button', { name: `${second.title} 책장 이동`, exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal(await star(second.id).evaluate(n => n === document.activeElement), true);
        await page.keyboard.press('Space');
        assert.equal(await star(second.id).getAttribute('aria-pressed'), 'true');
        await page.keyboard.press('Space');
        assert.equal(await star(second.id).getAttribute('aria-pressed'), 'false');
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert(geometry.scroll <= geometry.viewport && geometry.body <= geometry.viewport, `${palette} ${mode} ${width} overflow`);
        await page.screenshot({ path: `${output}/${palette}-${mode}-${width}-hover.png`, fullPage: false });
        layouts.push({ palette, mode, width });
    }

    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await page.setViewportSize({ width: 360, height: 900 });
    assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);

    for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) {
        await page.evaluate(({ palette, mode }) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = mode; }, { palette, mode });
        await page.getByRole('button', { name: '새 책장', exact: true }).focus();
        await page.mouse.move(2, 2);
        assert(await opacity(star(second.id)) > 0, 'touch can discover the favorite control');
        await tap(star(second.id));
        assert.equal(await star(second.id).getAttribute('aria-pressed'), 'true');
        await tap(star(second.id));
        assert.equal(await star(second.id).getAttribute('aria-pressed'), 'false');
        await page.screenshot({ path: `${output}/${palette}-${mode}-360-touch.png`, fullPage: false });
    }

    await cleanSave();
    failSave = true;
    await tap(star(first.id));
    await until(async () => (await stored())?.dirty, 'offline local favorite');
    await until(async () => !!(await stored())?.pendingRequest, 'failed request retained');
    assert.equal((await stored()).data.works[0].favorite, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await home().waitFor();
    assert.equal(await star(first.id).getAttribute('aria-pressed'), 'false');
    failSave = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await cleanSave();
    assert.equal(data.works[0].favorite, false);
    assert.equal(data.works[2].favorite, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedWrites, []);
    await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, layouts, touchThemes: 6, saveRequests: saveRequests.length, pageErrors: errors, unexpectedWrites }, null, 2));
    console.log(`PASS favorites: button/menu/settings/open/remove/focus, persisted reload and failed-save retry; ${layouts.length} theme/width layouts, touch, no publication changes`);
} finally {
    await browser.close();
}
