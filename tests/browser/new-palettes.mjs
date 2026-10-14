// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/new-palettes');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

try {
    // 1. The header picker chooses ink, keeps it across a reload and the studio reads the same choice.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        const picker = page.getByRole('group', { name: '테마' });
        assert.deepEqual(await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label'))), ['보라 테마', '카세트 테마', '사이버 테마', '잉크 테마', '컬럼비아 테마', '나사펑크 테마']);
        await picker.getByRole('button', { name: '잉크 테마' }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'ink');
        assert.equal(await picker.getByRole('button', { name: '잉크 테마' }).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'ink');
        assert.equal(await style(page, '.public-site', 'backgroundColor'), 'rgb(247, 243, 234)');
        assert.equal(await style(page, '.public-header', 'borderBottomStyle'), 'double');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'ink', 'head script keeps ink before paint');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        assert.equal(await style(page, '.studio', 'backgroundColor'), 'rgb(235, 229, 216)');
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const choice = dialog.getByRole('group', { name: '색 계열', exact: true });
        assert.equal(await choice.getByRole('button', { name: '잉크', exact: true }).getAttribute('aria-pressed'), 'true', 'settings shows the same palette');
        await choice.getByRole('button', { name: '보라', exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'violet');
        await choice.getByRole('button', { name: '잉크', exact: true }).click();
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'ink');
        await context.close();
    }

    // 2. Each new palette in light and dark at 1280px and 360px: no sideways scroll, screenshots of every surface.
    const paper = { ink: { light: 'rgb(247, 243, 234)', dark: 'rgb(20, 22, 28)' }, columbia: { light: 'rgb(245, 239, 226)', dark: 'rgb(18, 26, 44)' }, nasapunk: { light: 'rgb(244, 244, 241)', dark: 'rgb(8, 9, 11)' } };

    for (const palette of ['ink', 'columbia', 'nasapunk']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(([palette, mode]) => { localStorage.setItem('orbis-palette', palette); localStorage.setItem('orbis-theme', mode); }, [palette, mode]);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${palette} ${name} ${mode} ${width}: no sideways scroll`); await page.screenshot({ path: `${output}/${palette}-${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('group', { name: '테마' }).waitFor();
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), paper[palette][mode]);
        const href = await page.locator('.book-read').first().getAttribute('href');
        const wiki = await page.locator('.book-wiki').first().getAttribute('href');
        await shot('library');

        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        await shot('reader');

        if (wiki) { await page.goto(`${base}${wiki}`, { waitUntil: 'domcontentloaded' }); await page.locator('.wiki-page').waitFor(); await shot('wiki'); }

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();

        if (palette === 'ink') {
            assert.equal(await page.locator('.doc-divider').first().evaluate(el => getComputedStyle(el, '::after').content), '"\u2042"');
            assert.match(await style(page, '.manuscript p', 'backgroundImage'), /linear-gradient/, 'manuscript paper grid');
        }

        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`new palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
