import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlan } from '../tools/assets/plan.mjs';
import { indexAudio } from '../tools/assets/audio.mjs';

test('the ordinary asset plan includes external portraits, all skills, models and token ownership', () => {
  const dataChess = JSON.parse(readFileSync(new URL('../data/chess.json', import.meta.url)));
  const plan = buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {},
    modelsData: {}, audio: indexAudio({}), dataChess, extraTokenIds: ['token_10064_wang_stone1'] });
  for (const [name, id] of [['chen3', 'char_1050_chen3'], ['wang', 'char_2027_wang']]) {
    assert.ok(plan.template.chars[id]?.avatarE2);
    assert.ok(plan.template.chars[id]?.portraitE2);
    assert.ok(plan.models.has(`op:${id}:front`));
    assert.ok(plan.models.has(`op:${id}:back`));
    for (const i of [1, 2, 3]) assert.ok(plan.template.skillsById[`skchr_${name}_${i}`]);
  }
  assert.equal(plan.template.tokens.token_10064_wang_stone1.owner, 'char_2027_wang');
});
