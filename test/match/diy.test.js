import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor } from './harness.js';
import { checkDiySelection } from '../../shared/diy.js';
import { createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { applyCard } from '../../server/match/choices.js';
import { uniteBattleOpts } from '../../server/match/unite.js';

const chen = 'chess_diy_5_chen3_a';
const seats = [0, 1].map((seat) => ({ seat, playerId: `p_${seat}`, name: `P${seat}`, connected: true,
  diy: { '5': [chen, null], '6': [null, null] } }));
test('external copies belong to one player while fixed copies still belong to the shared pool', () => {
  const h = makeMatch({ seats, fake: true });
  const a = h.ps('p_0'), b = h.ps('p_1');
  assert.equal(a.pool.left(chen), 8);
  assert.equal(b.pool.left(chen), 8);
  assert.equal(h.m.pool.has(chen), false);
  const piece = a.acquireChess(chen);
  assert.ok(piece);
  assert.equal(a.pool.left(chen), 7);
  assert.equal(b.pool.left(chen), 8);
  a.returnCopies(piece);
  assert.equal(a.pool.left(chen), 8);
  const fixed = h.m.gd.visibleChess[0];
  a.pool.take(fixed);
  assert.equal(a.pool.left(fixed), b.pool.left(fixed));
  assert.equal(a.acquireChess('chess_diy_6_wang_a'), null);
});

test('selection rejects duplicates and unknown ids, defaults empty, and locks after briefing', () => {
  assert.deepEqual(checkDiySelection().diy, { '5': [null, null], '6': [null, null] });
  assert.equal(checkDiySelection({ '5': [chen, chen] }).error, 'BAD_TARGET');
  assert.equal(checkDiySelection({ '5': [chen, null], '6': ['chess_diy_6_chen3_a', null] }).error, 'BAD_TARGET');
  assert.equal(checkDiySelection({ '5': ['unknown', null] }).error, 'BAD_MSG');
  const h = makeMatch({ seats, fake: true });
  h.start();
  assert.equal(h.m.setLoadout('p_0', { [chen]: { skill: 0, module: 'none' } }, seats[0].diy).ok, true);
  const p = h.ps('p_0');
  assert.equal(p.loadoutFor(h.m.gd.chess(chen.replace(/_a$/, '_b'))).moduleId, 'none');
  h.runToPhase('PREP');
  assert.equal(h.m.setLoadout('p_0', {}, {}).error, 'WRONG_PHASE');
  assert.equal(p.diy['5'][0], chen);
});

test('external merge, sale and exhaustion use the personal pool, and beacon refuses both states without consuming', () => {
  const h = makeMatch({ seats, fake: true });
  h.start(); h.runToPhase('PREP');
  const p = h.ps('p_0'), other = h.ps('p_1');
  const first = p.acquireChess(chen);
  const beaconId = Object.keys(h.m.gd.raw.items).find((id) => h.m.gd.item(id).effectId === 'eff_acarm109');
  const beacon = p.acquireItem(beaconId);
  const before = { funds: p.funds, effects: p.effects.length };
  assert.equal(p.equip(beacon.uid, first.uid).error, 'BAD_TARGET');
  assert.ok(p.find(beacon.uid)); assert.ok(p.find(first.uid));
  p.acquireChess(chen);
  const elite = p.acquireChess(chen);
  assert.equal(elite.id, chen.replace(/_a$/, '_b'));
  assert.equal(elite.poolCopies, 3);
  assert.equal(p.pool.left(chen), 5);
  assert.equal(other.pool.left(chen), 8);
  assert.equal(p.equip(beacon.uid, elite.uid).error, 'BAD_TARGET');
  assert.deepEqual({ funds: p.funds, effects: p.effects.length }, before);
  assert.ok(p.find(beacon.uid));
  assert.equal(p.sell(elite.uid).ok, true);
  assert.equal(p.pool.left(chen), 8);
  p.pool.take(chen, 8);
  assert.equal(p.acquireChess(chen), null);
  assert.equal(p.pool.roll(h.m.rngMeta, { filter: (id) => id === chen }), null);
  p.pool.give(chen, 8);
  h.invariants();
});

test('external promotion and elite reward rolls require all three private copies', () => {
  const h = makeMatch({ seats, fake: true }); h.start(); h.runToPhase('PREP');
  const p = h.ps('p_0'), piece = p.acquireChess(chen);
  p.pool.take(chen, 6);
  assert.equal(p.promote(piece), false);
  assert.equal(piece.id, chen); assert.equal(piece.poolCopies, 1); assert.equal(p.pool.left(chen), 1);
  p.pool.give(chen, 6);
  assert.equal(p.promote(piece), true); assert.equal(piece.poolCopies, 3);
  assert.equal(p.pool.left(chen), 5); assert.equal(h.ps('p_1').pool.left(chen), 8);
  h.invariants(); h.m.dispose();
});

test('external shop buys, reward offers, grants and departure conserve private copies', () => {
  const h = makeMatch({ seats, fake: true }); h.start(); h.runToPhase('PREP');
  const p = h.ps('p_0'), other = h.ps('p_1');
  p.funds = 20; p.shop.slots = [{ kind: 'chess', id: chen, price: 3, sold: false }];
  assert.equal(p.buy(0).ok, true); assert.equal(p.pool.left(chen), 7); assert.equal(other.pool.left(chen), 8);
  assert.deepEqual(p.pushRewardOffer('test', { ids: [chen, 'chess_diy_6_wang_a'] }).slots.map((s) => s.id), [chen]);
  const grant = h.m.rollPool(Object.keys(h.m.gd.choices.pools).find((id) => {
    const pool = h.m.gd.choices.pools[id]; return pool.kind === 'chess' && !pool.items && !pool.weighted;
  }), { player: p });
  assert.ok(!grant || !h.m.gd.chess(grant.id).isDiy || grant.id.startsWith('chess_diy_5_chen3'));
  h.m.onLeave('p_0');
  assert.equal(p.pool.left(chen), 8); assert.equal(other.pool.left(chen), 8); h.invariants(); h.m.dispose();
});

test('external loadouts reach teammate views and disconnected browser combat is taken over deterministically', () => {
  const selectedSeats = seats.map((s) => ({ ...s, diy: { '5': [chen, null], '6': ['chess_diy_6_wang_a', null] } }));
  const h = makeMatch({ seats: selectedSeats, clientCombat: true, captureFrames: false, perPlayer: { p_1: { mute: true } } });
  h.start(); h.toPrep(1); h.setStage('act2autochess_m01');
  for (const p of h.m.players.values()) {
    for (const piece of p.allChess()) { p.returnCopies(piece); }
    p.hand.fill(null); p.temp.fill(null); p.board.clear();
    const c = 'chess_diy_5_chen3_b';
    give(h.m, p, c, 'board', legalTileFor(h.m, p, c));
    const w = 'chess_diy_6_wang_b';
    give(h.m, p, w, 'board', legalTileFor(h.m, p, w, new Set(p.board.keys())));
    const stack = p.hand.find((x) => x?.kind === 'token');
    assert.equal(h.m.handle(p.playerId, { t: 'g.move', uid: stack.uid, to: { area: 'board', row: 9, col: 7 } }).ok, true);
  }
  assert.equal(h.m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }).ok, true);
  assert.ok(h.lastTo('p_0', 'm.field').units.some((u) => u.defId === 'chess_diy_6_wang_b'));
  for (const p of h.m.players.values()) h.m.handle(p.playerId, { t: 'g.ready', ready: true });
  h.runToPhase('COMBAT');
  const field = h.m.fields.find((f) => f.fieldId === 'n:p_1');
  assert.ok(field.spec.players[0].units.some((u) => u.tokenId === 'token_10064_wang_stone1'));
  h.sched.advance(3000); h.m.onDisconnect('p_1');
  assert.equal(field.mode, 'server'); assert.ok(field.result);
  const honest = createBattleFromSpec(field.spec, h.m.ds, { quiet: true }).runToEnd(4000);
  assert.equal(resultDigest(field.result).hash, resultDigest(honest).hash);
  h.m.onReconnect('p_1'); assert.equal(h.lastTo('p_1', 'b.start').authoritative, false);
  assert.equal(h.m.errorCount, 0); h.invariants(); h.m.dispose();
});

test('bond recruitment can draw selected externals after the shared fixed copies are exhausted', () => {
  const h = makeMatch({ seats, fake: true }); h.start(); h.runToPhase('PREP');
  const p = h.ps('p_0'); p.shop.level = 5;
  const saved = new Map([...h.m.pool.entries].map(([id, e]) => [id, e.left]));
  for (const e of h.m.pool.entries.values()) e.left = 0;
  const id = Object.keys(h.m.gd.raw.effects).find((id) => h.m.gd.effect(id).buffs?.some((b) =>
    b.key === 'single_special_choice_gain_bond_chess' && b.bbStr?.bond === 'yanShip'));
  assert.ok(id, 'the real Yan recruitment choice exists');
  applyCard(h.m, p, { id, kind: 'tactic' });
  assert.ok(p.allChess().some((c) => c.id === chen));
  assert.equal(p.pool.left(chen), 7); assert.equal(h.ps('p_1').pool.left(chen), 8);
  for (const [base, left] of saved) h.m.pool.entries.get(base).left = left;
  h.invariants(); h.m.dispose();
});

test('two external squads enter unite with carried HP/SP and owner-isolated stones', () => {
  const selectedSeats = seats.map((s) => ({ ...s, diy: { '5': [chen, null], '6': ['chess_diy_6_wang_a', null] } }));
  const h = makeMatch({ seats: selectedSeats, fake: true }); h.start(); h.toPrep(1); h.setStage('act2autochess_m01');
  const helpers = [...h.m.players.values()];
  for (const p of helpers) {
    for (const piece of p.allChess()) p.returnCopies(piece);
    p.hand.fill(null); p.temp.fill(null); p.board.clear();
    const c = give(h.m, p, 'chess_diy_5_chen3_b', 'board', legalTileFor(h.m, p, 'chess_diy_5_chen3_b'));
    const w = give(h.m, p, 'chess_diy_6_wang_b', 'board', legalTileFor(h.m, p, 'chess_diy_6_wang_b', new Set(p.board.keys())));
    const stack = p.hand.find((x) => x?.kind === 'token');
    assert.equal(h.m.handle(p.playerId, { t: 'g.move', uid: stack.uid, to: { area: 'board', row: 9, col: 7 } }).ok, true);
    h.m.lastResults.set(p.playerId, { unitsEnd: [{ uid: c.uid, alive: true, hpPct: 0.4, sp: 0, skillActive: true },
      { uid: w.uid, alive: true, hpPct: 0.6, sp: 0, skillActive: true }] });
  }
  const { wave, players } = uniteBattleOpts(h.m, { helpers, leaked: [] }, 60);
  const spec = { battleId: 'diy-unite', fieldId: 'u', kind: 'unite', seed: 81, round: 1,
    modeId: h.m.gd.modeId, stageId: 'act2autochess_m01', timeLimit: 60, players, spawns: wave.spawns, routes: wave.routes, flags: { autoFinish: false } };
  const b = createBattleFromSpec(spec, h.m.ds, { quiet: true }); b.step();
  const owners = b.allyUnits.filter((u) => u.defId === 'chess_diy_6_wang_b');
  assert.equal(owners.length, 2); assert.notEqual(owners[0].id, owners[1].id);
  for (const owner of owners) {
    assert.ok(Math.abs(owner.hpRatio - 0.6) < 1e-6); assert.equal(owner.skill.active, false);
    assert.equal(owner.mem.wang.followers.length, 1);
    const stone = b.allyUnits.find((u) => u.ownerUnit === owner);
    assert.equal(stone.ownerId, owner.ownerId); assert.equal(stone.tileC, owner.ownerId === helpers[0].playerId ? 15 : 7);
  }
  assert.equal(new Set(b.snapshot().stones.map((s) => s[0])).size, 2);
  assert.deepEqual(b.errors, []); h.invariants(); h.m.dispose();
});
