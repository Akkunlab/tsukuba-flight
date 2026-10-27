// 見た目の実装漏れ。three.js を読むので、DOM 側の型設定（tsconfig.json）で検査する。
import { describe, expect, it } from 'vitest';
import { SCENERY, VEHICLES } from '../src/content/index';
import { SHAPE_IDS } from '../src/render/vehicleMesh';
import { SCENERY_KINDS } from '../src/world/scenery';

describe('見た目', () => {
  it('乗り物の shape が実装されている', () => {
    for (const v of VEHICLES) expect(SHAPE_IDS, `${v.id}`).toContain(v.shape);
  });

  it('景色の kind が実装されている', () => {
    for (const s of SCENERY) expect(SCENERY_KINDS, `${s.id}`).toContain(s.kind);
  });
});
