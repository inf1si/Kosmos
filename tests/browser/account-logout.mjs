// Run through tsx with the browser/module configuration in docs/personal-notes.md.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/account-logout');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const page = await context.newPage();

page.setDefaultTimeout(15000);

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-08T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

const session = { access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile };

const authKey = process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token';

const note = newNote();

note.content = fromText('보존할 합성 노트.');

let remote = addNote(seedWorkspace(), note), version = 1, saveFailure = false, logoutFailure = false, releaseLogout;

remote.works[0].documents[0].content = fromText('\n\n보존할 합성 원고.');

const errors = [], scopes = [], layouts = [], saves = [];

page.on('pageerror', error => errors.push(error.message));

await context.route('**/*.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let value = {};

    if (path.endsWith('/auth/v1/logout')) {
        scopes.push(url.searchParams.get('scope'));

        if (logoutFailure) {
            await new Promise(resolve => { releaseLogout = resolve; });
            await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"synthetic logout failure"}' });

            return;
        }

        await route.fulfill({ status: 204 });

        return;
    }

    if (path.includes('/auth/v1/user')) value = profile;
    else if (path.endsWith('/auth/v1/token')) value = session;
    else if (path.endsWith('/authors')) value = { user_id: profile.id };
    else if (path.endsWith('/workspaces')) value = { id: remote.id, payload: remote, version };
    else if (path.endsWith('/save_workspace')) {
        const input = request.postDataJSON();
        saves.push(input);

        if (saveFailure) {
            await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic save unavailable"}' });

            return;
        }

        assert.equal(input.p_base_version, version);
        remote = workspaceSchema.parse(input.p_payload);
        value = { status: 'saved', version: ++version };
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});

await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));

await context.route('**/api/ai/**', route => route.abort());

if (context.routeWebSocket) await context.routeWebSocket('**/realtime/**', ws => ws.close());

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

const account = () => page.getByRole('button', { name: '로그인 계정', exact: true });

const logout = () => page.getByRole('button', { name: '로그아웃', exact: true });

async function login() {
    await page.getByLabel('이메일', { exact: true }).fill(profile.email);
    await page.getByLabel('비밀번호', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: '집필실 열기', exact: true }).click();
    await account().waitFor();
}

try {
    // Seed once. Reloading after logout must never silently reinsert authentication.
    await page.goto(`${base}/privacy`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ key, session }) => {
        localStorage.setItem(key, JSON.stringify(session));
        localStorage.setItem('kosmos-app-preferences', JSON.stringify({ studioStart: 'last' }));
    }, { key: authKey, session });
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await account().click();
    await logout().waitFor({ timeout: 4000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '로그인 계정');

    for (const consumer of ['studio', 'notes']) {
        await page.goto(`${base}/studio${consumer === 'notes' ? '#notes' : ''}`, { waitUntil: 'domcontentloaded' });

        for (const width of [1280, 360]) for (const palette of ['violet', 'cassette', 'cyber']) for (const theme of ['light', 'dark']) {
            await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
            await page.evaluate(({ palette, theme }) => {
                document.documentElement.dataset.palette = palette;
                document.documentElement.dataset.theme = theme;
            }, { palette, theme });

            await account().click();
            await logout().waitFor();

            const style = await logout().evaluate(button => {
                const rect = button.getBoundingClientRect(), menu = button.closest('.account-login');

                return { fontSize: getComputedStyle(button).fontSize, referenceFontSize: getComputedStyle(menu.querySelector('button')).fontSize, inside: rect.left >= 0 && rect.right <= innerWidth, overflow: menu.scrollWidth > menu.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
            });

            assert.equal(style.fontSize, style.referenceFontSize);
            assert.equal(style.inside, true);
            assert.equal(style.overflow, false);
            assert.equal(style.pageOverflow, false);
            layouts.push({ consumer, width, palette, theme, ...style });
            await page.screenshot({ path: resolve(output, `${consumer}-${palette}-${theme}-${width}.png`) });
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '로그인 계정');
        }
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    const paragraph = page.locator('.editor-panes > .editor-shell .manuscript p').nth(1);
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' 로그아웃 직전 입력.');
    logoutFailure = true;
    await account().click();
    await logout().click();
    await page.waitForFunction(() => document.body.textContent.includes('로그아웃 중…'));
    assert.equal(await page.getByRole('button', { name: '로그아웃 중…', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Google 계정 연결', exact: true }).isDisabled(), true);

    for (let attempt = 0; !releaseLogout && attempt < 100; attempt++) await page.waitForTimeout(20);
    assert(releaseLogout);
    releaseLogout();
    // This SDK removes the current session even when server revocation fails.
    await page.getByRole('button', { name: '집필실 열기', exact: true }).waitFor();
    await page.getByRole('alert').filter({ hasText: '서버 로그아웃을 확인하지 못했습니다.' }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), authKey), null);
    assert(JSON.stringify(remote).includes('로그아웃 직전 입력.'));
    logoutFailure = false;
    await login();
    await account().click();
    await logout().click();
    await page.getByRole('button', { name: '집필실 열기', exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), authKey), null);
    assert.equal(await page.locator('.manuscript').count(), 0);
    const saved = await stored();
    assert.equal(saved.dirty, false);
    assert(JSON.stringify(saved.data).includes('로그아웃 직전 입력.'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '집필실 열기', exact: true }).waitFor();
    assert.deepEqual((await stored()).data, saved.data);

    profile.identities = [{ id: profile.id, user_id: profile.id, provider: 'google', identity_data: { sub: 'synthetic-google' }, created_at: profile.created_at }];
    await login();
    await page.goto(`${base}/studio#notes/${note.id}`, { waitUntil: 'domcontentloaded' });
    const noteParagraph = page.locator('.studio-panel .manuscript p').first();
    await noteParagraph.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' 서버 장애 중 입력.');
    saveFailure = true;
    await account().click();
    await page.getByText('Google 계정이 연결되어 있습니다.', { exact: true }).waitFor();
    await logout().click();
    await page.getByRole('button', { name: '집필실 열기', exact: true }).waitFor();
    const pending = await stored();
    assert.equal(pending.dirty, true);
    assert(pending.pendingRequest);
    assert(JSON.stringify(pending.data).includes('서버 장애 중 입력.'));
    assert.equal(await page.locator('.login-screen [role="alert"]').count(), 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '집필실 열기', exact: true }).waitFor();
    assert.deepEqual((await stored()).pendingRequest, pending.pendingRequest);
    saveFailure = false;
    await login();
    await page.waitForFunction(() => document.body.textContent.includes('클라우드 동기화됨'));
    assert.equal((await stored()).dirty, false);
    assert.equal((await stored()).pendingRequest, undefined);
    assert.equal(saves.at(-1).p_request_id, pending.pendingRequest.id);
    assert(JSON.stringify(remote).includes('서버 장애 중 입력.'));
    assert.deepEqual(scopes, ['local', 'local', 'local']);

    // A local save failure must keep the editor and login available, rather than hiding unsaved text.
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;

        IDBObjectStore.prototype.put = function(value, key) {
            if (this.name === 'workspaces') throw new DOMException('Synthetic local save failure', 'QuotaExceededError');

            return put.call(this, value, key);
        };
    });
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' 기기 저장 실패 중 입력.');
    await account().click();
    await logout().click();
    await page.locator('.account-login [role="alert"]').filter({ hasText: '기기 저장이 끝나지 않았습니다.' }).waitFor();
    assert(await page.evaluate(key => !!localStorage.getItem(key), authKey));
    assert.equal(scopes.length, 3);
    assert(await logout().isEnabled());
    await page.keyboard.press('Escape');
    assert(await page.locator('.manuscript').filter({ hasText: '기기 저장 실패 중 입력.' }).count());
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, layouts, logoutScopes: scopes, preservedSavedData: true, preservedPendingData: true, serverFailureReported: true, localSaveFailureBlocksLogout: true, linkedGoogleLogout: true, pageErrors: errors }, null, 2));
    console.log(`PASS logout: ${layouts.length} layouts, saved/pending manuscripts preserved, server failure reported, local save failure blocks logout, reload and same-account login, local scope`);
} catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    console.error(JSON.stringify({ errors, scopes, layouts: layouts.length }));
    throw error;
} finally {
    await browser.close();
}
