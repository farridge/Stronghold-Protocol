// test/sim/loadout.browser.test.js — operator loadouts (DESIGN §16) in the BROWSER sim: headless Chrome loads the
// served /sim/ modules and /data/*.json through the client's own loader (public/js/battle/runner.js loadBrowserSim),
// builds a BattleSpec whose units carry skillIndex / moduleId and must resolve the same defs and produce the same result
// digest as Node (server re-simulation / verification depend on it).
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/sim/loadout.browser.test.js   (or SIM_E2E=1)
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBattleSpec, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = (process.env.RENDER_E2E === '1' || process.env.SIM_E2E === '1') && existsSync(CHROME);
const skip = enabled ? false : 'set RENDER_E2E=1 or SIM_E2E=1 (needs Chrome)';

describe('operator loadouts in the browser sim', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('all six external skills and dual-mode arms give identical battle digests and follower snapshots in Chrome and Node', async () => {
    const ds = getDefaultSource(), tpl = ds.getWave('act1autochess_03');
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    try {
      for (const skillIndex of [0, 1, 2]) for (const moduleId of [undefined, 'none']) {
        const spec = buildBattleSpec({ battleId: `diy:${skillIndex}:${moduleId}`, fieldId: 'n:p1', kind: 'normal', seed: 2178,
          modeId: 'mode_multi_normal', round: 3, stageId: 'act2autochess_m01', timeLimit: 110,
          players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [
            { uid: 1, chessId: 'chess_diy_6_chen3_b', row: 9, col: 5, skillIndex, moduleId,
              items: ['chess_item_5_03_e_b'], carryState: { sp: 999 } },
            { uid: 2, chessId: 'chess_diy_5_wang_b', row: 10, col: 5, skillIndex, moduleId, carryState: { sp: 999 } },
            { uid: 3, kind: 'token', tokenId: 'token_10064_wang_stone1', ownerUid: 2, row: 9, col: 7 },
            { uid: 4, kind: 'token', tokenId: 'token_10064_wang_stone1', ownerUid: 2, row: 12, col: 7 },
          ] }], routes: tpl.routes, spawns: tpl.spawns.filter((s) => !s.action && !s.slot).map((s) =>
            ({ time: s.time, enemyKey: s.key, routeIndex: s.routeIndex, count: s.count, interval: s.interval })) });
        const b = createBattleFromSpec(spec, ds, { quiet: true, recordEvents: false }); b.step();
        const stones = b.snapshot().stones, hash = resultDigest(b.runToEnd(4000)).hash;
        const out = await page.evaluate(async (s) => {
          const { loadBrowserSim } = await import('/js/battle/runner.js');
          const { spec: S, ds } = await loadBrowserSim();
          const b = S.createBattleFromSpec(s, ds, { quiet: true, recordEvents: false }); b.step();
          const stones = b.snapshot().stones;
          return { stones, hash: S.resultDigest(b.runToEnd(4000)).hash, errors: b.errors.map((e) => e.message) };
        }, spec);
        assert.deepEqual(out, { stones, hash, errors: [] }); assert.equal(b.errors.length, 0);
      }
    } finally { await page.close(); }
  });

  test('a spec with loadouts resolves the same defs and gives the same digest in Chrome as in Node', async () => {
    const ds = getDefaultSource();
    const tpl = ds.getWave('act1autochess_03');
    const spec = buildBattleSpec({
      battleId: 'lo1', fieldId: 'n:p1', kind: 'normal', seed: 90210, modeId: 'mode_multi_normal', round: 3, stageId: 'act2autochess_m01',
      timeLimit: 110, players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [
        { uid: 1, chessId: 'chess_char_1_01_a', row: 10, col: 5, dir: 'RIGHT', skillIndex: 0 },
        { uid: 2, chessId: 'chess_char_1_02_a', row: 10, col: 8, dir: 'RIGHT', skillIndex: 0 },
        { uid: 3, chessId: 'chess_char_6_11_b', row: 11, col: 4, dir: 'RIGHT', skillIndex: 1, moduleId: 'uniequip_003_mlyss' },
        { uid: 4, kind: 'token', tokenId: 'token_10030_mlyss_wtrman', ownerUid: 3, row: 12, col: 6 },
      ] }],
      spawns: tpl.spawns.filter((s) => !s.action && !s.slot).map((s) => ({ time: s.time, enemyKey: s.key, routeIndex: s.routeIndex, count: s.count, interval: s.interval })),
      routes: tpl.routes, flags: {}, waveId: 'act1autochess_03',
    });
    const nb = createBattleFromSpec(spec, new DataSource(ds.raw, null), { quiet: true, recordEvents: false });
    const nodeUnits = nb.allyUnits.map((u) => [u.uid, u.def.skill?.id ?? null, u.base.maxHp, u.base.atk]);
    const nodeHash = resultDigest(nb.runToEnd(4000)).hash;

    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const out = await page.evaluate(async (s) => {
      const { loadBrowserSim } = await import('/js/battle/runner.js');
      const { spec: S, ds } = await loadBrowserSim();
      const b = S.createBattleFromSpec(s, ds, { quiet: true, recordEvents: false });
      const units = b.allyUnits.map((u) => [u.uid, u.def.skill?.id ?? null, u.base.maxHp, u.base.atk]);
      return { units, hash: S.resultDigest(b.runToEnd(4000)).hash };
    }, spec);
    await page.close();
    assert.deepEqual(problems, []);
    assert.deepEqual(out.units, nodeUnits, 'same loadout defs in the browser');
    assert.equal(nodeUnits[0][1], 'skchr_inside_1');
    assert.equal(nodeUnits[2][1], 'skchr_mlyss_2');
    assert.equal(nodeUnits[3][1], 'sktok_mlyss_wtrman_2');
    assert.equal(out.hash, nodeHash, 'browser and Node results are identical');
  });
});
