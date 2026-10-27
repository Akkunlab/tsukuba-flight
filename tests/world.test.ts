// 実際の筑波大学データ（public/data/world.json）の確認。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAD, RUNWAY, World, flatHeights, type WorldFile } from '../src/sim/world';

const data = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldFile;
// 標高は遊ぶときに国土地理院から読み込むので、テストでは平らな地面に実際の建物を置く
const world = new World({ ...data, near: flatHeights(data.near), far: flatHeights(data.far) });

describe('筑波大学のデータ', () => {
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
  });
});
