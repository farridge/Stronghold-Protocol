import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { addFollowers, connectStones } from '../../server/sim/content/kits/wang.js';
const id = 'chess_diy_6_wang_b', token = 'token_10064_wang_stone1';
function run(skillIndex, options = {}) {
  return makeBattle({ autoFinish: false, timeLimit: 200, captureNoisy: true,
    units: [{ chessId: id, uid: 1, row: 10, col: 6, skillIndex },
      { kind: 'token', tokenId: token, ownerUid: 1, uid: 2, row: 9, col: 7 }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, speed: 0 }) } }, ...options });
}
test('Wang placed stones create nonoccupying followers, connect and deal S1 damage over time', () => {
  const h = run(0); h.run(0.1);
  const owner = h.unit(id);
  assert.equal(owner.kit.skillSource, 'skills');
  assert.equal(owner.mem.wang.followers.length, 1);
  const follow = owner.mem.wang.followers[0];
  assert.equal(h.b.unitAt(follow.r, follow.c), null);
  assert.deepEqual(h.snapshot().stones, [[owner.id, follow.c, follow.r, 2]]);
  const stone = h.b.allyUnits.find((u) => u.kind === 'token');
  assert.ok(stone.mem.wangStone.axes.size);
  h.spawn('dummy', { pos: [stone.tileR, stone.tileC] });
  h.run(2);
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'sluggish'));
  assert.ok(h.hooksOf('damaged').some((c) => c.dmg?.tags.includes('wangDot')));
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Wang S2 line activation persists after a connection is lost and its slow layers multiply', () => {
  const h = run(1); h.run(0.1);
  const owner = h.unit(id), stone = h.b.allyUnits.find((u) => u.kind === 'token');
  const state = owner.mem.wang;
  assert.ok(stone.mem.wangStone.axes.has('vertical'));
  state.followers = [];
  connectStones(h.b, owner);
  assert.ok(stone.mem.wangStone.axes.has('vertical'));
  h.spawn('dummy', { pos: [10, 7] }); h.run(0.1);
  const enemy = h.b.enemies[0];
  assert.ok(h.hooksOf('damaged').some((c) => c.dmg.tags.includes('wangStone')));
  assert.ok(enemy.findBuff('wang:slow'));
  assert.equal(stone.alive, false);
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Wang followers prefer enemy tiles, disappear under deployments and stay isolated between summoners', () => {
  const h = run(1, { units: [
    { chessId: id, uid: 1, row: 10, col: 6, skillIndex: 1 },
    { kind: 'token', tokenId: token, ownerUid: 1, uid: 2, row: 9, col: 7 },
    { chessId: id, uid: 3, row: 11, col: 6, skillIndex: 1 },
  ] }); h.run(0.1);
  const owner = h.unit(id);
  h.spawn('dummy', { pos: [9, 9] }); h.run(0.1);
  addFollowers(h.b, owner, [[9, 8], [9, 9]], 1);
  assert.ok(owner.mem.wang.followers.some((s) => s.r === 9 && s.c === 9));
  const second = h.unit(3);
  addFollowers(h.b, second, [[9, 8]], 1);
  connectStones(h.b, second);
  assert.equal(second.mem.wang.followers[0].axes.size, 0);
  h.b.spawnDevice('cover', 9, 9, { hp: 1e6, blockCnt: 0 });
  assert.equal(owner.mem.wang.followers.some((s) => s.r === 9 && s.c === 9), false);
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Wang S3 grants stock, spawns overflow followers, spends actual deployment ammo and returns the remainder', () => {
  const h = run(2); h.run(0.1);
  const owner = h.unit(id), state = owner.mem.wang;
  owner.skill.activate('test', { free: true });
  assert.equal(state.stock, 7); assert.equal(state.ammo, 20);
  assert.ok(state.followers.length > 1 && state.followers.length <= 9);
  const stone = h.b.allyUnits.find((u) => u.kind === 'token');
  h.b.retreat(stone, { reason: 'expired', permanent: true });
  state.followers = [];
  h.run(3.2);
  assert.ok(state.ammo < 20);
  assert.ok(h.hooksOf('ammoUsed').length);
  owner.skill.end('manual');
  assert.equal(state.ammo, 0); assert.equal(state.stock, 7);
  assert.equal(owner.skill.ammoLeft, 0);
  assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
});

test('Wang redeployment waits for DP and never consumes stock on a refused deployment', () => {
  const h = run(0); h.run(0.1);
  const owner = h.unit(id), state = owner.mem.wang;
  const stone = h.b.allyUnits.find((u) => u.kind === 'token');
  h.b.retreat(stone, { reason: 'expired', permanent: true });
  state.followers = []; const stock = state.stock;
  h.b.getPlayer(owner.ownerId).dp = 0;
  state.nextOp = 0; stone.mem.readyAt = 0;
  h.step();
  assert.equal(stone.alive, false);
  assert.equal(state.stock, stock);
  h.b.getPlayer(owner.ownerId).dp = 20; h.step();
  assert.equal(stone.alive, true);
  assert.equal(state.stock, stock - 1);
  assert.ok(h.b.getPlayer(owner.ownerId).dp < 20);
});

test('Wang S1 snapshots the owner attack and line penetration when a board stone triggers', () => {
  const h = run(0); h.run(0.1);
  const owner = h.unit(id), stone = h.b.allyUnits.find((u) => u.kind === 'token');
  owner.mem.wang.followers = [];
  h.b.addBuff(owner, { key: 'test:ownerAtk', mods: { atkPct: 1 } });
  const attack = owner.s.atk;
  h.spawn('dummy', { pos: [stone.tileR, stone.tileC] }); h.step();
  h.b.removeBuff(owner, 'test:ownerAtk'); h.run(1.1);
  const hit = h.hooksOf('damaged').find((c) => c.dmg.tags.includes('wangDot'));
  assert.ok(hit); assert.equal(hit.source, owner);
  assert.equal(hit.dmg.amount, attack * owner.def.skill.bb['attack@atk_scale']);
  assert.equal(hit.dmg.resIgnoreFlat, owner.def.talents[1].bb['attack@per_magic_resist_penetrate_fixed']);
});

test('Wang S3 only spends ammo on stone redeployments inside its expanded range', () => {
  const h = run(2, { units: [{ chessId: id, uid: 1, row: 10, col: 6 },
    { kind: 'token', tokenId: token, ownerUid: 1, uid: 2, row: 10, col: 4 }] }); h.run(0.1);
  const owner = h.unit(id), state = owner.mem.wang, stone = h.b.allyUnits.find((u) => u.kind === 'token');
  owner.skill.activate('test', { free: true });
  h.b.retreat(stone, { permanent: true, reason: 'expired' }); state.followers = [];
  state.nextOp = 0; stone.mem.readyAt = 0; h.b.getPlayer(owner.ownerId).dp = 50;
  h.step();
  assert.equal(state.ammo, 20); assert.equal(state.followers.length, 1);
});

test('a module permits seven board cards but initial Wang stock deploys only six stones', () => {
  const h = run(0, { units: [{ chessId: id, uid: 1, row: 10, col: 6, skillIndex: 0 },
    ...Array.from({ length: 7 }, (_, i) => ({ kind: 'token', tokenId: token, ownerUid: 1, uid: i + 2, row: 9, col: i + 3 }))] });
  h.run(0.1);
  const owner = h.unit(id), stones = h.b.allyUnits.filter((u) => u.kind === 'token');
  assert.equal(stones.filter((s) => s.alive).length, 6);
  assert.equal(owner.mem.wang.stock, 0);
  owner.skill.activate('test', { free: true });
  h.b.getPlayer(owner.ownerId).dp = 50; owner.mem.wang.nextOp = 0;
  h.run(2.2);
  assert.equal(stones.filter((s) => s.alive).length, 7);
  assert.equal(owner.mem.wang.stock, 1);
});

test('a Wang entering unite down never deploys orphaned stones or followers', () => {
  const h = run(0, { kind: 'unite', units: [{ chessId: id, uid: 1, row: 10, col: 6, carryState: { down: true } },
    { kind: 'token', tokenId: token, ownerUid: 1, uid: 2, row: 9, col: 7 }] }); h.run(0.1);
  const owner = h.unit(id);
  assert.equal(owner.alive, false);
  assert.equal(h.b.allyUnits.some((u) => u.kind === 'token' && u.alive && u.deployed), false);
  assert.deepEqual(h.snapshot().stones, []); assert.deepEqual(h.b.errors, []);
});

test('Wang continuous-line damage and penetration cap at three stacks with or without a module', () => {
  for (const tier of [5, 6]) for (const moduleId of [undefined, 'none']) {
    const chessId = `chess_diy_${tier}_wang_b`;
    const h = run(1, { units: [{ chessId, uid: 1, row: 10, col: 6, skillIndex: 1, moduleId },
      { kind: 'token', tokenId: token, ownerUid: 1, uid: 2, row: 9, col: 7 }] }); h.run(0.1);
    const owner = h.unit(chessId), stone = h.b.allyUnits.find((u) => u.kind === 'token');
    owner.mem.wang.followers = [];
    addFollowers(h.b, owner, [[9, 8], [9, 9], [9, 10]], 3);
    h.spawn('dummy', { pos: [9, 7] }); h.step();
    const hit = h.hooksOf('damaged').find((c) => c.source === stone && c.dmg.tags.includes('wangStone'));
    const bb = owner.def.talents[1].bb;
    assert.ok(hit);
    assert.equal(hit.dmg.mul, 1 + 3 * bb['attack@per_atk_scale']);
    assert.equal(hit.dmg.resIgnoreFlat, 3 * bb['attack@per_magic_resist_penetrate_fixed']);
    assert.equal(hit.dmg.amount, stone.s.atk * owner.def.skill.bb['attack@atk_scale']);
    assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
  }
});
