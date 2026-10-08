// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// The wrapped split-view toolbar must not cover the documents in any palette, and the publish dialog leaves empty drafts unchecked.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { newDocument, workspaceSchema } from '../../src/lib/model.ts';
import { applyNavigation, resolveNavigation } from '../../src/lib/document-navigation.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/split-toolbar-publish');

await mkdir(output, { recursive: true });

let data = seedWorkspace(), version = 1;

// A new or replacement document starts untitled and empty, like the one a last-document deletion leaves behind.
const empty = newDocument('scene', '');

data = workspaceSchema.parse({ ...data, works: data.works.map((w, i) => {
    if (i)
        return applyNavigation(w, resolveNavigation(w));
    const nav = resolveNavigation(w);

    return applyNavigation({ ...w, documents: [...w.documents, empty] }, { ...nav, nodes: [...nav.nodes, { id: empty.id, type: 'document', sectionId: 'scene', parentId: null }] });
}) });

const written = data.works[0].documents.filter(d => d.kind === 'scene' && d.id !== empty.id).map(d => d.title), errors = [];

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });

await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}');

 if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });

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

page.setDefaultTimeout(15000);

page.on('pageerror', error => errors.push(error.message));

const button = name => page.getByRole('button', { name, exact: true });

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.manuscript').first().waitFor();
    await page.locator('aside').getByText(written[0], { exact: true }).first().click();
    await button('옆에 열기').click();
    await page.locator('.is-split .editor-toolbar').nth(1).waitFor();

    for (const palette of ['보라', '카세트', '사이버'])
        for (const dark of [false, true]) {
            await button(`${palette} 테마`).click();

            if ((await page.locator('html').getAttribute('data-theme') === 'dark') !== dark)
                await button(dark ? '다크 모드로 전환' : '라이트 모드로 전환').click();
            await page.mouse.move(640, 850);

            // Each pane's toolbar grows with its wrapped rows and the document starts below it.
            const panes = await page.locator('.is-split .editor-toolbar').evaluateAll(bars => bars.map(bar => {
                const box = bar.getBoundingClientRect(), scroll = bar.parentElement.closest('.editor-shell, .split-pane').querySelector('.editor-scroll');

                return { height: box.height, content: bar.scrollHeight, gap: scroll.getBoundingClientRect().top - box.bottom };
            }));

            assert.equal(panes.length, 2);

            for (const pane of panes) {
                assert(pane.content <= pane.height + 1, `${palette} toolbar rows overflow: ${JSON.stringify(pane)}`);
                assert(pane.gap >= -1, `${palette} toolbar covers the document: ${JSON.stringify(pane)}`);
            }

            await page.screenshot({ path: resolve(output, `split-1280-${palette}-${dark ? 'dark' : 'light'}.png`) });
            console.log('PASS split toolbar', palette, dark ? 'dark' : 'light');
        }

    await button('분할 닫기').click();
    await button('게시 준비').click();
    const rows = await page.locator('.publish-scene').evaluateAll(labels => labels.map(label => [label.querySelector('strong').textContent, label.querySelector('input').checked]));

    assert.deepEqual(rows, [...written.map(title => [title, true]), ['제목 없음', false]]);
    await page.screenshot({ path: resolve(output, 'publish-default.png') });
    console.log('PASS publish leaves the empty draft unchecked');
    assert.deepEqual(errors, []);
} finally {
    await browser.close();
}
