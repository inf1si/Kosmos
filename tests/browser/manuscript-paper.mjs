// Run against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/manuscript-paper');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

async function openDocument(width, palette) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });

    await context.addInitScript(value => localStorage.setItem('orbis-palette', value), palette);
    const page = await context.newPage();

    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
    await page.locator('.studio-home').waitFor();
    await page.locator('.studio-home .reference-card').filter({ hasText: /./ }).nth(0).click();
    await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();

    return { context, page };
}

// Every sheet is 10 rows of 20 equal cells and no letter spills out of its cell.
const paperLayout = page => page.evaluate(() => {
    const sheets = [...document.querySelectorAll('.paper-sheet')];
    const cells = [...document.querySelectorAll('.paper-row > span')];
    const widths = new Set(cells.map(cell => Math.round(cell.getBoundingClientRect().width * 10)));
    const modal = document.querySelector('.paper-modal');

    return {
        sheets: sheets.length,
        meta: document.querySelector('.paper-meta')?.textContent,
        rows: sheets.map(sheet => sheet.querySelectorAll('.paper-row').length),
        columns: [...new Set([...document.querySelectorAll('.paper-row')].map(row => row.children.length))],
        widths: widths.size,
        spilled: cells.flatMap(cell => cell.scrollWidth > cell.clientWidth + 1 ? [cell.textContent] : []),
        first: [...document.querySelectorAll('.paper-row')[0].children].slice(0, 4).map(cell => cell.textContent),
        modalOverflow: modal.scrollWidth - modal.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        focusInside: !!document.activeElement?.closest('[role=dialog]'),
    };
});

try {
    // 1. The statistics popover opens the view for the whole document, including text typed just before.
    {
        const { context, page } = await openDocument(1280, 'ink');
        const editor = page.locator('.editor-panes > .editor-shell .manuscript');

        await editor.locator('p').first().click();
        await page.keyboard.press('Control+Home');
        await page.keyboard.type('새');
        await page.locator('.editor-panes > .editor-shell button[aria-label*="문서 통계 열기"]').click();
        await page.getByRole('button', { name: '원고지로 보기' }).click();
        const dialog = page.getByRole('dialog', { name: '원고지 보기' });

        await dialog.waitFor();
        const layout = await paperLayout(page);

        assert.ok(layout.sheets > 1, 'example document spans several sheets');
        assert.equal(layout.meta, `01. 귀환 · ${layout.sheets}매`);
        assert.deepEqual([...new Set(layout.rows)], [10]);
        assert.deepEqual(layout.columns, [20]);
        assert.equal(layout.widths, 1, 'all cells share one width');
        assert.deepEqual(layout.spilled, []);
        assert.deepEqual(layout.first, ['', '새', '항', '구'], 'paragraph indent cell, then the typed letter');
        assert.ok(layout.focusInside, 'focus moves into the dialog');
        await page.screenshot({ path: resolve(output, 'ink-1280.png') });

        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.match(await editor.locator('p').first().textContent(), /^새항구에/, 'the view does not change the manuscript');
        await context.close();
    }

    // 2. The statistics table shows A4 pages, the toolbar can show them, and the choice survives a reload.
    for (const width of [1280, 360]) {
        const { context, page } = await openDocument(width, 'ink');
        const trigger = page.locator('.editor-panes > .editor-shell button[aria-label*="문서 통계 열기"]');

        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        const row = page.getByRole('row', { name: /A4 · 10pt/u });

        await row.waitFor();
        const pages = await row.locator('td').first().textContent();

        assert.match(pages, /^\d+(\.\d)?$/u, 'A4 pages with one decimal');
        assert.ok(Number(pages) > 0);
        assert.equal(await page.locator('.popover').evaluate(el => el.scrollWidth - el.clientWidth), 0, 'popover fits');
        await page.screenshot({ path: resolve(output, `a4-statistics-${width}.png`) });
        await page.getByRole('combobox', { name: '통계 표시 기준' }).selectOption('a4');
        await page.keyboard.press('Escape');
        assert.match(await trigger.getAttribute('aria-label'), new RegExp(`^${pages.replace('.', '\\.')}매 · A4 · 문서 통계 열기$`, 'u'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home, .editor-panes > .editor-shell .manuscript').first().waitFor();

        if (await page.locator('.studio-home').isVisible()) await page.locator('.studio-home .reference-card').filter({ hasText: /./u }).nth(0).click();
        await page.locator('.editor-panes > .editor-shell .manuscript').waitFor();
        assert.match(await page.locator('.editor-panes > .editor-shell button[aria-label*="문서 통계 열기"]').getAttribute('aria-label'), /매 · A4/u, 'choice kept after reload');
        await context.close();
    }

    // 3. The more menu opens the same view; at 360px the sheet fits without sideways scrolling.
    for (const palette of ['violet', 'nasapunk']) {
        const { context, page } = await openDocument(360, palette);

        await page.getByRole('button', { name: '더 보기' }).click();
        await page.locator('#more-menu').getByRole('button', { name: '원고지 보기' }).click();
        await page.getByRole('dialog', { name: '원고지 보기' }).waitFor();
        const layout = await paperLayout(page);

        assert.deepEqual(layout.columns, [20]);
        assert.deepEqual(layout.spilled, []);
        assert.equal(layout.modalOverflow, 0);
        assert.equal(layout.pageOverflow, 0);
        await page.screenshot({ path: resolve(output, `${palette}-360.png`) });
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(`manuscript paper checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
