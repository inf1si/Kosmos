// Run through tsx; see docs/settings.md for the browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, workspaceSchema } from '../../src/lib/model.ts';
import { addNote, newNote } from '../../src/lib/personal-notes.ts';
import { trashNote } from '../../src/lib/workspace-trash.ts';
import { prepareTemplate } from '../../src/lib/workspace-templates.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/settings-navigation');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const note = { ...newNote(), title: '선택한 노트', content: fromText('노트 원문') };

const deleted = { ...newNote(), title: '삭제한 합성 노트' };

let data = trashNote(addNote(addNote(seedWorkspace(), note), deleted), deleted.id);

const work = data.works[0], scene = work.documents[0];

data = prepareTemplate(data, { scope: 'work', workId: work.id }, [scene.id], '합성 문서 템플릿').state;

data = prepareTemplate(data, { scope: 'notes' }, [note.id], '합성 노트 템플릿').state;

const originalContent = JSON.stringify(scene.content);

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-11T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

await context.addInitScript(() => localStorage.setItem('kosmos-app-preferences', JSON.stringify({ studioStart: 'last' })));

await context.addInitScript(({ profile, token, key }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile })), { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });

let version = 1, saves = 0;

const errors = [], layouts = [], flows = [];

await context.route('**/*.supabase.co/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value = {};

    if (path.includes('/auth/v1/user')) value = profile;
    else if (path.endsWith('/authors')) value = { user_id: profile.id };
    else if (path.endsWith('/workspaces')) value = { id: data.id, payload: data, version };
    else if (path.endsWith('/workspace_revisions')) value = [];
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

if (context.routeWebSocket) await context.routeWebSocket('**/realtime/**', ws => ws.close());

const page = await context.newPage();

page.setDefaultTimeout(20000);

page.on('pageerror', error => errors.push(error.message));

const settings = () => page.getByRole('dialog', { name: '설정', exact: true });

const tools = () => page.locator('.notes-workspace').count().then(count => page.locator(count ? '.notes-tools' : '.studio-tools'));

const children = [['backup', '백업과 복구', '백업과 복구'], ['interchange', '가져오기 · 내보내기', '문서 가져오기 · 내보내기'], ['template', '템플릿', '템플릿'], ['trash', '휴지통', '휴지통'], ['note-import', '노트 가져오기', '노트 가져오기']];

async function focused(locator) {
    try { await page.waitForFunction(el => el === document.activeElement, await locator.elementHandle()); }
    catch (error) { console.error(await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.slice(0,80) }))); throw error; }
}

async function openSettings() {
    const nav = await tools();

    if (!(await nav.isVisible())) await page.getByRole('button', { name: '사이드바 열기', exact: true }).click();
    await nav.getByRole('button', { name: '설정', exact: true }).click();
    await settings().getByRole('button', { name: '저장 · 백업', exact: true }).click();
}

async function child([id, label, title]) {
    await settings().getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await dialog.waitFor();
    assert.equal(await settings().count(), 0, `${id}: no hidden parent modal`);
    assert.equal(await page.locator('.modal[role="dialog"]').count(), 1, `${id}: one active modal`);
    assert.equal(await dialog.getByRole('button', { name: '설정으로 돌아가기', exact: true }).count(), 1, `${id}: return path`);

    return dialog;
}

async function back(dialog, [id, label]) {
    await dialog.getByRole('button', { name: '설정으로 돌아가기', exact: true }).click();
    await settings().waitFor();
    assert.equal(await settings().getByRole('button', { name: '저장 · 백업', exact: true }).getAttribute('aria-pressed'), 'true', `${id}: return to data section`);
    assert.equal(await settings().getByRole('combobox', { name: '자동 복구 지점 간격' }).inputValue(), '5', `${id}: keep chosen value`);
    await focused(settings().getByRole('button', { name: label, exact: true }));
    assert.equal(await page.locator('.modal[role="dialog"]').count(), 1, `${id}: child dismissed`);
}

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ProseMirror').first().waitFor();
    await openSettings();
    await settings().getByRole('combobox', { name: '자동 복구 지점 간격' }).selectOption('5');

    for (const item of children) {
        const dialog = await child(item);

        if (item[0] === 'template') assert.match(await dialog.getByRole('combobox', { name: '저장한 템플릿' }).innerText(), /합성 문서 템플릿/);
        await back(dialog, item);
        assert.equal(await page.locator('.notes-workspace').count(), 0, `${item[0]}: studio origin preserved`);
        flows.push(`studio-${item[0]}`);
    }

    await page.keyboard.press('Escape');
    await focused(page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }));
    assert.equal(await page.locator('.modal[role="dialog"]').count(), 0);

    // Direct entry has no settings parent, even after returning from settings.
    await page.locator('.studio-tools').getByRole('button', { name: /휴지통/ }).click();
    const directTrash = page.getByRole('dialog', { name: '휴지통', exact: true });
    await directTrash.waitFor();
    assert.equal(await directTrash.getByRole('button', { name: '설정으로 돌아가기' }).count(), 0);
    await page.keyboard.press('Escape');
    await focused(page.locator('.studio-tools').getByRole('button', { name: /휴지통/ }));
    await page.locator(`[data-navigation-row="${scene.id}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '템플릿으로 저장', exact: true }).click();
    const directTemplate = page.getByRole('dialog', { name: '템플릿', exact: true });
    await directTemplate.waitFor();
    assert.equal(await directTemplate.getByRole('button', { name: '설정으로 돌아가기' }).count(), 0);
    await page.keyboard.press('Escape');
    await directTemplate.waitFor({ state: 'detached' });

    // Notes retain the selected note, and templates keep the correct scope.
    await page.locator('.notes-mode').getByRole('button', { name: '노트', exact: true }).click();
    await page.locator(`[data-navigation-row="${note.id}"]`).getByRole('button', { name: '선택한 노트', exact: true }).click();
    await openSettings();

    for (const item of children) {
        const dialog = await child(item);

        if (item[0] === 'template') assert.match(await dialog.getByRole('combobox', { name: '저장한 템플릿' }).innerText(), /합성 노트 템플릿/);
        await back(dialog, item);
        assert.equal(new URL(page.url()).hash, `#notes/${note.id}`);
        flows.push(`notes-${item[0]}`);
    }

    // Cancel a nested destructive confirmation before returning to settings.
    const trashItem = children.find(item => item[0] === 'trash');
    const trash = await child(trashItem);
    await trash.getByRole('button', { name: '삭제한 합성 노트 영구 삭제' }).click();
    await page.getByRole('dialog', { name: '영구 삭제', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: '휴지통', exact: true, includeHidden: true }).getByRole('button', { name: '설정으로 돌아가기', includeHidden: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '영구 삭제', exact: true }).waitFor({ state: 'detached' });
    await back(trash, trashItem);
    assert.equal(data.trash.length, 1);

    // Back cancels file preparation; an in-flight import must finish first.
    const importItem = children.find(item => item[0] === 'note-import');
    let importer = await child(importItem);
    await importer.getByLabel('가져올 노트 파일', { exact: true }).setInputFiles({ name: '합성.md', mimeType: 'text/markdown', buffer: Buffer.from('가져올 노트 본문') });
    await importer.getByRole('textbox', { name: '가져올 폴더 이름' }).fill('아직 저장하지 않은 폴더');
    await back(importer, importItem);
    assert.equal(data.notes.length, 1);
    importer = await child(importItem);
    assert.equal(await importer.getByRole('textbox', { name: '가져올 폴더 이름' }).count(), 0, 'back discards prepared import');
    // Hold actual file reading so the busy state is observable even on fast machines.
    await page.evaluate(() => {
        const read = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function() {
            await new Promise(resolve => { window.kosmosReleaseFile = resolve; });
            File.prototype.arrayBuffer = read;

            return read.call(this);
        };
    });
    await importer.getByLabel('가져올 노트 파일', { exact: true }).setInputFiles({ name: '합성.md', mimeType: 'text/markdown', buffer: Buffer.from('가져올 노트 본문') });
    await page.waitForFunction(() => !!window.kosmosReleaseFile);
    assert.equal(await importer.getByRole('button', { name: '설정으로 돌아가기' }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await importer.isVisible(), true, 'busy file processing remains open');
    await page.evaluate(() => { window.kosmosReleaseFile(); delete window.kosmosReleaseFile; });
    const savedImport = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/save_workspace'));
    await importer.getByRole('button', { name: '노트 1개 가져오기', exact: true }).click();
    await importer.getByRole('status').filter({ hasText: '노트 1개를 가져왔습니다.' }).waitFor();
    await back(importer, importItem);
    await savedImport;
    assert.equal(data.notes.length, 2);
    assert.equal(saves, 1);
    assert.equal(JSON.stringify(data.works[0].documents[0].content), originalContent);

    // Close and Escape exit the child instead of unexpectedly reopening settings.
    for (const [index, item] of children.entries()) {
        const dialog = await child(item);

        if (index % 2) await dialog.getByRole('button', { name: '닫기', exact: true }).click();
        else await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await settings().count(), 0);
        await focused(page.locator('.notes-tools').getByRole('button', { name: '설정', exact: true }));
        await openSettings();
    }

    await page.keyboard.press('Escape');
    await page.locator('.notes-mode').getByRole('button', { name: '집필실', exact: true }).click();

    // Actual consecutive navigation in every palette/mode and narrow layout.
    for (const width of [1280, 360]) for (const palette of ['violet', 'cassette', 'cyber']) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
        await page.waitForTimeout(150);
        await page.evaluate(({ palette, theme }) => { localStorage.setItem('orbis-palette', palette); localStorage.setItem('orbis-theme', theme); document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = theme; }, { palette, theme });
        await openSettings();

        for (const item of children) {
            const dialog = await child(item), heading = dialog.locator('.modal-heading');
            const box = await dialog.boundingBox();
            assert(box.x >= 0 && box.x + box.width <= width + 1);
            assert.equal(await heading.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${item[0]} heading overflow`);
            const backButton = await heading.getByRole('button', { name: '설정으로 돌아가기' }).boundingBox();
            const closeButton = await heading.getByRole('button', { name: '닫기' }).boundingBox();
            assert(backButton.x + backButton.width < closeButton.x, 'back and close do not overlap');
            const label = `${item[0]}-${palette}-${theme}-${width}`;
            await page.screenshot({ path: resolve(output, `${label}.png`) });
            layouts.push(label);
            await back(dialog, item);
        }

        await page.keyboard.press('Escape');
        await settings().waitFor({ state: 'detached' });
    }

    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'summary.json'), JSON.stringify({ flows, layouts, saves, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, flows: flows.length, layouts: layouts.length, saves, errors }));
} catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    throw error;
} finally { await browser.close(); }
