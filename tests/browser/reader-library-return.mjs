// Run against a local preview without Supabase settings; only synthetic IndexedDB data is written.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { seedWorkspace } from '../../src/lib/seed.ts';
import { PALETTES } from '../../src/lib/theme.ts';

const require = createRequire(import.meta.url);

const engine = process.env.KOSMOS_BROWSER_ENGINE || 'chromium';

const playwright = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || `test-results/reader-library-return/${engine}`);

const options = { headless: true };

if (engine === 'chromium') {
    options.executablePath = process.env.KOSMOS_CHROMIUM_PATH || undefined;
    options.args = ['--no-sandbox', '--disable-dev-shm-usage'];
}

await mkdir(output, { recursive: true });

const browser = await playwright[engine].launch(options);

const data = seedWorkspace(), template = data.works[0], errors = [];

data.works = Array.from({ length: 8 }, (_, i) => {
    const work = structuredClone(template), suffix = String(i + 1).padStart(12, '0');
    work.id = `20000000-0000-4000-8000-${suffix}`;
    work.title = `검증 작품 ${i + 1}`;
    const pub = work.publications[0];
    pub.id = `80000000-0000-4000-8000-${suffix}`; pub.workId = work.id; pub.title = work.title; pub.libraryPosition = i + 1;
    pub.scenes[0].content = { type: 'doc', content: Array.from({ length: 18 }, (_, j) => ({ type: 'paragraph', attrs: { blockId: `test-${j}` }, content: [{ type: 'text', text: '돌아온 사람은 다음 계절의 이야기를 읽었다. '.repeat(8) }] })) };
    work.activePublicationId = pub.id;

    return work;
});

const locationKey = 'kosmos-library-location';

const until = async (page, check, message) => {
    for (let i = 0; i < 80; i++) {
        if (await check()) return;
        await page.waitForTimeout(50);
    }

    assert.fail(message);
};

try {
    for (const width of [360, 1280]) {
        const context = await browser.newContext({ viewport: { width, height: 850 } });
        const page = await context.newPage();
        let closing = false;
        page.on('pageerror', e => { if (!closing) errors.push(e.message); });
        await page.goto(`${base}/library`, { waitUntil: 'networkidle' });
        await page.getByText('기기 내 미리보기 · 예시 작품을 포함합니다', { exact: true }).waitFor();
        await page.locator('.book-list').waitFor();
        await page.evaluate(async data => new Promise((resolve, reject) => {
            const request = indexedDB.open('orbit-novel-studio-v1');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result, tx = db.transaction('workspaces', 'readwrite');
                tx.objectStore('workspaces').put({ namespace: 'preview', data, localVersion: 1, cloudVersion: 0, dirty: false, lastExportAt: null });
                tx.oncomplete = () => { db.close(); resolve(); };

                tx.onerror = () => reject(tx.error);
            };
        }), data);
        await page.reload({ waitUntil: 'networkidle' });
        await page.getByRole('combobox', { name: '서재 정렬' }).selectOption('titleDesc');
        await page.evaluate(() => document.fonts.ready);
        const links = ['.book-read', '.book-info h2', '.book-cover'];
        let workId = '';

        for (const [i, selector] of links.entries()) {
            const card = page.locator('.book-entry').nth(3);
            workId = (await card.getAttribute('id')).replace('library-work-', '');
            await card.evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80));
            await card.locator(selector).click();
            await page.locator('.reading-body').waitFor();
            const nav = page.locator('.public-header nav');
            assert.deepEqual(await nav.locator('a').allTextContents(), ['설정집'], 'only the work wiki stays in the reading header');
            assert.equal(await page.locator('.public-brand').getAttribute('href'), '/');
            const back = page.locator('.reading-library-link');
            assert.equal(await back.getAttribute('href'), '/library', 'return destination is independent of browser history');
            await page.evaluate(() => window.scrollTo(0, 900));
            assert.ok((await back.boundingBox()).y >= 0, 'library return stays visible after scrolling');
            await page.getByRole('button', { name: '목차', exact: true }).click();
            await page.locator('.reading-toc a').first().click();
            await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
            await page.getByRole('dialog', { name: '읽기 설정', exact: true }).waitFor();

            if (i !== 2) await page.keyboard.press('Escape');

            if (i === 1) {
                await page.locator('.reading-end').getByRole('link', { name: '작품 목록', exact: true }).click();
            } else if (i === 2) {
                await back.click();
            } else {
                await back.focus();
                await page.keyboard.press('Enter');
            }

            await page.waitForURL(`${base}/library`);
            await page.locator('.book-list').waitFor();
            await until(page, async () => Math.abs((await page.locator(`#library-work-${workId}`).boundingBox()).y - 80) < 2, 'selected card returns to the same viewport position');
            assert.equal(await page.getByRole('combobox', { name: '서재 정렬' }).inputValue(), 'titleDesc');
            assert.equal(await page.locator(`#library-work-${workId} .book-read`).evaluate(el => el === document.activeElement), true, 'focus returns to the selected work');
            assert.equal(await page.evaluate(key => sessionStorage.getItem(key), locationKey), null, 'return position is consumed once');
        }

        // The selected card, rather than an absolute pixel offset, survives a viewport change while reading.
        const card = page.locator('.book-entry').nth(4);
        workId = (await card.getAttribute('id')).replace('library-work-', '');
        await card.evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80));
        await card.locator('.book-read').click();
        await page.locator('.reading-body').waitFor();
        await page.setViewportSize({ width: width === 360 ? 1280 : 360, height: 850 });
        await page.locator('.reading-library-link').click();
        await page.waitForURL(`${base}/library`);
        await page.locator('.book-list').waitFor();
        await until(page, async () => Math.abs((await page.locator(`#library-work-${workId}`).boundingBox()).y - 80) < 2, 'card position survives resizing');
        await page.setViewportSize({ width, height: 850 });

        // Check the reading bar in every palette, including real controls after the text labels collapse on mobile.
        await page.goto(`${base}/read/${workId}`, { waitUntil: 'networkidle' });
        await page.locator('.reading-body').waitFor();
        await page.evaluate(() => window.scrollTo(0, 900));

        for (const palette of PALETTES) for (const mode of ['light', 'dark']) {
            await page.evaluate(([p, m]) => { document.documentElement.dataset.palette = p; document.documentElement.dataset.theme = m; }, [palette, mode]);

            const r = await page.locator('.reading-controls').evaluate(bar => {
                const b = bar.getBoundingClientRect(), title = bar.querySelector(':scope>span').getBoundingClientRect();

                return { height: b.height, top: b.top, center: (title.left + title.right) / 2, controls: [...bar.querySelectorAll('a,button')].map(el => el.getBoundingClientRect().toJSON()), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
            });

            assert.equal(r.height, 52); assert.equal(r.top, 0); assert.equal(r.overflow, 0);
            assert.ok(Math.abs(r.center - width / 2) < 1, 'work title stays centered');

            for (const c of r.controls) assert.ok(c.left >= 0 && c.right <= width && c.top >= 0 && c.bottom <= 52, 'all controls stay inside the single bar');
            assert.ok(r.controls[0].right <= r.controls[1].left, 'return and contents do not overlap');
            await page.locator('.reading-controls').screenshot({ path: resolve(output, `${palette}-${mode}-${width}.png`) });
        }

        // A fresh direct entry, stale snapshot or blocked storage still returns to the library, never another site.
        for (const stored of [null, '{broken', JSON.stringify({ workId: data.works[0].id, sort: 'titleAsc', offset: -999, restore: false }), 'blocked']) {
            const direct = await context.newPage();
            await direct.goto(`${base}/privacy`, { waitUntil: 'networkidle' });
            await direct.goto(`${base}/read/${data.works[1].id}`, { waitUntil: 'networkidle' });
            await direct.locator('.reading-body').waitFor();
            await direct.evaluate(({ key, stored }) => {
                if (stored === 'blocked') Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('test blocked storage', 'SecurityError'); } });
                else if (stored) sessionStorage.setItem(key, stored);
                else sessionStorage.removeItem(key);
                window.scrollTo(0, 900);
            }, { key: locationKey, stored });
            await direct.locator('.reading-library-link').click();
            await direct.waitForURL(`${base}/library`);
            await direct.locator('.book-list').waitFor();
            await until(direct, () => direct.evaluate(() => window.scrollY === 0), 'direct entry returns to the top of the library');
            assert.equal(await direct.locator('.public-header nav').getByRole('link', { name: '집필실', exact: true }).count(), 1, 'library header keeps its studio entry');
            await direct.close();
        }

        closing = true;
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`${engine}: sticky library return, reader-only header, controls, sort/card restoration, resizing, direct entry/storage fallbacks, 42 themes × 2 widths — ${output}`);
} finally {
    await browser.close();
}
