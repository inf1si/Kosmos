// Run through tsx; see docs/personal-notes.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/note-quick-capture');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// Older checks start in the editor; the studio home has its own check (studio-home.mjs).
await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}');

 if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });

const note = { ...newNote(), title: '합성 노트', content: fromText('첫 문단.\n\n둘째 문단은 들여쓰지 않는다.'), tags: ['생각'] };

const other = { ...newNote(), title: '보관 노트', content: fromText('다른 태그'), tags: ['자료'] };

let data = addNote(addNote(seedWorkspace(), other), note), version = 1, saves = 0;

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

const until = async (check, label) => { for (let i = 0; i < 100; i++) { if (check()) return; await page.waitForTimeout(100); }

 throw new Error(`Timed out: ${label}`); };

const indent = scope => page.locator(`${scope} .manuscript p`).nth(1).evaluate(el => getComputedStyle(el).textIndent);

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.studio-panel .manuscript').first().waitFor();
    const before = data.notes.length, studioIndent = await indent('.studio-panel');
    assert.notEqual(studioIndent, '0px', 'Manuscripts keep their first-line indent');
    // Ctrl/Cmd+Shift+N belongs to the browser's private window, so Alt+N opens the quick note in place.
    await page.locator('.studio-panel .manuscript p').first().click();
    await page.keyboard.press('Alt+KeyN');
    const input = page.getByRole('textbox', { name: '빠른 메모 내용', exact: true });
    await input.waitFor();
    assert(await input.evaluate(el => el === document.activeElement));
    await input.fill('우산 두 개를 든 노인\n지하철 2호선');
    await input.press('Control+Enter');
    await page.getByRole('status').filter({ hasText: '수집함에 넣었습니다' }).waitFor();
    assert.equal(await input.inputValue(), '');
    await until(() => data.notes.length === before + 1, 'quick note save');
    const captured = data.notes.find(n => n.content.content?.[0]?.content?.[0]?.text === '우산 두 개를 든 노인');
    assert(captured && captured.box === 'inbox' && captured.content.content.length === 2);
    await page.screenshot({ path: resolve(output, 'quick-note.png') });
    await page.keyboard.press('Escape');
    await popover().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !!document.activeElement?.closest('.studio-panel .manuscript'));
    assert.equal(await page.locator('.notes-workspace').count(), 0, 'Quick capture stays in the studio');
    await button('빠른 메모 (Alt+N)').click();
    await input.fill('엔딩은 비 그친 시장');
    await button('노트에서 열기').click();
    await page.locator('.notes-workspace .manuscript').waitFor();
    assert.equal((await page.locator('.notes-workspace .doc-tab span').textContent()).trim(), '엔딩은 비 그친 시장');
    await until(() => data.notes.length === before + 2, 'open in notes');
    await page.keyboard.press('Alt+KeyN');
    await until(() => data.notes.length === before + 3, 'Alt+N in notes');
    await page.waitForFunction(() => !!document.activeElement?.closest('.notes-workspace .manuscript'));
    await page.locator('.notes-list').getByText('합성 노트', { exact: true }).click();
    assert.equal(await indent('.notes-workspace'), '0px', 'Notes drop the manuscript indent');
    // Filters fold into a popover beside search; the views are one segmented row.
    await button('노트 필터').click();
    await page.getByRole('combobox', { name: '태그로 노트 찾기', exact: true }).selectOption('자료');
    await page.keyboard.press('Escape');
    await button('노트 필터 · 1개 적용').waitFor();
    assert(!(await page.locator('.notes-list').innerText()).includes('합성 노트'));
    await button('노트 필터 · 1개 적용').click();
    await button('필터 초기화').click();
    await page.keyboard.press('Escape');
    await button('노트 필터').waitFor();
    await page.locator('.notes-list').getByText('합성 노트', { exact: true }).click();
    await page.getByRole('button', { name: '노트 더 보기', exact: true }).click();
    await page.getByRole('menuitem', { name: '아이스박스에 넣기', exact: true }).click();
    await page.locator('.doc-kicker').filter({ hasText: '아이스박스' }).waitFor();
    await until(() => data.notes.find(n => n.id === note.id).box === 'icebox', 'icebox');
    const icebox = page.getByRole('group', { name: '노트 보기' }).getByRole('button', { name: /아이스박스/ });
    await icebox.click();
    assert.equal(await icebox.getAttribute('aria-pressed'), 'true');
    assert(await page.locator('.notes-list').getByText('합성 노트', { exact: true }).isVisible());

    for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(300);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: resolve(output, `notes-${width}.png`) });
    }

    assert.deepEqual(errors, []);
    const result = { environment: 'isolated Chromium synthetic author and Supabase responses', base, studioIndent, notes: data.notes.length, saves, errors };
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
