// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Tatooine and Empire: picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/starwars-palettes');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

const names = { tatooine: '두 태양', empire: '제국' };

const paper = { tatooine: { light: 'rgb(239, 230, 220)', dark: 'rgb(20, 13, 22)' }, empire: { light: 'rgb(241, 242, 240)', dark: 'rgb(10, 11, 13)' } };

const action = { tatooine: { light: 'rgb(142, 47, 107)', dark: 'rgb(233, 139, 196)' }, empire: { light: 'rgb(36, 41, 47)', dark: 'rgb(29, 32, 37)' } };

try {
    // 1. Both families follow matrix at the end of the header picker; picking one persists and the studio settings show it.
    for (const palette of ['tatooine', 'empire']) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const labels = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.deepEqual(labels.slice(17, 20), ['황금함대 테마', '두 태양 테마', '제국 테마']);
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
    for (const palette of ['tatooine', 'empire']) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
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
        assert.match(await pseudo(page, '.public-header', '::after', 'backgroundImage'), /data:image\/svg|linear-gradient/, 'dunes or wall panel under the header');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none');
        assert.equal(await style(page, '.book-read', 'backgroundColor'), action[palette][mode], 'main button colour');
        const trigger = page.getByRole('button', { name: /^테마 · / });
        assert.notEqual(await trigger.evaluate(el => getComputedStyle(el).borderRadius), '8px', 'header theme button takes the family shape');

        if (palette === 'tatooine') {
            assert.match(await style(page, '.book-cover', 'backgroundImage'), /radial-gradient.*linear-gradient/, 'twin suns over the dusk sky on the cover');
            assert.match(await style(page, '.public-brand-mark', 'backgroundImage'), /radial-gradient/, 'twin-sun mark');
            assert.match(await pseudo(page, '.book-category', '::before', 'backgroundImage'), /repeating-linear-gradient/, 'starfighter stripes before the kicker');
        } else {
            assert.match(await style(page, '.book-cover', 'backgroundImage'), /data:image\/svg/, 'battle station on the cover');
            assert.equal(await style(page, '.book-read', 'borderTopLeftRadius'), '0px');
            assert.match(await style(page, '.book-read', 'boxShadow'), /inset/, 'red blade edge on the main button');
            assert.match(await pseudo(page, '.book-category', '::before', 'backgroundImage'), /linear-gradient/, 'rank plaque before the kicker');
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

        assert.match(await pseudo(page, '.reading-title', '::after', 'backgroundImage'), /data:image\/svg/, 'lightsaber divider');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();

        assert.match(await style(page, '.doc-divider', 'backgroundImage'), /data:image\/svg/, 'lightsaber divider in the studio');
        assert.notEqual(await pseudo(page, '.doc-kicker', '::before', 'backgroundImage'), 'none', 'stripes or rank plaque before the studio kicker');

        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`tatooine and empire palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
