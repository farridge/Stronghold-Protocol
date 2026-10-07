// Actual browser coverage for the opt-in funds test server. Run with SP_E2E=1 and CHROME_PATH.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(chrome);
const out = fileURLToPath(new URL('../e2e/out/', import.meta.url));

describe('funds test build in actual Chrome', { skip: !enabled && 'set SP_E2E=1 and CHROME_PATH' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, fundsTest: true });
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    mkdirSync(out, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const [label, width, height, touch] of [['desktop', 1920, 1080, false], ['phone', 667, 375, true]]) {
    test(`${label}: the real shop displays 99 after upgrading and refreshing`, { timeout: 60000 }, async (t) => {
      const ctx = await browser.createBrowserContext();
      t.after(() => ctx.close());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewport({ width, height, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('sp.name', '资金测试'); sessionStorage.setItem('sp.entered', '1');
      });
      await page.goto(`http://127.0.0.1:${srv.port}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online', { timeout: 30000 });
      const request = (type, body = {}) => page.evaluate((type, body) => globalThis.__SP__.net.request(type, body), type, body);
      await request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
      await request('room.start');
      await page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'INFO_CHECK');
      await request('room.loadout', { entries: {}, diy: {
        '5': ['chess_diy_5_wang_a', null], '6': ['chess_diy_6_chen3_a', null],
      } });
      await request('g.infoReady');
      await page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'BAND_DRAFT');
      await request('g.band', { bandId: 'band_bldsk' });
      await page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'PREP', { timeout: 30000 });
      await page.waitForSelector('.funds__num', { visible: true });
      const click = (selector) => touch ? page.tap(selector) : page.click(selector);
      for (let level = 2; level <= 6; level++) {
        await click('.lvcard');
        await page.waitForSelector('.lvcard.is-armed');
        await click('.lvcard.is-armed');
        await page.waitForFunction((level) => globalThis.__SP__.store.get().match.private?.shop.level === level, {}, level);
        assert.equal(await page.$eval('.funds__num', (e) => e.textContent), '99');
      }
      const count = await page.evaluate(() => globalThis.__SP__.store.get().match.private.stats.refreshes);
      await click('.toolbtn--amber');
      await page.waitForFunction((count) => globalThis.__SP__.store.get().match.private.stats.refreshes > count, {}, count);
      assert.equal(await page.$eval('.funds__num', (e) => e.textContent), '99');
      const state = await page.evaluate(() => globalThis.__SP__.store.get().match.private);
      assert.deepEqual(state.diy, { '5': ['chess_diy_5_wang_a', null], '6': ['chess_diy_6_chen3_a', null] });
      assert.deepEqual(errors, []);
      await page.screenshot({ path: out + `funds-test-${label}.png` });
    });
  }
});
