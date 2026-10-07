// Stable catalog ids; selection and copy ownership are per player.
export const DIY_NAMES = Object.freeze(['chen3', 'wang']);
export const EMPTY_DIY = Object.freeze({ '5': Object.freeze([null, null]), '6': Object.freeze([null, null]) });
export const isDiySelection = (v) => v === undefined || (v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).every((k) => k === '5' || k === '6')
  && Object.entries(v).every(([tier, slots]) => Array.isArray(slots) && slots.length === 2
    && slots.every((id) => id === null || DIY_NAMES.some((name) => id === `chess_diy_${tier}_${name}_a`))));

export function checkDiySelection(value) {
  if (!isDiySelection(value)) return { error: 'BAD_MSG', detail: 'invalid external selection' };
  const diy = { '5': [...(value?.['5'] || EMPTY_DIY['5'])], '6': [...(value?.['6'] || EMPTY_DIY['6'])] };
  const names = Object.values(diy).flat().filter(Boolean).map((id) => id.split('_').at(-2));
  if (new Set(names).size !== names.length) return { error: 'BAD_TARGET', detail: 'an external operator can only be selected once' };
  for (const tier of ['5', '6']) Object.freeze(diy[tier]);
  return { ok: true, diy: Object.freeze(diy) };
}
