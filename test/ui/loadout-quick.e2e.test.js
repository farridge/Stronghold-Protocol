// Opt-in real-server browser checks: SP_E2E=1 CHROME_PATH=... node --test test/ui/loadout-quick.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, OUT, CHROME, hasChrome } from '../e2e/client.mjs';
import { richTextPlain } from '../../public/js/ui/richText.js';
import { moduleBadge } from '../../public/js/ui/loadoutModel.js';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const chess = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const byName = (name) => Object.values(chess).find((c) => c.name === name && !c.isGolden && !c.isDiy);
const inside = byName('隐现');
const archetto = byName('空弦');
const garrisons = JSON.parse(readFileSync(path.join(ROOT, 'data/garrisons.json'), 'utf8'));
const card = (c) => `.lo-card[data-chess="${c.chessId}"]`;

describe('quick loadout configuration (real server)', { skip: !enabled && 'set SP_E2E=1 and CHROME_PATH' }, () => {
  let server, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${server.port}`;
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  async function open(t, width = 1920, height = 1080, fourModules = false, touch = false) {
    const ctx = await browser.createBrowserContext();
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (fourModules) {
      // A future valid data record with four modules; no synthetic choice is sent to the server.
      const elite = chess[archetto.goldenId];
      const extra = { ...elite.modules[0], uniEquipId: 'future_test_module', isDefault: false };
      const body = JSON.stringify({ ...chess, [elite.chessId]: { ...elite, modules: [...elite.modules, extra] } });
      await page.setRequestInterception(true);
      page.on('request', (r) => r.url().endsWith('/data/chess.json')
        ? r.respond({ status: 200, contentType: 'application/json', body }) : r.continue());
    }
    await page.setViewport({ width, height, hasTouch: touch });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', 'Quick loadout');
      sessionStorage.setItem('sp.entered', '1');
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lobby-screen [data-testid="loadout-open"]', { visible: true });
    await page.click('.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true });
    return { page, errors };
  }

  test('quick choices persist and sync, while one form switch previews every operator without changing choices', async (t) => {
    const { page, errors } = await open(t);
    await page.click(`${card(inside)} .lo-quick-skill[data-skill="0"]`);
    await page.click(`${card(inside)} .lo-quick-module[data-module="none"]`);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries.chess_char_1_01_a?.module === 'none');
    const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries);
    assert.deepEqual(entries, { [inside.chessId]: { skill: 0, module: 'none' } });
    await page.click('.lo-preview [data-level="elite"]');
    await page.waitForFunction((id) => document.querySelector(`[data-chess="${id}"]`).dataset.variant === 'elite', {}, inside.chessId);
    assert.equal(await page.$eval(card(archetto), (c) => c.dataset.variant), 'elite');
    assert.equal(await page.$eval('.lo-garrisons', (c) => c.dataset.variant), 'elite');
    assert.equal(await page.$$eval('.lo-card__preview', (els) => els.length), 0);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries), entries);
    assert.equal(await page.$eval(`${card(inside)} .lo-quick-skill[data-skill="0"]`, (b) => b.getAttribute('aria-pressed')), 'true');
    const badges = await page.$$eval(`${card(archetto)} .lo-quick-module`, (buttons) => buttons.map((b) => ({
      id: b.dataset.module, type: b.querySelector('.lo-quick-module__type')?.textContent || null,
    })));
    assert.equal(badges[0].id, 'none');
    assert.equal(badges[0].type, null);
    for (const module of chess[archetto.goldenId].modules) {
      assert.equal(badges.find((b) => b.id === module.uniEquipId).type, moduleBadge(module));
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }));
    await page.waitForSelector('.room-screen', { visible: true });
    await page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
    await page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'INFO_CHECK');
    assert.deepEqual(await page.evaluate(() => globalThis.__SP__.store.get().match.private.loadout), entries);
    assert.deepEqual(errors, []);
  });

  test('attributes match the in-game description for each normal/elite form, and previews survive filtering', async (t) => {
    const { page, errors } = await open(t);
    for (const name of ['空弦', '星熊', '缄默德克萨斯']) {
      const c = byName(name);
      await page.click(`${card(c)} .lo-card__pick`);
      for (const rec of [c, chess[c.goldenId]]) {
        await page.click(`.lo-preview [data-level="${rec.isGolden ? 'elite' : 'normal'}"]`);
        await page.waitForFunction((variant) => document.querySelector('.lo-garrisons')?.dataset.variant === variant, {}, rec.isGolden ? 'elite' : 'normal');
        assert.deepEqual(await page.$$eval('.lo-garrisons .dgarrison__text', (els) => els.map((el) => el.textContent)),
          rec.garrisonIds.map((id) => richTextPlain(garrisons[id].descRaw || garrisons[id].desc)));
      }
    }
    await page.click('.lo-chip--t6');
    await page.click('.lo-chip--t6');
    assert.equal(await page.$eval(card(archetto), (c) => c.dataset.variant), 'elite');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout') || '{"entries":{}}').entries), {});
    assert.deepEqual(errors, []);
  });

  test('responsive quick controls and a future four-module row remain reachable without opening mobile detail', async (t) => {
    const { page, errors } = await open(t, 1920, 1080, true);
    for (const [width, height] of [[1920, 1080], [1366, 768], [844, 390], [667, 375], [390, 844], [320, 568]]) {
      await page.setViewport({ width, height });
      const layout = await page.evaluate(() => {
        const grid = document.querySelector('.lo-grid');
        const buttons = [...document.querySelectorAll('.lo-quick-skill, .lo-quick-module')];
        return {
          overflow: document.querySelector('.lo').scrollWidth > innerWidth + 1,
          gridOverflow: grid.scrollWidth > grid.clientWidth + 1,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          controls: buttons.every((b) => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44),
          portraitFirst: [...document.querySelectorAll('.lo-card')].every((c) => {
            const art = c.querySelector('.lo-card__art').getBoundingClientRect();
            const skills = c.querySelector('.lo-quick-skills').getBoundingClientRect();
            const mods = c.querySelector('.lo-quick-mods')?.getBoundingClientRect();
            const name = c.querySelector('.lo-card__name').getBoundingClientRect();
            const skill = c.querySelector('.lo-sicon').getBoundingClientRect().width;
            return art.width >= 96 && skill <= art.width * .4 && skills.left >= art.right
              && name.bottom <= art.bottom && (!mods || (mods.left === skills.left && mods.bottom <= art.bottom + 1));
          }),
          iconsOnly: [...document.querySelectorAll('.lo-quick-skill')].every((b) => !b.textContent.trim()
            || (!b.querySelector('img') && /^S[123]$/.test(b.textContent.trim()))),
          leftAligned: [...document.querySelectorAll('.lo-quick-skills')].every((row) => {
            const buttons = [...row.children].map((b) => b.getBoundingClientRect());
            return buttons[0].left <= row.getBoundingClientRect().left + 1
              && buttons.every((b, i) => !i || Math.abs(b.left - buttons[i - 1].right) < 1);
          }),
        };
      });
      assert.equal(layout.overflow, false, `${width}: page overflow`);
      assert.equal(layout.gridOverflow, false, `${width}: roster overflow`);
      assert.equal(layout.controls, true, `${width}: 44px quick controls`);
      assert.equal(layout.portraitFirst, true, `${width}: the portrait is larger than the skill artwork`);
      assert.equal(layout.iconsOnly, true, `${width}: quick skills show artwork without captions`);
      assert.equal(layout.leftAligned, true, `${width}: missing skills leave empty slots on the right`);
      if (width === 1920 || width === 1366) assert.equal(layout.columns, 3, JSON.stringify(layout));
      if (width === 667) assert.ok(layout.columns >= 2, JSON.stringify(layout));
    }
    await page.setViewport({ width: 667, height: 375 });
    const mods = await page.$eval(`${card(archetto)} .lo-quick-mods`, (row) => ({ n: row.children.length, scrolls: row.scrollWidth > row.clientWidth }));
    assert.deepEqual(mods, { n: 5, scrolls: true });
    await page.focus(`${card(archetto)} .lo-quick-module:last-child`);
    assert.equal(await page.$eval(`${card(archetto)} .lo-quick-mods`, (row) => {
      const last = row.lastElementChild.getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      return row.scrollLeft > 0 && last.left >= bounds.left - 1 && last.right <= bounds.right + 1;
    }), true, 'keyboard focus brings the last module fully into view');
    await page.click(`${card(inside)} .lo-quick-skill[data-skill="0"]`);
    assert.equal(await page.$eval('.lo-roster', (el) => getComputedStyle(el).display === 'none'), false);
    await page.click(`${card(inside)} .lo-quick-module[data-module="none"]`);
    assert.equal(await page.$eval('.lo-detail-wrap', (el) => getComputedStyle(el).display), 'none');
    await page.screenshot({ path: path.join(OUT, 'loadout-quick-phone.png') });
    assert.deepEqual(errors, []);
  });

  test('touch swipes reveal more modules and a revealed choice persists without opening the detail', async (t) => {
    const { page, errors } = await open(t, 667, 375, true, true);
    const row = `${card(archetto)} .lo-quick-mods`;
    await page.$eval(card(archetto), (c) => c.scrollIntoView({ block: 'center' }));
    const box = await (await page.$(row)).boundingBox();
    const y = box.y + box.height / 2;
    await page.touchscreen.touchStart(box.x + box.width * .85, y);
    for (let i = 1; i <= 8; i++) {
      await page.touchscreen.touchMove(box.x + box.width * (.85 - i * .08), y);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await page.touchscreen.touchEnd();
    await page.waitForFunction((selector) => document.querySelector(selector).scrollLeft > 0, {}, row);
    const module = chess[archetto.goldenId].modules.at(-1).uniEquipId;
    await page.focus(`${row} [data-module="${module}"]`);
    const option = await (await page.$(`${row} [data-module="${module}"]`)).boundingBox();
    await page.touchscreen.tap(option.x + option.width / 2, option.y + option.height / 2);
    await page.waitForFunction((id, moduleId) => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries[id]?.module === moduleId, {}, archetto.chessId, module);
    assert.equal(await page.$eval('.lo-detail-wrap', (el) => getComputedStyle(el).display), 'none');
    assert.deepEqual(errors, []);
  });

  test('language switches update accessible labels and game texts without losing choices or the shared preview', async (t) => {
    const { page, errors } = await open(t);
    await page.click(`${card(inside)} .lo-quick-skill[data-skill="0"]`);
    await page.click('.lo-preview [data-level="elite"]');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries);
    await page.evaluate(() => import('/js/ui/lang.js').then((m) => m.switchLang('en')));
    await page.waitForFunction(() => document.documentElement.lang.startsWith('en') && document.querySelector('.lo-tabs').textContent.includes('Operator Loadout'));
    await page.waitForFunction((id) => document.querySelector(`[data-chess="${id}"] .lo-card__name`)?.textContent === 'Archetto', {}, archetto.chessId);
    assert.equal(await page.$eval(card(archetto), (c) => c.dataset.variant), 'elite');
    const labels = await page.$eval(card(archetto), (c) => ({ name: c.querySelector('.lo-card__name').textContent, skill: c.querySelector('.lo-quick-skill').getAttribute('aria-label') }));
    assert.equal(labels.name, 'Archetto');
    assert.match(labels.skill, /Offensive Recovery/);
    assert.match(await page.$eval('.lo-preview [data-level="elite"]', (b) => b.textContent), /Elite/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries), before);
    await page.screenshot({ path: path.join(OUT, 'loadout-quick-en.png') });
    await page.evaluate(() => import('/js/ui/lang.js').then((m) => m.switchLang('zh')));
    await page.waitForFunction(() => document.querySelector('.lo-preview [data-level="normal"]').textContent === '普通');
    assert.deepEqual(errors, []);
  });
});
