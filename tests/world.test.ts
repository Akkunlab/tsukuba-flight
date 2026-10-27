// 実際の筑波大学データ（public/data/world.json）での確認。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODES, SCENERY, fuelById, vehicleById } from '../src/content/index';
import { Flight, COUNTDOWN, RING_RADIUS } from '../src/sim/flight';
import { PAD, RUNWAY, RUNWAY_START, World, inRunwayArea, type WorldData } from '../src/sim/world';

const data: WorldData = JSON.parse(readFileSync('public/data/world.json', 'utf8'));
const world = new World(data);

describe('筑波大学のデータ', () => {
  it('地形・建物・森がある', () => {
    expect(data.near.heights.length).toBe(data.near.size ** 2);
    expect(data.far.heights.length).toBe(data.far.size ** 2);
    expect(world.obstacles.filter((o) => o.kind === 'building').length).toBeGreaterThan(1000);
    expect(world.obstacles.filter((o) => o.kind === 'tree').length).toBeGreaterThan(10);
    for (const h of [...data.near.heights, ...data.far.heights]) expect(h).toBeGreaterThan(-50);
  });

  it('出典表示が入っている', () => {
    expect(data.attribution).toContain('国土地理院');
    expect(data.attribution).toContain('OpenStreetMap');
  });

  it('滑走路と発射台の上には何もない', () => {
    for (let z = RUNWAY.z - RUNWAY.length / 2; z <= RUNWAY.z + RUNWAY.length / 2; z += 10) {
      for (const dx of [-RUNWAY.width / 2, 0, RUNWAY.width / 2]) {
        expect(world.hitTest(RUNWAY.x + dx, world.terrainHeight(RUNWAY.x, z) + 3, z, 8), `z=${z}`).toBeNull();
      }
    }
    expect(world.hitTest(PAD.x, world.terrainHeight(PAD.x, PAD.z) + 3, PAD.z, 10)).toBeNull();
    expect(inRunwayArea(RUNWAY_START.x, RUNWAY_START.z)).toBe(true);
  });

  it('リングは建物や森に埋まっていない', () => {
    for (const m of MODES) {
      m.checkpoints.forEach((c) => {
        const y = world.terrainHeight(c.x, c.z) + c.alt;
        expect(world.hitTest(c.x, y, c.z, RING_RADIUS * 0.6), `${m.id}: ${c.name}`).toBeNull();
        expect(world.outOfBounds(c.x, c.z)).toBe(false);
      });
    }
  });

  it('景色は飛べる範囲の中にある', () => {
    for (const s of SCENERY) {
      if (typeof s.params.x === 'number' && typeof s.params.z === 'number') {
        expect(world.outOfBounds(s.params.x, s.params.z), s.id).toBe(false);
      }
    }
  });

  it('プロペラ機は本物の地形でも滑走路から離陸して上昇できる', () => {
    const f = new Flight(world, { vehicle: vehicleById('prop'), fuel: fuelById('jetfuel'), mode: { ...MODES[1], wind: 0 }, seed: 3 });
    const dt = 1 / 60;
    for (let t = 0; t < COUNTDOWN + 40 && f.phase !== 'ended'; t += dt) {
      f.update({ x: 0, y: f.altitude > 120 ? 0 : 0.35, throttle: f.phase === 'flying' ? 0.9 : 0 }, dt);
    }
    expect(f.outcome, f.cause).toBeNull();
    expect(f.tookOff).toBe(true);
    expect(f.altitude).toBeGreaterThan(60);
  });
});
