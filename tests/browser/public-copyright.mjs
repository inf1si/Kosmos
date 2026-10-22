// Local preview only: synthetic publications and author name in an isolated browser; no server writes.
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

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || `test-results/public-copyright/${engine}`);

const options = { headless: true };

if (engine === 'chromium') {
    options.executablePath = process.env.KOSMOS_CHROMIUM_PATH || undefined;
    options.args = ['--no-sandbox', '--disable-dev-shm-usage'];
}

await mkdir(output, { recursive: true });

const browser = await playwright[engine].launch(options);

const data = seedWorkspace(), template = data.works[0], errors = [];

data.works = [2024, 2026].map((year, i) => {
    const work = structuredClone(template), suffix = String(i + 1).padStart(12, '0');
    work.id = `30000000-0000-4000-8000-${suffix}`;
    work.title = `검증 작품 ${i + 1}`;
    const pub = work.publications[0];
    pub.id = `90000000-0000-4000-8000-${suffix}`; pub.workId = work.id; pub.title = work.title; pub.libraryPosition = i + 1;
    pub.publishedAt = `${year}-05-0${i + 1}T03:00:00.000Z`;
    work.activePublicationId = pub.id;

    return work;
});

const [older, newer] = data.works;

async function savePreview(page, workspace) {
    await page.evaluate(async workspace => new Promise((resolve, reject) => {
        const request = indexedDB.open('orbit-novel-studio-v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result, tx = db.transaction('workspaces', 'readwrite');
            tx.objectStore('workspaces').put({ namespace: 'preview', data: workspace, localVersion: 1, cloudVersion: 0, dirty: false, lastExportAt: null });
            tx.oncomplete = () => { db.close(); resolve(); };

            tx.onerror = () => reject(tx.error);
        };
    }), workspace);
}

async function notices(page) {
    return page.evaluate(() => [...document.querySelectorAll('.public-footer span:nth-child(2), .reading-copyright')].map(el => el.textContent));
}

try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/library`, { waitUntil: 'networkidle' });
    await page.getByText('기기 내 미리보기 · 예시 작품을 포함합니다', { exact: true }).waitFor();

    await savePreview(page, { ...data, authorProfile: { name: '', bio: '' } });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.book-list').waitFor();
    assert.deepEqual(await notices(page), [], 'no notice without an author name');
    assert.equal(await page.locator('.public-footer').textContent(), 'Orbis Tertius');

    await savePreview(page, { ...data, authorProfile: { name: '  검증 작가  ', bio: '' } });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.book-list').waitFor();
    assert.deepEqual(await notices(page), ['© 2024–2026 검증 작가. All rights reserved.'], 'library spans first to latest publication year');

    await page.goto(`${base}/read/${newer.id}`, { waitUntil: 'networkidle' });
    await page.locator('.reading-end').waitFor();
    assert.deepEqual(await notices(page), ['© 2026 검증 작가. All rights reserved.'], 'reader uses this publication year');
    const end = await page.locator('.reading-end').evaluate(el => [...el.children].map(child => child.textContent));
    assert.equal(end.at(-1), '© 2026 검증 작가. All rights reserved.', 'notice follows the publication date');

    await page.goto(`${base}/wiki/${older.id}`, { waitUntil: 'networkidle' });
    await page.locator('.wiki-layout').waitFor();
    assert.deepEqual(await notices(page), ['© 2024 검증 작가. All rights reserved.'], 'wiki shows the same notice');
    await context.close();

    for (const width of [360, 1280]) {
        for (const mode of ['light', 'dark']) {
            for (const palette of PALETTES) {
                const themed = await browser.newContext({ viewport: { width, height: 900 } });
                await themed.addInitScript(([mode, palette]) => { localStorage.setItem('orbis-theme', mode); localStorage.setItem('orbis-palette', palette); }, [mode, palette]);
                const view = await themed.newPage();
                view.on('pageerror', e => errors.push(e.message));
                await view.goto(`${base}/library`, { waitUntil: 'networkidle' });
                await savePreview(view, { ...data, authorProfile: { name: '검증 작가', bio: '' } });

                for (const path of ['/library', `/read/${newer.id}`, `/wiki/${newer.id}`]) {
                    await view.goto(`${base}${path}`, { waitUntil: 'networkidle' });
                    const notice = view.locator('.public-footer span:nth-child(2), .reading-copyright');
                    await notice.waitFor();

                    const box = await notice.evaluate(el => {
                        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);

                        return { left: rect.left, right: rect.right, height: rect.height, size: style.fontSize, visible: style.visibility !== 'hidden' && style.opacity !== '0', scroll: document.documentElement.scrollWidth - innerWidth };
                    });

                    assert(box.visible && box.height > 0, `${palette} ${mode} ${width} ${path} notice is visible`);
                    assert(box.left >= 0 && box.right <= width, `${palette} ${mode} ${width} ${path} notice stays inside the page`);
                    assert.equal(box.size, '12px', `${palette} ${mode} ${path} notice keeps the footer size`);
                    assert(box.scroll <= 0, `${palette} ${mode} ${width} ${path} has no horizontal scroll`);

                    if (path === '/library' || palette === 'violet' || palette === 'nostromo') {
                        await notice.scrollIntoViewIfNeeded();
                        await view.screenshot({ path: `${output}/${path.split('/')[1]}-${palette}-${mode}-${width}.png` });
                    }
                }

                await themed.close();
            }
        }
    }

    assert.deepEqual(errors, []);
    console.log('public copyright: ok');
} finally {
    await browser.close();
}
