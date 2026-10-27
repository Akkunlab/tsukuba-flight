// 景色の要素のビルダー。content/scenery.ts の kind がここのキーに対応する。
// 新しい種類の景色を足すときは、ここにビルダーを 1 つ追加して content/scenery.ts にデータを足す。
import * as THREE from 'three';
import type { SceneryDef } from '../content/types';
import type { Vec3 } from '../sim/physics';
import type { World } from '../sim/world';

export interface SceneryContext {
  world: World;
  /** 今の風（m/s） */
  wind: () => Vec3;
}

export interface SceneryObject {
  object: THREE.Object3D;
  update?: (dt: number, time: number) => void;
}

type Builder = (def: SceneryDef, ctx: SceneryContext) => SceneryObject;

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const text = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

export function textSprite(label: string, opts: { color?: string; bg?: string; scale?: number } = {}): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = 'bold 56px "Hiragino Sans", "Noto Sans JP", sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(label).width) + 48;
  c.width = w;
  c.height = 88;
  g.font = font;
  g.fillStyle = opts.bg ?? 'rgba(10,20,35,0.55)';
  const r = 30;
  g.beginPath();
  g.roundRect(0, 0, w, 88, r);
  g.fill();
  g.fillStyle = opts.color ?? '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, w / 2, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const scale = opts.scale ?? 1;
  s.scale.set((w / 88) * 8 * scale, 8 * scale, 1);
  return s;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let cloudTexture: THREE.Texture | null = null;
function getCloudTexture() {
  if (cloudTexture) return cloudTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 9; i++) {
    const x = 30 + Math.random() * 68;
    const y = 40 + Math.random() * 48;
    const r = 22 + Math.random() * 20;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  cloudTexture = new THREE.CanvasTexture(c);
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  return cloudTexture;
}

export const SCENERY_BUILDERS: Record<string, Builder> = {
  /** 地名の看板（空中に浮かぶラベル） */
  label(def) {
    const s = textSprite(text(def.params.text, def.name), { scale: num(def.params.scale, 1.6) });
    s.position.set(num(def.params.x, 0), num(def.params.y, 40), num(def.params.z, 0));
    return { object: s };
  },

  /** 吹き流し。風向きに向く */
  windsock(def, ctx) {
    const g = new THREE.Group();
    const x = num(def.params.x, 0);
    const z = num(def.params.z, 0);
    g.position.set(x, ctx.world.terrainHeight(x, z), z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 8, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.y = 4;
    g.add(pole);
    const sock = new THREE.Group();
    sock.position.y = 7.6;
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.3, 4, 10, 4, true).rotateX(Math.PI / 2).translate(0, 0, 2),
      new THREE.MeshLambertMaterial({ color: 0xff5a1f, side: THREE.DoubleSide }),
    );
    sock.add(cone);
    g.add(sock);
    return {
      object: g,
      update: (_dt, t) => {
        const w = ctx.wind();
        sock.rotation.y = Math.atan2(w.x, w.z);
        sock.rotation.x = -Math.max(0, 0.9 - Math.hypot(w.x, w.z) / 8) + Math.sin(t * 3) * 0.04;
      },
    };
  },

  /** 雲。ゆっくり風に流れる */
  clouds(def, ctx) {
    const g = new THREE.Group();
    const r = rng(num(def.params.seed, 1));
    const count = num(def.params.count, 30);
    const mat = new THREE.SpriteMaterial({ map: getCloudTexture(), transparent: true, opacity: 0.85, depthWrite: false, fog: true });
    for (let i = 0; i < count; i++) {
      const cl = new THREE.Group();
      const puffs = 3 + Math.floor(r() * 4);
      for (let j = 0; j < puffs; j++) {
        const s = new THREE.Sprite(mat);
        const size = 250 + r() * 350;
        s.scale.set(size, size * 0.6, 1);
        s.position.set((r() - 0.5) * 400, (r() - 0.5) * 60, (r() - 0.5) * 250);
        cl.add(s);
      }
      cl.position.set((r() - 0.5) * 16000, 650 + r() * 700, (r() - 0.5) * 16000);
      g.add(cl);
    }
    return {
      object: g,
      update: (dt) => {
        const w = ctx.wind();
        for (const c of g.children) {
          c.position.x += w.x * dt * 0.5;
          c.position.z += w.z * dt * 0.5;
          if (c.position.x > 9000) c.position.x -= 18000;
          if (c.position.x < -9000) c.position.x += 18000;
          if (c.position.z > 9000) c.position.z -= 18000;
          if (c.position.z < -9000) c.position.z += 18000;
        }
      },
    };
  },
};

export const SCENERY_KINDS = Object.keys(SCENERY_BUILDERS);

export function buildScenery(defs: SceneryDef[], ctx: SceneryContext): SceneryObject[] {
  const out: SceneryObject[] = [];
  for (const d of defs) {
    const b = SCENERY_BUILDERS[d.kind];
    if (!b) continue;
    try {
      out.push(b(d, ctx));
    } catch (e) {
      console.warn('scenery failed', d.id, e);
    }
  }
  return out;
}
