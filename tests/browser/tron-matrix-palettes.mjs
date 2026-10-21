// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Tron and Matrix: picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/tron-matrix-palettes');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

const names = { tron: '트론', matrix: '매트릭스' };

const paper = { tron: { light: 'rgb(238, 243, 245)', dark: 'rgb(4, 8, 11)' }, matrix: { light: 'rgb(244, 246, 243)', dark: 'rgb(2, 5, 3)' } };

const action = { tron: { light: 'rgb(10, 115, 146)', dark: 'rgb(62, 224, 255)' }, matrix: { light: 'rgb(11, 122, 50)', dark: 'rgb(58, 228, 108)' } };

try {
    // 1. Both families follow hitchhiker in the header picker; picking one persists and the studio settings show it.
    for (const palette of ['tron', 'matrix']) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const labels = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.deepEqual(labels.slice(14, 17), ['히치하이커 테마', '트론 테마', '매트릭스 테마']);
        await picker.getByRole('button', { name: `${names[palette]} 테마` }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), `테마 · ${names[palette]}`);
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), palette);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), palette, 'head script keeps the family before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const choice = dialog.getByRole('group', { name: '색 계열', exact: true });
        const pressed = choice.getByRole('button', { name: names[palette], exact: true });
        assert.equal(await pressed.getAttribute('aria-pressed'), 'true');
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action[palette].light, 'segmented choice takes the main button colour');
        await dialog.screenshot({ path: `${output}/${palette}-settings-light.png` });
        await context.close();
    }

    // 2. Light and dark at 1280px and 360px.
    for (const palette of ['tron', 'matrix']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
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
        assert.match(await pseudo(page, '.public-header', '::after', 'backgroundImage'), /linear-gradient/, 'trail or rain under the header');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none');
        assert.equal(await style(page, '.book-read', 'backgroundColor'), action[palette][mode], 'main button colour');
        const trigger = page.getByRole('button', { name: /^테마 · / });
        assert.notEqual(await trigger.evaluate(el => getComputedStyle(el).borderRadius), '8px', 'header theme button takes the family shape');

        if (palette === 'tron') {
            assert.equal(await pseudo(page, '.book-cover', '::before', 'transform').then(v => v !== 'none'), true, 'perspective grid floor on the cover');
            assert.equal(await style(page, '.public-brand-mark', 'borderTopLeftRadius'), '50%', 'identity disc mark');
            assert.match(await style(page, '.public-site', 'backgroundImage'), /linear-gradient/, 'grid behind the library');
        } else {
            assert.match(await pseudo(page, '.book-cover', '::before', 'content'), /ﾊﾐﾋ/, 'code rain on the cover');
            assert.equal(await pseudo(page, '.book-cover', '::before', 'writingMode'), 'vertical-rl');
            assert.equal(await style(page, '.public-brand-mark', 'order'), '1', 'cursor after the name');
            assert.equal(await pseudo(page, '.book-wiki', '::before', 'content'), '"[" / ""');
        }

        // The cover title stays inside the cover and clear of the decoration.
        const titleFits = await page.locator('.book-cover').first().evaluate(cover => {
            const box = cover.getBoundingClientRect();
            const title = cover.querySelector('strong').getBoundingClientRect();

            return title.top >= box.top && title.bottom <= box.bottom && title.left >= box.left && title.right <= box.right;
        });

        assert.ok(titleFits, `${palette} ${mode} ${width}: cover title inside the cover`);
        await shot('library');

        await trigger.click();
        await page.locator('.palette-popover').waitFor();
        const pressed = page.getByRole('group', { name: '테마' }).getByRole('button', { name: `${names[palette]} 테마` });
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action[palette][mode], 'popover choice takes the main button colour');
        await page.locator('.palette-popover').screenshot({ path: `${output}/${palette}-popover-${mode}-${width}.png` });
        await page.keyboard.press('Escape');

        const href = await page.locator('.book-read').first().getAttribute('href');
        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        assert.match(await page.locator('.reading-scene-title h2').first().evaluate(el => getComputedStyle(el, '::before').content), /decimal-leading-zero/, 'scene number');

        if (palette === 'tron') assert.match(await pseudo(page, '.reading-title', '::after', 'backgroundImage'), /linear-gradient/, 'light-cycle divider');
        else assert.match(await pseudo(page, '.reading-title', '::after', 'content'), /ﾊﾐﾋ/, 'glyph divider');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();

        if (palette === 'tron') {
            assert.match(await style(page, '.doc-divider', 'backgroundImage'), /linear-gradient/, 'trail divider in the studio');
            assert.equal(await style(page, '.doc-kicker', 'borderLeftColor'), action[palette][mode], 'light-line plate kicker');
        } else {
            assert.match(await pseudo(page, '.doc-divider', '::after', 'content'), /ﾊﾐﾋ/, 'glyph divider in the studio');
            assert.equal(await pseudo(page, '.doc-kicker', '::before', 'content'), '"›" / ""', 'prompt kicker');
        }

        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`tron and matrix palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
