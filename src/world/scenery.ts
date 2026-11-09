// 景色の要素のビルダー。content/scenery.ts の kind がここのキーに対応する。
import * as THREE from 'three';
import type { SceneryDef } from '../content/types';
import type { Vec3 } from '../sim/physics';
import type { World } from '../sim/world';

export interface SceneryContext {
  world: World;
  /** 今の風（m/s） */
  wind: () => Vec3;
  /** 雲の明るさの倍率 */
  cloudBrightness?: number;
}

export interface SceneryObject {
  object: THREE.Object3D;
  update?: (dt: number, time: number) => void;
}

type Builder = (def: SceneryDef, ctx: SceneryContext) => SceneryObject;

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const text = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

export function textSprite(label: string, opts: { color?: string; scale?: number } = {}): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '600 52px "Hiragino Sans", "Noto Sans JP", sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(label).width) + 40;
  c.width = w;
  c.height = 80;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(8,14,22,0.75)';
  g.strokeText(label, w / 2, 42);
  g.fillStyle = opts.color ?? '#f4f7fa';
  g.fillText(label, w / 2, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const scale = opts.scale ?? 1;
  s.scale.set((w / 80) * 7 * scale, 7 * scale, 1);
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
  label(def, ctx) {
    const g = new THREE.Group();
    const x = num(def.params.x, 0);
    const z = num(def.params.z, 0);
    const y = num(def.params.y, 40);
    const s = textSprite(text(def.params.text, def.name), { scale: num(def.params.scale, 1.4) });
    s.position.set(x, y + 4, z);
    g.add(s);
    const ground = ctx.world.terrainHeight(x, z);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, ground + 2, z), new THREE.Vector3(x, y, z)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
    );
    g.add(line);
    return { object: g };
  },

  windsock(def, ctx) {
    const g = new THREE.Group();
    const x = num(def.params.x, 0);
    const z = num(def.params.z, 0);
    g.position.set(x, ctx.world.terrainHeight(x, z), z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.6 }));
    pole.position.y = 4;
    g.add(pole);
    const sock = new THREE.Group();
    sock.position.y = 7.6;
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.3, 4, 10, 4, true).rotateX(Math.PI / 2).translate(0, 0, 2),
      new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.8, side: THREE.DoubleSide }),
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

  clouds(def, ctx) {
    const g = new THREE.Group();
    const r = rng(num(def.params.seed, 1));
    const count = num(def.params.count, 30);
    const mat = new THREE.SpriteMaterial({ map: getCloudTexture(), color: 0xf6f8fa, transparent: true, opacity: 0.8, depthWrite: false, fog: true, toneMapped: false });
    mat.color.multiplyScalar(ctx.cloudBrightness ?? 1);
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

  birds(def, ctx) {
    const g = new THREE.Group();
    const r = rng(num(def.params.seed, 1));
    const count = num(def.params.count, 7);
    const cx = num(def.params.x, 0);
    const cz = num(def.params.z, 0);
    const radius = num(def.params.radius, 400);
    const alt = num(def.params.alt, 90);
    const speed = num(def.params.speed, 0.05);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 0, -0.4, 2.6, 0, -0.1], 3));
    const birds: { root: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; off: number; slot: number }[] = [];
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, mat);
      const rt = new THREE.Mesh(wingGeo, mat);
      l.scale.x = -1;
      root.add(l, rt);
      root.scale.setScalar(2.2);
      g.add(root);
      // V 字の隊列：先頭から左右に交互に並ぶ
      birds.push({ root, l, r: rt, off: r() * 6, slot: i });
    }
    return {
      object: g,
      update: (_dt, t) => {
        const a = t * speed;
        for (const b of birds) {
          const side = b.slot % 2 === 0 ? 1 : -1;
          const rank = Math.ceil(b.slot / 2);
          const ang = a - (rank * 9) / radius;
          const rr = radius + side * rank * 7;
          const x = cx + Math.cos(ang) * rr;
          const z = cz + Math.sin(ang) * rr;
          const y = ctx.world.terrainHeight(cx, cz) + alt + Math.sin(t * 0.3 + b.off) * 4;
          b.root.position.set(x, y, z);
          b.root.rotation.y = -ang;
          const flap = Math.sin(t * 5 + b.off) * 0.55;
          b.l.rotation.z = flap;
          b.r.rotation.z = -flap;
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
