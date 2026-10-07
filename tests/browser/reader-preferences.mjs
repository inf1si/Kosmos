// Use an isolated production preview and synthetic IndexedDB data; never writes a published work.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { manuscriptFonts, fontSizes } from '../../src/lib/editor-preferences.ts';
import { seedWorkspace } from '../../src/lib/seed.ts';

const require = createRequire(import.meta.url);

const { chromium } = require(process.env.KOSMOS_PLAYWRIGHT_MODULE || 'playwright-core');

const base = process.env.KOSMOS_TEST_BASE_URL || 'http://127.0.0.1:3210';

const output = resolve(process.env.KOSMOS_BROWSER_OUTPUT || 'test-results/reader-preferences');

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.KOSMOS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const page = await context.newPage();

page.setDefaultTimeout(15000);

page.setDefaultNavigationTimeout(60000);

const errors = [], failedFonts = [], fonts = [], layouts = [], renderedFonts = [];

const cdp = await context.newCDPSession(page);

await cdp.send('DOM.enable');

await cdp.send('CSS.enable');

page.on('pageerror', error => errors.push(error.message));

page.on('response', response => {
    if (/\.(woff2?|ttf)(\?|$)/.test(response.url()) && new URL(response.url()).origin === new URL(base).origin) {
        assert(response.ok(), `font response ${response.status()}`);
        fonts.push(new URL(response.url()).pathname);
    }
});

page.on('requestfailed', request => {
    if (/\.(woff2?|ttf)(\?|$)/.test(request.url()) && new URL(request.url()).origin === new URL(base).origin) failedFonts.push(new URL(request.url()).pathname);
});

const open = async () => {
    await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
    await page.getByRole('dialog', { name: '읽기 설정', exact: true }).waitFor();
};

const font = () => page.getByRole('combobox', { name: '글꼴', exact: true });

const sizes = () => page.getByRole('combobox', { name: '글자 크기', exact: true });

const input = () => page.getByRole('spinbutton', { name: '크기 직접 입력 (px)', exact: true });

const body = () => page.locator('.reading-body').first();

const computedSize = () => body().evaluate(el => parseFloat(getComputedStyle(el).fontSize));

try {
    await page.goto(`${base}/library`, { waitUntil: 'domcontentloaded' });
    await page.getByText('기기 내 미리보기 · 예시 작품을 포함합니다', { exact: true }).waitFor();
    await page.locator('.book-list').waitFor();
    const data = seedWorkspace();
    const work = data.works.find(work => work.activePublicationId);
    const workId = work.id;
    work.publications.find(pub => pub.id === work.activePublicationId).scenes[0].content.content.unshift({ type: 'paragraph', content: [{ type: 'text', text: '글꼴 확인 가나다 항구 123 abc' }] });
    await page.evaluate(async data => {
        await new Promise((resolve, reject) => {
            const request = indexedDB.open('orbit-novel-studio-v1');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result, transaction = db.transaction('workspaces', 'readwrite');
                transaction.objectStore('workspaces').put({ namespace: 'preview', data, localVersion: 1, cloudVersion: 0, dirty: false, lastExportAt: null });
                transaction.oncomplete = () => { db.close(); resolve(); };

                transaction.onerror = () => { db.close(); reject(transaction.error); };
            };
        });
        localStorage.setItem('orbit-reader-prefs', JSON.stringify({ font: 'sans', size: 23, width: 580 }));
        localStorage.setItem('orbis-editor-preferences', JSON.stringify({ font: 'system', size: 18 }));
    }, data);
    await page.goto(`${base}/read/${workId}`, { waitUntil: 'domcontentloaded' });
    await body().waitFor();
    await open();
    assert.equal(await font().locator('option').count(), 20);
    assert.equal(await font().inputValue(), 'ibm-plex', 'old sans preference migrates');
    assert.equal(await sizes().inputValue(), '23', 'old custom size is retained');
    assert.equal(await page.getByRole('combobox', { name: '본문 폭', exact: true }).inputValue(), '580');
    assert.deepEqual(await sizes().locator('option').evaluateAll(list => list.map(option => Number(option.value))), [...fontSizes, 23].sort((a, b) => a - b));

    // Native select keyboard operation and actual webfont rendering.
    await font().focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await font().inputValue(), 'system');

    for (const item of manuscriptFonts) {
        await font().selectOption(item.id);

        const actual = await body().evaluate(async (el, item) => {
            el.getBoundingClientRect();
            await document.fonts.ready;
            const style = getComputedStyle(el);
            let expected = item.family.replace(/var\((--[\w-]+)\)/g, (_, variable) => style.getPropertyValue(variable).trim());
            const probe = document.createElement('span');
            probe.style.fontFamily = expected;
            el.append(probe);
            expected = getComputedStyle(probe).fontFamily;
            probe.remove();

            return { actual: style.fontFamily, expected };
        }, item);

        assert.equal(actual.actual, actual.expected, item.label);

        if (manuscriptFonts.indexOf(item) < 16) {
            const { root } = await cdp.send('DOM.getDocument');
            const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.reading-body p > span:first-child' });
            const platform = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
            assert(platform.fonts.length > 0 && platform.fonts.every(face => face.isCustomFont), `webfont rendered: ${item.label} ${JSON.stringify(platform.fonts)}`);
            renderedFonts.push({ id: item.id, label: item.label, families: [...new Set(platform.fonts.map(face => face.familyName))] });
        }
    }

    assert(fonts.length > 0, 'selected fonts are served by the app');
    assert.equal(new Set(renderedFonts.flatMap(item => item.families)).size, 16, 'sixteen distinct webfont families actually render');

    for (const size of fontSizes) {
        await sizes().selectOption(String(size));
        assert.equal(await computedSize(), size);
    }

    await input().fill('22.5');
    await input().press('Enter');
    assert.equal(await computedSize(), 22.5);
    assert.equal(await sizes().inputValue(), '22.5');

    for (const invalid of ['99', '20.1', '']) {
        await input().fill(invalid);
        await sizes().focus();
        assert.equal(await input().inputValue(), '22.5');
        assert.equal(await computedSize(), 22.5);
    }

    await input().fill('40');
    await input().press('Escape');
    await page.getByRole('dialog', { name: '읽기 설정', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '읽기 설정', exact: true }).evaluate(el => el === document.activeElement), true);
    await open();
    assert.equal(await input().inputValue(), '22.5');
    assert.equal(await computedSize(), 22.5);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    assert.equal(await font().inputValue(), 'system');
    assert.equal(await computedSize(), 22.5);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('orbis-editor-preferences'))), { font: 'system', size: 18 });

    for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 850 });

        for (const palette of ['violet', 'cassette', 'cyber']) for (const theme of ['light', 'dark']) {
            await page.getByRole('combobox', { name: '테마', exact: true }).selectOption(palette);
            await page.getByRole('combobox', { name: '배경', exact: true }).selectOption(theme);
            await font().selectOption('maruburi');
            await sizes().selectOption('72');
            assert.equal(await computedSize(), 72, 'mobile does not cap the chosen size');

            const layout = await page.getByRole('dialog', { name: '읽기 설정', exact: true }).evaluate(el => {
                const box = el.getBoundingClientRect();

                return { inside: box.left >= 11 && box.right <= innerWidth - 11, controlsFit: [...el.querySelectorAll('input,select')].every(control => control.getBoundingClientRect().right <= box.right - 8), overflow: document.documentElement.scrollWidth > innerWidth };
            });

            assert.deepEqual(layout, { inside: true, controlsFit: true, overflow: false });
            await sizes().selectOption('24');
            await page.screenshot({ path: resolve(output, `${palette}-${theme}-${width}.png`) });
            layouts.push({ width, palette, theme });
        }
    }

    await font().selectOption('pretendard');
    await page.getByRole('button', { name: '목차', exact: true }).click();
    await page.getByRole('dialog', { name: '읽기 설정', exact: true }).waitFor({ state: 'hidden' });
    assert(await page.locator('.reading-toc').isVisible());
    await page.getByRole('button', { name: '목차 닫기', exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    assert.equal(await font().inputValue(), 'pretendard');
    assert.equal(await computedSize(), 24);
    await page.evaluate(() => localStorage.setItem('orbit-reader-prefs', JSON.stringify({ font: 'serif', size: 17, width: 680 })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    assert.equal(await font().inputValue(), 'gowun');
    assert.equal(await computedSize(), 17);
    assert.deepEqual(errors, []);
    assert.deepEqual(failedFonts, []);
    const report = { passed: true, fonts: manuscriptFonts.length, presets: fontSizes.length, layouts, fontResponses: fonts.length, renderedFonts, errors, failedFonts };
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, layouts: layouts.length }));
} catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    throw error;
} finally {
    await context.close();
    await browser.close();
}
