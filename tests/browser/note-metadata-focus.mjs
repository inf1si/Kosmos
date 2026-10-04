// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, newDocument, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/note-metadata-focus');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const note = { ...newNote(), title: '합성 노트', content: fromText('메타 항목을 바꿔도 보존할 합성 본문.'), tags: ['생각'] };
let data = addNote(seedWorkspace(), note), version = 1, saves = 0;
const workIds = data.works.map(w => w.id), initialContent = structuredClone(note.content), errors = [], layouts = [];
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
const waitSave = () => page.waitForFunction(() => document.body.textContent.includes('클라우드 동기화됨'));
const openTags = () => page.getByRole('button', { name: /^태그 (추가|\d+)$/ }).click();
const openWorks = () => page.getByRole('button', { name: /^작품 (연결|\d+)$/ }).click();
// Detect the real painted outline against every clipping ancestor, not a CSS selector.
async function outlineFits(control) {
    const metrics = await control.evaluate(el => {
        const r = el.getBoundingClientRect(), style = getComputedStyle(el), outset = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)), clipped = [];
        for (let p = el.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p), b = p.getBoundingClientRect();
            if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
                const left = b.left + p.clientLeft, top = b.top + p.clientTop, right = left + p.clientWidth, bottom = top + p.clientHeight;
                if (r.left - outset < left - .5 || r.right + outset > right + .5 || r.top - outset < top - .5 || r.bottom + outset > bottom + .5)
                    clipped.push(p.className);
            }
        }
        return { focused: el === document.activeElement, type: el.type, outline: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset, clipped, rect: { width: r.width, height: r.height } };
    });
    assert(metrics.focused, 'Control must actually have focus');
    assert.notEqual(metrics.outline, 'none');
    assert(metrics.clipped.length === 0, `Focus outline clipped by ${metrics.clipped.join(', ')}`);
    if (metrics.type === 'checkbox')
        assert(metrics.rect.width >= 12 && metrics.rect.height >= 12, 'Long labels must not collapse a native checkbox');
    return metrics;
}
async function close() { await page.keyboard.press('Escape'); await popover().waitFor({ state: 'hidden' }); await page.waitForFunction(() => document.querySelector('[aria-label="노트 본문"]') === document.activeElement); }
try {
    await page.goto(`${base}/studio#notes/${note.id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.notes-workspace .manuscript').waitFor();
    await waitSave();
    for (const width of [1280, 360])
        for (const palette of ['보라', '카세트', '사이버'])
            for (const dark of [false, true]) {
                await page.setViewportSize({ width, height: 900 });
                if (!await button(`${palette} 테마`).isVisible())
                    await button('사이드바 열기').click();
                await button(`${palette} 테마`).click();
                if ((await page.locator('html').getAttribute('data-theme') === 'dark') !== dark)
                    await button(dark ? '다크 모드로 전환' : '라이트 모드로 전환').click();
                if (width === 360)
                    await button('노트 탐색 닫기').click();
                await openTags();
                const input = page.getByRole('textbox', { name: '새 태그', exact: true });
                await input.click();
                await input.fill('강조할 태그');
                await input.selectText();
                const tag = await outlineFits(input);
                assert.equal(await input.evaluate(el => el.selectionEnd - el.selectionStart), 6);
                await page.screenshot({ path: resolve(output, `tag-${width}-${palette}-${dark ? 'dark' : 'light'}.png`) });
                await close();
                await openWorks();
                const check = page.getByRole('checkbox', { name: `${data.works[0].title}에 노트 연결`, exact: true });
                await check.focus();
                const unchecked = await outlineFits(check);
                assert(!await check.isChecked());
                await check.press('Space');
                await check.waitFor({ state: 'visible' });
                assert(await check.isChecked());
                const checked = await outlineFits(check);
                await waitSave();
                assert(data.notes[0].linkedWorkIds.includes(workIds[0]));
                await page.screenshot({ path: resolve(output, `work-${width}-${palette}-${dark ? 'dark' : 'light'}.png`) });
                await check.press('Space');
                assert(!await check.isChecked());
                await waitSave();
                await close();
                await openTags();
                await button('생각 태그 제거').focus();
                await page.keyboard.press('Tab');
                assert(await input.evaluate(el => el === document.activeElement));
                await outlineFits(input);
                // On narrow screens the open panel covers the chips on the next row.
                if (width === 360)
                    await close();
                await button('작품으로 가져오기').click();
                const target = page.getByRole('combobox', { name: '노트를 가져올 작품', exact: true });
                await target.focus();
                const copy = await outlineFits(target);
                if (width === 360)
                    await close();
                await button('첨부 추가').click();
                const file = page.getByRole('button', { name: '첨부 추가', exact: true });
                assert(await file.isVisible());
                const upload = page.getByLabel('노트 이미지 첨부', { exact: true });
                await upload.focus();
                const attachment = await outlineFits(upload);
                await close();
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                const actual = await page.locator('html').evaluate(el => ({ palette: el.dataset.palette, theme: el.dataset.theme }));
                layouts.push({ width, ...actual, tag, unchecked, checked, copy, attachment });
                console.log('PASS', width, actual.palette, actual.theme);
            }
    // Saving metadata, consecutive popovers and reload preserve the original body.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTags();
    const input = page.getByRole('textbox', { name: '새 태그', exact: true });
    await input.fill('새 태그');
    await input.press('Enter');
    await page.getByRole('button', { name: '새 태그 태그 제거', exact: true }).waitFor();
    await waitSave();
    await openWorks();
    const second = page.getByRole('checkbox').nth(1);
    await second.press('Space');
    assert(await second.isChecked());
    await waitSave();
    await close();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.notes-workspace .manuscript').waitFor();
    await waitSave();
    await openTags();
    await page.getByRole('button', { name: '새 태그 태그 제거', exact: true }).waitFor();
    await openWorks();
    assert(await page.getByRole('checkbox').nth(1).isChecked());
    await close();
    assert.deepEqual(data.notes[0].content, initialContent);
    // Long work names and lists stay scrollable under the existing Popover limit.
    data = { ...data, works: [...data.works, ...Array.from({ length: 18 }, (_, i) => ({ id: uid(), title: `긴 제목 ${i} ${'연결할 작품 '.repeat(20)}`, subtitle: '', description: '', form: '단편', documents: [newDocument('memo', '합성 메모')], publications: [], activePublicationId: null }))] };
    version++;
    await page.setViewportSize({ width: 360, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.notes-workspace .manuscript').waitFor();
    await waitSave();
    await openWorks();
    const last = page.getByRole('checkbox').last();
    await last.focus();
    const lastCheckbox = await outlineFits(last);
    await page.keyboard.press('Shift+Tab');
    await outlineFits(page.getByRole('checkbox').nth(18));
    await page.keyboard.press('Tab');
    await outlineFits(last);
    const scroll = await popover().evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, viewport: innerHeight }));
    assert(scroll.scrollHeight > scroll.height);
    assert(scroll.scrollTop > 0);
    assert(scroll.height <= scroll.viewport * .7 + 1);
    await page.screenshot({ path: resolve(output, 'long-work-list.png') });
    await close();
    assert.deepEqual(errors, []);
    const result = { environment: 'isolated Chromium synthetic author and Supabase responses', base, layouts, screenshots: 25, tagAndWorkReloadPreserved: true, bodyUnchanged: true, longWorkList: { ...scroll, lastCheckbox }, saves, errors };
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ layouts: layouts.length, screenshots: 25, persistence: true, errors }));
}
catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    throw error;
}
finally {
    await context.close();
    await browser.close();
}
