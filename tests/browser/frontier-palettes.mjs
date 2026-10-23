// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Space frontier families (탐구·특이점·정수·고대 회로·궤도): picker, persistence and every surface in light and dark at 1280px and 360px.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/frontier-palettes');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property);

const pseudo = (page, selector, which, property) => page.locator(selector).first().evaluate((el, [which, property]) => getComputedStyle(el, which)[property], [which, property]);

// Colour and image together, since some main buttons paint the colour inside a gradient.
const paintOf = locator => locator.evaluate(el => {
    const s = getComputedStyle(el);

    return `${s.backgroundColor} ${s.backgroundImage}`;
});

const paint = (page, selector) => paintOf(page.locator(selector).first());

const families = {
    inquiry: { name: '탐구', paper: { light: 'rgb(243, 246, 249)', dark: 'rgb(3, 13, 31)' }, action: { light: 'rgb(11, 42, 92)', dark: 'rgb(242, 246, 251)' } },
    singularity: { name: '특이점', paper: { light: 'rgb(250, 250, 250)', dark: 'rgb(13, 15, 19)' }, action: { light: 'rgb(27, 30, 35)', dark: 'rgb(236, 238, 241)' } },
    essence: { name: '정수', paper: { light: 'rgb(241, 239, 234)', dark: 'rgb(7, 10, 18)' }, action: { light: 'rgb(18, 19, 24)', dark: 'rgb(255, 159, 46)' } },
    relic: { name: '고대 회로', paper: { light: 'rgb(245, 241, 232)', dark: 'rgb(11, 9, 6)' }, action: { light: 'rgb(201, 150, 46)', dark: 'rgb(227, 184, 90)' } },
    orbit: { name: '궤도', paper: { light: 'rgb(238, 243, 245)', dark: 'rgb(5, 13, 23)' }, action: { light: 'rgb(13, 102, 112)', dark: 'rgb(69, 211, 216)' } },
};

try {
    // 1. The five families follow nostromo at the end of the header picker; picking one persists and the studio settings show it.
    for (const [id, family] of Object.entries(families)) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        await page.getByRole('button', { name: /^테마 · / }).click();
        const picker = page.getByRole('group', { name: '테마' });
        const labels = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
        assert.deepEqual(labels.slice(21), ['마더 테마', '탐구 테마', '특이점 테마', '정수 테마', '고대 회로 테마', '궤도 테마']);
        await picker.getByRole('button', { name: `${family.name} 테마` }).click();
        assert.equal(await page.getByRole('button', { name: /^테마 · / }).getAttribute('aria-label'), `테마 · ${family.name}`);
        assert.equal(await page.evaluate(() => localStorage.getItem('orbis-palette')), id);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), id, 'head script keeps the family before paint');
        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '설정' });
        await dialog.waitFor();
        const pressed = dialog.getByRole('group', { name: '색 계열', exact: true }).getByRole('button', { name: family.name, exact: true });
        assert.equal(await pressed.getAttribute('aria-pressed'), 'true');
        assert.ok((await paintOf(pressed)).includes(family.action.light), `${id}: segmented choice takes the main button colour`);
        await dialog.screenshot({ path: `${output}/${id}-settings-light.png` });
        await context.close();
    }

    // 2. Light and dark at 1280px and 360px.
    for (const [id, family] of Object.entries(families)) for (const mode of ['light', 'dark']) for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, colorScheme: mode });
        await context.addInitScript(([id, mode]) => { localStorage.setItem('orbis-palette', id); localStorage.setItem('orbis-theme', mode); }, [id, mode]);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const tag = `${id} ${mode} ${width}`;
        const shot = async name => { assert.ok(await overflow(page) <= 0, `${name} ${tag}: no sideways scroll`); await page.screenshot({ path: `${output}/${id}-${name}-${mode}-${width}.png` }); };

        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^테마 · / }).waitFor();
        assert.notEqual(await page.locator('header').first().evaluate(el => getComputedStyle(el, '::after').backgroundImage), 'none', `${tag}: line under the home header`);
        await shot('home');

        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        await page.locator('.book-list').waitFor();
        assert.equal(await style(page, '.public-site', 'backgroundColor'), family.paper[mode]);
        assert.notEqual(await pseudo(page, '.public-header', '::after', 'backgroundImage'), 'none', `${tag}: line under the header`);
        assert.equal(await style(page, '.book-cover svg', 'display'), 'none');
        assert.equal(await style(page, '.book-cover-series', 'display'), 'none');
        assert.match(await style(page, '.book-cover', 'backgroundImage'), /data:image\/svg\+xml/, `${tag}: cover scene`);
        assert.match(await style(page, '.public-brand-mark', 'backgroundImage'), /data:image\/svg\+xml/, `${tag}: brand mark`);
        assert.ok((await paint(page, '.book-read')).includes(family.action[mode]), `${tag}: main button colour`);
        assert.notEqual(await pseudo(page, '.book-category', '::before', 'content'), 'none', `${tag}: mark before the kicker`);

        if (id === 'essence' && mode === 'light') assert.equal(await style(page, '.public-header', 'backgroundColor'), 'rgb(11, 12, 16)', `${tag}: black header bar on light paper`);

        // The cover title stays inside the cover.
        const inside = await page.locator('.book-cover').first().evaluate(cover => {
            const box = cover.getBoundingClientRect();
            const text = cover.querySelector('strong').getBoundingClientRect();

            return text.top >= box.top && text.bottom <= box.bottom && text.left >= box.left && text.right <= box.right;
        });

        assert.ok(inside, `${tag}: cover title inside the cover`);

        // The header stays one row at 360px.
        const rows = await page.locator('.public-header').first().evaluate(header => new Set([...header.children].map(el => Math.round(el.getBoundingClientRect().top / 20))).size);
        assert.equal(rows, 1, `${tag}: header on one row`);
        await shot('library');

        const trigger = page.getByRole('button', { name: /^테마 · / });
        await trigger.click();
        await page.locator('.palette-popover').waitFor();
        const pressed = page.getByRole('group', { name: '테마' }).getByRole('button', { name: `${family.name} 테마` });
        assert.equal(await pressed.getAttribute('aria-pressed'), 'true');
        assert.ok((await paintOf(pressed)).includes(family.action[mode]), `${tag}: popover choice takes the main button colour`);
        await page.locator('.palette-popover').screenshot({ path: `${output}/${id}-popover-${mode}-${width}.png` });
        await page.keyboard.press('Escape');

        const href = await page.locator('.book-read').first().getAttribute('href');
        await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.reading-body').first().waitFor();
        assert.match(await pseudo(page, '.reading-scene-title h2', '::before', 'content'), /decimal-leading-zero/, `${tag}: scene number`);
        assert.match(await pseudo(page, '.reading-title', '::after', 'backgroundImage'), /data:image\/svg\+xml/, `${tag}: divider under the title`);
        await shot('reader');

        await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        await shot('studio-home');
        await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await style(page, '.doc-divider', 'backgroundImage'), /data:image\/svg\+xml/, `${tag}: divider in the studio`);
        assert.notEqual(await pseudo(page, '.doc-kicker', '::before', 'content'), 'none', `${tag}: mark before the studio kicker`);
        await shot('studio-editor');
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`frontier palette checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
