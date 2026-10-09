// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// Covers picking a whole folder in 노트 가져오기: an Obsidian-style vault with Word and 한글 files keeps its folders,
// [[links]] and images, and the dialog fits all six palette × mode combinations at 1280 and 360px.
import assert from 'node:assert/strict';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { workspaceSchema } from '../../src/lib/model.ts';
import { resolveNoteNavigation } from '../../src/lib/note-navigation.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/note-import-formats');

await mkdir(output, { recursive: true });

function png(width, height, rgb) {
    const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => rgb).flat()])));

    const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));

 return Buffer.concat([size, body, crc]); };

    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);

    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Playwright cannot read non-ASCII file or folder names from an uploaded directory (NotReadableError), so the
// names are ASCII here and the Korean titles come from the files themselves.
const vault = resolve(output, 'vault'), fixtures = resolve('tests/fixtures/note-import');

await rm(vault, { recursive: true, force: true });

for (const dir of ['people', 'attach', 'drafts', '.obsidian']) await mkdir(resolve(vault, dir), { recursive: true });

await writeFile(resolve(vault, 'idea.md'), '# 구상\n\n[[seoyun]]이 [[people/seoyun|항해사]]를 만난다.\n\n![[star.png]]\n');

await writeFile(resolve(vault, 'people/seoyun.md'), '# 이서윤\n\n항해사. 바다를 잘 안다.');

await writeFile(resolve(vault, 'attach/star.png'), png(60, 40, [200, 160, 40]));

await writeFile(resolve(vault, '.obsidian/app.json'), '{}');

await copyFile(resolve(fixtures, 'voyage.docx'), resolve(vault, 'drafts/voyage.docx'));

await copyFile(resolve(fixtures, 'memo.hwp'), resolve(vault, 'drafts/memo.hwp'));

let data = seedWorkspace();

let version = 1, saves = 0;

const errors = [], profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-04T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// Older checks start in the editor; the studio home has its own check (studio-home.mjs).
await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}');

 if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });

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

// 노트 가져오기 lives in 설정 → 저장 · 백업 rather than the notes sidebar.
const openNoteImport = async () => {
    await page.locator('.notes-tools').getByRole('button', { name: '설정', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '설정', exact: true });
    await settings.getByRole('button', { name: '저장 · 백업', exact: true }).click();
    await settings.getByRole('button', { name: '노트 가져오기', exact: true }).click();
    await settings.waitFor({ state: 'detached' });
};

const body = page.locator('.notes-workspace .manuscript');

const until = async (check, label) => { for (let i = 0; i < 150; i++) { if (check()) return; await page.waitForTimeout(100); }

 throw new Error(`Timed out: ${label}`); };

try {
    await page.goto(`${base}/studio#notes`, { waitUntil: 'domcontentloaded' });
    await page.locator('.notes-home').waitFor();
    await openNoteImport();
    // The folder picker sends every file with its path inside the chosen folder; hidden folders are skipped.
    await page.getByLabel('가져올 노트 폴더').setInputFiles(vault);
    await page.getByText('노트 4개 · 첨부 2개').waitFor();
    assert.equal(await page.getByLabel('가져올 폴더 이름').inputValue(), 'vault');
    const shots = [];

    for (const width of [1280, 360])
        for (const palette of ['violet', 'cassette', 'cyber'])
            for (const theme of ['light', 'dark']) {
                await page.setViewportSize({ width, height: 860 });
                await page.evaluate(([palette, theme]) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = theme; }, [palette, theme]);
                await page.waitForTimeout(150);

                const layout = await page.locator('.transfer-pick').evaluate(el => { const [a, b] = [...el.querySelectorAll('label')].map(l => l.getBoundingClientRect()); const dialog = el.closest('[role=dialog]').getBoundingClientRect();

 return { sideBySide: Math.abs(a.top - b.top) < 2, stacked: b.top >= a.bottom, inside: a.left >= dialog.left && b.right <= dialog.right + 0.5 }; });

                assert(width > 600 ? layout.sideBySide : layout.stacked, `file and folder pickers at ${width}px`);
                assert(layout.inside, 'pickers stay inside the dialog');
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                const name = `dialog-${width}-${palette}-${theme}.png`;
                await page.screenshot({ path: resolve(output, name) });
                shots.push(name);
            }

    await page.setViewportSize({ width: 1280, height: 860 });
    await button('노트 4개 가져오기').click();
    await page.getByText('노트 4개를 가져왔습니다.').waitFor();
    await until(() => (data.notes || []).some(n => n.title === '항해 구상'), 'import saved');
    const nav = resolveNoteNavigation(data), node = id => nav.nodes.find(n => n.id === id), note = title => data.notes.find(n => n.title === title);
    const parentTitle = title => node(node(note(title).id).parentId).title;
    assert.equal(parentTitle('이서윤'), 'people');
    assert.equal(parentTitle('항해 구상'), 'drafts');
    assert.equal(parentTitle('memo'), 'drafts');
    assert.equal(parentTitle('구상'), 'vault');
    assert.equal(node(node(note('이서윤').id).parentId).parentId, node(note('구상').id).parentId, 'source folders sit inside the new import folder');
    const idea = JSON.stringify(note('구상').content);
    assert(idea.includes(`"targetId":"${note('이서윤').id}"`) && idea.includes('"noteImage"'));
    assert(JSON.stringify(note('항해 구상').content).includes('"bulletList"'));
    await page.keyboard.press('Escape');
    await page.locator('[data-navigation-row]', { hasText: /^구상/ }).first().click();
    await page.locator('.notes-workspace .manuscript .editor-wiki-link').first().waitFor();
    assert.equal(await page.locator('.notes-workspace .manuscript .editor-wiki-link').count(), 2);
    await page.locator('.notes-workspace .manuscript .note-image img').waitFor();
    await page.screenshot({ path: resolve(output, 'imported-vault.png') });

    // A vault with documents only in one subfolder must keep that subfolder.
    const singleVault = resolve(output, 'single-vault');
    await mkdir(resolve(singleVault, 'Characters'), { recursive: true });
    await writeFile(resolve(singleVault, 'Characters/A.md'), '# 인물 A\n인물 A 본문');
    await writeFile(resolve(singleVault, 'Characters/B.md'), '# 인물 B\n인물 B 본문');
    await openNoteImport();
    await page.getByLabel('가져올 노트 폴더').setInputFiles(singleVault);
    await page.getByText('노트 2개 · 첨부 0개').waitFor();
    await button('노트 2개 가져오기').click();
    await page.getByText('노트 2개를 가져왔습니다.').waitFor();
    await until(() => data.notes.some(n => n.title === '인물 A'), 'single subfolder saved');
    const singleNav = resolveNoteNavigation(data), person = note('인물 A');
    const characterFolder = singleNav.nodes.find(n => n.id === singleNav.nodes.find(n => n.id === person.id).parentId);
    assert.equal(characterFolder.title, 'Characters');
    assert.equal(singleNav.nodes.find(n => n.id === characterFolder.parentId).title, 'single-vault');
    await page.keyboard.press('Escape');

    // Import, open and reload a table whose middle row is entirely covered by a vertical merge.
    const merged = new JSZip();
    merged.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>위 병합</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>마지막 칸</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
    await openNoteImport();
    await page.getByLabel('가져올 노트 파일').setInputFiles({ name: 'merged.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await merged.generateAsync({ type: 'nodebuffer' }) });
    await page.getByText('노트 1개 · 첨부 0개').waitFor();
    await button('노트 1개 가져오기').click();
    await page.getByText('노트 1개를 가져왔습니다.').waitFor();
    await until(() => data.notes.some(n => n.title === 'merged'), 'merged table saved');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/studio#notes/${note('merged').id}`, { waitUntil: 'domcontentloaded' });
    await body.locator('table').waitFor();
    assert.equal(await body.locator('table tr').count(), 3);
    assert.equal(await body.locator('table tr').nth(1).locator('td').count(), 0);
    assert.equal(await body.locator('table tr').nth(2).innerText(), '마지막 칸');

    const geometry = await body.locator('table').evaluate(table => {
        const first = table.rows[0].cells[0].getBoundingClientRect(), last = table.rows[2].cells[0].getBoundingClientRect();

        return { sameColumn: Math.abs(first.left - last.left) < 1, sameWidth: Math.abs(first.width - last.width) < 1 };
    });

    assert.deepEqual(geometry, { sameColumn: true, sameWidth: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await body.locator('table').waitFor();
    assert.equal(await body.locator('table tr').count(), 3);

    // A .scrivx at the ZIP root must not swallow a separately selected Markdown document.
    const project = new JSZip();
    project.file('Novel.scrivx', '<ScrivenerProject><Binder><BinderItem UUID="S1" Type="Text"><Title>합성 장면</Title></BinderItem></Binder></ScrivenerProject>');
    project.file('Files/Data/S1/content.rtf', '{\\rtf1 Scene body}');
    await openNoteImport();
    await page.getByLabel('가져올 노트 파일').setInputFiles([
        { name: 'Novel.zip', mimeType: 'application/zip', buffer: await project.generateAsync({ type: 'nodebuffer' }) },
        { name: 'Other.md', mimeType: 'text/markdown', buffer: Buffer.from('# 별도 문서\n함께 선택한 본문') },
    ]);
    await page.getByText('노트 2개 · 첨부 0개').waitFor();
    await button('노트 2개 가져오기').click();
    await page.getByText('노트 2개를 가져왔습니다.').waitFor();
    await until(() => data.notes.some(n => n.title === '별도 문서'), 'separate Markdown saved');
    assert(data.notes.some(n => n.title === '합성 장면'));
    await page.keyboard.press('Escape');
    await page.goto(`${base}/studio#notes/${note('별도 문서').id}`, { waitUntil: 'domcontentloaded' });
    await body.getByText('함께 선택한 본문', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await body.getByText('함께 선택한 본문', { exact: true }).waitFor();

    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    const result = { environment: 'isolated Chromium synthetic author and Supabase responses', base, notes: data.notes.length, saves, screenshots: shots.length + 1, regressions: ['single subfolder retained', 'merged table three rows and one column after reload', 'Scrivener ZIP and separate Markdown both saved'], errors };
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
