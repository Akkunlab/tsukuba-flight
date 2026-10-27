// 国土地理院の標高タイル（dem_png）をブラウザで直接読み込み、標高グリッドにする。
// 標高は測量法の基本測量成果なので、加工したものを配らず、遊ぶたびにその場で読み込む。
import type { GridSpec, HeightGrid } from '../sim/world';

const URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png';

function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x, y };
}

async function tilePixels(z: number, x: number, y: number): Promise<Uint8ClampedArray | null> {
  const res = await fetch(`${URL}/${z}/${x}/${y}.png`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`標高タイル ${z}/${x}/${y}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(256, 256);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, 256, 256).data;
}

/** dem_png の画素を標高 [m] にする（無効値は NaN） */
function decode(r: number, g: number, b: number) {
  const v = r * 65536 + g * 256 + b;
  if (v === 8388608) return NaN;
  return (v >= 8388608 ? v - 16777216 : v) * 0.01;
}

export async function loadHeights(spec: GridSpec, onProgress?: (done: number, total: number) => void): Promise<HeightGrid> {
  const { z, size } = spec;
  const p0 = tileXY(spec.north, spec.west, z);
  const p1 = tileXY(spec.south, spec.east, z);
  const tx0 = Math.floor(p0.x);
  const ty0 = Math.floor(p0.y);
  const tx1 = Math.floor(p1.x);
  const ty1 = Math.floor(p1.y);
  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;
  const W = cols * 256;
  const H = rows * 256;
  const mosaic = new Float32Array(W * H).fill(NaN);
  let done = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(
        tilePixels(z, tx, ty).then((px) => {
          if (px) {
            const ox = (tx - tx0) * 256;
            const oy = (ty - ty0) * 256;
            for (let j = 0; j < 256; j++) {
              for (let i = 0; i < 256; i++) {
                const k = (j * 256 + i) * 4;
                mosaic[(oy + j) * W + ox + i] = decode(px[k], px[k + 1], px[k + 2]);
              }
            }
          }
          onProgress?.(++done, cols * rows);
        }),
      );
    }
  }
  await Promise.all(jobs);
  const valid = Array.from(mosaic.filter((v) => !Number.isNaN(v))).sort((a, b) => a - b);
  const fill = valid.length ? valid[valid.length >> 1] : 0;
  // bbox にぴったり合わせて size × size に双線形で取り直す
  const x0 = (p0.x - tx0) * 256;
  const y0 = (p0.y - ty0) * 256;
  const x1 = (p1.x - tx0) * 256;
  const y1 = (p1.y - ty0) * 256;
  const at = (x: number, y: number) => {
    const v = mosaic[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    return Number.isNaN(v) ? fill : v;
  };
  const heights = new Array<number>(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const fx = x0 + ((x1 - x0) * i) / (size - 1) - 0.5;
      const fy = y0 + ((y1 - y0) * j) / (size - 1) - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
      const b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
      heights[j * size + i] = Math.round((a * (1 - ty) + b * ty) * 10) / 10;
    }
  }
  const { minX, maxX, minZ, maxZ } = spec;
  return { minX, maxX, minZ, maxZ, size, heights };
}
