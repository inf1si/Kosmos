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

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

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

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await home().waitFor();
    await button('새 책장').waitFor({ timeout: 4000 });
    assert.equal(await shelf('기본 책장').locator('[data-work-id]').count(), 3);
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
    assert.deepEqual(await page.locator('.work-menu-shelf').allTextContents(), ['기본 책장', '보관', '구상']);
    await page.locator('#work-menu').getByRole('button', { name: /^보관할 작품/ }).click();
    await page.locator('.manuscript').first().waitFor();
    await page.locator('.studio-tools').getByRole('button', { name: '집필실 홈', exact: true }).click();
    await button('보관 접기').click();
    assert.equal(await shelf('보관').locator('[data-work-id]').count(), 0);
    await page.waitForFunction(namespace => new Promise(resolve => {
        const request = indexedDB.open('orbit-novel-studio-v1');
        request.onsuccess = () => {
            const db = request.result, tx = db.transaction('workspaces', 'readonly'), get = tx.objectStore('workspaces').get(namespace);
            get.onsuccess = () => resolve(get.result?.dirty === false && document.body.textContent.includes('클라우드 동기화됨'));
            tx.oncomplete = () => db.close();
        };
    }), `author:${profile.id}`);
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
    await page.waitForFunction(() => document.body.textContent.includes('클라우드 동기화됨'));
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

        const typography = await page.locator('.work-shelf-heading h3').first().evaluate(node => {
            const style = getComputedStyle(node);

            return { size: style.fontSize, weight: style.fontWeight, color: style.color };
        });

        assert.equal(typography.size, '12px');
        assert.equal(typography.weight, '600');
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
        layouts.push({ width, palette, theme, screens: 8, typography });
    }

    assert.deepEqual(unexpectedWrites, []);
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, layouts, saveRequests: saveRequests.length, sourceWorksPreserved: true, originalWorkOrderPreserved: true, pageErrors: errors, unexpectedWrites }, null, 2));
    console.log(`PASS work shelves: create/rename/reorder/collapse/move/new work/delete, save retry/reload, ${layouts.length * 8} layouts, originals preserved`);
} catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    console.error(JSON.stringify({ errors, layouts: layouts.length, saves: saveRequests.length }));
    throw error;
} finally {
    await browser.close();
}
