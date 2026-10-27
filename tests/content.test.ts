// 要素データ（乗り物・燃料・搭乗者・モード・景色）が壊れていないか。
// 改善ループで要素が増えても、ここが通る限りメニューと物理に安全に乗る。
import { describe, expect, it } from 'vitest';
import { EVOLUTION_LOG, FUELS, GENERATION, MODES, PASSENGERS, SCENERY, VEHICLES, fuelsFor } from '../src/content/index';
import {
  uniqueIds,
  validateFuel,
  validateMode,
  validatePassenger,
  validateScenery,
  validateVehicle,
} from '../src/content/validate';
import { readFileSync } from 'node:fs';

// three.js を読まずに、ビルダー名だけをソースから拾う（node でも動くように）
function builderKeys(file: string, objectName: string): string[] {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf(`${objectName}: Record<string, `);
  expect(start, `${objectName} が ${file} に見つからない`).toBeGreaterThan(-1);
  const body = src.slice(start);
  const keys = [...body.matchAll(/^ {2}([a-z][a-zA-Z0-9]*)\(/gm)].map((m) => m[1]);
  return keys;
}

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

  it('乗り物の値が範囲内', () => {
    const fuelIds = FUELS.map((f) => f.id);
    expect(VEHICLES.flatMap((v) => validateVehicle(v, fuelIds))).toEqual([]);
  });

  it('乗り物の見た目（shape）が実装されている', () => {
    const shapes = builderKeys('src/render/vehicleMesh.ts', 'SHAPES');
    expect(shapes.length).toBeGreaterThan(3);
    for (const v of VEHICLES) expect(shapes, `shape ${v.shape} (${v.id})`).toContain(v.shape);
  });

  it('エンジン音の種類が実装されている', () => {
    const src = readFileSync('src/audio/sound.ts', 'utf8');
    for (const v of VEHICLES) expect(src, `engine ${v.engine} (${v.id})`).toContain(`case '${v.engine}'`);
  });

  it('どの乗り物にも使える燃料がある', () => {
    for (const v of VEHICLES) expect(fuelsFor(v).length, v.id).toBeGreaterThan(0);
  });

  it('燃料・搭乗者・モードの値が範囲内', () => {
    expect(FUELS.flatMap(validateFuel)).toEqual([]);
    expect(PASSENGERS.flatMap(validatePassenger)).toEqual([]);
    expect(MODES.flatMap(validateMode)).toEqual([]);
  });

  it('景色の kind が実装されている', () => {
    const kinds = builderKeys('src/world/scenery.ts', 'SCENERY_BUILDERS');
    expect(kinds).toContain('label');
    expect(SCENERY.flatMap((s) => validateScenery(s, kinds))).toEqual([]);
  });

  it('進化ログの世代が 1 から連番で、日付と説明がある', () => {
    EVOLUTION_LOG.forEach((e, i) => {
      expect(e.generation).toBe(i + 1);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeGreaterThan(0);
    });
    expect(GENERATION).toBe(EVOLUTION_LOG.length);
  });

  it('メニューに出す最低限の数がある', () => {
    expect(VEHICLES.length).toBeGreaterThanOrEqual(3);
    expect(FUELS.length).toBeGreaterThanOrEqual(2);
    expect(PASSENGERS.length).toBeGreaterThanOrEqual(2);
    expect(MODES.some((m) => m.checkpoints.length === 0)).toBe(true);
  });
});
