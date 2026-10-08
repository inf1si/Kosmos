// Run through tsx with the browser/module configuration in docs/personal-notes.md.
// The real save request runs through PostgreSQL; changing the guard must unblock the same queued request.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, uid, workspaceSchema } from '../../src/lib/model.ts';
import { applyNavigation, resolveNavigation } from '../../src/lib/document-navigation.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/untitled-trash-sync');

await mkdir(output, { recursive: true });

const pg = new PGlite();

const sql = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

await pg.exec('create role anon; create role authenticated; create table public.workspaces (id integer primary key, payload jsonb not null);');

await pg.exec(sql('20261007081500_work_trash_unpublish.sql').match(/create or replace function public.guard_workspace_trash[\s\S]*?end \$\$;/)[0]);

await pg.exec('create trigger preserve_workspace_trash before insert or update on public.workspaces for each row execute function public.guard_workspace_trash();');

let data = seedWorkspace(), version = 1;

const document = data.works[0].documents[0];

document.title = '';

document.content = fromText('제목 없는 합성 원고의 보존할 본문.');

document.customProperties = [{ id: uid(), name: '합성 속성', type: 'text', value: '보존할 값' }];

data = workspaceSchema.parse({ ...data, works: data.works.map(w => applyNavigation(w, resolveNavigation(w))), trash: [] });

const original = structuredClone(document);

await pg.query('insert into public.workspaces values (1,$1)', [JSON.stringify(data)]);

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-08T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

await context.addInitScript(({ profile, token, key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile }));
    localStorage.setItem('kosmos-app-preferences', JSON.stringify({ studioStart: 'last' }));
}, { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });

const attempts = [], errors = [], requests = new Map();

await context.route('**/*.supabase.co/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value = {};

    if (path.includes('/auth/v1/user')) value = profile;
    else if (path.endsWith('/authors')) value = { user_id: profile.id };
    else if (path.endsWith('/workspaces')) value = { id: data.id, payload: data, version };
    else if (path.endsWith('/save_workspace')) {
        const input = request.postDataJSON();
        attempts.push(input);

        if (requests.has(input.p_request_id)) value = requests.get(input.p_request_id);
        else {
            assert.equal(input.p_base_version, version);

            try {
                await pg.query('update public.workspaces set payload=$1 where id=1', [JSON.stringify(input.p_payload)]);
            } catch (error) {
                assert.equal(error.code, 'P0001');
                assert.equal(error.message, '휴지통 문서를 확인하세요.');
                await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: error.code, message: error.message }) });

                return;
            }

            data = workspaceSchema.parse((await pg.query('select payload from public.workspaces where id=1')).rows[0].payload);
            value = { status: 'saved', version: ++version };
            requests.set(input.p_request_id, value);
        }
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});

await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));

await context.route('**/api/ai/**', route => route.abort());

if (context.routeWebSocket) await context.routeWebSocket('**/realtime/**', ws => ws.close());

const page = await context.newPage();

page.setDefaultTimeout(30000);

page.on('pageerror', error => errors.push(error.message));

const stored = () => page.evaluate(namespace => new Promise((resolve, reject) => {
    const request = indexedDB.open('orbit-novel-studio-v1');
    request.onsuccess = () => {
        const db = request.result, tx = db.transaction('workspaces', 'readonly'), get = tx.objectStore('workspaces').get(namespace);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => db.close();
    };

    request.onerror = () => reject(request.error);
}), `author:${profile.id}`);

try {
    await page.goto(`${base}/studio`);
    await page.locator(`[data-navigation-row="${original.id}"]`).getByRole('button', { name: '제목 없음 메뉴', exact: true }).click();
    await page.getByRole('menuitem', { name: '휴지통으로 이동', exact: true }).click();
    await page.locator('.studio-error').filter({ hasText: '휴지통 문서를 확인하세요.' }).waitFor();

    const rejected = await stored();
    assert.equal(rejected.dirty, true);
    assert.deepEqual(rejected.data.trash.find(t => t.id === original.id).document, original);
    assert.equal(data.trash.length, 0);

    await pg.exec(sql('20261008055311_untitled_trash_documents.sql'));
    // Leave the editor open: its existing 12-second timer must retry without a refresh or queue reset.
    await page.waitForFunction(() => document.body.textContent.includes('클라우드 동기화됨'));
    await page.locator('.studio-error').waitFor({ state: 'hidden' });
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(attempts[1].p_request_id, rejected.pendingRequest.id);
    assert.deepEqual(data.trash.find(t => t.id === original.id).document, original);
    assert.equal((await stored()).dirty, false);
    assert.equal((await stored()).pendingRequest, undefined);

    await page.reload();
    await page.getByRole('button', { name: /^휴지통/ }).first().click();
    const row = page.locator(`.trash-row[data-trash-id="${original.id}"]`);
    await row.getByRole('button', { name: '복원', exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes('클라우드 동기화됨'));
    assert.deepEqual(data.works[0].documents.find(d => d.id === original.id), original);
    assert.equal(data.trash.length, 0);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator(`[data-navigation-row="${original.id}"]`).getByTitle('제목 없음', { exact: true }).click();
    await page.locator('.editor-panes > .editor-shell .manuscript').filter({ hasText: '제목 없는 합성 원고의 보존할 본문.' }).waitFor();
    assert.equal(await page.locator('.studio-error').count(), 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, 'restored.png') });
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, attempts: attempts.length, sameRequestRetried: true, restoredBlankTitle: true, errors }, null, 2));
    console.log('PASS PostgreSQL rejection → same queued request automatic retry → saved → reload → restore → reload; body and properties preserved');
} catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });

    throw error;
} finally {
    await browser.close();
    await pg.close();
}
