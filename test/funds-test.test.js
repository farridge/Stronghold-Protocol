import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FundsTestMatch } from '../server/match/FundsTestMatch.js';
import { makeMatch, checkInvariants } from './match/harness.js';
import { parseArgs } from '../scripts/launch.mjs';
import { attachAudit } from '../server/match/audit.js';

const exec = promisify(execFile);
const launcher = fileURLToPath(new URL('../scripts/launch.mjs', import.meta.url));

test('the separate funds test server starts a real match with 99 funds', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, fundsTest: true });
  t.after(() => srv.close());
  const client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(() => client.terminate());
  const welcome = await client.hello('Tester');
  for (const msg of [{ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }, { t: 'room.start' }]) {
    assert.equal((await client.request(msg)).t, 'ok');
  }
  const view = await client.waitFor('m.private');
  assert.equal(view.funds, 99);
  assert.equal((await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).json()).fundsTest, true);
  await client.terminate();
  const resumed = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(() => resumed.terminate());
  assert.equal((await resumed.hello('Tester', welcome.token)).playerId, welcome.playerId);
  assert.equal((await resumed.waitFor('m.private')).funds, 99);
});

test('the test launcher refuses a regular server on its port rather than opening the wrong build', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => srv.close());
  await assert.rejects(exec(process.execPath, [launcher, '--funds-test', '--port', String(srv.port), '--no-open', '--no-setup']),
    (error) => error.code === 1 && /funds-test/.test(error.stderr));
});

test('test funds stay 99 through upgrades, refreshes, external purchases, sales, income and combat', (t) => {
  const chen = 'chess_diy_6_chen3_a', wang = 'chess_diy_5_wang_a';
  const seats = [0, 1].map((seat) => ({ seat, playerId: `p_${seat}`, name: `Tester${seat}`, connected: true,
    diy: { '5': [wang, null], '6': [chen, null] } }));
  const h = makeMatch({ MatchClass: FundsTestMatch, seats, fake: true });
  const audit = attachAudit(h.m);
  h.start();
  t.after(() => h.m.dispose());
  h.toPrep(1);
  const p = h.ps('p_0'), other = h.ps('p_1');
  assert.equal(p.funds, 99); assert.equal(other.funds, 99);
  for (let i = 0; i < 5; i++) assert.deepEqual(h.m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
  assert.equal(p.shop.level, 6); assert.equal(p.funds, 99);
  p.shop.freeRefreshes = 0;
  for (let i = 0; i < 120; i++) {
    assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true });
    assert.equal(p.funds, 99);
  }
  const goldBefore = p.stats.gold;
  for (const id of [chen, wang]) {
    const copiesBefore = p.pool.left(id), otherBefore = other.pool.left(id);
    p.shop.slots[0] = { kind: 'chess', id, basePrice: 4, sold: false };
    assert.deepEqual(h.m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
    assert.equal(p.funds, 99);
    assert.equal(p.pool.left(id), copiesBefore - 1);
    assert.equal(other.pool.left(id), otherBefore);
    const piece = p.hand.find((v) => v?.id === id);
    assert.ok(piece);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.sell', uid: piece.uid }), { ok: true });
    assert.equal(p.pool.left(id), copiesBefore); assert.equal(p.funds, 99);
  }
  assert.equal(p.stats.gold, goldBefore + 8, 'original payment bookkeeping remains active');
  p.addFunds(15); p.addFunds(-20); p.pendingFunds = 5;
  assert.equal(p.funds, 99);
  h.drive(() => h.m.phase === 'COMBAT');
  assert.equal(p.funds, 99); assert.equal(p.privateView().funds, 99);
  h.toPrep(2);
  assert.equal(p.funds, 99); assert.equal(other.funds, 99);
  assert.equal(p.pendingFunds, 0); checkInvariants(h.m);
  p.funds = 0; p.funds = 1000;
  assert.equal(p.funds, 99);
  p.eliminate(2);
  assert.equal(p.funds, 99, 'the fixed display balance also survives elimination');
  checkInvariants(h.m);
  assert.deepEqual(audit.violations, []);
});

test('ordinary matches retain their real economy and the test launcher keeps separate defaults', (t) => {
  const h = makeMatch({ mode: 'solo', fake: true }).start();
  t.after(() => h.m.dispose());
  assert.equal(h.ps('p_0').funds, 0);
  h.toPrep(1);
  const p = h.ps('p_0');
  assert.equal(p.funds, 4);
  p.shop.freeRefreshes = 0;
  assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true });
  assert.equal(p.funds, 3);
  const args = parseArgs(['--funds-test']);
  assert.equal(args.port, 3001); assert.equal(args.fundsTest, true);
  assert.deepEqual(args.setupArgs, []);
  assert.equal(parseArgs(['--funds-test', '--port', '3200']).port, 3200);
  assert.equal(parseArgs([]).fundsTest, false);
});
