// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Nostromo: picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/nostromo-palette');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

const paper = { light: 'rgb(230, 225, 213)', dark: 'rgb(17, 16, 13)' };

// The main button is dark CRT glass in light and a lit phosphor panel in dark.
const action = { light: 'rgb(27, 33, 29)', dark: 'rgb(166, 226, 162)' };

try {
    // 1. Nostromo follows odyssey at the end of the header picker; picking it persists and the studio settings show it.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const labels = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.deepEqual(labels.slice(19, 22), ['제국 테마', '오디세이 테마', '마더 테마']);
        await picker.getByRole('button', { name: '마더 테마' }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), '테마 · 마더');
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'nostromo');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'nostromo', 'head script keeps the family before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const pressed = dialog.getByRole('group', { name: '색 계열', exact: true }).getByRole('button', { name: '마더', exact: true });
        assert.equal(await pressed.getAttribute('aria-pressed'), 'true');
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action.light, 'segmented choice takes the main button colour');
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '3px');
        await dialog.screenshot({ path: `${output}/settings-light.png` });
        await context.close();
    }

    // 2. Light and dark at 1280px and 360px.
    for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(mode => { localStorage.setItem('orbis-palette', 'nostromo'); localStorage.setItem('orbis-theme', mode); }, mode);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${name} ${mode} ${width}: no sideways scroll`); await page.screenshot({ path: `${output}/${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^테마 · / }).waitFor();
        assert.match(await page.locator('header').first().evaluate(el => getComputedStyle(el, '::after').backgroundImage), /linear-gradient/, 'keyboard strip under the home header');
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), paper[mode]);
        assert.match(await pseudo(page, '.public-header', '::after', 'backgroundImage'), /linear-gradient/, 'keyboard strip under the header');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none');
        assert.equal(await style(page, '.book-cover-series', 'display'), 'none');
        assert.match(await pseudo(page, '.book-cover', '::before', 'backgroundImage'), /repeating-conic-gradient/, 'CRT screen with a ground grid on the cover');
        assert.equal(await style(page, '.book-cover', 'borderTopLeftRadius'), width === 360 ? '6px' : '8px');
        assert.equal(await style(page, '.book-read', 'backgroundColor'), action[mode], 'main button colour');
        assert.match(await style(page, '.book-read', 'backgroundImage'), /repeating-linear-gradient/, 'scan lines on the main button');
        assert.equal(await style(page, '.public-brand-mark', 'width'), width === 360 ? '18px' : '22px', 'motion tracker mark');
        assert.equal(await pseudo(page, '.book-category', '::before', 'width'), '9px', 'amber key before the kicker');
        const trigger = page.getByRole('button', { name: /^테마 · / });
        assert.equal(await trigger.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '3px', 'header theme button takes the family shape');

        // The cover title stays inside the screen and above the horizon.
        const placement = await page.locator('.book-cover').first().evaluate(cover => {
            const box = cover.getBoundingClientRect();
            const screen = getComputedStyle(cover, '::before');
            const top = box.top + parseFloat(screen.top);
            const bottom = box.bottom - parseFloat(screen.bottom);
            const left = box.left + parseFloat(screen.left);
            const right = box.right - parseFloat(screen.right);
            const horizon = top + (bottom - top) * .64;
            const text = cover.querySelector('span:last-child').getBoundingClientRect();

            return { inside: text.top >= top && text.left >= left && text.right <= right, clear: text.bottom <= horizon };
        });

        assert.ok(placement.inside, `${mode} ${width}: cover title inside the screen`);
        assert.ok(placement.clear, `${mode} ${width}: cover title above the horizon`);
        await shot('library');

        await trigger.click();
        await page.locator('.palette-popover').waitFor();
        const pressed = page.getByRole('group', { name: '테마' }).getByRole('button', { name: '마더 테마' });
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action[mode], 'popover choice takes the main button colour');
        await page.locator('.palette-popover').screenshot({ path: `${output}/popover-${mode}-${width}.png` });
        await page.keyboard.press('Escape');

        const href = await page.locator('.book-read').first().getAttribute('href');
        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        assert.match(await pseudo(page, '.reading-scene-title h2', '::before', 'content'), /decimal-leading-zero/, 'tracker scene number');
        assert.match(await pseudo(page, '.reading-scene-title h2', '::before', 'fontFamily'), /VT323/);
        assert.match(await pseudo(page, '.reading-title', '::after', 'backgroundImage'), /radial-gradient/, 'tracker divider');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();

        // At 360px the sidebar is a closed drawer.
        if (width === 1280) assert.match(await pseudo(page, '.studio-tools', '::after', 'backgroundImage'), /linear-gradient/, 'keys under the studio tools');
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await style(page, '.doc-divider', 'backgroundImage'), /radial-gradient/, 'tracker divider in the studio');
        assert.equal(await pseudo(page, '.doc-kicker', '::before', 'width'), '9px', 'amber key before the studio kicker');
        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`nostromo palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
