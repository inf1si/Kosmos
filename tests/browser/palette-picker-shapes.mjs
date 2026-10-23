// Run through tsx against `pnpm dev` without Supabase settings (local preview with the example works); see docs/settings.md for browser/module configuration.
// Theme pickers (header theme button, header popover, studio settings segmented) take each family's button shape and main-button colour.
// Families from ink onwards were added with the plain rounded default; this keeps every family distinct from violet.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://localhost:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/palette-picker-shapes');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors = [];

const palettes = ['violet', 'cassette', 'cyber', 'ink', 'columbia', 'nasapunk', 'diesel', 'noir', 'forerunner', 'spartan', 'redbook', 'silmaril', 'babel', 'infinity', 'hitchhiker', 'tron', 'matrix', 'protoss', 'tatooine', 'empire', 'odyssey', 'nostromo', 'inquiry', 'singularity', 'essence', 'relic', 'orbit'];

const names = { violet: '보라', cassette: '카세트', cyber: '사이버', ink: '잉크', columbia: '컬럼비아', nasapunk: '나사펑크', diesel: '디젤', noir: '누아르', forerunner: '선조 유적', spartan: '스파르탄', redbook: '붉은 책', silmaril: '실마릴리온', babel: '바벨', infinity: '무한', hitchhiker: '히치하이커', tron: '트론', matrix: '매트릭스', protoss: '프로토스', tatooine: '타투인', empire: '제국', odyssey: '오디세이', nostromo: '노스트로모', inquiry: '탐구', singularity: '특이점', essence: '정수', relic: '고대 회로', orbit: '궤도' };

const look = el => ['borderRadius', 'clipPath', 'borderTopWidth', 'borderTopColor', 'boxShadow', 'backgroundColor', 'backgroundImage', 'color'].map(key => getComputedStyle(el)[key]).join(' | ');

const pressedLook = el => ['backgroundColor', 'backgroundImage', 'boxShadow', 'clipPath', 'borderRadius'].map(key => getComputedStyle(el)[key]).join(' | ');

try {
    for (const mode of ['light', 'dark']) {
        const seen = { trigger: new Map(), idle: new Map(), pressed: new Map(), segmented: new Map() };

        for (const palette of palettes) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: mode });
            await context.addInitScript(([palette, mode]) => { localStorage.setItem('orbis-palette', palette); localStorage.setItem('orbis-theme', mode); }, [palette, mode]);
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
            await page.locator('.book-list').waitFor();
            const trigger = page.getByRole('button', { name: /^테마 · / });
            seen.trigger.set(palette, await trigger.evaluate(look));
            await trigger.click();
            const picker = page.getByRole('group', { name: '테마' });
            await picker.waitFor();
            const pressed = picker.getByRole('button', { name: `${names[palette]} 테마` });
            assert.equal(await pressed.getAttribute('aria-pressed'), 'true');
            seen.pressed.set(palette, await pressed.evaluate(pressedLook));
            seen.idle.set(palette, await picker.locator('button[aria-pressed=false]').first().evaluate(look));
            // Every name stays on one line inside the 260px popover.
            const heights = await picker.getByRole('button').evaluateAll(list => list.map(b => b.getBoundingClientRect().height));
            assert.ok(heights.every(h => h <= 36), `${palette} ${mode}: picker buttons stay one line (${heights.join(',')})`);
            const overflowing = await picker.getByRole('button').evaluateAll(list => list.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent));
            assert.deepEqual(overflowing, [], `${palette} ${mode}: picker names fit`);
            await page.locator('.palette-popover').screenshot({ path: `${output}/popover-${palette}-${mode}.png` });

            // Clipped shapes drop the clip on keyboard focus so the focus ring shows.
            if (['forerunner', 'spartan', 'babel'].includes(palette)) {
                await pressed.focus();
                await page.keyboard.press('Shift+Tab');
                await page.keyboard.press('Tab');
                assert.deepEqual(await pressed.evaluate(el => [el.matches(':focus-visible'), getComputedStyle(el).clipPath]), [true, 'none'], `${palette} ${mode}: focus ring not clipped`);
            }

            await page.keyboard.press('Escape');

            await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded' });
            await page.locator('.studio-home').waitFor();
            await page.locator('.studio-tools').getByRole('button', { name: '설정', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: '설정' });
            await dialog.waitFor();
            const choice = dialog.getByRole('group', { name: '색 계열', exact: true });
            const current = choice.getByRole('button', { name: names[palette], exact: true });
            assert.equal(await current.getAttribute('aria-pressed'), 'true');
            seen.segmented.set(palette, await current.evaluate(pressedLook));
            await context.close();
        }

        // The selected picker button and the selected settings choice differ from violet's in every other family.
        for (const palette of palettes.slice(1)) {
            assert.notEqual(seen.pressed.get(palette), seen.pressed.get('violet'), `${palette} ${mode}: selected picker button has its own look`);
            assert.notEqual(seen.segmented.get(palette), seen.segmented.get('violet'), `${palette} ${mode}: selected settings choice has its own look`);
        }

        // Families with a distinct button shape also change the header button and the unselected picker buttons.
        // Columbia keeps the default corners and changes only the edge colour to gilt.
        const corners = look => look.split(' | ').slice(0, 3).join();

        for (const palette of ['cyber', 'ink', 'nasapunk', 'diesel', 'noir', 'forerunner', 'spartan', 'redbook', 'silmaril', 'babel', 'infinity', 'hitchhiker', 'tron', 'matrix', 'protoss', 'tatooine', 'empire', 'odyssey', 'nostromo', 'inquiry', 'singularity', 'essence', 'relic', 'orbit']) {
            assert.notEqual(corners(seen.idle.get(palette)), corners(seen.idle.get('violet')), `${palette} ${mode}: picker button shape`);
            assert.notEqual(corners(seen.trigger.get(palette)), corners(seen.trigger.get('violet')), `${palette} ${mode}: header theme button shape`);
        }
    }

    assert.deepEqual(errors, []);
    console.log(`palette picker shape checks passed; screenshots in ${output}`);
} finally {
    await browser.close();
}
