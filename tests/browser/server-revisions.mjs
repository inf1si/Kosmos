// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// The backup dialog must list the account's server revisions (workspace_revisions) so a
// cleared browser or a second device can still restore an earlier version.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { workspaceSchema } from '../../src/lib/model.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/server-revisions');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const current = seedWorkspace(), older = structuredClone(current);

older.works[0].title = '서버 이력의 작품';

const revisions = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: '2026-10-10T08:00:00.000Z', payload: older }, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: '2026-10-10T07:00:00.000Z', payload: current }];

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-10T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

const errors = [], layouts = [], revisionQueries = [];

let data = structuredClone(current), version = 1, saved = null;

try {
    for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });

        await context.addInitScript(() => { try { localStorage.setItem('kosmos-app-preferences', JSON.stringify({ studioStart: 'last' })); } catch { /* The test fails loudly on the home screen. */ } });
        await context.addInitScript(({ profile, token, key }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile })), { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });

        await context.route('**/*.supabase.co/**', async (route) => {
            const request = route.request(), url = new URL(request.url()), path = url.pathname;
            let value = {};

            if (path.includes('/auth/v1/user'))
                value = profile;
            else if (path.endsWith('/authors'))
                value = { user_id: profile.id };
            else if (path.endsWith('/workspaces'))
                value = { id: data.id, payload: data, version };
            else if (path.endsWith('/workspace_revisions')) {
                revisionQueries.push(url.search);
                assert.equal(url.searchParams.get('workspace_id'), `eq.${data.id}`);
                const id = url.searchParams.get('id');

                value = id ? { payload: revisions.find(r => `eq.${r.id}` === id).payload } : revisions.map(({ id, created_at }) => ({ id, created_at }));
            }
            else if (path.endsWith('/save_workspace')) {
                const input = request.postDataJSON();

                data = workspaceSchema.parse(input.p_payload);
                version++;
                saved = data;
                value = { status: 'saved', version };
            }

            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
        });
        await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));

        if (context.routeWebSocket)
            await context.routeWebSocket('**/realtime/**', ws => ws.close());

        const page = await context.newPage();

        page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.ProseMirror').first().waitFor();
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('studio-modal', { detail: 'backup' })));

        const dialog = page.getByRole('dialog', { name: '백업과 복구' });

        await dialog.waitFor();

        const serverRows = dialog.locator('.revision-list button').filter({ hasText: '서버 자동 저장' });

        // One list: browser checkpoints and server revisions together, newest first, no extra help text.
        await serverRows.nth(1).waitFor();
        assert.equal(await serverRows.count(), 2, `${width}px: two server revisions`);
        assert.equal(await dialog.locator('.revision-list button').filter({ hasText: '처음 시작' }).count(), 1, `${width}px: browser checkpoint in the same list`);
        assert.equal(await dialog.locator('.backup-columns section').first().locator('.field-help, .segmented').count(), 0, `${width}px: no tabs or help paragraph`);
        const times = await dialog.locator('.revision-list small').allInnerTexts();

        assert.equal(times.length, 3);

        await serverRows.first().click();
        await dialog.locator('.restore-choice').scrollIntoViewIfNeeded();

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

        assert(!overflow, `${width}px: no horizontal overflow`);
        await page.screenshot({ path: resolve(output, `server-tab-${width}.png`) });

        if (width === 1280) {
            await dialog.getByRole('button', { name: '선택한 원고 복원' }).click();
            await dialog.getByRole('status').filter({ hasText: '이전 원고를 새 작업본으로 복원했습니다.' }).waitFor();
            await page.waitForTimeout(2500);
            assert.equal(saved?.works[0].title, '서버 이력의 작품', 'restored payload reaches the cloud save');

            // The pre-restore state is kept as a local checkpoint.
            await dialog.locator('.revision-list').getByText('복원 전 원고').first().waitFor();
            await page.screenshot({ path: resolve(output, `after-restore-${width}.png`) });
            data = structuredClone(current);
            version++;
        }

        layouts.push(`server-revisions-${width}`);
        await context.close();
    }

    assert(revisionQueries.some(q => q.includes('select=id%2Ccreated_at') || q.includes('select=id,created_at')), 'list query only asks for id and time');
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ layouts, revisionQueries, errors }, null, 2));
    console.log(`server revisions: ${layouts.length} widths, restore saved`);
} finally {
    await browser.close();
}
