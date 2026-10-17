// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/infinite-palettes');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property, pseudo = null) => page.locator(selector).first().evaluate((el, [property, pseudo]) => getComputedStyle(el, pseudo)[property], [property, pseudo]);

try {
    // 1. The header picker lists the three infinity families and the studio settings follow the choice.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        assert.deepEqual((await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')))).slice(-3), ['바벨 테마', '알레프 테마', '거울 테마']);
        await picker.getByRole('button', { name: '거울 테마' }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), '테마 · 거울');
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'mirror');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'mirror', 'head script keeps mirror before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const choice = page.getByRole('dialog', { name: '설정' }).getByRole('group', { name: '색 계열', exact: true });
        assert.equal(await choice.getByRole('button', { name: '거울', exact: true }).getAttribute('aria-pressed'), 'true');
        await choice.getByRole('button', { name: '바벨', exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'babel');
        await context.close();
    }

    // 2. Each family in light and dark at 1280px and 360px: no sideways scroll, its decorations, screenshots.
    const paper = { babel: { light: 'rgb(233, 230, 220)', dark: 'rgb(15, 19, 18)' }, aleph: { light: 'rgb(245, 244, 241)', dark: 'rgb(9, 9, 13)' }, mirror: { light: 'rgb(243, 243, 241)', dark: 'rgb(14, 15, 17)' } };

    for (const palette of ['babel', 'aleph', 'mirror']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(([palette, mode]) => { localStorage.setItem('orbis-palette', palette); localStorage.setItem('orbis-theme', mode); }, [palette, mode]);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${palette} ${name} ${mode} ${width}: no sideways scroll`); await page.screenshot({ path: `${output}/${palette}-${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^테마 · / }).waitFor();
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), paper[palette][mode]);
        const href = await page.locator('.book-read').first().getAttribute('href');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none', 'own cover art replaces the orbit circles');
        assert.match(await style(page, '.book-cover', 'maskImage', '::before'), /svg/, 'cover art');

        if (palette === 'babel') {
            assert.match(await style(page, '.public-header', 'maskImage', '::after'), /svg/, 'honeycomb band under the header');
            assert.match(await style(page, '.book-category', 'clipPath'), /polygon/, 'hexagon plate');
            assert.match(await style(page, '.book-read', 'clipPath'), /polygon/, 'hexagon button');
        }

        if (palette === 'aleph') {
            assert.match(await style(page, '.public-header', 'backgroundImage', '::after'), /linear-gradient/, 'iridescent hairline');
            assert.match(await style(page, '.book-cover', 'backgroundImage', '::after'), /conic-gradient/, 'iridescent ring on the cover');
            assert.match(await style(page, '.book-category', 'backgroundImage', '::before'), /conic-gradient/, 'ring before the kicker');
            assert.equal(await style(page, '.book-read', 'borderTopLeftRadius'), '999px');
        }

        if (palette === 'mirror') {
            assert.equal((await style(page, '.public-header', 'backgroundImage', '::after')).match(/linear-gradient/g)?.length, 5, 'five converging lines');
            assert.equal(await style(page, '.book-category', 'outlineStyle'), 'solid', 'double frame kicker');
            assert.equal((await style(page, '.book-read', 'boxShadow')).split('px, ').length > 1, true, 'echo outlines on the button');
        }

        await shot('library');

        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        assert.match(await style(page, '.reading-title', 'maskImage', '::after'), /svg/, 'divider under the reading title');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await style(page, '.doc-divider', 'maskImage'), /svg/, 'divider under the studio title');
        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`infinite palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
