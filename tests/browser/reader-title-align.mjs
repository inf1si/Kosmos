// Run against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Regression: the work title in the sticky reading bar sat 14–15px left of the big title because the bar's side buttons differ in width.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/reader-title-align');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const palettes = ['violet', 'cassette', 'cyber', 'ink', 'columbia', 'nasapunk'];

const errors = [];

// Centre of the drawn glyphs: text rects minus the trailing letter-spacing the browser adds after the last glyph.
const centres = page => page.evaluate(() => {
    const ink = el => {
        const range = document.createRange();
        range.selectNodeContents(el);

        const rects = [...range.getClientRects()];
        const spacing = parseFloat(getComputedStyle(el).letterSpacing) || 0;

        return (Math.min(...rects.map(r => r.left)) + Math.max(...rects.map(r => r.right)) - spacing) / 2;
    };

    const bar = document.querySelector('.reading-controls>span');

    return {
        title: ink(document.querySelector('.reading-title h1')),
        bar: ink(bar),
        // A cut title's text runs on past the ellipsis, so its visible centre is the box's centre.
        barBox: (bar.getBoundingClientRect().left + bar.getBoundingClientRect().right) / 2,
        kicker: ink(document.querySelector('.reading-title>span')),
        subtitle: ink(document.querySelector('.reading-title>p')),
        truncated: bar.scrollWidth > bar.clientWidth,
        barHeight: document.querySelector('.reading-controls').getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
});

try {
    for (const width of [1280, 360]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
        const href = await page.locator('a[href^="/read/"]').first().getAttribute('href');

        for (const palette of palettes) for (const mode of ['light', 'dark']) {
            await page.evaluate(([palette, mode]) => { localStorage.setItem('orbis-palette', palette); localStorage.setItem('orbis-theme', mode); }, [palette, mode]);
            await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
            await page.locator('.reading-title h1').waitFor();
            await page.evaluate(() => document.fonts.ready);
            const label = `${palette} ${mode} ${width}px`;
            const r = await centres(page);
            assert.ok(Math.abs(r.bar - r.title) < 1, `${label}: bar title ${(r.bar - r.title).toFixed(1)}px off the big title`);
            assert.ok(Math.abs(r.kicker - r.title) < 1, `${label}: kicker ${(r.kicker - r.title).toFixed(1)}px off the big title`);
            assert.ok(Math.abs(r.subtitle - r.title) < 1, `${label}: subtitle off the big title`);
            assert.equal(r.barHeight, 52, `${label}: bar stays one line`);
            assert.equal(r.overflow, 0, `${label}: no sideways scroll`);
            await page.screenshot({ path: resolve(output, `${palette}-${mode}-${width}.png`), clip: { x: 0, y: 0, width, height: 360 } });
        }

        // A title too long for the bar is cut with an ellipsis and still sits on the centre line.
        await page.evaluate(() => { document.querySelector('.reading-controls>span').textContent = '먼 별의 항구에서 돌아온 사람들의 아주 긴 이야기'; });
        const long = await centres(page);

        if (width === 360) assert.equal(long.truncated, true, 'long title is cut at 360px');
        assert.ok(Math.abs(long.barBox - long.title) < 1, `${width}px: long bar title ${(long.barBox - long.title).toFixed(1)}px off the big title`);
        assert.equal(long.barHeight, 52, `${width}px: long title keeps the bar one line`);
        assert.equal(long.overflow, 0, `${width}px: long title causes no sideways scroll`);

        // The hidden spacer copy is not a second 읽기 설정 button for keyboard or screen-reader users.
        assert.equal(await page.getByRole('button', { name: '읽기 설정', exact: true }).count(), 1);
        await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
        await page.getByRole('dialog', { name: '읽기 설정', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '목차', exact: true }).click();
        await page.locator('.reading-toc').waitFor();
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`reader title alignment: 12 themes × 2 widths, long title, controls — screenshots in ${output}`);
} finally {
    await browser.close();
}
