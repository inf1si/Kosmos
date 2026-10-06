// Run through tsx; see docs/personal-notes.md for browser/module configuration.
// Covers the notes home/board, checklist and in-body image, note links and backlinks, ENEX import and folder → work.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
import { applyNoteNavigation, resolveNoteNavigation } from '../../src/lib/note-navigation.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';
const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/note-ideation');
await mkdir(output, { recursive: true });
function png(width, height, rgb) {
    const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => rgb).flat()])));
    const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const picture = png(120, 60, [120, 90, 200]), market = png(80, 40, [60, 160, 120]);
const enex = `<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>등불 시장 메모</title><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><en-note><div>시장 입구에는 등불 장수가 있다.</div><div><en-todo checked="true"/>지도 그리기</div><div><en-todo/>상인 이름 정하기</div><div><en-media type="image/png" hash="${createHash('md5').update(market).digest('hex')}"/></div></en-note>]]></content><created>20250302T091500Z</created><updated>20250410T120000Z</updated><tag>세계관</tag><tag>시장</tag><resource><data encoding="base64">${market.toString('base64')}</data><mime>image/png</mime><resource-attributes><file-name>market.png</file-name></resource-attributes></resource></note><note><title>두 번째 메모</title><content><![CDATA[<en-note><div>짧은 메모</div></en-note>]]></content><created>20240105T000000Z</created></note></en-export>`;
let data = seedWorkspace();
const make = (title, body, extra = {}) => { const note = { ...newNote(), title, content: fromText(body), ...extra }; data = addNote(data, note); return note; };
const city = make('달 아래 도시', '도시는 달의 위상에 따라 구역이 열린다.', { tags: ['세계관'] });
const motive = make('주인공 동기', '왜 떠나는가?');
const ending = make('엔딩 아이디어', '마지막 장면은 비가 그친 뒤의 시장.');
const loose = make('지하철 관찰', '우산 두 개를 든 노인');
const folder = uid(), nav = resolveNoteNavigation(data);
nav.nodes = [{ id: folder, type: 'folder', title: '작품 구상', parentId: null }, ...nav.nodes.map(n => [city.id, motive.id, ending.id].includes(n.id) ? { ...n, parentId: folder } : n)];
data = applyNoteNavigation(data, nav);
let version = 1, saves = 0;
const errors = [], profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-04T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;
const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// Older checks start in the editor; the studio home has its own check (studio-home.mjs).
await context.addInitScript(() => { try { const key = 'kosmos-app-preferences', value = JSON.parse(localStorage.getItem(key) || '{}'); if (!('studioStart' in value)) localStorage.setItem(key, JSON.stringify({ ...value, studioStart: 'last' })); } catch { /* Storage blocked: the test sees the home and fails loudly. */ } });
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
const saved = id => data.notes.find(n => n.id === id);
try {
    // No note in the address opens the notes home; the board has one column per top-level folder.
    await page.goto(`${base}/studio#notes`, { waitUntil: 'domcontentloaded' });
    await page.locator('.notes-home').waitFor();
    await page.getByRole('group', { name: '노트 첫 화면 보기' }).getByRole('button', { name: '보드' }).click();
    const column = page.locator('.board-column', { hasText: '작품 구상' });
    assert.equal(await column.locator('.note-board-card').count(), 3);
    await page.locator('.note-board-card', { hasText: '지하철 관찰' }).dragTo(column);
    await until(() => resolveNoteNavigation(data).nodes.find(n => n.id === loose.id)?.parentId === folder, 'board drag moves the note into the folder');
    await page.screenshot({ path: resolve(output, 'board.png') });
    // Checklist and in-body image belong to notes only.
    await page.locator('.note-board-card', { hasText: '엔딩 아이디어' }).click();
    await body.waitFor();
    await body.locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await button('체크리스트').click();
    await page.keyboard.type('시장 지도 그리기');
    await body.locator('ul[data-type=taskList] input[type=checkbox]').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button('본문에 이미지 넣기').click()]);
    await chooser.setFiles({ name: 'picture.png', mimeType: 'image/png', buffer: picture });
    await body.locator('.note-image img').waitFor();
    await until(() => { const json = JSON.stringify(saved(ending.id).content); return json.includes('"checked":true') && json.includes('"noteImage"'); }, 'checklist and image saved');
    assert.equal(saved(ending.id).assetIds.length, 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await body.locator('.note-image img').waitFor();
    assert(await body.locator('.note-image img').evaluate(img => img.naturalWidth === 120), 'The private image loads from this device after reload');
    await page.screenshot({ path: resolve(output, 'checklist-image.png') });
    // A note link shows up as outgoing here and as a backlink on the target.
    await body.locator('p').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await button('노트 링크 추가').click();
    await page.getByRole('combobox', { name: '연결할 노트' }).selectOption({ label: '달 아래 도시' });
    await button('연결').click();
    await page.locator('#note-links-toggle').click();
    const panel = page.getByRole('complementary', { name: '노트 참고 패널' });
    await panel.getByRole('button', { name: /달 아래 도시/ }).click();
    await page.locator('.notes-workspace .doc-tab', { hasText: '달 아래 도시' }).waitFor();
    await panel.getByRole('button', { name: /엔딩 아이디어/ }).waitFor();
    await page.screenshot({ path: resolve(output, 'backlink.png') });
    // Evernote ENEX becomes inbox notes in a new folder, keeping tags, dates, checkboxes and images.
    await button('노트 가져오기').click();
    await page.getByLabel('가져올 노트 파일').setInputFiles({ name: 'ideas.enex', mimeType: 'application/xml', buffer: Buffer.from(enex) });
    await page.getByText('노트 2개 · 첨부 1개').waitFor();
    await button('노트 2개 가져오기').click();
    await page.getByText('노트 2개를 가져왔습니다.').waitFor();
    await until(() => data.notes.some(n => n.title === '등불 시장 메모'), 'import saved');
    const imported = data.notes.find(n => n.title === '등불 시장 메모'), importedJson = JSON.stringify(imported.content);
    assert.deepEqual(imported.tags, ['세계관', '시장']);
    assert.equal(imported.updatedAt, '2025-04-10T12:00:00.000Z');
    assert(importedJson.includes('"checked":true') && importedJson.includes('지도 그리기') && importedJson.includes('"noteImage"'));
    await page.keyboard.press('Escape');
    await page.locator('[data-navigation-row]', { hasText: '등불 시장 메모' }).first().click();
    await body.locator('.note-image img').waitFor();
    await page.waitForTimeout(1200);
    assert.equal(data.notes.find(n => n.id === imported.id).updatedAt, '2025-04-10T12:00:00.000Z', 'Opening an imported note keeps its date');
    // A folder becomes a new work; notes stay and gain the link.
    const row = page.locator('[data-navigation-row]', { hasText: '작품 구상' }).first();
    await row.hover();
    await row.locator('[data-row-menu]').click();
    await page.getByRole('menuitem', { name: '새 작품으로 만들기' }).click();
    await page.getByLabel('새 작품 제목').fill('달 아래 도시');
    await button('작품 만들기').click();
    await page.locator('.studio-panel .manuscript').first().waitFor();
    await until(() => data.works.some(w => w.title === '달 아래 도시'), 'work saved');
    const work = data.works.find(w => w.title === '달 아래 도시');
    assert.equal(work.documents.length, 4);
    assert(work.documents.every(d => d.kind === 'memo'));
    assert(!JSON.stringify(work.documents).includes('"taskList"') && !JSON.stringify(work.documents).includes('"noteImage"'));
    assert(saved(city.id).linkedWorkIds.includes(work.id));
    for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(300);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
    const result = { environment: 'isolated Chromium synthetic author and Supabase responses', base, notes: data.notes.length, works: data.works.length, saves, errors };
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
