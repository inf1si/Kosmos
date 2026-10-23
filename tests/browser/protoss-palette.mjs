// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Protoss: picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/protoss-palette');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

const paper = { light: 'rgb(244, 240, 230)', dark: 'rgb(15, 13, 11)' };

const action = { light: 'rgb(29, 92, 187)', dark: 'rgb(74, 168, 245)' };

const gold = { light: 'rgb(180, 140, 60)', dark: 'rgb(207, 169, 85)' };

try {
    // 1. Protoss follows matrix in the header picker; picking it persists and the studio settings show it.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const labels = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.deepEqual(labels.slice(15, 18), ['그리드 테마', '매트릭스 테마', '황금함대 테마']);
        await picker.getByRole('button', { name: '황금함대 테마' }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), '테마 · 황금함대');
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'protoss');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'protoss', 'head script keeps the family before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const pressed = dialog.getByRole('group', { name: '색 계열', exact: true }).getByRole('button', { name: '황금함대', exact: true });
        assert.equal(await pressed.getAttribute('aria-pressed'), 'true');
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action.light, 'segmented choice takes the main button colour');
        assert.match(await pressed.evaluate(el => getComputedStyle(el).boxShadow), /rgb\(180, 140, 60\)/, 'gold frame on the segmented choice');
        await dialog.screenshot({ path: `${output}/protoss-settings-light.png` });
        await context.close();
    }

    // 2. Light and dark at 1280px and 360px.
    for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(mode => { localStorage.setItem('orbis-palette', 'protoss'); localStorage.setItem('orbis-theme', mode); }, mode);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${name} ${mode} ${width}: no sideways scroll`); await page.screenshot({ path: `${output}/protoss-${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^테마 · / }).waitFor();
        assert.match(await page.locator('header').first().evaluate(el => getComputedStyle(el, '::after').backgroundImage), /linear-gradient/, 'psionic seam under the home header');
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), paper[mode]);
        assert.equal(await style(page, '.public-header', 'borderBottomColor'), gold[mode], 'gold hairline under the header');
        assert.match(await pseudo(page, '.public-header', '::after', 'backgroundImage'), /linear-gradient/, 'psionic seam under the header');
        assert.match(await style(page, '.public-brand-mark', 'clipPath'), /polygon/, 'crystal mark');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none');
        assert.match(await pseudo(page, '.book-cover', '::after', 'clipPath'), /polygon/, 'crystal on the cover');
        assert.equal(await pseudo(page, '.book-cover', '::before', 'borderBottomColor'), gold[mode], 'gold cradle under the crystal');
        assert.equal(await style(page, '.book-read', 'backgroundColor'), action[mode], 'main button colour');
        assert.equal(await style(page, '.book-read', 'borderTopColor'), gold[mode], 'gold frame on the main button');
        assert.equal(await style(page, '.book-read', 'borderTopLeftRadius'), '2px');
        const trigger = page.getByRole('button', { name: /^테마 · / });
        assert.equal(await trigger.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '2px', 'header theme button takes the family shape');

        // The cover title stays inside the cover and below the crystal.
        const fits = await page.locator('.book-cover').first().evaluate(cover => {
            const box = cover.getBoundingClientRect();
            const title = cover.querySelector('strong').getBoundingClientRect();
            const crystal = getComputedStyle(cover, '::after');
            const crystalBottom = box.top + parseFloat(crystal.top) + parseFloat(crystal.height) / 2;

            return { inside: title.top >= box.top && title.bottom <= box.bottom && title.left >= box.left && title.right <= box.right, clear: title.top >= crystalBottom };
        });

        assert.deepEqual(fits, { inside: true, clear: true }, `${mode} ${width}: cover title inside the cover and clear of the crystal`);
        await shot('library');

        await trigger.click();
        await page.locator('.palette-popover').waitFor();
        const pressed = page.getByRole('group', { name: '테마' }).getByRole('button', { name: '황금함대 테마' });
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action[mode], 'popover choice takes the main button colour');
        await page.locator('.palette-popover').screenshot({ path: `${output}/protoss-popover-${mode}-${width}.png` });
        await page.keyboard.press('Escape');

        const href = await page.locator('.book-read').first().getAttribute('href');
        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        const number = page.locator('.reading-scene-title h2').first();
        assert.match(await number.evaluate(el => getComputedStyle(el, '::before').content), /decimal-leading-zero/, 'scene number');
        assert.match(await number.evaluate(el => getComputedStyle(el, '::before').backgroundImage), /conic-gradient/, 'psionic arc around the scene number');
        assert.match(await pseudo(page, '.reading-title', '::after', 'backgroundImage'), /linear-gradient/, 'crystal divider');
        assert.match(await pseudo(page, '.reading-title > span', '::before', 'clipPath'), /polygon/, 'crystal before the kicker');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();

        if (width === 1280) assert.match(await style(page, '.studio-brand > span', 'clipPath'), /polygon/, 'crystal studio mark');

        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await style(page, '.doc-divider', 'backgroundImage'), /linear-gradient/, 'crystal divider in the studio');
        assert.match(await pseudo(page, '.doc-kicker', '::before', 'clipPath'), /polygon/, 'crystal before the studio kicker');
        assert.match(await style(page, '.doc-head', 'backgroundImage'), /linear-gradient/, 'gold hairline over the manuscript head');
        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`protoss palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
