// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Odyssey: picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/odyssey-palette');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

const paper = { light: 'rgb(247, 248, 248)', dark: 'rgb(10, 11, 12)' };

// The main button is a black monolith in light and a lit white panel in dark.
const action = { light: 'rgb(20, 22, 24)', dark: 'rgb(232, 234, 236)' };

try {
    // 1. Odyssey follows matrix at the end of the header picker; picking it persists and the studio settings show it.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const labels = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.deepEqual(labels.slice(18, 21), ['타투인 테마', '제국 테마', '오디세이 테마']);
        await picker.getByRole('button', { name: '오디세이 테마' }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), '테마 · 오디세이');
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), 'odyssey');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'odyssey', 'head script keeps the family before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const pressed = dialog.getByRole('group', { name: '색 계열', exact: true }).getByRole('button', { name: '오디세이', exact: true });
        assert.equal(await pressed.getAttribute('aria-pressed'), 'true');
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action.light, 'segmented choice takes the main button colour');
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '2px');
        await dialog.screenshot({ path: `${output}/settings-light.png` });
        await context.close();
    }

    // 2. Light and dark at 1280px and 360px.
    for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(mode => { localStorage.setItem('orbis-palette', 'odyssey'); localStorage.setItem('orbis-theme', mode); }, mode);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${name} ${mode} ${width}: no sideways scroll`); await page.screenshot({ path: `${output}/${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^테마 · / }).waitFor();
        assert.match(await page.locator('header').first().evaluate(el => getComputedStyle(el, '::after').backgroundImage), /repeating-linear-gradient/, 'ceiling light panels under the home header');
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), paper[mode]);
        assert.match(await pseudo(page, '.public-header', '::after', 'backgroundImage'), /repeating-linear-gradient/, 'ceiling light panels under the header');
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none');
        assert.equal(await style(page, '.book-cover-series', 'display'), 'none');
        assert.equal(await pseudo(page, '.book-cover', '::before', 'aspectRatio'), '4 / 9', 'monolith on the cover');
        assert.equal(await style(page, '.book-cover', 'borderTopLeftRadius'), '10px');
        assert.equal(await style(page, '.book-read', 'backgroundColor'), action[mode], 'main button colour');
        assert.equal(await style(page, '.public-brand-mark', 'width'), width === 360 ? '6px' : '7px', 'monolith mark');
        assert.equal(await pseudo(page, '.book-category', '::before', 'width'), '4px', 'slab before the kicker');
        assert.match(await pseudo(page, '.library-heading', '::after', 'backgroundImage'), /radial-gradient/, 'HAL eye on the library heading');

        // The eye sits at the right end of the heading, clear of the title, count and date.
        const libraryEye = await page.locator('.library-heading').evaluate(heading => {
            const box = heading.getBoundingClientRect();
            const eyeLeft = box.right - parseFloat(getComputedStyle(heading, '::after').width);

            return [...heading.children].every(child => {
                const range = document.createRange();
                range.selectNodeContents(child);

                return range.getBoundingClientRect().right <= eyeLeft;
            });
        });

        assert.ok(libraryEye, `${mode} ${width}: HAL eye clear of the library heading text`);
        const trigger = page.getByRole('button', { name: /^테마 · / });
        assert.equal(await trigger.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '2px', 'header theme button takes the family shape');

        // The cover title stays inside the cover and above the monolith.
        const placement = await page.locator('.book-cover').first().evaluate(cover => {
            const box = cover.getBoundingClientRect();
            const title = cover.querySelector('strong').getBoundingClientRect();
            const after = cover.querySelector('span:last-child').getBoundingClientRect();
            const slab = getComputedStyle(cover, '::before');
            const slabTop = box.bottom - parseFloat(slab.bottom) - parseFloat(slab.height);

            return { inside: title.top >= box.top && title.bottom <= box.bottom && title.left >= box.left && title.right <= box.right, clear: after.bottom <= slabTop + 1 };
        });

        assert.ok(placement.inside, `${mode} ${width}: cover title inside the cover`);
        assert.ok(placement.clear, `${mode} ${width}: cover title above the monolith`);
        await shot('library');

        await trigger.click();
        await page.locator('.palette-popover').waitFor();
        const pressed = page.getByRole('group', { name: '테마' }).getByRole('button', { name: '오디세이 테마' });
        assert.equal(await pressed.evaluate(el => getComputedStyle(el).backgroundColor), action[mode], 'popover choice takes the main button colour');
        await page.locator('.palette-popover').screenshot({ path: `${output}/popover-${mode}-${width}.png` });
        await page.keyboard.press('Escape');

        const href = await page.locator('.book-read').first().getAttribute('href');
        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        assert.match(await pseudo(page, '.reading-scene-title h2', '::before', 'content'), /decimal-leading-zero/, 'monitor scene number');
        assert.equal(await pseudo(page, '.reading-scene-title h2', '::before', 'borderTopLeftRadius'), '7px');
        assert.match(await pseudo(page, '.reading-title', '::after', 'backgroundImage'), /linear-gradient/, 'monolith-on-horizon divider');
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();

        // At 360px the sidebar is a closed drawer.
        if (width === 1280) assert.match(await pseudo(page, '.studio-tools', '::after', 'backgroundImage'), /repeating-linear-gradient/, 'light panels under the studio tools');
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await style(page, '.doc-divider', 'backgroundImage'), /linear-gradient/, 'monolith divider in the studio');
        assert.match(await pseudo(page, '.doc-head', '::after', 'backgroundImage'), /radial-gradient/, 'HAL eye on the document head');

        // The eye sits in the kicker row, clear of the kicker text and the title.
        const eye = await page.locator('.doc-head').first().evaluate(head => {
            const box = head.getBoundingClientRect();
            const kicker = head.querySelector('.doc-kicker');
            const range = document.createRange();
            range.selectNodeContents(kicker);
            const text = range.getBoundingClientRect();
            const title = head.querySelector('.doc-title').getBoundingClientRect();

            return { clearOfText: text.right <= box.right - 16, aboveTitle: box.top + 16 <= title.top };
        });

        assert.ok(eye.clearOfText && eye.aboveTitle, `${mode} ${width}: HAL eye clear of the kicker and title`);
        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`odyssey palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
