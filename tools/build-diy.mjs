#!/usr/bin/env node
// External operators use the same parser as the fixed roster, pinned before the season ended.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChess, buildTokens } from './build-data.mjs';

export const SNAPSHOT = '86da4cfa3a4b958c3615fccf5afbc10b5c7f1bfb';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPERATORS = { chen3: 'char_1050_chen3', wang: 'char_2027_wang' };

export async function buildDiy({ out = join(ROOT, 'data'), cache = join(ROOT, '.cache/diy', SNAPSHOT), offline = false,
  bondsInput = null, write = true } = {}) {
  await mkdir(cache, { recursive: true });
  const load = async (name) => {
    const path = join(cache, `${name}.json`);
    try { return JSON.parse(await readFile(path, 'utf8')); } catch (err) {
      if (offline || err.code !== 'ENOENT') throw err;
      const response = await fetch(`https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${SNAPSHOT}/zh_CN/gamedata/excel/${name}.json`, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const text = await response.text();
      const value = JSON.parse(text);
      await writeFile(path, text);
      return value;
    }
  };
  const [activity, charTable, skillTable, rangeTable, uniequip, battleEquip] = await Promise.all(
    ['activity_table', 'character_table', 'skill_table', 'range_table', 'uniequip_table', 'battle_equip_table'].map(load));
  const source = activity.activity.AUTOCHESS_SEASON.act2autochess;
  const act = { ...source, diyChessDict: {}, charChessDataDict: {}, charShopChessDatas: {}, chessNormalIdLookupDict: {} };
  const bonds = structuredClone(bondsInput || JSON.parse(await readFile(join(out, 'bonds.json'), 'utf8')));
  for (const [name, charId] of Object.entries(OPERATORS)) for (const tier of [5, 6]) {
    const base = `chess_diy_${tier}_${name}_a`, golden = `chess_diy_${tier}_${name}_b`;
    const original = `chess_char_${tier}_diy1_a`;
    const char = charTable[charId];
    const membership = [char.nationId, char.groupId, char.teamId].filter(Boolean);
    const bondIds = Object.keys(bonds).filter((id) => (bonds[id].powerIdList || []).some((power) => membership.includes(power)));
    if (!bondIds.length) bondIds.push('emptyShip');
    act.charShopChessDatas[base] = { ...source.charShopChessDatas[original], chessId: base, goldenChessId: golden,
      chessType: 'NORMAL', charId, defaultSkillIndex: 2, defaultUniEquipId: `uniequip_002_${name}` };
    for (const [id, suffix] of [[base, 'a'], [golden, 'b']]) {
      const template = source.charChessDataDict[original.replace(/_a$/, `_${suffix}`)];
      act.charChessDataDict[id] = { ...template, chessId: id, bondIds, garrisonIds: [],
        upgradeChessId: suffix === 'a' ? golden : null };
      act.chessNormalIdLookupDict[id] = base;
    }
  }
  const ctx = { act, ac: activity.autoChessData, charTable, skillTable, rangeTable, uniequip, battleEquip,
    research: {}, stageIds: [], levels: {} };
  const { chess, tokenOwners } = buildChess(ctx);
  for (const rec of Object.values(chess)) Object.assign(rec, { isDiy: true, diyAvailable: true, visible: false,
    chessType: 'DIY', dataSnapshot: SNAPSHOT });
  const tokens = buildTokens(ctx, chess, tokenOwners, {});
  for (const rec of Object.values(chess).filter((c) => !c.isGolden)) for (const id of rec.bonds) {
    if (!bonds[id].members.includes(rec.chessId)) bonds[id].members.push(rec.chessId);
  }
  if (write) for (const [name, additions] of Object.entries({ chess, tokens, bonds })) {
    const path = join(out, `${name}.json`);
    const current = JSON.parse(await readFile(path, 'utf8'));
    const text = JSON.stringify({ ...current, ...additions });
    await writeFile(`${path}.tmp`, text);
    await rename(`${path}.tmp`, path);
  }
  return { chess, tokens, bonds };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildDiy({ offline: process.argv.includes('--offline') }).then(({ chess, tokens }) => {
    console.log(`Historical external data: ${Object.keys(chess).length} chess, ${Object.keys(tokens).length} tokens (${SNAPSHOT})`);
  }).catch((err) => { console.error(err); process.exitCode = 1; });
}
