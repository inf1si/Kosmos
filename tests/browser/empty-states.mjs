// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// Regression: the notes sidebar list view printed "노트가 없습니다." twice, and the public
// library showed "0편" and an empty-shelf heading even when loading the library failed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/empty-states');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const data = { ...seedWorkspace(), notes: [], noteNavigation: undefined };

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-10T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

const errors = [], layouts = [];

try {
    for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });

        await context.addInitScript(({ profile, token, key }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile })), { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });

        await context.route('**/*.supabase.co/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            const value = path.includes('/auth/v1/user') ? profile : path.endsWith('/authors') ? { user_id: profile.id } : path.endsWith('/workspaces') ? { id: data.id, payload: data, version: 1 } : {};

            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
        });

        const page = await context.newPage();

        page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`${base}/studio#notes`, { waitUntil: 'domcontentloaded' });

        if (width < 700)
            await page.getByRole('button', { name: '사이드바 열기', exact: true }).first().click();

        const sidebar = page.locator('.notes-empty');

        await sidebar.first().waitFor();

        for (const view of ['폴더', '최근 수정순']) {
            await page.getByRole('button', { name: view, exact: true }).click();
            await page.waitForTimeout(150);
            assert.equal(await sidebar.count(), 1, `${width}px ${view}: one empty-notes line`);
            layouts.push(`notes-${view}-${width}`);
        }

        await page.screenshot({ path: resolve(output, `notes-list-${width}.png`) });

        // The dev server cannot reach the synthetic Supabase host, so the server render fails.
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('alert').filter({ hasText: '서재를 불러오지 못했습니다' }).waitFor();
        assert.equal(await page.locator('.empty-library').count(), 0, `${width}px: no empty shelf after a load failure`);
        assert.equal(await page.locator('.library-heading span').count(), 0, `${width}px: no 0편 after a load failure`);
        await page.screenshot({ path: resolve(output, `library-error-${width}.png`) });
        layouts.push(`library-error-${width}`);

        await context.close();
    }

    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ layouts, errors }, null, 2));
    console.log(`empty states: ${layouts.length} checks`);
} finally {
    await browser.close();
}
