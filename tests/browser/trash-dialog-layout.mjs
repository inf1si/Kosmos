// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, newDocument, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
import { trashDocument, trashNote } from '../../src/lib/workspace-trash.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/trash-dialog-layout');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const note = { ...newNote(), title: '합성 노트', content: fromText('휴지통에 넣을 합성 본문.') }, kept = { ...newNote(), title: '남은 노트', content: fromText('합성 본문.') };
let data = addNote(addNote(seedWorkspace(), note), kept), version = 1, saves = 0;
data = trashNote(data, note.id);
data = trashDocument(data, data.works[0].id, data.works[0].documents[1].id);
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
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const popover = () => page.locator('.popover');
// The search icon must share the input's row; a global `label` rule once stacked it above the field.
async function searchRow() {
    return page.locator('.trash-tools .sidebar-search').evaluate(el => {
        const icon = el.querySelector('svg').getBoundingClientRect(), input = el.querySelector('input').getBoundingClientRect(), box = el.getBoundingClientRect();
        return { direction: getComputedStyle(el).flexDirection, iconCenter: icon.top + icon.height / 2, inputTop: input.top, inputBottom: input.bottom, iconLeftOfInput: icon.right <= input.left, height: box.height };
    });
}
try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.manuscript').first().waitFor();
    for (const width of [1280, 360])
        for (const palette of ['보라', '카세트', '사이버'])
            for (const dark of [false, true]) {
                await page.setViewportSize({ width, height: 800 });
                if (!await button(`${palette} 테마`).isVisible())
                    await button('사이드바 열기').click();
                await button(`${palette} 테마`).click();
                if ((await page.locator('html').getAttribute('data-theme') === 'dark') !== dark)
                    await button(dark ? '다크 모드로 전환' : '라이트 모드로 전환').click();
                await page.getByRole('button', { name: /^휴지통/ }).first().click();
                const row = await searchRow();
                assert.equal(row.direction, 'row');
                assert(row.iconLeftOfInput, 'Search icon must sit left of the input');
                assert(row.iconCenter >= row.inputTop && row.iconCenter <= row.inputBottom, 'Search icon must share the input row');
                assert(row.height <= 40, `Search field grew to ${row.height}px`);
                await page.screenshot({ path: resolve(output, `trash-${width}-${palette}-${dark ? 'dark' : 'light'}.png`) });
                await button('비우기').click();
                const danger = await page.locator('.trash-confirm .button.danger').evaluate(el => {
                    const probe = document.createElement('span');
                    probe.style.color = 'var(--danger)';
                    el.append(probe);
                    const expected = getComputedStyle(probe).color;
                    probe.remove();
                    return { color: getComputedStyle(el).color, expected };
                });
                assert.equal(danger.color, danger.expected, 'Permanent delete must use the danger button');
                await page.screenshot({ path: resolve(output, `confirm-${width}-${palette}-${dark ? 'dark' : 'light'}.png`) });
                await button('취소').click();
                await page.keyboard.press('Escape');
                await page.locator('.trash-tools').waitFor({ state: 'hidden' });
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                const actual = await page.locator('html').evaluate(el => ({ palette: el.dataset.palette, theme: el.dataset.theme }));
                layouts.push({ width, ...actual, row, danger: danger.color });
                console.log('PASS', width, actual.palette, actual.theme);
            }
    assert.equal(data.trash.length, 2, 'Layout checks must not change the trash');
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ environment: 'isolated Chromium synthetic author and Supabase responses', base, layouts, saves, errors }, null, 2) + '\n');
}
catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    throw error;
}
finally {
    await context.close();
    await browser.close();
}
