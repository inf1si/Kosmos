// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// Folder-wide deletion shows one trash row and one restore brings back the folder, its subfolders and documents in order.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { workspaceSchema } from '../../src/lib/model.ts';
import { applyNavigation, insertFolder, moveNavigation, resolveNavigation } from '../../src/lib/document-navigation.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
import { editNoteTree, moveNote } from '../../src/lib/note-navigation.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/folder-restore');

await mkdir(output, { recursive: true });

let data = seedWorkspace(), version = 1;

let work = data.works[0];

const [a, b, c] = work.documents, first = resolveNavigation(work).nodes.find(n => n.parentId === null && n.sectionId === 'scene');

const folderNamed = title => resolveNavigation(work).nodes.find(n => n.type === 'folder' && n.title === title).id;

work = insertFolder(work, '합성 1부', { sectionId: 'scene', parentId: null });

const folder = folderNamed('합성 1부');

work = moveNavigation(work, folder, { sectionId: 'scene', parentId: null, beforeId: first.id });

work = insertFolder(work, '합성 1장', { sectionId: 'scene', parentId: folder });

const chapter = folderNamed('합성 1장');

for (const [id, to] of [[null, { sectionId: 'scene', parentId: folder }], [a.id, { sectionId: 'scene', parentId: folder, beforeId: chapter }], [b.id, { sectionId: 'scene', parentId: chapter }], [c.id, { sectionId: 'scene', parentId: b.id }]])
    work = id ? moveNavigation(work, id, to) : insertFolder(work, '합성 빈 폴더', to);

data = workspaceSchema.parse({ ...data, works: data.works.map((w, i) => i === 0 ? work : applyNavigation(w, resolveNavigation(w))), trash: [] });

const parentNote = { ...newNote(), title: '합성 부모 노트' }, childNote = { ...newNote(), title: '합성 하위 노트' };

data = addNote(addNote(data, parentNote), childNote, { parentId: parentNote.id });

data = editNoteTree(data, w => insertFolder(w, '합성 노트묶음', { sectionId: 'notes', parentId: null }));

const noteFolder = data.noteNavigation.nodes.find(n => n.type === 'folder' && n.title === '합성 노트묶음').id;

data = moveNote(data, parentNote.id, { parentId: noteFolder });

// Each node with its children in order, so a restore that reorders, moves or drops a folder fails.
const sceneTree = nav => {
    const visit = parentId => nav.nodes.filter(n => n.parentId === parentId && n.sectionId === 'scene').map(n => `${n.id}(${visit(n.id)})`).join(',');

    return visit(null);
};

const original = sceneTree(data.works[0].navigation), errors = [];

const originalNotes = structuredClone(data.noteNavigation);

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

async function saved(check) {
    for (let i = 0; i < 60 && !check(); i++)
        await page.waitForTimeout(250);

    assert(check(), 'The change must reach the server copy');
}

async function sidebarCount(count) {
    if (!await page.getByRole('button', { name: /^휴지통/ }).first().isVisible())
        await button('사이드바 열기').click();
    assert.equal(await page.getByRole('button', { name: /^휴지통/ }).first().locator('small').textContent(), String(count));
}

async function modalCount(count) {
    assert.equal(await page.locator('.trash-tools > .field-help').textContent(), `${count}개`);
    assert.equal(await page.locator('.trash-row').count(), count);
}

async function reload() {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^휴지통/ }).first().waitFor({ state: 'attached' });
}

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.manuscript').first().waitFor();

    await button('합성 1부 메뉴').click({ force: true });
    await page.getByRole('menuitem', { name: '폴더 전체 삭제' }).click();
    const help = await page.locator('.modal .field-help').first().textContent();

    assert.match(help, /폴더 구조와 하위 .+ 3개를 휴지통에 보관합니다/);
    await page.screenshot({ path: resolve(output, 'delete-confirm.png') });
    await button('삭제').click();
    await saved(() => data.trash.length === 3);
    assert(!data.works[0].navigation.nodes.some(n => n.id === folder || n.id === chapter));

    for (const width of [1280, 360])
        for (const palette of ['보라', '카세트', '사이버'])
            for (const dark of [false, true]) {
                await page.setViewportSize({ width, height: 800 });

                if (!await button(`${palette} 테마`).isVisible())
                    await button('사이드바 열기').click();
                await button(`${palette} 테마`).click();

                if ((await page.locator('html').getAttribute('data-theme') === 'dark') !== dark)
                    await button(dark ? '다크 모드로 전환' : '라이트 모드로 전환').click();
                await sidebarCount(1);
                await page.getByRole('button', { name: /^휴지통/ }).first().click();
                const row = page.locator(`.trash-row[data-trash-id="${folder}"]`);

                assert.equal(await page.locator('.trash-row').count(), 1, 'A folder-wide deletion is one trash row');
                assert.match(await row.textContent(), /합성 1부.*폴더 · .+ · 문서 3개/);
                await modalCount(1);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await page.screenshot({ path: resolve(output, `trash-${width}-${palette}-${dark ? 'dark' : 'light'}.png`) });
                await page.keyboard.press('Escape');
                await page.locator('.trash-tools').waitFor({ state: 'hidden' });
                // Both consumers show the same account trash count, even before any note deletion.
                await button('노트').click();
                await sidebarCount(1);
                await button('집필실').click();
                console.log('PASS', width, palette, dark ? 'dark' : 'light');
            }

    await page.setViewportSize({ width: 1280, height: 900 });
    await reload();
    await sidebarCount(1);
    await page.getByRole('button', { name: /^휴지통/ }).first().click();
    await page.locator(`.trash-row[data-trash-id="${folder}"]`).getByRole('button', { name: '복원', exact: true }).click();
    await saved(() => data.trash.length === 0);
    await modalCount(0);
    assert(await page.getByRole('textbox', { name: '휴지통 검색', exact: true }).evaluate(el => el === document.activeElement));
    assert.equal(sceneTree(data.works[0].navigation), original, 'Restore must rebuild the folder tree in its old place and order');
    await page.keyboard.press('Escape');

    for (const title of ['합성 1부', '합성 1장', '합성 빈 폴더'])
        await button(`${title} 메뉴`).waitFor({ state: 'attached' });
    await page.screenshot({ path: resolve(output, 'restored-tree.png') });
    await sidebarCount(0);
    await reload();
    await sidebarCount(0);
    console.log('PASS document restore and reload');

    await button('노트').click();
    await button('합성 노트묶음 메뉴').click();
    await page.getByRole('menuitem', { name: '폴더 전체 삭제' }).click();
    await button('삭제').click();
    await saved(() => data.trash.length === 2);

    for (const width of [1280, 360])
        for (const palette of ['보라', '카세트', '사이버'])
            for (const dark of [false, true]) {
                await page.setViewportSize({ width, height: 800 });

                if (!await button(`${palette} 테마`).isVisible())
                    await button('사이드바 열기').click();
                await button(`${palette} 테마`).click();

                if ((await page.locator('html').getAttribute('data-theme') === 'dark') !== dark)
                    await button(dark ? '다크 모드로 전환' : '라이트 모드로 전환').click();
                await sidebarCount(1);
                await page.getByRole('button', { name: /^휴지통/ }).first().click();
                await modalCount(1);
                assert.match(await page.locator('.trash-row').textContent(), /합성 노트묶음.*노트 폴더 · 노트 2개/);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await page.screenshot({ path: resolve(output, `notes-trash-${width}-${palette}-${dark ? 'dark' : 'light'}.png`) });
                await page.keyboard.press('Escape');
                await page.locator('.trash-tools').waitFor({ state: 'hidden' });
                console.log('PASS notes', width, palette, dark ? 'dark' : 'light');
            }

    await page.setViewportSize({ width: 1280, height: 900 });
    await reload();
    await sidebarCount(1);
    await page.getByRole('button', { name: /^휴지통/ }).first().click();
    await page.locator(`.trash-row[data-trash-id="${noteFolder}"]`).getByRole('button', { name: '복원', exact: true }).click();
    await saved(() => data.trash.length === 0);
    assert.deepEqual(data.noteNavigation, originalNotes);
    await modalCount(0);
    await page.keyboard.press('Escape');
    await sidebarCount(0);
    await reload();
    await button('합성 노트묶음 메뉴').click();
    await page.getByRole('menuitem', { name: '폴더 전체 삭제' }).click();
    await button('삭제').click();
    await saved(() => data.trash.length === 2);
    await page.getByRole('button', { name: /^휴지통/ }).first().click();
    await button('합성 노트묶음 영구 삭제').click();
    await button('삭제').click();
    await saved(() => data.trash.length === 0);
    await modalCount(0);
    assert(!data.notes.some(n => n.id === parentNote.id || n.id === childNote.id));
    await page.keyboard.press('Escape');
    await sidebarCount(0);
    await reload();
    await sidebarCount(0);
    console.log('PASS note restore, purge and reload');
    assert.deepEqual(errors, []);
    console.log('PASS restore');
} finally {
    await browser.close();
}
