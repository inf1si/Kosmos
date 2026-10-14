// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// A long manuscript times 50 recovery points used to exceed the 100MB backup cap and
// "백업 내려받기" failed. The ZIP must still be made, keeping the newest history that fits.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, workspaceSchema } from '../../src/lib/model.ts';
import { readBackup } from '../../src/lib/backup.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/backup-size');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// About 3MB of manuscript text: 50 full copies cannot fit in 100MB.
const current = seedWorkspace();

current.works[0].documents[0].content = fromText(Array(16).fill('별빛 아래 항구는 조용했다. '.repeat(5000)).join('\n\n'));

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-14T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

const errors = [], results = [];

let data = structuredClone(current), version = 1;

try {
    for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });

        await context.addInitScript(() => { try { localStorage.setItem('kosmos-app-preferences', JSON.stringify({ studioStart: 'last' })); } catch { /* The test fails loudly on the home screen. */ } });
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
            else if (path.endsWith('/workspace_revisions'))
                value = [];
            else if (path.endsWith('/save_workspace')) {
                data = workspaceSchema.parse(request.postDataJSON().p_payload);
                version++;
                value = { status: 'saved', version };
            }

            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
        });
        await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));

        if (context.routeWebSocket)
            await context.routeWebSocket('**/realtime/**', ws => ws.close());

        const page = await context.newPage();

        page.setDefaultTimeout(60000);
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.ProseMirror').first().waitFor({ timeout: 180000 });
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('studio-modal', { detail: 'backup' })));

        const dialog = page.getByRole('dialog', { name: '백업과 복구' });

        await dialog.waitFor();
        await dialog.getByRole('button', { name: '지금 복구 지점 만들기' }).click();
        await dialog.getByRole('status').filter({ hasText: '현재 원고를 보관했습니다.' }).waitFor();

        // Fill the browser history to its 50-entry limit with full copies of the long manuscript.
        const stored = await page.evaluate(() => new Promise((done, fail) => {
            const open = indexedDB.open('orbit-novel-studio-v1');

            open.onerror = () => fail(open.error);
            open.onsuccess = () => {
                const db = open.result, tx = db.transaction('revisions', 'readwrite'), store = tx.objectStore('revisions'), all = store.getAll();

                all.onsuccess = () => {
                    const sample = all.result.find(r => r.label === '수동 복구 지점');

                    for (let i = all.result.length; i < 50; i++)
                        store.add({ ...sample, id: crypto.randomUUID(), label: `채운 이력 ${i}`, createdAt: new Date(Date.parse(sample.createdAt) - i * 60000).toISOString() });
                };

                tx.oncomplete = () => done(50);
                tx.onerror = () => fail(tx.error);
            };
        }));

        assert.equal(stored, 50);
        await dialog.getByRole('button', { name: '백업 내려받기' }).click();

        const message = dialog.locator('.success-message').filter({ hasText: '백업 파일을 만들었습니다.' });

        await message.waitFor({ timeout: 120000 });
        assert.equal(await dialog.locator('.error-message').count(), 0, `${width}px: no error`);
        const text = await message.innerText();
        const kept = Number(/최근 (\d+)개만 담았습니다/.exec(text)?.[1]);

        assert(kept > 0 && kept < 50, `${width}px: message names the kept history count (${text})`);

        const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: /파일 저장/ }).click()]);
        const path = resolve(output, `backup-${width}.zip`);

        await download.saveAs(path);
        const { readFile } = await import('node:fs/promises');
        const bytes = await readFile(path);
        const restored = await readBackup(new Blob([bytes]));

        assert.equal(restored.revisions.length, kept, `${width}px: ZIP holds the stated history count`);
        assert.equal(restored.revisions[0].label, '수동 복구 지점', `${width}px: newest history kept first`);
        await message.scrollIntoViewIfNeeded();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

        assert(!overflow, `${width}px: no horizontal overflow`);
        await page.screenshot({ path: resolve(output, `backup-message-${width}.png`) });
        results.push({ width, kept, zipBytes: bytes.length, message: text });
        await context.close();
    }

    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(`backup size: ${results.map(r => `${r.width}px kept ${r.kept}`).join(', ')}`);
} finally {
    await browser.close();
}
