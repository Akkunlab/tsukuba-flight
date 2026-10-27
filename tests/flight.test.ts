// 「スタート！」のあと何もしなくても飛び立てるか（実際の筑波大学の地形で）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { VEHICLES, fuelsFor, modeById } from '../src/content/index';
import { Flight, COUNTDOWN } from '../src/sim/flight';
import { World, type WorldData } from '../src/sim/world';

const DT = 1 / 60;
const world = new World(JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData);
const FREE = { ...modeById('tour'), wind: 0, checkpoints: [] };

function takesOff(vehicle: (typeof VEHICLES)[number], fuel: ReturnType<typeof fuelsFor>[number]): boolean {
  const f = new Flight(world, { vehicle, fuel, mode: FREE, seed: 1 });
  for (let t = 0; t < COUNTDOWN + 60 && f.phase !== 'ended' && !(f.tookOff && f.altitude > 20); t += DT) {
    f.update({ x: 0, y: 0, throttle: f.phase === 'flying' ? f.launchThrottle : 0 }, DT);
  }
  return f.tookOff && f.phase !== 'ended';
}

describe('何もしなくても飛び立てる', () => {
  for (const v of VEHICLES) {
    it(v.id, () => {
      // 乗り物ごとに、どれか 1 つの燃料で飛べればよい
      expect(fuelsFor(v).some((fuel) => takesOff(v, fuel)), `${v.id} がどの燃料でも離陸しない`).toBe(true);
    });
  }
});

describe('燃料が切れると落ちる', () => {
  for (const v of VEHICLES) {
    it(v.id, () => {
      const f = new Flight(world, { vehicle: v, fuel: fuelsFor(v)[0], mode: FREE, seed: 1 });
      for (let t = 0; t < COUNTDOWN + 60 && !(f.tookOff && f.altitude > 60); t += DT) {
        f.update({ x: 0, y: v.model === 'plane' ? 0.3 : 0, throttle: f.phase === 'flying' ? 1 : 0 }, DT);
      }
      f.craft.fuel = 0;
      let fastest = 0;
      for (let t = 0; t < 60 && f.phase !== 'ended'; t += DT) {
        f.update({ x: 0, y: 0, throttle: 1 }, DT);
        fastest = Math.min(fastest, f.craft.vel.y);
      }
      expect(f.phase, `${v.id} が落ちきらない`).toBe('ended');
      expect(fastest, `${v.id} の落ちる速さ`).toBeLessThan(-12);
    });
  }
});
