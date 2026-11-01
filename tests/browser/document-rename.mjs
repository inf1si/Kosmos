// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// Documents and notes are renamed inside their sidebar row from the … or right-click menu, like folders.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
import { PALETTES } from '../../src/lib/theme.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/document-rename');

const palettes = process.env.KOSMOS_RENAME_QUICK === '1' ? PALETTES.slice(0, 1) : PALETTES;

await mkdir(output, { recursive: true });

const note = { ...newNote(), title: '합성 노트' };

let data = workspaceSchema.parse({ ...addNote(seedWorkspace(), note), trash: [] }), version = 1;

const [scene, second] = data.works[0].documents, wiki = data.works[0].documents.find(d => d.kind === 'wiki');

const docOf = id => data.works[0].documents.find(d => d.id === id);

const errors = [];

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

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
        const input = request.postDataJSON();

        assert.equal(input.p_base_version, version);
        data = workspaceSchema.parse(input.p_payload);
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

const renameBox = label => page.getByRole('textbox', { name: `${label} 새 이름`, exact: true });

async function saved(check, message) {
    for (let i = 0; i < 60 && !check(); i++)
        await page.waitForTimeout(250);
    assert(check(), message);
}

async function openSidebar() {
    if (!await page.locator('[data-navigation-section="scene"]').isVisible())
        await button('사이드바 열기').click();
}

async function renameFromMenu(label) {
    await button(`${label} 메뉴`).click({ force: true });
    await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
    await renameBox(label).waitFor();
}

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.manuscript').first().waitFor();

    // … menu → rename → Enter saves the document title, and the open tab and title field follow.
    await page.locator(`[data-navigation-row="${scene.id}"] button[aria-current="page"]`).waitFor();
    await renameFromMenu(scene.title);
    assert.equal(await renameBox(scene.title).inputValue(), scene.title);
    assert(await renameBox(scene.title).evaluate(el => el === document.activeElement && el.selectionStart === 0 && el.selectionEnd === el.value.length), 'The rename field starts focused with the name selected');
    await renameBox(scene.title).fill('합성 새 제목');
    await page.keyboard.press('Enter');
    await saved(() => docOf(scene.id).title === '합성 새 제목', 'Enter must save the document title');
    assert.equal(await page.getByRole('textbox', { name: '문서 제목', exact: true }).first().inputValue(), '합성 새 제목');
    assert(await page.locator(`[data-navigation-row="${scene.id}"] .tree-label`).textContent() === '합성 새 제목');
    assert(await button('합성 새 제목 메뉴').evaluate(el => el === document.activeElement), 'Focus returns to the row menu button');
    assert.deepEqual(docOf(scene.id).content, scene.content, 'Renaming keeps the manuscript');
    console.log('PASS menu rename');

    // Right-click opens the same item; Esc cancels without saving.
    const before = version;

    await page.locator(`[data-navigation-row="${second.id}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
    await renameBox(second.title).fill('취소할 제목');
    await page.keyboard.press('Escape');
    await renameBox(second.title).waitFor({ state: 'detached' });
    await page.waitForTimeout(1500);
    assert.equal(docOf(second.id).title, second.title);
    assert.equal(version, before, 'Esc must not save');
    console.log('PASS context menu cancel');

    // Blur saves, and an empty title is allowed like the editor title field: the row shows 제목 없음.
    await page.locator(`[data-navigation-row="${wiki.id}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
    await renameBox(wiki.title).fill('');
    assert.equal(await renameBox(wiki.title).getAttribute('placeholder'), '제목 없음');
    await page.locator('.manuscript').first().click();
    await saved(() => docOf(wiki.id).title === '', 'Blur must save an empty title');
    assert.equal(await page.locator(`[data-navigation-row="${wiki.id}"] .tree-label`).textContent(), '제목 없음');
    // Renaming an untitled document starts from the stored empty title, not the 제목 없음 label.
    await renameFromMenu('제목 없음');
    assert.equal(await renameBox('제목 없음').inputValue(), '');
    await renameBox('제목 없음').fill(wiki.title);
    await page.keyboard.press('Enter');
    await saved(() => docOf(wiki.id).title === wiki.title, 'The wiki title is restored');
    console.log('PASS blur save and empty title');

    // Every palette × mode at two widths: the field stays inside the row and the page does not scroll sideways.
    const results = [];

    for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 800 });
        await openSidebar();

        for (const palette of palettes)
            for (const mode of ['light', 'dark']) {
                await page.evaluate(({ palette, mode }) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = mode; }, { palette, mode });
                await renameFromMenu(second.title);

                const metrics = await renameBox(second.title).evaluate(el => {
                    const row = el.closest('[data-navigation-row]').getBoundingClientRect(), box = el.getBoundingClientRect(), style = getComputedStyle(el);

                    return { inside: box.left >= row.left - 0.5 && box.right <= row.right + 0.5 && box.top >= row.top - 0.5 && box.bottom <= row.bottom + 0.5, fieldWidth: box.width, color: style.color, background: style.backgroundColor, border: style.borderTopColor, scroll: document.documentElement.scrollWidth <= innerWidth };
                });

                assert(metrics.inside, `${width} ${palette} ${mode}: rename field inside its row`);
                assert(metrics.fieldWidth >= 80, `${width} ${palette} ${mode}: rename field wide enough (${metrics.fieldWidth})`);
                assert.notEqual(metrics.color, metrics.background);
                assert(metrics.scroll, `${width} ${palette} ${mode}: no sideways scroll`);
                results.push({ width, palette, mode, ...metrics });

                if (['violet', 'cyber', 'hitchhiker', 'nasapunk'].includes(palette) || palette === palettes.at(-1))
                    await page.locator(`[data-navigation-row="${second.id}"]`).locator('xpath=ancestor::section[1]').screenshot({ path: resolve(output, `${width}-${palette}-${mode}.png`) });
                await page.keyboard.press('Escape');
                await renameBox(second.title).waitFor({ state: 'detached' });
            }

        console.log('PASS display', width, results.filter(r => r.width === width).length);
    }

    await page.evaluate(() => { document.documentElement.dataset.palette = 'violet'; document.documentElement.dataset.theme = 'light'; });
    await page.setViewportSize({ width: 1280, height: 900 });

    // Notes use the same tree: renaming a note row patches the note title.
    await button('노트').click();
    await renameFromMenu('합성 노트');
    await renameBox('합성 노트').fill('합성 노트 새 이름');
    await page.keyboard.press('Enter');
    await saved(() => data.notes.find(n => n.id === note.id)?.title === '합성 노트 새 이름', 'Note rename must save the note title');
    await button('합성 노트 새 이름 메뉴').waitFor({ state: 'attached' });
    console.log('PASS note rename');

    // Saved titles survive a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await button('합성 노트 새 이름 메뉴').waitFor({ state: 'attached' });
    await button('집필실').click();
    await openSidebar();
    await button('합성 새 제목 메뉴').waitFor({ state: 'attached' });
    console.log('PASS reload');

    assert.deepEqual(errors, []);
    console.log('PASS document rename', results.length);
} finally {
    await browser.close();
}
