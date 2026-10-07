// Historical Chen external kit. Numeric skill/talent/module values come from generated blackboards.
import { weaknessRetype } from '../items/battle.js';
import { isHpLoss } from '../../damage.js';
import { rotateOffset } from '../../dir.js';
import { bodyDist } from '../../body.js';
import { TICK } from '../../constants.js';

const live = (u) => !!u && u.alive && u.deployed && !u.hidden && !u.removed;
const talent = (def, index) => def.talents?.[index]?.bb || {};
const nearest = (list, point) => list.sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y) || a.id - b.id)[0];

function chen(bb, chess, def) {
  const t0 = talent(def, 0), t1 = talent(def, 1);
  const sendWave = (battle, unit, wave) => {
    const blocked = (x, y) => {
      const r = Math.round(y), c = Math.round(x), tile = battle.grid.tile(r, c);
      return !battle.grid.inRect(r, c) || tile.height === 'HIGH' || tile.special === 'start' || tile.special === 'end';
    };
    if (blocked(wave.x + wave.dx * 0.25, wave.y + wave.dy * 0.25)) {
      const dx = wave.dx;
      wave.dx = wave.dy; wave.dy = -dx; wave.hits.clear();
    }
    const to = { x: wave.x + wave.dx * 1.5 * TICK, y: wave.y + wave.dy * 1.5 * TICK };
    if (blocked(to.x, to.y) || wave.age >= def.skill.duration) { unit.mem.chenWave = null; return; }
    // Point-flight segments keep collision timing on the existing deterministic projectile clock.
    battle.addProjectile({ source: unit, from: wave, to, speed: 1.5, visual: 'none',
      onHit({ x, y }) {
        wave.x = x; wave.y = y; wave.age += TICK;
        for (const enemy of battle.enemies) if (live(enemy) && !wave.hits.has(enemy.id) && bodyDist(enemy, x, y) <= 1.3) {
          wave.hits.add(enemy.id);
          battle.dealDamage(unit, enemy, { type: 'arts', amount: Math.max(enemy.hp * bb.hp_ratio, unit.s.atk * bb.projectile_min_atk_scale),
            tags: ['chenWave'], isProjectile: true });
        }
        if (Math.floor(wave.age / TICK) % 3 === 0) battle.fx('slash', { x, y, id: unit.id });
        sendWave(battle, unit, wave);
      } });
  };
  const finishSlashes = (battle, unit, skill) => {
    const state = unit.mem.chenSlashes;
    if (!state) return;
    const target = state.target;
    battle.removeBuff(unit, 'chen:slashes');
    unit.mem.chenSlashes = null;
    const r = Math.round(target?.y), c = Math.round(target?.x);
    if (!(live(target) && battle.grid.canStand(r, c) && battle.moveRedeploy(unit, r, c))) {
      battle.moveRedeploy(unit, state.home[0], state.home[1]);
    }
    skill.timeLeft = def.skill.duration;
    battle.addBuff(unit, { key: 'chen:afterSlashes', duration: def.skill.duration,
      mods: { atkPct: bb['chen3_s2[respawn_buff].atk'], dodgePhys: bb['chen3_s2[respawn_buff].prob'], dodgeArts: bb['chen3_s2[respawn_buff].prob'] } });
  };
  const slash = (battle, unit, skill) => {
    const state = unit.mem.chenSlashes;
    if (!state || !live(unit)) return;
    if (!live(state.target)) {
      state.target = nearest(battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }), unit);
      if (!state.target) { finishSlashes(battle, unit, skill); return; }
    }
    const target = state.target;
    battle.dealDamage(unit, target, { amount: unit.s.atk * bb.atk_scale, type: 'arts', isAttack: true, isSkill: true, tags: ['skill', 'chenSlash'] });
    if (battle.hasHook('attack')) battle.emit('attack', { attacker: unit, targets: [target], isSkill: true });
    battle.fx('slash', { x: target.x, y: target.y, id: unit.id });
    state.remaining--;
    if (!live(target)) {
      const local = battle.enemies.filter((e) => live(e) && Math.hypot(e.x - target.x, e.y - target.y) <= 1.7);
      state.target = nearest(local.length ? local : battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }), target);
      if (state.target) state.remaining++;
    }
    if (state.remaining <= 0 || !state.target) finishSlashes(battle, unit, skill);
  };
  return {
    skills: {
      skchr_chen3_1: { kind: 'duration', mods: { atkPct: bb.atk }, attack: { hits: 2 },
        onHit({ battle, unit, target }) { battle.applyStatus(target, 'silence', { duration: unit.skill.timeLeft, source: unit }); } },
      skchr_chen3_2: { kind: 'duration', targeting: { rangeGrid: def.skill.rangeGrid },
        onStart({ battle, unit, skill }) {
          unit.mem.chenSlashes = { remaining: 10, elapsed: 0, home: [unit.tileR, unit.tileC], target: null };
          skill.timeLeft = 10 * 0.4 + def.skill.duration;
          battle.releaseBlocked(unit);
          battle.addBuff(unit, { key: 'chen:slashes', flags: { invulnerable: true, disarm: true, noSp: true }, mods: { blockFlat: -99 } });
          slash(battle, unit, skill);
        },
        onTick({ battle, unit, skill, dt }) {
          const state = unit.mem.chenSlashes;
          if (!state) return;
          state.elapsed += dt;
          while (unit.mem.chenSlashes && state.elapsed >= 0.4 - 1e-9) { state.elapsed -= 0.4; slash(battle, unit, skill); }
          if (unit.mem.chenSlashes) skill.timeLeft = state.remaining * 0.4 + def.skill.duration;
        },
        onEnd({ battle, unit }) { unit.mem.chenSlashes = null; battle.removeBuff(unit, 'chen:slashes'); battle.removeBuff(unit, 'chen:afterSlashes'); } },
      skchr_chen3_3: { kind: 'duration', targeting: { rangeGrid: def.skill.rangeGrid, maxTargets: bb['attack@max_target'] },
        attack: { hits: 3, atkScale: bb['attack@atk_scale'], canHitFly: false, groundOnly: true },
        onStart({ battle, unit }) {
          const direction = rotateOffset(0, 1, unit.dir);
          const wave = { x: unit.x, y: unit.y, dx: direction[1], dy: direction[0], hits: new Set(), age: 0 };
          unit.mem.chenWave = wave;
          sendWave(battle, unit, wave);
        },
      },
    },
    install(battle, unit) {
      battle.addBuff(unit, { key: 'chen:insight', mods: { atkPct: t0.atk, aspd: t0.attack_speed }, persist: true, allowDead: true });
      let lastHeal = 0;
      battle.on('deploy', ({ unit: deployed }) => { if (deployed === unit) { lastHeal = battle.time; unit.mem.chenDodge = false; } }, { owner: unit });
      battle.on('damaged', (ctx) => { if (ctx.target === unit && ctx.amount > 0 && !isHpLoss(ctx.dmg)) lastHeal = battle.time; }, { owner: unit });
      battle.on('beforeStatus', (ctx) => { if (ctx.target === unit && unit.mem.chenSlashes && ['stun', 'freeze'].includes(ctx.status)) ctx.cancel = true; }, { owner: unit });
      battle.on('hit', (ctx) => {
        if (ctx.source === unit && ctx.dmg.isAttack) weaknessRetype(ctx.dmg, unit, ctx.target);
        if (ctx.target === unit && unit.mem.chenDodge && ctx.dmg.canDodge && ['phys', 'arts'].includes(ctx.dmg.type)) {
          ctx.dmg.cancel = true; unit.mem.chenDodge = false;
          battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
          battle.emit('dodge', { source: ctx.source, target: unit, dmg: ctx.dmg });
        }
      }, { owner: unit, priority: 5 });
      battle.on('tick', () => {
        if (!live(unit) || unit.mem.chenSlashes) return;
        const speed = unit.blocking.length ? 0 : (def.traitBb?.attack_speed || 0);
        const current = unit.findBuff('chen:module');
        if ((current?.mods?.aspd || 0) !== speed) battle.addBuff(unit, { key: 'chen:module', mods: { aspd: speed } });
        if (battle.time - lastHeal + 1e-9 < t1.stack_time) return;
        lastHeal = battle.time;
        const percent = t1.heal_atk_scale_min + Math.floor(battle.rng() * (t1.heal_atk_scale_max - t1.heal_atk_scale_min));
        battle.heal(unit, unit, unit.s.atk * percent / 100);
        unit.mem.chenDodge = true;
      }, { owner: unit });
    },
  };
}

export default Object.fromEntries([5, 6].map((tier) => [`chess_diy_${tier}_chen3_a`, chen]));
