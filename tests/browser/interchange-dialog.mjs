// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// Covers the studio 문서 가져오기 · 내보내기 dialog: export rows keep checkbox, title and kind on one line with the
// note below the list, and the import tab takes a whole folder, in all six palette × mode combinations at 1280/360px.
import assert from 'node:assert/strict';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { workspaceSchema } from '../../src/lib/model.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/interchange-dialog');
await mkdir(output, { recursive: true });
// Playwright cannot read non-ASCII file or folder names from an uploaded directory (NotReadableError), so the
// names are ASCII here and the Korean titles come from the files themselves.
const vault = resolve(output, 'vault');
await rm(vault, { recursive: true, force: true });
await mkdir(resolve(vault, 'drafts'), { recursive: true });
await writeFile(resolve(vault, 'idea.md'), '# 구상\n\n[[drafts/scene]]');
await copyFile(resolve('tests/fixtures/note-import/voyage.docx'), resolve(vault, 'drafts/scene.docx'));
let data = seedWorkspace();
let version = 1, saves = 0;
const errors = [], profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-04T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;
const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(({ profile, token, key }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile })), { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });
await context.route('**/*.supabase.co/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value = {};
    if (path.includes('/auth/v1/user')) value = profile;
    else if (path.endsWith('/authors')) value = { user_id: profile.id };
    else if (path.endsWith('/workspaces')) value = { id: data.id, payload: data, version };
    else if (path.endsWith('/save_workspace')) { const input = request.postDataJSON(); assert.equal(input.p_base_version, version); data = workspaceSchema.parse(input.p_payload); version++; saves++; value = { status: 'saved', version }; }
    else if (path.includes('/storage/v1/')) value = { Key: 'synthetic' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});
await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));
if (context.routeWebSocket) await context.routeWebSocket('**/realtime/**', ws => ws.close());
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const body = page.locator('.notes-workspace .manuscript');
const until = async (check, label) => { for (let i = 0; i < 150; i++) { if (check()) return; await page.waitForTimeout(100); } throw new Error(`Timed out: ${label}`); };
try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.manuscript').first().waitFor();
    const shots = [];
    for (const width of [1280, 360])
        for (const palette of ['violet', 'cassette', 'cyber'])
            for (const theme of ['light', 'dark']) {
                await page.setViewportSize({ width, height: 860 });
                await page.evaluate(([palette, theme]) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = theme; }, [palette, theme]);
                if (!await page.getByRole('button', { name: '가져오기 · 내보내기' }).isVisible()) await button('사이드바 열기').click();
                await page.getByRole('button', { name: '가져오기 · 내보내기' }).click();
                await page.getByRole('tab', { name: '내보내기' }).click();
                const rows = await page.locator('.transfer-export-row').evaluateAll(list => list.map(row => { const [box, title, kind] = [row.querySelector('input'), row.querySelector('span'), row.querySelector('small')].map(el => el.getBoundingClientRect()); return { oneLine: Math.abs((box.top + box.bottom) / 2 - (title.top + title.bottom) / 2) < 4 && box.right <= title.left && title.right <= kind.left, box: Math.round(box.width), title: Math.round(title.width), height: Math.round(row.getBoundingClientRect().height) }; }));
                assert(rows.every(r => r.title >= 80 && r.height <= 60), `export row titles squeezed at ${width}px: ${JSON.stringify(rows)}`);
                assert(rows.length > 0 && rows.every(r => r.oneLine), `export rows at ${width}px ${palette} ${theme}: ${JSON.stringify(rows)}`);
                const gap = await page.locator('.transfer-list + .field-help').evaluate(el => el.getBoundingClientRect().top - el.previousElementSibling.getBoundingClientRect().bottom);
                assert(gap >= 8, `export note overlaps the list (${gap}px)`);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await page.screenshot({ path: resolve(output, `export-${width}-${palette}-${theme}.png`) });
                await page.getByRole('tab', { name: '가져오기' }).click();
                await page.getByLabel('외부 문서 폴더').setInputFiles(vault);
                await page.getByText('2 / 2개 문서 선택 · 1개 첨부').waitFor();
                assert.equal(await page.getByLabel('가져올 새 작품 제목').inputValue(), 'vault');
                const pick = await page.locator('.transfer-pick').evaluate(el => { const [a, b] = [...el.querySelectorAll('label')].map(l => l.getBoundingClientRect()); return { sideBySide: Math.abs(a.top - b.top) < 2, stacked: b.top >= a.bottom }; });
                assert(width > 600 ? pick.sideBySide : pick.stacked, `file and folder pickers at ${width}px`);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await page.screenshot({ path: resolve(output, `import-${width}-${palette}-${theme}.png`) });
                shots.push(width, palette, theme);
                await page.keyboard.press('Escape');
            }
    assert.deepEqual(errors, []);
    const result = { environment: 'isolated Chromium synthetic author and Supabase responses', base, combinations: shots.length / 3, errors };
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
}
catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    throw error;
}
finally {
    await context.close();
    await browser.close();
}
