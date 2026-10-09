// Run through tsx with the browser/module configuration in docs/personal-notes.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applyNavigation, resolveNavigation } from '../../src/lib/document-navigation.ts';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { fromText, newDocument, uid, workspaceSchema } from '../../src/lib/model.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/author-profile');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: false });

let data = seedWorkspace(), version = 1;

data.works[0].title = '작업 중인 작품';

data.works[1].title = '보관할 작품';

const document = newDocument('scene', '합성 문서');

document.content = fromText('다른 책장으로 옮겨도 보존할 합성 원고.');

data.works.push({ id: uid(), title: '긴 제목의 작품 '.repeat(10), subtitle: '', description: '', form: '단편', documents: [document], publications: [], activePublicationId: null });

data.works = data.works.map(work => applyNavigation(work, resolveNavigation(work)));

const original = structuredClone(data), errors = [], layouts = [], saveRequests = [], unexpectedWrites = [];

const profile = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', created_at: '2026-10-08T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.synthetic-signature`;

await context.addInitScript(({ profile, token, key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: profile }));
    localStorage.setItem('kosmos-app-preferences', JSON.stringify({ studioStart: 'home' }));
}, { profile, token, key: process.env.KOSMOS_TEST_AUTH_STORAGE_KEY || 'sb-krakjollsufgnwealroh-auth-token' });


const pg = new PGlite();

await pg.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
create table public.authors(user_id uuid primary key);insert into public.authors values('${profile.id}');
alter table public.authors enable row level security;
create policy author_self on public.authors for select to authenticated using(user_id=auth.uid());grant select on public.authors to authenticated;`);

await pg.exec(readFileSync(new URL('../../supabase/migrations/20261009121112_author_profile.sql', import.meta.url), 'utf8'));

let failPublish = false, profileWrites = 0, profileQueue = Promise.resolve();

async function profileRoute(route) {
    const request = route.request(), authenticated = request.headers().authorization === `Bearer ${token}`;

    const job = profileQueue.then(async () => {
        try {
            await pg.exec('reset role');
            await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [authenticated ? profile.id : '']);
            await pg.exec(`set role ${authenticated ? 'authenticated' : 'anon'}`);
            let value = null;

            if (request.method() === 'POST') {
                if (failPublish) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic offline"}' });

 return; }

                const input = request.postDataJSON();
                assert.deepEqual(Object.keys(input).sort(), ['bio', 'id', 'name', 'published_at']);
                value = (await pg.query('insert into author_profile(id,name,bio,published_at) values(true,$1,$2,$3) on conflict(id) do update set name=excluded.name,bio=excluded.bio,published_at=excluded.published_at returning name,bio,published_at', [input.name, input.bio, input.published_at])).rows[0];
                profileWrites++;
            } else if (request.method() === 'DELETE') { await pg.query('delete from author_profile where id=true'); profileWrites++; }
            else value = (await pg.query('select name,bio,published_at from author_profile where id=true')).rows[0] || null;

            if (value) value = { ...value, published_at: new Date(value.published_at).toISOString().replace('Z', '+00:00') };
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
        } finally { await pg.exec('reset role'); }
    });

    profileQueue = job.catch(() => {});

    return job;
}

await context.route('**/*.supabase.co/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value = {};

    if (path.endsWith('/author_profile')) { await profileRoute(route);

 return; }

    if (path.includes('/auth/v1/user')) value = profile;
    else if (path.endsWith('/authors')) value = { user_id: profile.id };
    else if (path.endsWith('/workspaces')) value = { id: data.id, payload: data, version };
    else if (path.endsWith('/save_workspace')) {
        const input = request.postDataJSON();
        saveRequests.push(input);

        assert.equal(input.p_base_version, version);
        data = workspaceSchema.parse(input.p_payload);
        value = { status: 'saved', version: ++version };
    } else if (request.method() !== 'GET') unexpectedWrites.push(path);

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});

await context.route('**/api/backup/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"connected":false,"configured":false}' }));

await context.route('**/api/ai/**', route => route.abort());

if (context.routeWebSocket) await context.routeWebSocket('**/realtime/**', ws => ws.close());

const page = await context.newPage();

page.setDefaultTimeout(15000);

page.on('pageerror', error => errors.push(error.message));



const reader = await browser.newContext({ viewport: { width: 1280, height: 900 } });

await reader.route('**/*.supabase.co/**', async route => {
    assert(new URL(route.request().url()).pathname.endsWith('/author_profile'), 'public page only requests the published profile');
    assert.equal(route.request().method(), 'GET');
    await profileRoute(route);
});

const publicPage = await reader.newPage();

publicPage.on('pageerror', error => errors.push(error.message));

const dialog = () => page.getByRole('dialog', { name: '설정', exact: true });

const settings = async () => {
    await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
    await dialog().locator('.settings-nav').getByRole('button', { name: '자기소개', exact: true }).click();
    await dialog().getByText('공개된 자기소개가 없습니다.', { exact: true }).waitFor();
};

const until = async (check, label) => {
    for (let i = 0; i < 150; i++) { if (await check()) return; await page.waitForTimeout(100); }

    throw new Error(`Timed out: ${label}`);
};

async function localDraft() {
    return page.evaluate(namespace => new Promise((resolve, reject) => {
        const request = indexedDB.open('orbit-novel-studio-v1');
        request.onsuccess = () => { const db = request.result, tx = db.transaction('workspaces', 'readonly'), get = tx.objectStore('workspaces').get(namespace); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close(); };

        request.onerror = () => reject(request.error);
    }), `author:${profile.id}`);
}

async function capture(target, name, palette, mode, width) {
    await target.setViewportSize({ width, height: 900 });
    await target.evaluate(({ palette, mode }) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = mode; }, { palette, mode });
    await target.evaluate(() => document.fonts.ready);
    const sizes = await target.evaluate(() => ({ w: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert(sizes.html <= sizes.w && sizes.body <= sizes.w, `${name} ${palette} ${mode} ${width} overflow`);
    await target.screenshot({ path: `${output}/${name}-${palette}-${mode}-${width}.png`, fullPage: false });
    layouts.push({ name, palette, mode, width });
}

try {
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.studio-home').waitFor();
    await settings();
    const publish = () => dialog().getByRole('button', { name: '자기소개 공개', exact: true });
    assert.equal(await publish().isDisabled(), true);
    const draft = { name: '합성 필명', bio: '개인 소개의 **첫 문단**.\n같은 문단의 다음 줄.\n\n둘째 문단입니다. <script>window.profileInjected=true</script>\n' + '긴글'.repeat(150) + '\n\n- 첫 목록\n- [둘째 링크](https://example.com/profile)\n\n> 인용한 문장\n\n[나쁜 링크](javascript:window.profileInjected=true)' };
    await dialog().getByLabel('이름 · 필명', { exact: true }).fill(draft.name);
    await dialog().getByLabel('소개', { exact: true }).fill(draft.bio);
    await until(async () => { const record = await localDraft();

 return record && !record.dirty && record.data.authorProfile?.bio === draft.bio; }, 'private draft synced');
    assert.deepEqual(data.authorProfile, draft);
    await publicPage.goto(`${base}/about`, { waitUntil: 'domcontentloaded' });
    await publicPage.getByText('아직 자기소개를 등록하지 않았습니다.', { exact: true }).waitFor();
    assert.equal(profileWrites, 0, 'typing never publishes');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.studio-home').waitFor();await settings();
    assert.equal(await dialog().getByLabel('소개', { exact: true }).inputValue(), draft.bio);

    for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) await capture(page, 'draft', palette, mode, width);

    // The settings pane scrolls, so it clips anything outside its box: the focus ring must fit inside it.
    for (const width of [1280, 360]) for (const label of ['이름 · 필명', '소개']) {
        await page.setViewportSize({ width, height: 900 });
        const field = dialog().getByLabel(label, { exact: true });

        await field.focus();

        const ring = await field.evaluate(node => {
            const style = getComputedStyle(node), pane = node.closest('.settings-body'), box = node.getBoundingClientRect(), clip = pane.getBoundingClientRect();
            const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);

            return { style: style.outlineStyle, left: box.left - reach - clip.left, right: clip.left + pane.clientWidth - (box.right + reach) };
        });

        assert.equal(ring.style, 'solid', `${label} focus ring at ${width}`);
        assert(ring.left >= 0 && ring.right >= 0, `${label} focus ring clipped at ${width}: ${JSON.stringify(ring)}`);

        if (label === '소개') for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) await capture(page, 'focus', palette, mode, width);
    }

    // Every settings section shares the same scrolling pane; check each field's ring there too, then come back.
    for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 900 });
        const sections = dialog().locator('.settings-nav .nav-item');

        for (let index = 0; index < await sections.count(); index++) {
            await sections.nth(index).click();
            const fields = dialog().locator('.settings-body').locator('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), textarea, select');

            for (let field = 0; field < await fields.count(); field++) {
                const target = fields.nth(field);

                if (!await target.isVisible() || await target.isDisabled()) continue;
                await target.focus();

                const ring = await target.evaluate(node => {
                    const style = getComputedStyle(node), pane = node.closest('.settings-body'), box = node.getBoundingClientRect(), clip = pane.getBoundingClientRect();
                    const reach = style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);

                    return { left: box.left - reach - clip.left, right: clip.left + pane.clientWidth - (box.right + reach), name: node.getAttribute('aria-label') || node.id || node.tagName };
                });

                assert(ring.left >= 0 && ring.right >= 0, `focus ring clipped in section ${index} at ${width}: ${JSON.stringify(ring)}`);
            }
        }

        await dialog().getByRole('button', { name: '자기소개', exact: true }).click();
    }

    failPublish = true;await publish().click();
    await dialog().getByRole('alert').waitFor();
    assert.equal(profileWrites, 0);assert.equal(await dialog().getByLabel('소개', { exact: true }).inputValue(), draft.bio);
    failPublish = false;await publish().click();
    await dialog().getByText(/^공개된 내용과 같습니다 · \d{4}\. \d{1,2}\. \d{1,2}\. 공개$/).waitFor();
    assert.equal(profileWrites, 1);
    assert.equal(await dialog().getByRole('button', { name: '공개 내용 갱신', exact: true }).isDisabled(), true);
    await publicPage.reload({ waitUntil: 'domcontentloaded' });
    await publicPage.getByRole('heading', { name: draft.name, exact: true }).waitFor();
    assert.equal(await publicPage.evaluate(() => window.profileInjected), undefined);
    assert.match(await publicPage.getByRole('region', { name: '개인 소개' }).innerText(), /<script>/);
    const bio = publicPage.getByRole('region', { name: '개인 소개' });

    assert.equal(await bio.locator('strong').innerText(), '첫 문단');
    assert.equal(await bio.locator('p').first().locator('br').count(), 1, 'single line break kept');
    assert.deepEqual(await bio.locator('ul > li').allInnerTexts(), ['첫 목록', '둘째 링크']);
    assert.equal(await bio.getByRole('link', { name: '둘째 링크' }).getAttribute('rel'), 'nofollow noopener noreferrer');
    assert.equal(await bio.locator('blockquote').innerText(), '인용한 문장');
    assert.equal(await bio.locator('ul').evaluate(n => getComputedStyle(n).listStyleType), 'disc', 'list markers visible');
    assert.equal(await bio.locator('a[href^="javascript"], script').count(), 0);
    assert.match(await bio.innerText(), /\[나쁜 링크\]\(javascript:/);

    for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        await capture(page, 'published-settings', palette, mode, width);
        await capture(publicPage, 'published-page', palette, mode, width);
    }

    const changed = draft.bio + '\n\n아직 공개하지 않은 수정.';
    await dialog().getByLabel('소개', { exact: true }).fill(changed);
    await dialog().getByText(/^공개된 소개와 다른 초안입니다 · \d{4}\. \d{1,2}\. \d{1,2}\. 공개$/).waitFor();
    await publicPage.reload({ waitUntil: 'domcontentloaded' });
    await publicPage.getByRole('heading', { name: draft.name, exact: true }).waitFor();
    assert.equal((await publicPage.locator('main').innerText()).includes('아직 공개하지 않은 수정.'), false);
    await dialog().getByRole('button', { name: '공개 내용 갱신', exact: true }).click();
    await dialog().getByText(/^공개된 내용과 같습니다 · \d{4}\. \d{1,2}\. \d{1,2}\. 공개$/).waitFor();
    await publicPage.reload({ waitUntil: 'domcontentloaded' });
    await publicPage.getByText('아직 공개하지 않은 수정.', { exact: false }).waitFor();
    const confirmBox = () => dialog().getByRole('group', { name: '공개 취소 확인' });
    await dialog().getByRole('button', { name: '공개 취소', exact: true }).click();
    await confirmBox().getByText('초안은 남아 다시 공개할 수 있습니다.', { exact: false }).waitFor();
    assert.equal(await confirmBox().getByRole('button', { name: '그대로 두기' }).evaluate(n => n === document.activeElement), true, 'keep focused by default');
    await confirmBox().getByRole('button', { name: '그대로 두기' }).click();
    assert.equal(await confirmBox().count(), 0);
    await dialog().getByText(/^공개된 내용과 같습니다 · /).waitFor();
    await publicPage.reload({ waitUntil: 'domcontentloaded' });
    await publicPage.getByText('아직 공개하지 않은 수정.', { exact: false }).waitFor();
    await dialog().getByLabel('소개', { exact: true }).fill(changed + ' 더 고친 초안');

    for (const width of [1280, 360]) {
        // Open the confirmation at each width so the pane scrolls as it would for a reader of that width.
        await page.setViewportSize({ width, height: 900 });

        if (await confirmBox().count()) await confirmBox().getByRole('button', { name: '그대로 두기' }).click();
        await dialog().evaluate(node => { node.querySelector('.settings-body').scrollTop = 0; });
        await dialog().getByRole('button', { name: '공개 취소', exact: true }).click();
        await confirmBox().getByText('지금 공개된 글은 되살릴 수 없습니다.', { exact: false }).waitFor();
        await until(async () => confirmBox().evaluate(box => { const clip = box.closest('.modal').getBoundingClientRect(), pane = box.closest('.settings-body').getBoundingClientRect(), b = box.getBoundingClientRect();

 return b.bottom <= Math.min(clip.bottom, pane.bottom) + 1 && b.top >= Math.max(clip.top, pane.top) - 1; }), `confirmation scrolled into view at ${width}`);

        for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) await capture(page, 'withdraw-confirm', palette, mode, width);
    }

    await dialog().getByLabel('소개', { exact: true }).fill(changed);
    await confirmBox().getByText('초안은 남아 다시 공개할 수 있습니다.', { exact: false }).waitFor();
    await confirmBox().getByRole('button', { name: '공개 취소', exact: true }).click();
    await dialog().getByText('공개된 자기소개가 없습니다.', { exact: true }).waitFor();
    assert.equal(await confirmBox().count(), 0);
    assert.equal(await dialog().getByLabel('소개', { exact: true }).inputValue(), changed);
    await publicPage.reload({ waitUntil: 'domcontentloaded' });
    await publicPage.getByText('아직 자기소개를 등록하지 않았습니다.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await until(async () => { const record = await localDraft();

 return record && !record.dirty && record.data.authorProfile?.bio === changed; }, 'updated draft remains');
    assert.deepEqual(data.works, original.works);
    await page.setViewportSize({ width: 1280, height: 900 });

    if (!await page.locator('.notes-mode').isVisible()) await page.getByRole('button', { name: '사이드바 열기', exact: true }).click();
    await page.locator('.notes-mode').getByRole('button', { name: '노트', exact: true }).click();
    await page.locator('.notes-workspace').waitFor();
    const notesSettings = page.locator('.notes-tools').getByRole('button', { name: '설정', exact: true });
    await notesSettings.click();
    await dialog().locator('.settings-nav').getByRole('button', { name: '자기소개', exact: true }).click();
    assert.equal(await dialog().getByLabel('소개', { exact: true }).inputValue(), changed);
    await page.keyboard.press('Escape');
    assert.equal(await notesSettings.evaluate(el => el === document.activeElement), true);
    await notesSettings.click();
    await dialog().locator('.settings-nav').getByRole('button', { name: '자기소개', exact: true }).click();

    for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) await capture(page, 'notes-settings', palette, mode, width);
    await page.keyboard.press('Escape');
    await publicPage.goto(base, { waitUntil: 'domcontentloaded' });
    const link = publicPage.locator('footer').getByRole('link', { name: 'About Me', exact: true });
    assert.equal(await link.getAttribute('href'), '/about');

    for (const palette of ['violet', 'cassette', 'cyber']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) await capture(publicPage, 'home-link', palette, mode, width);
    await link.click();await publicPage.getByRole('heading', { name: 'Who I Am', exact: true }).waitFor();
    assert.deepEqual(errors, []);assert.deepEqual(unexpectedWrites, []);
    await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, layouts, profileWrites, workspaceSaves: saveRequests.length, pageErrors: errors, unexpectedWrites }, null, 2));
    console.log(`PASS about: private draft, reload, failed publish/retry, publish/update/withdraw, anonymous page, escaped text, footer link; ${layouts.length} layouts, actual local SQL RLS`);
} catch (error) {
    await page.screenshot({ path: `${output}/failure.png` });
    await writeFile(`${output}/failure.txt`, await page.locator('body').innerText());
    throw error;
} finally { await browser.close();await pg.close(); }
