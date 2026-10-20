// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Forerunner, Spartan × Infinity, Red Book and Silmarillion: picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/fiction-palettes');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

try {
    // 1. The header picker lists the four new families last; picking one persists and the studio settings show it.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const names = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.deepEqual(names.slice(8, 12), ['선조 유적 테마', '스파르탄 테마', '붉은 책 테마', '실마릴리온 테마']);
        await page.screenshot({ path: `${output}/picker-1280.png` });
        await picker.getByRole('button', { name: '스파르탄 테마' }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), '테마 · 스파르탄');
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'spartan');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'spartan', 'head script keeps spartan before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const choice = dialog.getByRole('group', { name: '색 계열', exact: true });
        assert.equal(await choice.getByRole('button', { name: '스파르탄', exact: true }).getAttribute('aria-pressed'), 'true');
        await choice.getByRole('button', { name: '실마릴리온', exact: true }).click();
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'silmaril');
        await context.close();
    }

    // 2. Each family in light and dark at 1280px and 360px.
    const paper = { forerunner: { light: 'rgb(232, 236, 238)', dark: 'rgb(10, 16, 21)' }, spartan: { light: 'rgb(229, 230, 222)', dark: 'rgb(16, 19, 13)' }, redbook: { light: 'rgb(239, 228, 202)', dark: 'rgb(23, 17, 11)' }, silmaril: { light: 'rgb(243, 242, 238)', dark: 'rgb(11, 13, 28)' } };

    for (const palette of ['forerunner', 'spartan', 'redbook', 'silmaril']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(([palette, mode]) => { localStorage.setItem('orbis-palette', palette); localStorage.setItem('orbis-theme', mode); }, [palette, mode]);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${palette} ${name} ${mode} ${width}: no sideways scroll`); await page.screenshot({ path: `${output}/${palette}-${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^테마 · / }).waitFor();
        assert.notEqual(await page.locator('header').first().evaluate(el => getComputedStyle(el, '::after').content), 'none', 'band under the home header');
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), paper[palette][mode]);
        assert.notEqual(await pseudo(page, '.public-header', '::after', 'content'), 'none', 'band under the library header');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none', 'the default orbit drawing gives way to the theme cover');
        assert.notEqual(await pseudo(page, '.book-cover', '::before', 'content'), 'none');
        assert.notEqual(await pseudo(page, '.book-cover', '::after', 'content'), 'none');

        if (palette === 'forerunner') assert.match(await style(page, '.book-cover', 'clipPath'), /polygon/, 'cut corners');

        if (palette === 'spartan') {
            assert.match(await style(page, '.book-cover', 'clipPath'), /polygon/, 'stepped armour plate');
            assert.match(await pseudo(page, '.book-cover', '::after', 'backgroundImage'), /INFINITY/, 'Infinity reflected in the visor');
            assert.match(await style(page, '.book-read', 'clipPath'), /polygon/, 'slanted button');

            // The visor once ran into a two-line title on the 360px cover.
            const gap = await page.locator('.book-cover').first().evaluate(cover => {
                const box = cover.getBoundingClientRect();
                const visor = getComputedStyle(cover, '::before');

                return cover.querySelector('strong').getBoundingClientRect().top - (box.top + parseFloat(visor.top) + parseFloat(visor.height));
            });

            assert.ok(gap >= 2, `visor clears the cover title (${gap}px)`);
        }

        if (palette === 'redbook') assert.equal(await pseudo(page, '.book-category', '::before', 'borderRadius'), '50%', 'red seal');

        if (palette === 'silmaril') assert.match(await pseudo(page, '.book-cover', '::after', 'clipPath'), /polygon/, 'jewel');

        await shot('library');

        const href = await page.locator('.book-read').first().getAttribute('href');
        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        assert.match(await pseudo(page, '.reading-title', '::after', 'maskImage'), /svg/, 'theme divider under the title');
        assert.match(await page.locator('.reading-scene-title h2').first().evaluate(el => getComputedStyle(el, '::before').content), palette === 'redbook' || palette === 'silmaril' ? /upper-roman/ : /decimal-leading-zero/, 'scene number');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await style(page, '.doc-divider', 'maskImage'), /svg/, 'theme divider in the studio');
        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`fiction palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
