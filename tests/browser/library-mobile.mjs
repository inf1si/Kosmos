// Local preview only: synthetic publications in an isolated browser; no server writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { seedWorkspace } from '../../src/lib/seed.ts';

const require = createRequire(import.meta.url);

const engine = process.env.KOSMOS_BROWSER_ENGINE || 'chromium';

const playwright = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || `test-results/library-mobile/${engine}`);

await mkdir(output, { recursive: true });

const launchOptions = { headless: true };

if (engine === 'chromium') {
    launchOptions.executablePath = process.env.KOSMOS_CHROMIUM_PATH || undefined;
    launchOptions.args = ['--no-sandbox', '--disable-dev-shm-usage'];
}

const browser = await playwright[engine].launch(launchOptions);

const errors = [];

const longText = '시험용 문단이다. 별을 따라 돌아온 사람은 항구에서 다음 계절을 기다렸다. '.repeat(14);

const cases = [
    ['미리보기', longText],
    ['공백없는아주긴표지제목'.repeat(5), '가나다라마바사아자차카타파하'.repeat(40)],
    ['UnbrokenBookTitle'.repeat(8), 'unbrokenparagraph'.repeat(60)],
    ['짧은 제목', '짧은 문단.'],
];

const data = seedWorkspace(), template = data.works[0];

data.works = cases.map(([title, text], index) => {
    const work = structuredClone(template), id = `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    work.id = id; work.title = title; work.subtitle = ''; work.description = '';
    const pub = work.publications[0];
    pub.workId = id; pub.id = `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    pub.title = title; pub.subtitle = ''; pub.description = ''; pub.libraryPosition = index + 1;
    pub.scenes[0].content = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text }] }] };
    work.activePublicationId = pub.id;

    return work;
});

try {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/library`, { waitUntil: 'networkidle' });
    await page.getByText('기기 내 미리보기 · 예시 작품을 포함합니다', { exact: true }).waitFor();
    await page.locator('.book-list').waitFor();
    await page.evaluate(async data => {
        await new Promise((resolve, reject) => {
            const request = indexedDB.open('orbit-novel-studio-v1');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result, tx = db.transaction('workspaces', 'readwrite');
                tx.objectStore('workspaces').put({ namespace: 'preview', data, localVersion: 1, cloudVersion: 0, dirty: false, lastExportAt: null });
                tx.oncomplete = () => { db.close(); resolve(); };

                tx.onerror = () => reject(tx.error);
            };
        });
    }, data);
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.book-entry').count(), cases.length);

    const check = async (label, checkCover = true) => {
        const results = await page.locator('.book-entry:visible').evaluateAll(entries => entries.map(entry => {
            const p = entry.querySelector('.book-excerpt p'), cover = entry.querySelector('.book-cover'), title = cover.querySelector('strong'), small = cover.querySelector('small');
            const rect = p.getBoundingClientRect(), line = parseFloat(getComputedStyle(p).lineHeight);
            const c = cover.getBoundingClientRect(), t = title.getBoundingClientRect(), s = small.getBoundingClientRect();

            // Diesel and noir draw a rotated diamond (::after) above the title; its centre sits at `top`.
            const emblem = ['diesel', 'noir'].includes(document.documentElement.dataset.palette) ? getComputedStyle(cover, '::after') : null;
            const emblemBottom = emblem ? parseFloat(emblem.top) + parseFloat(emblem.width) * Math.SQRT2 / 2 : 0;

            return { text: p.textContent, height: rect.height, line, truncated: p.scrollHeight > p.clientHeight + 1, titleOverflow: title.scrollWidth - title.clientWidth, titleTop: t.top - c.top, titleBottom: c.bottom - t.bottom, labelBottom: c.bottom - s.bottom, emblemBottom };
        }));

        for (const [i, r] of results.entries()) {
            assert.equal(r.text, cases[i][1].trim(), `${label}: full first nonempty paragraph stays intact`);

            if (i < 3) {
                assert.equal(r.truncated, true, `${label}: long paragraph is clamped`);
                assert.ok(Math.abs(r.height - 4 * r.line) < 1, `${label}: four complete lines, got ${r.height}px for ${r.line}px lines`);
            } else assert.ok(Math.abs(r.height - r.line) < 1, `${label}: short paragraph stays one line`);

            if (checkCover) {
                assert.ok(r.titleOverflow <= 1, `${label}: title ${i} overflows by ${r.titleOverflow}px`);
                assert.ok(r.titleTop > 0 && r.titleBottom > 0 && r.labelBottom > 0, `${label}: title and genre fit inside the cover`);
                assert.ok(r.titleTop >= r.emblemBottom, `${label}: title ${i} top ${r.titleTop}px overlaps the emblem ending at ${r.emblemBottom}px`);
            }
        }

        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${label}: no horizontal page overflow`);
    };

    // Regression: text inflation changes line-height while an em max-height stays at 121.6px.
    for (const scale of [150, 200]) {
        const inflation = await page.addStyleTag({ content: `html{-webkit-text-size-adjust:${scale}%;text-size-adjust:${scale}%}.book-entry:not(:first-child){display:none}` });
        await page.locator('.book-excerpt').first().screenshot({ path: resolve(output, `text-inflation-${scale}.png`) });

        if (engine === 'chromium') assert.equal(await page.locator('.book-excerpt p').first().evaluate(p => getComputedStyle(p).fontSize), `${16 * scale / 100}px`, 'text inflation is actually active');
        await check(`${scale}% mobile text inflation`, false);
        await inflation.evaluate(el => el.remove());
    }

    for (const width of [360, 390, 700, 1280]) {
        await page.setViewportSize({ width, height: 900 });

        for (const palette of ['violet', 'cassette', 'cyber', 'ink', 'columbia', 'nasapunk', 'diesel', 'noir']) for (const mode of ['light', 'dark']) {
            await page.evaluate(([palette, mode]) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = mode; }, [palette, mode]);
            await check(`${palette} ${mode} ${width}`);
            await page.screenshot({ path: resolve(output, `${palette}-${mode}-${width}.png`), fullPage: true });

            if (width === 360) await page.locator('.book-cover').nth(1).screenshot({ path: resolve(output, `${palette}-${mode}-cover.png`) });
        }
    }

    await page.locator('.book-read').first().click();
    await page.locator('.reading-body').waitFor();
    assert.ok((await page.locator('.reading-body').innerText()).includes(longText.trim()), 'reading the work still shows the complete paragraph');
    await page.goBack({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('.book-info h2').first().textContent(), cases[0][0], 'full title survives navigation');
    assert.equal(await page.evaluate(async () => new Promise(resolve => {
        const request = indexedDB.open('orbit-novel-studio-v1');
        request.onsuccess = () => { const db = request.result, get = db.transaction('workspaces').objectStore('workspaces').get('preview'); get.onsuccess = () => { db.close(); resolve(JSON.stringify(get.result.data)); }; };
    })), JSON.stringify(data), 'display changes never modify saved publications');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${engine}: library mobile text inflation, covers, 16 themes × 4 widths, full reader and unchanged publications — ${output}`);
} finally {
    await browser.close();
}
