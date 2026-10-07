import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDiy, SNAPSHOT } from '../../tools/build-diy.mjs';

test('selected external operators resolve every tier, skill and elite module without changing the fixed roster', () => {
  const ds = getDefaultSource();
  for (const name of ['chen3', 'wang']) for (const tier of [5, 6]) {
    const base = `chess_diy_${tier}_${name}`;
    for (const state of ['a', 'b']) for (let skillIndex = 0; skillIndex < 3; skillIndex++) {
      const def = ds.getChess(`${base}_${state}`, { skillIndex });
      assert.ok(def, `${base}_${state} exists`);
      assert.equal(def.raw.isDiy, true);
      assert.equal(def.raw.visible, false);
      assert.deepEqual(def.raw.bonds, ['yanShip'], 'both external operators belong only to Yan');
      assert.equal(def.skill.id, `skchr_${name}_${skillIndex + 1}`);
      assert.equal(def.raw.status.skillLevel, state === 'a' ? 4 : 7);
      assert.equal(def.raw.status.equipLevel, state === 'a' ? 0 : tier === 5 ? 1 : 3);
    }
  }
});

const cache = fileURLToPath(new URL(`../../.cache/diy/${SNAPSHOT}/`, import.meta.url));
test('pinned external data regenerates the checked-in records without hand-edited numbers',
  { skip: !existsSync(cache + 'character_table.json') && 'no historical DIY cache' }, async () => {
    const ds = getDefaultSource();
    const output = await buildDiy({ cache, offline: true, write: false });
    for (const [id, record] of Object.entries(output.chess)) assert.deepEqual(record, ds.raw.chess[id]);
    for (const [id, record] of Object.entries(output.tokens)) assert.deepEqual(record, ds.raw.tokens[id]);
    assert.deepEqual(output.bonds, JSON.parse(readFileSync(new URL('../../data/bonds.json', import.meta.url))));
  });
