// 地形・建物・森の「当たり判定用」データ。three.js に依存しない（テストで直接使う）。

export interface HeightGrid {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  size: number;
  heights: number[];
}

export interface BuildingData {
  p: [number, number][];
  h: number;
  n?: string;
  t?: string;
  lv?: number;
  c?: string;
  rc?: string;
  rs?: string;
  /** 中庭（輪郭の中の穴） */
  hl?: [number, number][][];
}

export interface WorldData {
  origin: { lat: number; lon: number };
  attribution: string;
  near: HeightGrid;
  far: HeightGrid;
  /** p: 輪郭 / h: 高さ / n: 名前 / t: 種類 / lv: 階数 / c: 壁の色 / rc: 屋根の色 / rs: 屋根の形（OSM のタグ） */
  buildings: BuildingData[];
  woods: [number, number][][];
  water: [number, number][][];
  named: { n: string; x: number; z: number }[];
}

/** 架空の「筑波大学 農場滑走路」。キャンパス北側の畑に南北向きで置く */
export const RUNWAY = { x: 50, z: -1300, length: 1000, width: 45 };
export const RUNWAY_START = { x: RUNWAY.x, z: RUNWAY.z + RUNWAY.length / 2 - 40 };
export const PAD = { x: RUNWAY.x + 85, z: RUNWAY.z + RUNWAY.length / 2 - 60 };
/** 森の木の高さ（当たり判定） */
export const TREE_HEIGHT = 13;

export interface Obstacle {
  kind: 'building' | 'tree';
  name?: string;
  base: number;
  top: number;
  poly: [number, number][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  src?: BuildingData;
}

export interface Hit {
  kind: 'building' | 'tree' | 'terrain';
  name?: string;
  /** 障害物の上面の高さ（上から着地できるかの判定用） */
  top: number;
}

export function sampleGrid(g: HeightGrid, x: number, z: number): number {
  const fx = ((x - g.minX) / (g.maxX - g.minX)) * (g.size - 1);
  const fz = ((z - g.minZ) / (g.maxZ - g.minZ)) * (g.size - 1);
  const cx = Math.min(Math.max(fx, 0), g.size - 1.0001);
  const cz = Math.min(Math.max(fz, 0), g.size - 1.0001);
  const ix = Math.floor(cx);
  const iz = Math.floor(cz);
  const tx = cx - ix;
  const tz = cz - iz;
  const h = g.heights;
  const s = g.size;
  const a = h[iz * s + ix];
  const b = h[iz * s + ix + 1];
  const c = h[(iz + 1) * s + ix];
  const d = h[(iz + 1) * s + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

export function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 輪郭の中で、穴（中庭）の外か */
export function inShape(x: number, z: number, poly: [number, number][], holes?: [number, number][][]): boolean {
  return pointInPolygon(x, z, poly) && !(holes?.some((h) => pointInPolygon(x, z, h)) ?? false);
}

export function distToPolygonEdge(x: number, z: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j];
    const [bx, bz] = poly[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const px = ax + t * dx - x;
    const pz = az + t * dz - z;
    best = Math.min(best, Math.hypot(px, pz));
  }
  return best;
}

function polyBounds(poly: [number, number][]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function inRunwayArea(x: number, z: number, margin = 0): boolean {
  return Math.abs(x - RUNWAY.x) <= RUNWAY.width / 2 + margin && Math.abs(z - RUNWAY.z) <= RUNWAY.length / 2 + margin;
}

/**
 * 多角形から長方形の領域を取り除く（簡易版）。長方形と重なる多角形は、長方形の外側の 4 つの帯で切った最大の部分を残す。
 * 森の形を大きく崩さずに滑走路まわりを空けるための処理。
 */
export function clipOutRect(poly: [number, number][], minX: number, maxX: number, minZ: number, maxZ: number): [number, number][] | null {
  const bb = polyBounds(poly);
  if (bb.maxX < minX || bb.minX > maxX || bb.maxZ < minZ || bb.minZ > maxZ) return poly;
  const bands: [number, number, number, number][] = [
    [-Infinity, minX, -Infinity, Infinity],
    [maxX, Infinity, -Infinity, Infinity],
    [minX, maxX, -Infinity, minZ],
    [minX, maxX, maxZ, Infinity],
  ];
  let best: [number, number][] | null = null;
  let bestArea = 0;
  for (const [x0, x1, z0, z1] of bands) {
    const c = clipToBox(poly, x0, x1, z0, z1);
    if (c.length < 3) continue;
    const a = Math.abs(polyArea(c));
    if (a > bestArea) {
      bestArea = a;
      best = c;
    }
  }
  return bestArea > 200 ? best : null;
}

function polyArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return a / 2;
}

function clipToBox(poly: [number, number][], x0: number, x1: number, z0: number, z1: number): [number, number][] {
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= x0, (a, b) => lerpAt(a, b, 0, x0)],
    [(p) => p[0] <= x1, (a, b) => lerpAt(a, b, 0, x1)],
    [(p) => p[1] >= z0, (a, b) => lerpAt(a, b, 1, z0)],
    [(p) => p[1] <= z1, (a, b) => lerpAt(a, b, 1, z1)],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (out.length === 0) break;
  }
  return out;
}

function lerpAt(a: [number, number], b: [number, number], axis: 0 | 1, v: number): [number, number] {
  if (!Number.isFinite(v)) return a;
  const t = (v - a[axis]) / (b[axis] - a[axis] || 1e-9);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

const CELL = 64;

/** 地区の名前（名前のある建物が近くにないときの呼び名） */
export const AREAS: { n: string; x: number; z: number }[] = [
  { n: '筑波大学 中地区', x: 0, z: -200 },
  { n: '筑波大学 北地区', x: -100, z: -900 },
  { n: '筑波大学 南地区', x: 150, z: 700 },
  { n: '一の矢', x: -380, z: -1420 },
  { n: '平砂', x: 200, z: 900 },
  { n: '追越', x: 450, z: 450 },
  { n: '天久保', x: 900, z: 300 },
  { n: '附属病院のあたり', x: -83, z: 1436 },
  { n: '春日', x: 400, z: 2200 },
  { n: 'つくばセンター', x: 931, z: 2616 },
  { n: '農場滑走路', x: 50, z: -1300 },
  { n: '地図と測量の科学館のあたり', x: -1474, z: 225 },
  { n: '筑波山', x: 420, z: -13250 },
];

export class World {
  readonly data: WorldData;
  readonly obstacles: Obstacle[] = [];
  readonly runwayElevation: number;
  private grid = new Map<number, number[]>();

  constructor(data: WorldData) {
    this.data = data;
    this.runwayElevation = sampleGrid(data.near, RUNWAY.x, RUNWAY.z);
    for (const b of data.buildings) {
      const bb = polyBounds(b.p);
      // 滑走路と発射台の周りに建物は置かない（データ上ほぼ無いが念のため）
      if (inRunwayArea((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2, 60)) continue;
      const base = this.terrainHeight((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2);
      this.add({ kind: 'building', name: b.n, base, top: base + b.h, poly: b.p, ...bb, src: b });
    }
    for (const w of data.woods) {
      // 滑走路と発射台の周り（離着陸の通り道）にかかる森は切り開く
      const poly = clipOutRect(w, RUNWAY.x - RUNWAY.width / 2 - 70, RUNWAY.x + RUNWAY.width / 2 + 120, RUNWAY.z - RUNWAY.length / 2 - 250, RUNWAY.z + RUNWAY.length / 2 + 250);
      if (!poly) continue;
      const bb = polyBounds(poly);
      if (bb.maxX - bb.minX > 3000 || bb.maxZ - bb.minZ > 3000) continue;
      const base = this.terrainHeight((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2);
      this.add({ kind: 'tree', base, top: base + TREE_HEIGHT, poly, ...bb });
    }
  }

  private key(ix: number, iz: number) {
    return (ix + 1000) * 4000 + (iz + 1000);
  }

  private add(o: Obstacle) {
    const idx = this.obstacles.push(o) - 1;
    for (let ix = Math.floor(o.minX / CELL); ix <= Math.floor(o.maxX / CELL); ix++) {
      for (let iz = Math.floor(o.minZ / CELL); iz <= Math.floor(o.maxZ / CELL); iz++) {
        const k = this.key(ix, iz);
        const list = this.grid.get(k);
        if (list) list.push(idx);
        else this.grid.set(k, [idx]);
      }
    }
  }

  /** 地形の高さ [m]。近景は細かいデータ、外側は遠景データ。滑走路は平らにならす */
  terrainHeight(x: number, z: number): number {
    const n = this.data.near;
    let h: number;
    if (x >= n.minX && x <= n.maxX && z >= n.minZ && z <= n.maxZ) {
      h = sampleGrid(n, x, z);
    } else {
      h = sampleGrid(this.data.far, x, z);
    }
    if (this.runwayElevation !== undefined) {
      const dx = Math.max(0, Math.abs(x - RUNWAY.x) - (RUNWAY.width / 2 + 60));
      const dz = Math.max(0, Math.abs(z - RUNWAY.z) - (RUNWAY.length / 2 + 40));
      const d = Math.hypot(dx, dz);
      if (d < 80) {
        const t = d / 80;
        h = this.runwayElevation * (1 - t) + h * t;
      }
    }
    return h;
  }

  private candidates(x: number, z: number, r: number): Obstacle[] {
    const out = new Set<number>();
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (list) for (const i of list) out.add(i);
      }
    }
    return [...out].map((i) => this.obstacles[i]);
  }

  /** 屋上・森の上を含めた「足元の高さ」。着陸面の判定に使う */
  surfaceHeight(x: number, z: number): { height: number; kind: Hit['kind']; name?: string } {
    let best: { height: number; kind: Hit['kind']; name?: string } = { height: this.terrainHeight(x, z), kind: 'terrain' };
    for (const o of this.candidates(x, z, 0)) {
      if (x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue;
      if (o.top > best.height && inShape(x, z, o.poly, o.src?.hl)) best = { height: o.top, kind: o.kind, name: o.name };
    }
    return best;
  }

  /** 半径 r の球が障害物にぶつかっているか。地面との接触は扱わない（physics 側で判定） */
  hitTest(x: number, y: number, z: number, r: number): Hit | null {
    for (const o of this.candidates(x, z, r)) {
      if (x < o.minX - r || x > o.maxX + r || z < o.minZ - r || z > o.maxZ + r) continue;
      if (y - r * 0.5 > o.top || y + r < o.base) continue;
      if (inShape(x, z, o.poly, o.src?.hl) || distToPolygonEdge(x, z, o.poly) < r || (o.src?.hl?.some((h) => distToPolygonEdge(x, z, h) < r) ?? false)) {
        return { kind: o.kind, name: o.name, top: o.top };
      }
    }
    return null;
  }

  outOfBounds(x: number, z: number): boolean {
    const f = this.data.far;
    const m = 600;
    return x < f.minX + m || x > f.maxX - m || z < f.minZ + m || z > f.maxZ - m;
  }

  /** いまいる場所の呼び名（飛行中の表示用）。近くの名前のある建物 → 地区の名前 → つくば市 */
  placeName(x: number, z: number): { name: string; near: boolean } {
    const b = this.nearestName(x, z, 120);
    if (b) return { name: b, near: true };
    let best = 'つくば市';
    let bd = 1400;
    for (const a of AREAS) {
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < bd) {
        bd = d;
        best = a.n;
      }
    }
    return { name: best, near: false };
  }

  /** 名前のある建物で一番近いもの（墜落地点の説明用） */
  nearestName(x: number, z: number, within = 150): string | undefined {
    let best: string | undefined;
    let bd = within;
    for (const n of this.data.named) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) {
        bd = d;
        best = n.n;
      }
    }
    return best;
  }
}

export function makeFlatWorldData(opts: { ground?: number; buildings?: WorldData['buildings']; woods?: WorldData['woods'] } = {}): WorldData {
  const g = opts.ground ?? 20;
  const grid = (half: number): HeightGrid => ({ minX: -half, maxX: half, minZ: -half, maxZ: half, size: 2, heights: [g, g, g, g] });
  return {
    origin: { lat: 0, lon: 0 },
    attribution: '',
    near: grid(3000),
    far: grid(15000),
    buildings: opts.buildings ?? [],
    woods: opts.woods ?? [],
    water: [],
    named: [],
  };
}
