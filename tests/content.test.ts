// 要素データ（乗り物・燃料・搭乗者・モード・景色）の参照が切れていないか。
// 値の上限は見ない。数として壊れていないことと、指している先が実在することだけを見る。
import { describe, expect, it } from 'vitest';
import { EVOLUTION_LOG, FUELS, GENERATION, MODES, PASSENGERS, SCENERY, VEHICLES, fuelsFor } from '../src/content/index';
import { uniqueIds, validateFuel, validateMode, validatePassenger, validateVehicle } from '../src/content/validate';

describe('content', () => {
  it('id が重複していない', () => {
    expect([
      ...uniqueIds(VEHICLES, 'vehicles'),
      ...uniqueIds(FUELS, 'fuels'),
      ...uniqueIds(PASSENGERS, 'passengers'),
      ...uniqueIds(MODES, 'modes'),
      ...uniqueIds(SCENERY, 'scenery'),
    ]).toEqual([]);
  });

  it('値が壊れていない', () => {
    const fuelIds = FUELS.map((f) => f.id);
    expect([
      ...VEHICLES.flatMap((v) => validateVehicle(v, fuelIds)),
      ...FUELS.flatMap(validateFuel),
      ...PASSENGERS.flatMap(validatePassenger),
      ...MODES.flatMap(validateMode),
    ]).toEqual([]);
  });

  it('どの乗り物にも使える燃料がある', () => {
    for (const v of VEHICLES) expect(fuelsFor(v).length, v.id).toBeGreaterThan(0);
  });

  it('進化ログの世代が 1 から連番', () => {
    EVOLUTION_LOG.forEach((e, i) => expect(e.generation).toBe(i + 1));
    expect(GENERATION).toBe(EVOLUTION_LOG.length);
  });
});
