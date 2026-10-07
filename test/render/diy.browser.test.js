// Real browser rendering of external squads and snapshot-backed followers on a united field.
// Opt-in: RENDER_E2E=1 node --test test/render/diy.browser.test.js (CHROME_PATH on Windows).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const spec = buildBattleSpec({ battleId: 'diy-render', fieldId: 'u', kind: 'unite', seed: 81, round: 3,
  modeId: 'mode_multi_normal', stageId: 'act2autochess_m01', rect: GEO.UNITE_RECT, timeLimit: 200,
  routes: [{ motion: 'WALK', start: [12, 18], end: [9, 2], checkpoints: [] }],
  spawns: [{ time: 190, enemyKey: 'enemy_1000_gopro_2', routeIndex: 0 }],
  players: [0, 1].map((seat) => ({ playerId: `p${seat}`, seat, side: 'L', colOffset: seat * 8, bonds: {}, playerEffects: [],
    units: [{ uid: 1, chessId: 'chess_diy_5_chen3_b', row: 10, col: 5, items: ['chess_item_5_03_e_b'] },
      { uid: 2, chessId: 'chess_diy_6_wang_b', row: 11, col: 5 },
      { uid: 3, kind: 'token', tokenId: 'token_10064_wang_stone1', ownerUid: 2, row: 9, col: 7 }] })) });

describe('external squads and follower effects in Chrome', { skip: !enabled && 'set RENDER_E2E=1 (needs Chrome and assets)' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const [width, height, touch] of [[1280, 720, false], [667, 375, true]]) test(`unite followers render and clear at ${width}×${height}`, async () => {
    const page = await browser.newPage(), problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    try {
      await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&paused=1&panel=0&board=2d`);
      await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error);
      const state = await page.evaluate(async (spec) => {
        if (window.__demo.error) throw new Error(window.__demo.error);
        const { loadBrowserSim } = await import('/js/battle/runner.js');
        const { spec: S, ds } = await loadBrowserSim();
        const b = S.createBattleFromSpec(spec, ds, { quiet: true }), v = window.__demo.view;
        v.enterBattle(b.fieldMeta()); v.setCamera('unite', { rect: spec.rect, instant: true });
        v.setLocalFeed({ on: true, speed: 2 });
        const frame = () => {
          const ev = b.drainEvents(); if (ev.length) v.pushEvents({ t: 'b.ev', fieldId: 'u', gt: b.time, ev });
          const { t, ...snap } = b.snapshot(); v.pushSnapshot({ ...snap, t: 'b.snap', fieldId: 'u', gt: t });
        };
        b.step(); frame();
        window.__diyRender = { b, v, frame };
        await new Promise((r) => setTimeout(r, 1200));
        const fx = v.debug.fx;
        return { stones: fx.stones, drawn: fx.stoneGfx.geometry.graphicsData.length,
          units: [...v.debug.views.values()].filter((u) => u.defId?.includes('diy_')).length, errors: b.errors.length };
      }, spec);
      assert.equal(state.stones.length, 2); assert.equal(new Set(state.stones.map((s) => s[0])).size, 2);
      assert.ok(state.drawn > 0); assert.equal(state.errors, 0);
      await page.screenshot({ path: path.join(OUT, `diy-unite-${touch ? 'phone' : 'desktop'}.png`) });
      const cleared = await page.evaluate(async () => {
        const { b, v, frame } = window.__diyRender;
        for (const u of b.allyUnits) if (u.mem.wang) u.mem.wang.followers = [];
        b.step(); frame(); await new Promise((r) => setTimeout(r, 100));
        return { stones: v.debug.fx.stones.length, drawn: v.debug.fx.stoneGfx.geometry.graphicsData.length };
      });
      assert.deepEqual(cleared, { stones: 0, drawn: 0 }); assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });
});
