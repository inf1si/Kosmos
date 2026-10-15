// Run through tsx against `pnpm dev` without Supabase settings (local preview); see docs/settings.md for browser/module configuration.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/sidebar-resize');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const sidebarWidth = page => page.locator('.studio-sidebar').evaluate(el => Math.round(el.getBoundingClientRect().width));

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('kosmos-app-preferences') || '{}').sidebarWidth ?? null);

/** Resolves a colour token inside the studio, so the expected value follows each palette. */
async function tokenColor(page, token) {
    return page.locator('.studio').evaluate((el, token) => {
        const probe = document.createElement('i');
        probe.style.color = `var(${token})`;
        el.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();

        return color;
    }, token);
}

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function open(context, path = '/studio') {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.studio-home').waitFor();

    return page;
}

/** Presses the handle's middle and moves the pointer by dx in steps, like a hand drag. */
async function drag(page, dx) {
    const box = await page.getByRole('separator', { name: '사이드바 폭' }).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 8 });
    await page.mouse.up();
}

try {
    // 1. Dragging the edge resizes the sidebar, survives a reload, carries into notes, clamps, and double-click resets.
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
        const page = await open(context);
        const handle = page.getByRole('separator', { name: '사이드바 폭' });
        assert.equal(await sidebarWidth(page), 264, 'default width');
        assert.equal(await handle.getAttribute('aria-orientation'), 'vertical');
        assert.equal(await page.locator('.sidebar-resizer').evaluate(el => getComputedStyle(el, '::after').backgroundColor), 'rgba(0, 0, 0, 0)', 'line hidden at rest');

        // A plain click on the handle saves nothing.
        await handle.click();
        assert.equal(await saved(page), null, 'click without moving keeps the default');

        await drag(page, 100);
        assert.equal(await sidebarWidth(page), 364);
        assert.equal(await saved(page), 364);
        assert.equal(await handle.getAttribute('aria-valuenow'), '364');
        const panel = await page.locator('.studio-panel').boundingBox();
        assert.equal(Math.round(panel.x), 8 + 364 + 8, 'panel keeps the 8px gap after the sidebar');
        await page.mouse.move(8 + 364 + 4, 400);
        assert.equal(await page.locator('.sidebar-resizer').evaluate(el => getComputedStyle(el, '::after').backgroundColor), 'rgb(102, 103, 171)', 'hover shows the --link line');
        await page.screenshot({ path: `${output}/drag-violet-light-1280.png` });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.studio-home').waitFor();
        assert.equal(await sidebarWidth(page), 364, 'width kept after reload');

        await page.getByRole('group', { name: '작업 공간' }).getByRole('button', { name: '노트' }).click();
        await page.locator('.notes-workspace .studio-sidebar').waitFor();
        assert.equal(await sidebarWidth(page), 364, 'notes sidebar uses the same width');
        await drag(page, -64);
        assert.equal(await sidebarWidth(page), 300);
        await drag(page, -200);
        await page.locator('.notes-workspace .studio-sidebar').waitFor({ state: 'detached', timeout: 3000 });
        assert.equal(await saved(page), 300);
        await page.locator('#sidebar-toggle').click();
        await page.locator('.notes-workspace .studio-sidebar').waitFor();
        assert.equal(await sidebarWidth(page), 300);
        await page.getByRole('group', { name: '작업 공간' }).getByRole('button', { name: '집필실' }).click();
        await page.locator('.studio-home').waitFor();
        assert.equal(await sidebarWidth(page), 300, 'studio follows the width set in notes');

        await drag(page, 600);
        assert.equal(await sidebarWidth(page), 480, 'max 480px');
        await drag(page, -300);
        assert.equal(await sidebarWidth(page), 200, 'min 200px without closing');

        // Dragging well past the minimum (below 120px) dims the sidebar, and releasing there closes it; the saved width comes back on reopen.
        {
            const box = await handle.boundingBox();
            const x = box.x + box.width / 2, y = box.y + box.height / 2;
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x - 100, y, { steps: 8 });
            assert.equal(await page.locator('.studio-sidebar').getAttribute('data-collapsing'), '', 'dimmed while past the threshold');
            assert.equal(await page.locator('.studio-sidebar').evaluate(el => getComputedStyle(el).opacity), '0.45');
            assert.equal(await sidebarWidth(page), 200, 'width stays at the minimum while dimmed');
            await page.mouse.move(x - 60, y, { steps: 4 });
            assert.equal(await page.locator('.studio-sidebar').getAttribute('data-collapsing'), null, 'dragging back cancels');
            await page.mouse.move(x - 100, y, { steps: 4 });
            await page.mouse.up();
            await page.locator('.studio-sidebar').waitFor({ state: 'detached', timeout: 3000 });
            assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-pressed'), 'false');
            assert.equal(await saved(page), 200, 'closing keeps the saved width');
            await page.locator('#sidebar-toggle').click();
            await page.locator('.studio-sidebar').waitFor();
            assert.equal(await sidebarWidth(page), 200, 'reopens at the saved width');
            assert.equal(await page.locator('.studio-sidebar').getAttribute('data-collapsing'), null);
        }

        await handle.focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await saved(page), 216);
        await page.keyboard.press('End');
        assert.equal(await sidebarWidth(page), 480);
        await page.keyboard.press('ArrowLeft');
        assert.equal(await sidebarWidth(page), 464);
        await page.keyboard.press('Home');
        assert.equal(await sidebarWidth(page), 200);

        await handle.dblclick();
        assert.equal(await sidebarWidth(page), 264, 'double-click restores the default');
        assert.equal(await saved(page), null);

        // A narrower desktop window caps the saved width at 40% so the editor keeps its room.
        await drag(page, 600);
        await page.setViewportSize({ width: 1000, height: 860 });
        assert.equal(await sidebarWidth(page), 400);
        assert.equal(await overflow(page), 0);

        // Collapsing the sidebar removes the handle with it.
        await page.locator('#sidebar-toggle').click();
        assert.equal(await page.locator('.sidebar-resizer').count(), 0);
        await context.close();
    }

    // 2. The wide-screen default stays 280px until dragged.
    {
        const context = await browser.newContext({ viewport: { width: 1700, height: 900 } });
        const page = await open(context);
        assert.equal(await sidebarWidth(page), 280);
        await context.close();
    }

    // 3. Drawer layouts (900px and below) hide the handle and ignore the dragged width.
    for (const width of [900, 360]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        await context.addInitScript(() => localStorage.setItem('kosmos-app-preferences', JSON.stringify({ sidebarWidth: 480 })));
        const page = await open(context);
        await page.locator('#sidebar-toggle').click();
        await page.locator('.studio-sidebar').waitFor();
        assert.equal(await page.locator('.sidebar-resizer').count(), 0, `no handle at ${width}px`);
        assert.equal(await sidebarWidth(page), width === 900 ? 264 : Math.min(280, Math.round(width * .86)));
        assert.equal(await overflow(page), 0);
        await page.screenshot({ path: `${output}/drawer-${width}.png` });
        await context.close();
    }

    // 4. Every palette × mode with a dragged width and the handle hovered.
    for (const palette of ['violet', 'cassette', 'cyber', 'ink', 'columbia', 'nasapunk']) {
        for (const mode of ['light', 'dark']) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: mode });
            await context.addInitScript(([palette, mode]) => { localStorage.setItem('orbis-palette', palette); localStorage.setItem('orbis-theme', mode); localStorage.setItem('kosmos-app-preferences', JSON.stringify({ sidebarWidth: 340 })); }, [palette, mode]);
            const page = await open(context);
            assert.equal(await sidebarWidth(page), 340, `${palette} ${mode}`);
            const box = await page.getByRole('separator', { name: '사이드바 폭' }).boundingBox();
            await page.mouse.move(box.x + 4, 300);
            const line = await page.locator('.sidebar-resizer').evaluate(el => getComputedStyle(el, '::after').backgroundColor);
            const link = await tokenColor(page, '--link');
            assert.equal(line, link, `${palette} ${mode} line uses --link`);
            await page.screenshot({ path: `${output}/${palette}-${mode}-1280.png`, clip: { x: 0, y: 0, width: 640, height: 420 } });
            await context.close();
        }
    }

    assert.deepEqual(errors, []);
    console.log(`sidebar resize checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
