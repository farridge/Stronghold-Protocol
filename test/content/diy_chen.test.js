import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { mitigate } from '../../server/sim/damage.js';
const id = 'chess_diy_6_chen3_b';
function run(skillIndex, enemies = [{ key: 'dummy', pos: [9, 7] }], defs = {}, options = {}) {
  return makeBattle({ autoFinish: false, timeLimit: 200, hooks: ['hit', 'damaged', 'heal', 'attack', 'skillStart', 'deploy'],
    captureNoisy: true, units: [{ chessId: id, row: 9, col: 6, skillIndex, carryState: { sp: 999 } }],
    enemies, defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, speed: 0, res: 50 }), ...defs } }, ...options });
}
test('Chen S1 authors double hits, silence and weakness damage', () => {
  const h = run(0); h.run(2);
  const u = h.unit(id), e = h.b.enemies[0];
  assert.equal(u.kit.skillSource, 'skills');
  assert.ok(e.findBuff('silence'));
  const damage = h.hooksOf('damaged').filter((c) => c.source === u);
  assert.ok(damage.length >= 2);
  assert.ok(damage.every((c) => c.type === 'phys'));
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Chen S2 delivers ten timed slashes then moves and keeps its buff for six more seconds', () => {
  const h = run(1); h.run(4.1);
  const u = h.unit(id);
  const damage = h.hooksOf('damaged').filter((c) => c.dmg?.tags.includes('chenSlash'));
  assert.equal(damage.length, 10);
  assert.equal(u.tileC, 7);
  assert.ok(u.findBuff('chen:afterSlashes'));
  assert.ok(u.skill.timeLeft > 5);
  h.run(6.1);
  assert.equal(u.findBuff('chen:afterSlashes'), null);
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Chen S2 transfers on a kill, adds a slash and returns when the final tile is unavailable', () => {
  const h = run(1, [{ key: 'weak', pos: [9, 7] }, { key: 'dummy', pos: [9, 8] }], {
    weak: enemyRec({ key: 'weak', hp: 10, speed: 0 }) });
  const blocker = h.b.spawnDevice('testBlock', 9, 8, { hp: 1e6, blockCnt: 0 });
  h.run(4.8);
  const u = h.unit(id);
  assert.equal(h.hooksOf('damaged').filter((c) => c.dmg?.tags.includes('chenSlash')).length, 11);
  assert.equal(u.tileC, 6);
  assert.ok(u.findBuff('chen:afterSlashes'));
  assert.equal(h.b.unitAt(9, 8), blocker);
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Chen S3 separates HP-ratio projectile damage from three-hit ground attacks and turns its wave', () => {
  const waves = [];
  const h = run(2, undefined, {}, { setup(battle) {
    battle.on('hit', ({ target, dmg }) => {
      if (dmg.tags.includes('chenWave')) waves.push({ hp: target.hp, amount: dmg.amount });
    });
  } }); h.run(3);
  const u = h.unit(id), events = h.hooksOf('damaged').filter((c) => c.source === u);
  assert.ok(waves.length);
  assert.equal(waves[0].amount, waves[0].hp * 0.06);
  assert.ok(events.filter((c) => !c.dmg.tags.includes('chenWave')).length >= 3);
  assert.ok(u.mem.chenWave && u.mem.chenWave.dx !== 1);
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Chen talent healing uses deterministic random values and dodges exactly one subsequent hit', () => {
  const h = run(0, []); h.run(0.1);
  const u = h.unit(id); u.hp = 1;
  h.run(6.1);
  assert.ok(h.hooksOf('heal').length);
  assert.equal(u.mem.chenDodge, true);
  assert.equal(h.b.dealDamage(null, u, { type: 'phys', amount: 500 }), 0);
  assert.equal(u.mem.chenDodge, false);
  assert.ok(h.b.dealDamage(null, u, { type: 'phys', amount: 500 }) > 0);
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Chen with normal, elite or both dual-mode arms retypes each hit once without multiplying damage', () => {
  const arm = 'chess_item_5_03_e_a', eliteArm = 'chess_item_5_03_e_b';
  for (const tier of [5, 6]) for (const state of ['a', 'b']) for (const skillIndex of [0, 1, 2]) {
    for (const items of [[arm], [eliteArm], [arm, eliteArm]]) for (const [def, res] of [[0, 50], [10000, 0], [0, 0]]) {
      const chessId = `chess_diy_${tier}_chen3_${state}`, pre = new Map();
      const h = run(skillIndex, undefined, { dummy: enemyRec({ key: 'dummy', hp: 1e7, speed: 0, def, res }) }, {
        units: [{ chessId, row: 9, col: 6, skillIndex, carryState: { sp: 999 }, items }],
        setup(b) { b.on('hit', ({ source, target, dmg }) => {
          if (source?.defId !== chessId) return;
          pre.set(dmg, { amount: dmg.amount, mul: dmg.mul, hp: target.hp,
            phys: mitigate(dmg.amount, 'phys', target.s, source.s), arts: mitigate(dmg.amount, 'arts', target.s, source.s) });
        }, { priority: 100 }); },
      });
      h.run(skillIndex === 1 ? 4.2 : 3);
      const hits = h.hooksOf('damaged').filter((c) => c.source === h.unit(chessId));
      assert.ok(hits.length, `${chessId} S${skillIndex + 1} hits`);
      assert.equal(hits.length, pre.size, 'one damage event per authored hit');
      for (const hit of hits) {
        const original = pre.get(hit.dmg);
        assert.equal(hit.dmg.amount, original.amount, 'weakness hooks never scale the raw damage');
        assert.equal(hit.dmg.mul, original.mul, 'weakness hooks never stack a damage multiplier');
        assert.ok(Math.abs(hit.amount - Math.max(original.phys, original.arts) * original.mul) < 1e-6);
        if (hit.dmg.tags.includes('chenWave')) {
          const u = h.unit(chessId);
          assert.equal(original.amount, Math.max(original.hp * 0.06, u.s.atk * u.def.skill.bb.projectile_min_atk_scale));
        }
      }
      if (skillIndex === 1) assert.equal(hits.filter((c) => c.dmg.tags.includes('chenSlash')).length, 10);
      assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
    }
  }
});

test('Chen dual-mode arms leave true and elemental damage intact', () => {
  const h = run(0, undefined, {}, { units: [{ chessId: id, row: 9, col: 6,
    items: ['chess_item_5_03_e_a', 'chess_item_5_03_e_b'] }] }); h.step();
  const u = h.unit(id), enemy = h.b.enemies[0];
  for (const type of ['true', 'elemental']) {
    h.b.dealDamage(u, enemy, { type, amount: 1234, canDodge: false });
    const hit = h.hooksOf('damaged').at(-1);
    assert.equal(hit.type, type); assert.equal(hit.amount, 1234);
  }
  assert.equal(h.b.errors.length, 0);
});
