// Opt-in playtest economy. Keep the real match, shop, pools and payment hooks intact.
import { Match } from './Match.js';

export class FundsTestMatch extends Match {
  constructor(opts) {
    super(opts);
    this.fundsTest = true;
    for (const player of this.players.values()) {
      // All economic paths (including direct round resets) observe the same fixed balance.
      // Payment/gain bookkeeping still runs through the original PlayerState methods.
      Object.defineProperty(player, 'funds', {
        enumerable: true,
        get: () => 99,
        set(_value) {},
      });
    }
  }
}
