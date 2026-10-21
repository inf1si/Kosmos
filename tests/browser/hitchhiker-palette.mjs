// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Hitchhiker (the Guide): picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/hitchhiker-palette');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

try {
    // 1. The header picker lists the family last; picking it persists and the studio settings show it.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const names = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.equal(names[14], '히치하이커 테마');
        await page.screenshot({ path: `${output}/picker-1280.png` });
        await picker.getByRole('button', { name: '히치하이커 테마' }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), '테마 · 히치하이커');
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'hitchhiker');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'hitchhiker', 'head script keeps the family before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const choice = dialog.getByRole('group', { name: '색 계열', exact: true });
        assert.equal(await choice.getByRole('button', { name: '히치하이커', exact: true }).getAttribute('aria-pressed'), 'true');
        await context.close();
    }

    // 2. Light and dark at 1280px and 360px.
    const paper = { light: 'rgb(246, 243, 234)', dark: 'rgb(12, 12, 14)' };
    const action = { light: 'rgb(215, 48, 31)', dark: 'rgb(255, 74, 58)' };

    for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(mode => { localStorage.setItem('orbis-palette', 'hitchhiker'); localStorage.setItem('orbis-theme', mode); }, mode);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${name} ${mode} ${width}: no sideways scroll`); await page.screenshot({ path: `${output}/hitchhiker-${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^테마 · / }).waitFor();
        assert.notEqual(await page.locator('header').first().evaluate(el => getComputedStyle(el, '::after').content), 'none', 'towel under the home header');
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), paper[mode]);
        // The header is the black top of the Guide in both modes; its text switches to the light ink.
        assert.equal(await style(page, '.public-header', 'backgroundImage').then(v => /linear-gradient/.test(v)), true, 'black header');
        assert.equal(await style(page, '.public-brand', 'color'), 'rgb(255, 246, 214)', 'brand reads on the black header');
        assert.match(await pseudo(page, '.public-header', '::after', 'backgroundImage'), /repeating-linear-gradient/, 'towel fringe under the header');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none');
        assert.equal(await pseudo(page, '.book-cover', '::before', 'content'), '"DON\'T\\a PANIC"', 'DON\'T PANIC on the Guide cover');
        assert.equal(await style(page, '.book-category', 'backgroundColor'), 'rgb(255, 210, 63)', 'yellow sticker');
        assert.equal(await style(page, '.book-read', 'backgroundColor'), action[mode], 'red is the action colour in both modes');

        // DON'T PANIC must not run into the cover title.
        const gap = await page.locator('.book-cover').first().evaluate(cover => {
            const box = cover.getBoundingClientRect();
            const panic = getComputedStyle(cover, '::before');
            const panicBottom = box.top + parseFloat(panic.top) + parseFloat(panic.height);

            return cover.querySelector('strong').getBoundingClientRect().top - panicBottom;
        });

        assert.ok(gap >= 2, `DON'T PANIC clears the cover title (${gap}px)`);
        await shot('library');

        const href = await page.locator('.book-read').first().getAttribute('href');
        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        assert.match(await pseudo(page, '.reading-title', '::after', 'backgroundImage'), /radial-gradient/, 'orbit divider under the title');
        assert.match(await page.locator('.reading-scene-title h2').first().evaluate(el => getComputedStyle(el, '::before').content), /decimal-leading-zero/, 'speech-bubble scene number');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await style(page, '.doc-divider', 'backgroundImage'), /radial-gradient/, 'orbit divider in the studio');
        assert.equal(await style(page, '.doc-kicker', 'backgroundColor'), 'rgb(255, 210, 63)', 'sticker kicker in the studio');
        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`hitchhiker palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
