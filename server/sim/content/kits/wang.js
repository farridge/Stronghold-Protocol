// Board stones are units; follower stones are effects and never enter the occupancy map.
import { COLS, AUTO_OP_COOLDOWN } from '../../constants.js';
import { bodyInKeys } from '../../body.js';
import { absoluteRangeKeys } from '../../targeting.js';

export const WANG_STONE = 'token_10064_wang_stone1';
const FOUR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const live = (u) => !!u && u.alive && u.deployed && !u.hidden && !u.removed;
const key = (r, c) => r * COLS + c;
const talent = (owner, index) => owner.def.talents?.[index]?.bb || {};
const mine = (battle, owner) => battle.allyUnits.filter((u) => u.defId === WANG_STONE && u.ownerUnit === owner);

export function wangState(owner) {
  return owner.mem.wang || (owner.mem.wang = { stock: talent(owner, 0).cnt || 6, cap: 7, followers: [], nextOp: 0, ammo: 0 });
}
const records = (battle, owner) => [...mine(battle, owner).filter(live).map((u) => u.mem.wangStone).filter(Boolean), ...wangState(owner).followers];

export function connectStones(battle, owner) {
  const all = records(battle, owner);
  for (const a of all) for (const b of all) if (a !== b && Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1) {
    const axis = a.r === b.r ? 'horizontal' : 'vertical';
    a.axes.add(axis); b.axes.add(axis);
  }
  return all;
}

function lineStacks(all, stone, maximum) {
  const positions = new Set(all.map((s) => key(s.r, s.c)));
  let best = 1;
  for (const axis of stone.axes) {
    const [dr, dc] = axis === 'horizontal' ? [0, 1] : [1, 0];
    let count = 1;
    for (const sign of [-1, 1]) for (let n = 1; positions.has(key(stone.r + dr * n * sign, stone.c + dc * n * sign)); n++) count++;
    best = Math.max(best, count);
  }
  return Math.min(maximum, best);
}

function candidates(battle, owner, tiles) {
  const existing = new Set(records(battle, owner).map((s) => key(s.r, s.c)));
  return tiles.map(([r, c], order) => ({ r, c, order, tile: battle.grid.tile(r, c),
    enemy: battle.enemies.some((u) => live(u) && bodyInKeys(u, new Set([key(r, c)]))) }))
    .filter((p) => battle.grid.inRect(p.r, p.c) && !battle.unitAt(p.r, p.c) && !battle.downOn(p.r, p.c)
      && !existing.has(key(p.r, p.c)) && (battle.grid.groundPassable(p.r, p.c) || battle.grid.canStand(p.r, p.c, { ranged: true })))
    .sort((a, b) => Number(b.enemy) - Number(a.enemy)
      || (a.tile.build === 'NONE' ? 0 : a.tile.height === 'LOW' ? 1 : 2) - (b.tile.build === 'NONE' ? 0 : b.tile.height === 'LOW' ? 1 : 2) || a.order - b.order);
}

export function addFollowers(battle, owner, tiles, count = 1) {
  const state = wangState(owner), limit = talent(owner, 0)['attack@max_spawn_cnt'] || 9;
  const chosen = candidates(battle, owner, tiles).slice(0, Math.min(count, limit - state.followers.length));
  for (const p of chosen) {
    state.followers.push({ r: p.r, c: p.c, axes: new Set(), source: owner, follower: true });
    battle.fx('summon', { x: p.c, y: p.r, id: owner.id, token: WANG_STONE, follower: true });
  }
  connectStones(battle, owner);
  return chosen.length;
}

function triggerKeys(stone, index, tokenDef) {
  if (index === 2) return absoluteRangeKeys(tokenDef?.skill?.rangeGrid || [[0, 0], [0, 1], [0, 2], [0, -1], [0, -2], [1, 0], [2, 0], [-1, 0], [-2, 0]], stone.r, stone.c, 'RIGHT');
  if (index === 0) return [key(stone.r, stone.c)];
  const out = new Set([key(stone.r, stone.c)]);
  for (const axis of stone.axes) for (let n = -3; n <= 3; n++) out.add(key(stone.r + (axis === 'vertical' ? n : 0), stone.c + (axis === 'horizontal' ? n : 0)));
  return [...out];
}

function triggerStone(battle, owner, stone, all) {
  if (!stone.axes.size || (!stone.follower && !live(stone.source))) return;
  const index = owner.def.loadout?.skillIndex ?? owner.def.skill.index ?? 2;
  const source = stone.source;
  const tokenDef = battle.tokenDef(WANG_STONE, owner);
  const keys = triggerKeys(stone, index, tokenDef);
  const enemies = battle.enemiesInKeys(keys, source, { canHitFly: true });
  if (!enemies.length) return;
  const bb = owner.def.skill.bb, t1 = talent(owner, 1);
  const stacks = lineStacks(all, stone, t1['attack@max_trigger_cnt'] || 3);
  const damageMul = 1 + stacks * t1['attack@per_atk_scale'];
  const penetrate = stacks * t1['attack@per_magic_resist_penetrate_fixed'];
  const atk = stone.follower ? owner.s.atk : source.s.atk;
  const damage = (target, scale, tags) => battle.dealDamage(source, target, { type: 'arts', amount: atk * scale,
    mul: damageMul, resIgnoreFlat: penetrate, tags, ignoreSelect: true });
  if (index === 0) {
    const target = enemies[0], duration = bb['attack@sluggish'], amount = owner.s.atk * bb['attack@atk_scale'];
    // S1 is an owner-applied DoT: snapshot the owner's ATK and the triggering stone's line bonuses once.
    battle.applyStatus(target, 'sluggish', { duration, source: owner });
    battle.addBuff(target, { key: `wang:dot:${source.id}:${battle.time}`, duration, interval: 1, source: owner,
      onTick: () => battle.dealDamage(owner, target, { type: 'arts', amount, mul: damageMul,
        resIgnoreFlat: penetrate, tags: ['dot', 'wangDot'], ignoreSelect: true }) });
  } else {
    for (const target of enemies) {
      damage(target, index === 1 ? bb['attack@atk_scale'] : bb.atk_scale, ['wangStone']);
      if (index === 1) battle.addBuff(target, { key: 'wang:slow', refresh: 'independent', duration: bb['attack@duration'],
        mods: { moveMul: 1 + bb['attack@move_speed'] }, source });
    }
  }
  battle.fx('explosion', { x: stone.c, y: stone.r, id: source.id, token: WANG_STONE, consumed: true });
  if (stone.follower) wangState(owner).followers = wangState(owner).followers.filter((s) => s !== stone);
  else battle.retreat(source, { permanent: true, reason: 'expired' });
}

export function wangStoneKit() {
  return { trait: { noAttack: true }, skill: { kind: 'passive' }, install(battle, unit) {
    battle.addBuff(unit, { key: 'wang:trap', flags: { untargetable: true, invulnerable: true }, persist: true, allowDead: true });
    battle.on('deploy', ({ unit: deployed, initial }) => {
      if (deployed !== unit || !live(unit.ownerUnit)) return;
      const owner = unit.ownerUnit, state = wangState(owner);
      unit.base.atk = owner.s.atk; unit.markDirty();
      unit.mem.wangStone = { r: unit.tileR, c: unit.tileC, axes: new Set(), source: unit, follower: false };
      if (initial) state.stock = Math.max(0, state.stock - 1);
      const active = owner.skill.active && owner.def.skill.id === 'skchr_wang_3'
        && owner.rangeKeySet.has(key(unit.tileR, unit.tileC));
      const n = addFollowers(battle, owner, FOUR.map(([dr, dc]) => [unit.tileR + dr, unit.tileC + dc]), active ? Math.min(3, state.ammo) : 1);
      if (active && n) { state.ammo -= n; owner.skill.ammoLeft = state.ammo; battle.emit('ammoUsed', { unit: owner, left: state.ammo, skill: owner.skill }); }
      connectStones(battle, owner);
    }, { owner: unit, priority: 10 });
    battle.on('death', ({ unit: dead }) => {
      if (dead !== unit) return;
      unit.removed = false;
      unit.mem.readyAt = battle.time + unit.base.respawnTime;
    }, { owner: unit });
  } };
}

export function wangKit(bb, chess, def) {
  const grant = (battle, unit, count, overflow = false) => {
    const state = wangState(unit), sum = state.stock + count;
    state.stock = Math.min(state.cap, sum);
    if (overflow && sum > state.cap) {
      const tiles = unit.rangeKeys.map((k) => [Math.floor(k / COLS), k % COLS]);
      addFollowers(battle, unit, tiles, sum - state.cap);
    }
  };
  return { skills: {
    skchr_wang_1: { kind: 'instant', trigger: 'SP_FULL', onStart({ battle, unit }) { grant(battle, unit, bb.cnt); } },
    skchr_wang_2: { kind: 'instant', trigger: 'SP_FULL', onStart({ battle, unit }) { grant(battle, unit, bb.cnt); } },
    skchr_wang_3: { kind: 'ammo', ammo: bb.trigger_time, targeting: { rangeGrid: def.skill.rangeGrid }, attack: { noAttack: true },
      onStart({ battle, unit, skill }) { const state = wangState(unit); state.ammo = skill.ammoLeft; grant(battle, unit, bb.cnt, true); },
      onEnd({ battle, unit, reason }) {
        const state = wangState(unit), remainder = state.ammo; state.ammo = 0;
        if (reason !== 'death' && live(unit)) grant(battle, unit, remainder, true);
      } },
  }, install(battle, owner) {
    const state = wangState(owner);
    battle.on('deploy', ({ unit, move }) => {
      state.followers = state.followers.filter((s) => s.r !== unit.tileR || s.c !== unit.tileC);
      if (unit === owner) {
        state.stock = talent(owner, 0).cnt || 6;
        state.nextOp = battle.time + AUTO_OP_COOLDOWN;
        if (move) { state.followers = []; for (const stone of mine(battle, owner)) if (live(stone)) battle.retreat(stone, { reason: 'expired', permanent: true }); }
      }
    }, { owner, priority: 20 });
    battle.on('death', ({ unit }) => { if (unit === owner) {
      state.followers = [];
      for (const stone of mine(battle, owner)) if (live(stone)) battle.retreat(stone, { permanent: true, reason: 'expired' });
    } }, { owner });
    battle.on('tick', () => {
      if (!live(owner)) return;
      const all = connectStones(battle, owner);
      for (const stone of all) triggerStone(battle, owner, stone, all);
      if (state.stock >= state.cap) {
        if (!owner.findBuff('wang:stockFull')) battle.addBuff(owner, { key: 'wang:stockFull', flags: { noSp: true } });
      } else battle.removeBuff(owner, 'wang:stockFull');
      if (battle.time + 1e-9 >= state.nextOp && state.stock > 0) {
        const active = owner.skill.active && def.skill.id === 'skchr_wang_3';
        for (const stone of mine(battle, owner)) {
          if (live(stone) || stone.mem.readyAt > battle.time || battle.unitAt(stone.homeR, stone.homeC)) continue;
          const expanded = active && owner.rangeKeySet.has(key(stone.homeR, stone.homeC));
          if (!expanded && battle.enemies.some((e) => live(e) && bodyInKeys(e, new Set([key(stone.homeR, stone.homeC)])))) continue;
          if (!battle.grid.canStand(stone.homeR, stone.homeC)) continue;
          if (!battle.redeploy(stone, { free: false })) continue;
          state.stock--; state.nextOp = battle.time + AUTO_OP_COOLDOWN;
          break;
        }
      }
      if (owner.skill.active && def.skill.id === 'skchr_wang_3' && (state.ammo <= 0 || state.stock <= 0)) owner.skill.end('stones');
    }, { owner });
  } };
}

export default Object.fromEntries([5, 6].map((tier) => [`chess_diy_${tier}_wang_a`, wangKit]));
