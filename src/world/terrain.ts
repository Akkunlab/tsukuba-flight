import * as THREE from 'three';
import { PAD, RUNWAY, World, inShape } from '../sim/world';

export interface PhotoSampler {
  colorAt(x: number, z: number): THREE.Color;
}

export async function loadTexture(url: string, renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export function makePhotoSampler(img: HTMLImageElement | ImageBitmap, world: World, width = 2048): PhotoSampler {
  const w = Math.min(width, img.width);
  const h = Math.round((img.height / img.width) * w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const n = world.data.near;
  return {
    colorAt(x, z) {
      const u = Math.min(w - 1, Math.max(0, Math.floor(((x - n.minX) / (n.maxX - n.minX)) * w)));
      const v = Math.min(h - 1, Math.max(0, Math.floor(((z - n.minZ) / (n.maxZ - n.minZ)) * h)));
      const i = (v * w + u) * 4;
      return new THREE.Color().setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, THREE.SRGBColorSpace);
    },
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, r: () => number) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(r() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** 壁の模様。1 枚が tileW[m] × tileH[m] に対応する。色はテクスチャ（明るさ）× 頂点色（建物ごとの色） */
interface FacadeStyle {
  tileW: number;
  tileH: number;
  map: THREE.Texture;
  rough: THREE.Texture;
}

function facade(kind: 'office' | 'apartment' | 'house' | 'glass' | 'metal'): FacadeStyle {
  const r = rng(kind.length * 77);
  const S = 512;
  type Draw = (g: CanvasRenderingContext2D, rough: boolean) => void;
  let tileW = 12;
  let tileH = 15.2;
  let draw: Draw;
  const glassCol = (g: CanvasRenderingContext2D, rough: boolean, x: number, y: number, w: number, h: number) => {
    if (rough) {
      g.fillStyle = '#141414';
      g.fillRect(x, y, w, h);
      return;
    }
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#5b7186');
    grad.addColorStop(1, '#2a3846');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = `rgba(${200 + r() * 55},${200 + r() * 55},${190 + r() * 40},${0.08 + r() * 0.12})`;
      g.fillRect(x + r() * w * 0.7, y, w * (0.15 + r() * 0.3), h);
    }
  };
  switch (kind) {
    case 'office':
      tileW = 12;
      tileH = 15.2;
      draw = (g, rough) => {
        const fh = S / 4;
        for (let f = 0; f < 4; f++) {
          const y = f * fh;
          const wy = y + fh * 0.18;
          const wh = fh * 0.5;
          for (let i = 0; i < 4; i++) {
            const x = i * (S / 4) + 6;
            glassCol(g, rough, x, wy, S / 4 - 12, wh);
            if (!rough) {
              g.fillStyle = 'rgba(40,40,40,0.55)';
              g.fillRect(x + (S / 4 - 12) / 2 - 1, wy, 3, wh);
            }
          }
          if (!rough) {
            g.fillStyle = 'rgba(0,0,0,0.12)';
            g.fillRect(0, wy + wh, S, 4);
          }
        }
      };
      break;
    case 'apartment':
      tileW = 7.2;
      tileH = 8.4;
      draw = (g, rough) => {
        const fh = S / 3;
        for (let f = 0; f < 3; f++) {
          const y = f * fh;
          for (let u = 0; u < 2; u++) {
            const x = u * (S / 2);
            glassCol(g, rough, x + 30, y + fh * 0.12, S / 2 - 110, fh * 0.6);
            if (!rough) {
              g.fillStyle = 'rgba(0,0,0,0.35)';
              g.fillRect(x + S / 2 - 70, y + fh * 0.2, 46, fh * 0.42);
              g.fillStyle = 'rgba(230,230,225,0.9)';
              g.fillRect(x + S / 2 - 66, y + fh * 0.5, 38, fh * 0.12);
            }
          }
          if (!rough) {
            g.fillStyle = 'rgba(255,255,255,0.85)';
            g.fillRect(0, y + fh * 0.62, S, fh * 0.26);
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(0, y + fh * 0.88, S, 6);
            for (let x = 0; x < S; x += S / 2) {
              g.fillStyle = 'rgba(0,0,0,0.2)';
              g.fillRect(x, y, 6, fh);
            }
          } else {
            g.fillStyle = '#c8c8c8';
            g.fillRect(0, y + fh * 0.62, S, fh * 0.26);
          }
        }
      };
      break;
    case 'house':
      tileW = 6;
      tileH = 2.9;
      draw = (g, rough) => {
        glassCol(g, rough, 70, 150, 120, 210);
        glassCol(g, rough, 320, 150, 110, 150);
        if (!rough) {
          g.fillStyle = 'rgba(60,60,60,0.5)';
          g.fillRect(64, 140, 132, 10);
          g.fillRect(314, 140, 122, 10);
          g.fillStyle = 'rgba(255,255,255,0.4)';
          g.fillRect(70, 255, 120, 4);
        }
      };
      break;
    case 'glass':
      tileW = 4;
      tileH = 4;
      draw = (g, rough) => {
        g.fillStyle = rough ? '#101010' : 'rgba(170,200,190,0.55)';
        g.fillRect(0, 0, S, S);
        g.fillStyle = rough ? '#888' : 'rgba(240,240,240,0.9)';
        for (let i = 0; i <= 4; i++) {
          g.fillRect((i * S) / 4 - 3, 0, 6, S);
          g.fillRect(0, (i * S) / 4 - 3, S, 6);
        }
      };
      break;
    case 'metal':
      tileW = 4;
      tileH = 4;
      draw = (g, rough) => {
        for (let x = 0; x < S; x += 16) {
          g.fillStyle = rough ? '#777' : 'rgba(0,0,0,0.13)';
          g.fillRect(x, 0, 6, S);
          if (!rough) {
            g.fillStyle = 'rgba(255,255,255,0.12)';
            g.fillRect(x + 8, 0, 3, S);
          }
        }
      };
      break;
  }
  const map = canvasTex(S, S, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    speckle(g, S, S, 4000, 0.07, r);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(60,55,50,${0.03 + r() * 0.05})`;
      g.fillRect(r() * S, r() * S, 2 + r() * 6, 30 + r() * 120);
    }
    draw(g, false);
  });
  const rough = canvasTex(
    S,
    S,
    (g) => {
      g.fillStyle = kind === 'metal' ? '#9a9a9a' : '#e8e8e8';
      g.fillRect(0, 0, S, S);
      draw(g, true);
    },
    false,
  );
  return { tileW, tileH, map, rough };
}

function roofTexture(): THREE.CanvasTexture {
  const r = rng(5);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 6000, 0.18, r);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 6; i++) g.fillRect(r() * w, r() * h, 20 + r() * 40, 20 + r() * 40);
  });
}

function tileRoofTexture(): THREE.CanvasTexture {
  // 瓦・スレートの段。v 方向が軒→棟
  const r = rng(11);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(0, y, w, 3);
      for (let x = (y / 16) % 2 ? 0 : 12; x < w; x += 24) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x, y, 2, 16);
      }
    }
    speckle(g, w, h, 2500, 0.12, r);
  });
}

/** 値ノイズ。gray なら白黒（色の模様用）、そうでなければ r と g に別の値（詳細・法線用） */
function noiseTexture(seed: number, size = 256, gray = false): THREE.CanvasTexture {
  const r = rng(seed);
  const t = canvasTex(
    size,
    size,
    (g, w, h) => {
      const img = g.createImageData(w, h);
      const layers = [8, 32, 128].map((n) => {
        const grid = Array.from({ length: (n + 1) * (n + 1) }, () => r());
        return { n, grid };
      });
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = 0;
          let amp = 0.5;
          for (const { n, grid } of layers) {
            const fx = (x / w) * n;
            const fy = (y / h) * n;
            const ix = Math.floor(fx);
            const iy = Math.floor(fy);
            const tx = fx - ix;
            const ty = fy - iy;
            const at = (i: number, j: number) => grid[((j % n) * (n + 1)) + (i % n)];
            const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
            const b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
            v += (a * (1 - ty) + b * ty) * amp;
            amp *= 0.5;
          }
          const c = Math.round((v / 0.875) * 255);
          const i = (y * w + x) * 4;
          img.data[i] = c;
          img.data[i + 1] = gray ? c : 255 - c;
          img.data[i + 2] = c;
          img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    },
    false,
  );
  return t;
}

/** 地面の近くで航空写真のぼやけを隠す、細かいムラ（世界座標で貼る） */
function addDetail(mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, detail: THREE.Texture, strength = 0.35) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldD;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldD = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vWorldD;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float dn = texture2D(detailMap, vWorldD.xz / 9.0).r * 0.55 + texture2D(detailMap, vWorldD.xz / 61.0).g * 0.45;
        float fade = clamp(1.0 - length(vWorldD - cameraPosition) / 1600.0, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 + (dn - 0.5) * ${strength.toFixed(2)} * fade;`,
      );
  };
}

export function buildTerrain(world: World, nearTex: THREE.Texture, farTex: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const n = world.data.near;
  const f = world.data.far;
  const detail = noiseTexture(3);

  const near = new THREE.PlaneGeometry(n.maxX - n.minX, n.maxZ - n.minZ, (n.size - 1) * 2, (n.size - 1) * 2);
  near.rotateX(-Math.PI / 2);
  near.translate((n.minX + n.maxX) / 2, 0, (n.minZ + n.maxZ) / 2);
  const p = near.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, world.terrainHeight(p.getX(i), p.getZ(i)));
  near.computeVertexNormals();
  const nearMat = new THREE.MeshStandardMaterial({ map: nearTex, roughness: 0.95, metalness: 0 });
  addDetail(nearMat, detail);
  const nearMesh = new THREE.Mesh(near, nearMat);
  nearMesh.name = 'terrain-near';
  nearMesh.receiveShadow = true;
  group.add(nearMesh);

  const far = new THREE.PlaneGeometry(f.maxX - f.minX, f.maxZ - f.minZ, f.size - 1, f.size - 1);
  far.rotateX(-Math.PI / 2);
  far.translate((f.minX + f.maxX) / 2, 0, (f.minZ + f.maxZ) / 2);
  const q = far.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i);
    const z = q.getZ(i);
    const inside = x > n.minX + 30 && x < n.maxX - 30 && z > n.minZ + 30 && z < n.maxZ - 30;
    // 近景の下に隠れる部分は沈めて、ちらつきを防ぐ
    q.setY(i, world.terrainHeight(x, z) - (inside ? 6 : 0.3));
  }
  far.computeVertexNormals();
  const farMesh = new THREE.Mesh(far, new THREE.MeshStandardMaterial({ map: farTex, roughness: 1, metalness: 0 }));
  farMesh.name = 'terrain-far';
  group.add(farMesh);

  const horizon = new THREE.Mesh(
    new THREE.CircleGeometry(90000, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x55653f, roughness: 1 }),
  );
  horizon.position.y = -2;
  group.add(horizon);
  return group;
}

type Style = 'office' | 'apartment' | 'house' | 'glass' | 'metal';

function styleOf(t: string | undefined, h: number, area: number): Style | 'canopy' {
  switch (t) {
    case 'roof':
    case 'carport':
    case 'bridge':
      return 'canopy';
    case 'greenhouse':
      return 'glass';
    case 'house':
    case 'detached':
      return 'house';
    case 'apartments':
    case 'dormitory':
    case 'residential':
    case 'hotel':
      return 'apartment';
    case 'shed':
    case 'garage':
    case 'garages':
    case 'warehouse':
    case 'industrial':
    case 'service':
      return 'metal';
    case 'university':
    case 'school':
    case 'college':
    case 'hospital':
    case 'commercial':
    case 'retail':
    case 'public':
    case 'kindergarten':
      return 'office';
  }
  // 種類が書かれていない建物は大きさで決める
  if (area < 160 && h <= 9) return 'house';
  if (area < 60) return 'metal';
  return 'office';
}

const WALL_PALETTES: Record<Style, number[]> = {
  // 筑波大学の建物はタイル張りの茶・ベージュ系とコンクリートが多い
  office: [0xc9c1b3, 0xb8ad9a, 0xd8d2c6, 0xa89582, 0x9c8b78, 0xcfc9bd, 0xbfb8ab],
  apartment: [0xeae6dc, 0xddd6c8, 0xe9e1d0, 0xd2cec6, 0xc8b9a4],
  house: [0xf0ece2, 0xe6dccb, 0xd9cbb3, 0xcfc8bc, 0xbfae95, 0xe8e4dc, 0x9ea3a6],
  glass: [0xdfe9e4],
  metal: [0xb7bbbd, 0xa6aaa8, 0x8f9a9e, 0xc4c0b6, 0x7f8c84],
};

class GeoBuf {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  /** 三角形を、内側の点 inside から外へ向く向きで足す */
  tri(a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[], color: THREE.Color, inside: number[]) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const out = (a[0] - inside[0]) * n[0] + (a[1] - inside[1]) * n[1] + (a[2] - inside[2]) * n[2];
    if (out < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

function polyArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return a / 2;
}

/** 面積最小の外接長方形（家の切妻屋根を載せる向きを決める） */
function minRect(poly: [number, number][]) {
  let best = { area: Infinity, ang: 0, minU: 0, maxU: 0, minV: 0, maxV: 0 };
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const ang = Math.atan2(bz - az, bx - ax);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of poly) {
      const u = x * c + z * s;
      const v = -x * s + z * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) best = { area, ang, minU, maxU, minV, maxV };
  }
  return best;
}

/** OSM の色名は原色に近いので、実際の外壁・屋根材の色に置き換える */
const MATERIAL_COLORS: Record<string, number> = {
  brown: 0x8e6f5a,
  firebrick: 0x98604e,
  maroon: 0x7a5248,
  red: 0xa0614f,
  pink: 0xd6bcb1,
  beige: 0xd8ccb2,
  lightyellow: 0xe6dfc6,
  yellow: 0xd9cc98,
  ivory: 0xece8dc,
  white: 0xe6e5e0,
  lightgrey: 0xc4c4c0,
  lightgray: 0xc4c4c0,
  grey: 0x96979a,
  gray: 0x96979a,
  green: 0x7c8a72,
  lightblue: 0x8fa2ad,
  blue: 0x5f7486,
};

function parseColor(s: string | undefined): THREE.Color | null {
  if (!s) return null;
  const key = s.trim().toLowerCase();
  if (MATERIAL_COLORS[key] !== undefined) return new THREE.Color(MATERIAL_COLORS[key]);
  try {
    const c = new THREE.Color();
    c.setStyle(key, THREE.SRGBColorSpace);
    // 原色のままだと浮くので、彩度を落とす
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    return c.setHSL(hsl.h, hsl.s * 0.45, Math.min(0.8, Math.max(0.3, hsl.l)));
  } catch {
    return null;
  }
}

export function buildBuildings(world: World, sampler: PhotoSampler | null): THREE.Group {
  const styles: Record<Style, FacadeStyle> = {
    office: facade('office'),
    apartment: facade('apartment'),
    house: facade('house'),
    glass: facade('glass'),
    metal: facade('metal'),
  };
  const walls: Record<Style, GeoBuf> = { office: new GeoBuf(), apartment: new GeoBuf(), house: new GeoBuf(), glass: new GeoBuf(), metal: new GeoBuf() };
  const flatRoofs = new GeoBuf();
  const pitched = new GeoBuf();
  const rand = rng(42);

  for (const o of world.obstacles) {
    if (o.kind !== 'building') continue;
    const info = o.src;
    let poly = o.poly;
    const area = polyArea(poly);
    if (area > 0) poly = [...poly].reverse();
    const absArea = Math.abs(area);
    const h = o.top - o.base;
    const style = styleOf(info?.t, h, absArea);
    const cx = (o.minX + o.maxX) / 2;
    const cz = (o.minZ + o.maxZ) / 2;
    const photo = sampler ? sampleRoof(sampler, poly) : new THREE.Color(0x888888);
    const roofColor = parseColor(info?.rc) ?? photo.clone().multiplyScalar(1.05);
    const pal = WALL_PALETTES[style === 'canopy' ? 'metal' : style];
    const wallColor = parseColor(info?.c) ?? new THREE.Color(pal[Math.floor(rand() * pal.length)]).multiplyScalar(0.92 + rand() * 0.12);
    const y0 = o.base - 1.5;
    const y1 = o.top;

    if (style === 'canopy') {
      addRoofSlab(flatRoofs, poly, y1 - 0.3, y1, roofColor, [cx, y1 - 0.15, cz]);
      continue;
    }

    // 家は切妻屋根（四角に近い小さい家だけ）
    let eave = y1;
    let rect: ReturnType<typeof minRect> | null = null;
    if (style === 'house' && absArea < 260 && info?.rs !== 'flat') {
      rect = minRect(poly);
      const fill = absArea / rect.area;
      const short = Math.min(rect.maxU - rect.minU, rect.maxV - rect.minV);
      if (fill > 0.72 && short > 3) {
        const rise = Math.min(2.6, short * 0.32);
        eave = y1 - rise;
      } else {
        rect = null;
      }
    }

    const fs = styles[style];
    const buf = walls[style];
    let along = rand() * fs.tileW;
    const holes = info?.hl ?? [];
    for (const ring of [poly, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % ring.length];
        const len = Math.hypot(bx - ax, bz - az);
        const u0 = along / fs.tileW;
        const u1 = (along + len) / fs.tileW;
        const v0 = (y0 - o.base) / fs.tileH;
        const v1 = (eave - o.base) / fs.tileH;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const nx = -(bz - az) / (len || 1);
        const nz = (bx - ax) / (len || 1);
        // 辺の中点から少しずらした点が輪郭の中にある側を「内側」とする（多角形の向きに頼らない）
        const sgn = inShape(mx - nx * 0.3, mz - nz * 0.3, poly, holes) ? 1 : -1;
        const inPt = [mx - nx * 0.3 * sgn, (y0 + eave) / 2, mz - nz * 0.3 * sgn];
        buf.tri([ax, y0, az], [bx, y0, bz], [bx, eave, bz], [u0, v0], [u1, v0], [u1, v1], wallColor, inPt);
        buf.tri([ax, y0, az], [bx, eave, bz], [ax, eave, az], [u0, v0], [u1, v1], [u0, v1], wallColor, inPt);
        along += len;
      }
    }

    if (rect) {
      addGable(pitched, walls[style], rect, eave, y1, roofColor, wallColor, fs);
    } else {
      addRoofSlab(flatRoofs, poly, y1, y1, roofColor, [cx, y1 - 1, cz], holes);
    }
  }

  const group = new THREE.Group();
  group.name = 'buildings';
  (Object.keys(walls) as Style[]).forEach((k) => {
    const g = walls[k].build();
    const mat = new THREE.MeshStandardMaterial({
      map: styles[k].map,
      roughnessMap: styles[k].rough,
      roughness: 1,
      metalness: k === 'metal' ? 0.35 : 0,
      vertexColors: true,
      transparent: k === 'glass',
      opacity: k === 'glass' ? 0.8 : 1,
      envMapIntensity: 0.9,
    });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.9, vertexColors: true });
  const fr = new THREE.Mesh(flatRoofs.build(), roofMat);
  fr.castShadow = fr.receiveShadow = true;
  const pr = new THREE.Mesh(pitched.build(), new THREE.MeshStandardMaterial({ map: tileRoofTexture(), roughness: 0.6, metalness: 0.1, vertexColors: true }));
  pr.castShadow = pr.receiveShadow = true;
  group.add(fr, pr);
  return group;
}

function sampleRoof(sampler: PhotoSampler, poly: [number, number][]): THREE.Color {
  // 重心と、重心と各頂点の中点で写真の色を平均する（縁の影を避ける）
  let cx = 0;
  let cz = 0;
  for (const [x, z] of poly) {
    cx += x;
    cz += z;
  }
  cx /= poly.length;
  cz /= poly.length;
  const acc = sampler.colorAt(cx, cz);
  let n = 1;
  for (let i = 0; i < poly.length; i += Math.max(1, Math.floor(poly.length / 6))) {
    const c = sampler.colorAt((cx + poly[i][0]) / 2, (cz + poly[i][1]) / 2);
    acc.add(c);
    n++;
  }
  return acc.multiplyScalar(1 / n);
}

function addRoofSlab(buf: GeoBuf, poly: [number, number][], yBottom: number, yTop: number, color: THREE.Color, inside: number[], holes: [number, number][][] = []) {
  const v2 = (ring: [number, number][]) => ring.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(v2(poly), holes.map(v2));
  const all = [...poly, ...holes.flat()];
  const above = [inside[0], yTop - 50, inside[2]];
  for (const t of tris) {
    const [a, b, c] = t.map((i) => all[i]);
    buf.tri([a[0], yTop, a[1]], [b[0], yTop, b[1]], [c[0], yTop, c[1]], [a[0] / 8, a[1] / 8], [b[0] / 8, b[1] / 8], [c[0] / 8, c[1] / 8], color, above);
  }
  if (yBottom < yTop) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const c = [inside[0], (yBottom + yTop) / 2, inside[2]];
      buf.tri([ax, yBottom, az], [bx, yBottom, bz], [bx, yTop, bz], [0, 0], [1, 0], [1, 1], color, c);
      buf.tri([ax, yBottom, az], [bx, yTop, bz], [ax, yTop, az], [0, 0], [1, 1], [0, 1], color, c);
      buf.tri([ax, yBottom, az], [bx, yBottom, bz], [inside[0], yBottom, inside[2]], [0, 0], [1, 0], [0.5, 0.5], color.clone().multiplyScalar(0.5), [inside[0], yBottom + 10, inside[2]]);
    }
  }
}

function addGable(roof: GeoBuf, wall: GeoBuf, r: ReturnType<typeof minRect>, eave: number, ridge: number, roofColor: THREE.Color, wallColor: THREE.Color, fs: FacadeStyle) {
  const c = Math.cos(r.ang);
  const s = Math.sin(r.ang);
  const toXZ = (u: number, v: number) => [u * c - v * s, u * s + v * c];
  const lenU = r.maxU - r.minU;
  const lenV = r.maxV - r.minV;
  const eaves = 0.45;
  const alongU = lenU >= lenV;
  const mid = alongU ? (r.minV + r.maxV) / 2 : (r.minU + r.maxU) / 2;
  const p = (u: number, v: number, y: number) => {
    const [x, z] = toXZ(u, v);
    return [x, y, z];
  };
  const centre = p((r.minU + r.maxU) / 2, (r.minV + r.maxV) / 2, eave - 3);
  const dropY = eave - 0.25;
  if (alongU) {
    const u0 = r.minU - eaves, u1 = r.maxU + eaves;
    for (const vEdge of [r.minV - eaves, r.maxV + eaves]) {
      const a = p(u0, vEdge, dropY), b = p(u1, vEdge, dropY), cc = p(u1, mid, ridge), d = p(u0, mid, ridge);
      const sl = Math.hypot(mid - vEdge, ridge - dropY) / 2.4;
      roof.tri(a, b, cc, [0, 0], [lenU / 2.4, 0], [lenU / 2.4, sl], roofColor, centre);
      roof.tri(a, cc, d, [0, 0], [lenU / 2.4, sl], [0, sl], roofColor, centre);
    }
    for (const u of [r.minU, r.maxU]) {
      const a = p(u, r.minV, eave), b = p(u, r.maxV, eave), t = p(u, mid, ridge);
      wall.tri(a, b, t, [0, (eave % fs.tileH) / fs.tileH], [lenV / fs.tileW, (eave % fs.tileH) / fs.tileH], [lenV / 2 / fs.tileW, 0.99], wallColor, centre);
    }
  } else {
    const v0 = r.minV - eaves, v1 = r.maxV + eaves;
    for (const uEdge of [r.minU - eaves, r.maxU + eaves]) {
      const a = p(uEdge, v0, dropY), b = p(uEdge, v1, dropY), cc = p(mid, v1, ridge), d = p(mid, v0, ridge);
      const sl = Math.hypot(mid - uEdge, ridge - dropY) / 2.4;
      roof.tri(a, b, cc, [0, 0], [lenV / 2.4, 0], [lenV / 2.4, sl], roofColor, centre);
      roof.tri(a, cc, d, [0, 0], [lenV / 2.4, sl], [0, sl], roofColor, centre);
    }
    for (const v of [r.minV, r.maxV]) {
      const a = p(r.minU, v, eave), b = p(r.maxU, v, eave), t = p(mid, v, ridge);
      wall.tri(a, b, t, [0, (eave % fs.tileH) / fs.tileH], [lenU / fs.tileW, (eave % fs.tileH) / fs.tileH], [lenU / 2 / fs.tileW, 0.99], wallColor, centre);
    }
  }
  const under = [centre[0], eave + 30, centre[2]];
  const corners = [p(r.minU - eaves, r.minV - eaves, dropY), p(r.maxU + eaves, r.minV - eaves, dropY), p(r.maxU + eaves, r.maxV + eaves, dropY), p(r.minU - eaves, r.maxV + eaves, dropY)];
  const dark = roofColor.clone().multiplyScalar(0.35);
  roof.tri(corners[0], corners[1], corners[2], [0, 0], [1, 0], [1, 1], dark, under);
  roof.tri(corners[0], corners[2], corners[3], [0, 0], [1, 1], [0, 1], dark, under);
}

export function buildTrees(world: World, maxTrees = 14000): THREE.Group {
  const rand = rng(7);
  const woods = world.obstacles.filter((o) => o.kind === 'tree');
  const areas = woods.map((o) => Math.abs(THREE.ShapeUtils.area(o.poly.map(([x, z]) => new THREE.Vector2(x, z)))));
  const total = areas.reduce((a, b) => a + b, 0);
  const density = Math.min(1 / 70, maxTrees / Math.max(total, 1));
  const points: { x: number; z: number; y: number; s: number }[] = [];
  woods.forEach((o, i) => {
    const count = Math.round(areas[i] * density);
    let tries = 0;
    let placed = 0;
    while (placed < count && tries < count * 4) {
      tries++;
      const x = o.minX + rand() * (o.maxX - o.minX);
      const z = o.minZ + rand() * (o.maxZ - o.minZ);
      if (!pointIn(x, z, o.poly)) continue;
      points.push({ x, z, y: world.terrainHeight(x, z), s: 0.75 + rand() * 0.55 });
      placed++;
    }
  });

  const broad = mergeSimple(
    [
      lumpy(new THREE.IcosahedronGeometry(4.2, 2), 0.9, 1).translate(0, 9.5, 0),
      lumpy(new THREE.IcosahedronGeometry(3.2, 1), 0.7, 2).translate(2.0, 8.0, 1.0),
      lumpy(new THREE.IcosahedronGeometry(3.0, 1), 0.7, 3).translate(-1.8, 8.4, -1.2),
    ],
  );
  const conifer = mergeSimple([
    lumpy(new THREE.ConeGeometry(3.2, 6, 9, 2), 0.45, 4).translate(0, 7.5, 0),
    lumpy(new THREE.ConeGeometry(2.5, 5, 9, 2), 0.4, 5).translate(0, 10.5, 0),
    lumpy(new THREE.ConeGeometry(1.6, 3.6, 8, 1), 0.3, 6).translate(0, 13.2, 0),
  ]);
  const trunk = new THREE.CylinderGeometry(0.28, 0.45, 7, 6).translate(0, 3.5, 0);
  const leafTex = noiseTexture(9, 128, true);
  const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, map: leafTex });
  const group = new THREE.Group();
  const meshA = new THREE.InstancedMesh(broad, leaf, Math.ceil(points.length * 0.7) + 1);
  const meshB = new THREE.InstancedMesh(conifer, leaf, Math.ceil(points.length * 0.4) + 1);
  const meshT = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }), points.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  let a = 0;
  let b = 0;
  points.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    const sc = new THREE.Vector3(p.s, p.s * (0.85 + rand() * 0.35), p.s);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, sc);
    meshT.setMatrixAt(i, m);
    if (rand() < 0.68) {
      c.setHSL(0.22 + rand() * 0.07, 0.35 + rand() * 0.2, 0.16 + rand() * 0.09);
      meshA.setMatrixAt(a, m);
      meshA.setColorAt(a++, c);
    } else {
      c.setHSL(0.27 + rand() * 0.06, 0.3 + rand() * 0.15, 0.12 + rand() * 0.06);
      meshB.setMatrixAt(b, m);
      meshB.setColorAt(b++, c);
    }
  });
  meshA.count = a;
  meshB.count = b;
  for (const im of [meshA, meshB, meshT]) {
    im.castShadow = true;
    im.receiveShadow = true;
  }
  group.add(meshA, meshB, meshT);
  group.name = 'trees';
  return group;
}

function lumpy(geo: THREE.BufferGeometry, amount: number, seed: number) {
  const r = rng(seed);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  // 同じ位置の頂点は同じだけ動かして、ひび割れないようにする
  const offsets = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    let k = offsets.get(key);
    if (k === undefined) {
      k = 1 + (r() - 0.5) * amount * 0.5;
      offsets.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * (1 + (k - 1) * 0.5), p.getZ(i) * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const uv: number[] = [];
  for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * 0.15 + p.getY(i) * 0.05, p.getZ(i) * 0.15 + p.getY(i) * 0.1);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
    uv.push(...(g.attributes.uv.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

function pointIn(x: number, z: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function buildWater(world: World): THREE.Mesh {
  const pos: number[] = [];
  for (const poly of world.data.water) {
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const [cx, cz] = poly[0];
    g.translate(0, world.terrainHeight(cx, cz) + 0.4, 0);
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.attributes.position.array as Float32Array));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 20, pos[i + 2] / 20);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const ripple = noiseTexture(21, 256);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x223d48,
    roughness: 0.06,
    metalness: 0.2,
    normalMap: ripple,
    normalScale: new THREE.Vector2(0.25, 0.25),
    envMapIntensity: 1.4,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'water';
  return m;
}

function runwayTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 4096;
  const g = c.getContext('2d')!;
  const r = rng(13);
  g.fillStyle = '#4a4c4f';
  g.fillRect(0, 0, c.width, c.height);
  speckle(g, c.width, c.height, 60000, 0.18, r);
  for (const y0 of [c.height - 900, 300]) {
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(15,15,15,${0.05 + r() * 0.12})`;
      g.fillRect(100 + r() * 56, y0 + r() * 600, 2 + r() * 4, 40 + r() * 160);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < c.height; y += 64) g.fillRect(0, y, c.width, 1);
  g.fillStyle = '#ececec';
  g.fillRect(8, 0, 5, c.height);
  g.fillRect(c.width - 13, 0, 5, c.height);
  for (let y = 360; y < c.height - 360; y += 120) g.fillRect(125, y, 6, 64);
  for (const y0 of [24, c.height - 160]) for (let x = 26; x < 230; x += 24) if (Math.abs(x - 128) > 14) g.fillRect(x, y0, 12, 136);
  for (const y0 of [c.height - 640, 500]) {
    g.fillRect(70, y0, 22, 110);
    g.fillRect(164, y0, 22, 110);
  }
  g.font = 'bold 92px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.save();
  g.translate(128, c.height - 230);
  g.fillText('36', 0, 0);
  g.restore();
  g.save();
  g.translate(128, 230);
  g.rotate(Math.PI);
  g.fillText('18', 0, 0);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

export function buildAirfield(world: World): THREE.Group {
  const group = new THREE.Group();
  const y = world.runwayElevation;
  const rw = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.85 }),
  );
  rw.position.set(RUNWAY.x, y + 0.12, RUNWAY.z);
  rw.receiveShadow = true;
  group.add(rw);
  const grassTex = noiseTexture(17, 256, true);
  grassTex.repeat.set(8, 30);
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width + 90, RUNWAY.length + 80).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x74804f, roughness: 1, map: grassTex }),
  );
  grass.position.set(RUNWAY.x, y + 0.06, RUNWAY.z);
  grass.receiveShadow = true;
  group.add(grass);
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 120).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a8c8d, roughness: 0.9, map: noiseTexture(19, 128, true) }),
  );
  apron.position.set(PAD.x + 10, y + 0.09, PAD.z + 10);
  apron.receiveShadow = true;
  group.add(apron);
  const padC = document.createElement('canvas');
  padC.width = padC.height = 512;
  const g = padC.getContext('2d')!;
  g.fillStyle = '#5a5e62';
  g.beginPath();
  g.arc(256, 256, 252, 0, Math.PI * 2);
  g.fill();
  speckle(g, 512, 512, 8000, 0.2, rng(4));
  g.strokeStyle = '#f0c400';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(256, 256, 210, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f2f2f2';
  g.fillRect(170, 140, 44, 232);
  g.fillRect(298, 140, 44, 232);
  g.fillRect(170, 234, 172, 44);
  const padTex = new THREE.CanvasTexture(padC);
  padTex.colorSpace = THREE.SRGBColorSpace;
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: padTex, transparent: true, roughness: 0.8 }),
  );
  pad.position.set(PAD.x, world.terrainHeight(PAD.x, PAD.z) + 0.16, PAD.z);
  pad.receiveShadow = true;
  group.add(pad);
  const lightGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.7, 8);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd88a, emissiveIntensity: 1.2 });
  const lights = new THREE.InstancedMesh(lightGeo, lightMat, 2 * Math.floor(RUNWAY.length / 50 + 1));
  const m = new THREE.Matrix4();
  let i = 0;
  for (let z = -RUNWAY.length / 2; z <= RUNWAY.length / 2; z += 50) {
    for (const s of [-1, 1]) {
      m.makeTranslation(RUNWAY.x + s * (RUNWAY.width / 2 + 2), y + 0.35, RUNWAY.z + z);
      lights.setMatrixAt(i++, m);
    }
  }
  lights.count = i;
  group.add(lights);
  const corrugated = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(x, 0, 3, h);
    }
  });
  corrugated.repeat.set(10, 1);
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 14, 40, 32, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xc4c8cb, roughness: 0.45, metalness: 0.7, map: corrugated, side: THREE.DoubleSide }),
  );
  const hx = RUNWAY.x - 80;
  const hz = RUNWAY.z + RUNWAY.length / 2 - 90;
  shell.position.set(hx, y, hz);
  shell.castShadow = shell.receiveShadow = true;
  group.add(shell);
  // かまぼこの軸は南北（z）。北の端は壁、南の端（滑走路側）は開いた扉
  const endWall = new THREE.Mesh(
    new THREE.CircleGeometry(14, 32, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
  );
  endWall.position.set(hx, y, hz - 20);
  group.add(endWall);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.9 }));
  door.position.set(hx, y + 5.5, hz + 19.9);
  group.add(door);
  group.name = 'airfield';
  return group;
}
