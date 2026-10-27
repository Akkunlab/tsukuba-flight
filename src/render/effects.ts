// 軌跡（テール）・リング・爆発・影。
import * as THREE from 'three';
import type { TrailSetting } from '../content/types';

const MAX = 600;

export class Trail {
  readonly mesh: THREE.Mesh;
  private positions = new Float32Array(MAX * 2 * 3);
  private colors = new Float32Array(MAX * 2 * 4);
  private pts: { p: THREE.Vector3; side: THREE.Vector3; c: THREE.Color; w: number }[] = [];
  private geo: THREE.BufferGeometry;
  setting: TrailSetting = { mode: 'auto', color: '#ffffff', style: 'ribbon' };
  baseWidth = 1.5;
  private emitTimer = 0;
  private hue = 0;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
  }

  clear() {
    this.pts = [];
    this.geo.setDrawRange(0, 0);
  }

  /** 毎フレーム呼ぶ。color は今の色、level は音の大きさ (0..1) */
  update(dt: number, pos: THREE.Vector3, right: THREE.Vector3, color: THREE.Color, level: number, emit: boolean) {
    this.emitTimer += dt;
    this.hue = (this.hue + dt * 0.25) % 1;
    if (emit && this.emitTimer >= 1 / 30) {
      this.emitTimer = 0;
      let c = color.clone();
      if (this.setting.style === 'rainbow') c = new THREE.Color().setHSL(this.hue, 0.9, 0.6);
      let w = this.baseWidth * (0.55 + level * 1.6);
      if (this.setting.style === 'dots' && this.pts.length % 4 < 2) w = 0;
      const last = this.pts[this.pts.length - 1];
      if (!last || last.p.distanceToSquared(pos) > 0.04) {
        this.pts.push({ p: pos.clone(), side: right.clone(), c, w });
        if (this.pts.length > MAX) this.pts.shift();
      }
    }
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const pt = this.pts[i];
      const age = 1 - i / Math.max(n - 1, 1);
      const w = pt.w * (1 - age * 0.3);
      const a = (1 - age) * 0.55;
      const o = i * 6;
      this.positions[o] = pt.p.x - pt.side.x * w;
      this.positions[o + 1] = pt.p.y - pt.side.y * w;
      this.positions[o + 2] = pt.p.z - pt.side.z * w;
      this.positions[o + 3] = pt.p.x + pt.side.x * w;
      this.positions[o + 4] = pt.p.y + pt.side.y * w;
      this.positions[o + 5] = pt.p.z + pt.side.z * w;
      const k = i * 8;
      for (let s = 0; s < 2; s++) {
        this.colors[k + s * 4] = pt.c.r;
        this.colors[k + s * 4 + 1] = pt.c.g;
        this.colors[k + s * 4 + 2] = pt.c.b;
        this.colors[k + s * 4 + 3] = a;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }
}

export class Rings {
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private beam: THREE.Mesh;
  private active = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 });
  private later = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35 });

  constructor() {
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.group.add(this.beam);
  }

  set(points: THREE.Vector3[], radius: number, groundAt: (x: number, z: number) => number) {
    for (const r of this.rings) this.group.remove(r);
    this.rings = points.map((p, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius, 2.2, 10, 48), this.later);
      m.position.copy(p);
      const next = points[i + 1] ?? points[i - 1];
      if (next) m.lookAt(next.x, p.y, next.z);
      m.userData.ground = groundAt(p.x, p.z);
      this.group.add(m);
      return m;
    });
    this.setCurrent(0);
  }

  setCurrent(i: number) {
    this.rings.forEach((r, k) => {
      r.visible = k >= i;
      r.material = k === i ? this.active : this.later;
    });
    const cur = this.rings[i];
    this.beam.visible = !!cur;
    if (cur) {
      const g = cur.userData.ground as number;
      const h = cur.position.y - g - 40;
      this.beam.scale.set(1, Math.max(h, 1), 1);
      this.beam.position.set(cur.position.x, g + Math.max(h, 1) / 2, cur.position.z);
    }
  }

  update(t: number) {
    this.active.opacity = 0.7 + Math.sin(t * 5) * 0.25;
  }
}

export class Explosion {
  readonly group = new THREE.Group();
  private parts: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];

  burst(at: THREE.Vector3, scale: number) {
    const fire = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true });
    const smoke = new THREE.MeshLambertMaterial({ color: 0x444444, transparent: true });
    for (let i = 0; i < 40; i++) {
      const isFire = i < 18;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(scale * (0.4 + Math.random() * 0.6), 0), (isFire ? fire : smoke).clone());
      m.position.copy(at);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).multiplyScalar(scale * (isFire ? 14 : 6));
      this.parts.push({ m, v, life: isFire ? 1.4 : 3.5 });
      this.group.add(m);
    }
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.m.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - dt * 1.5);
      p.v.y += dt * 2;
      p.m.scale.multiplyScalar(1 + dt * 0.8);
      (p.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(1, p.life));
    }
    for (const p of this.parts.filter((x) => x.life <= 0)) this.group.remove(p.m);
    this.parts = this.parts.filter((p) => p.life > 0);
  }

  clear() {
    for (const p of this.parts) this.group.remove(p.m);
    this.parts = [];
  }
}

export function blobShadow(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.renderOrder = 1;
  return m;
}

/** 風船割りの風船。割れると小さく弾けて消える */
export class Balloons {
  readonly group = new THREE.Group();
  private items: { m: THREE.Group; pop: number; base: number; phase: number }[] = [];
  private mat = new THREE.MeshPhysicalMaterial({ color: 0xd8141e, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.3 });

  set(points: { x: number; y: number; z: number }[], radius: number) {
    for (const it of this.items) this.group.remove(it.m);
    const body = new THREE.SphereGeometry(radius * 0.55, 24, 16).scale(1, 1.18, 1);
    const knot = new THREE.ConeGeometry(radius * 0.08, radius * 0.12, 8).rotateX(Math.PI);
    const stringMat = new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7 });
    this.items = points.map((p, i) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(body, this.mat);
      b.castShadow = true;
      g.add(b);
      const k = new THREE.Mesh(knot, this.mat);
      k.position.y = -radius * 0.68;
      g.add(k);
      const pts = [];
      for (let j = 0; j <= 8; j++) pts.push(new THREE.Vector3(Math.sin(j * 0.9) * 0.4, -radius * 0.7 - j * 1.1, 0));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), stringMat));
      g.position.set(p.x, p.y, p.z);
      this.group.add(g);
      return { m: g, pop: -1, base: p.y, phase: i * 1.7 };
    });
  }

  pop(i: number) {
    const it = this.items[i];
    if (it && it.pop < 0) it.pop = 0;
  }

  /** 全部まとめて元に戻す（リプレイ用）。popped[i] が true のものは消す */
  show(popped: boolean[]) {
    this.items.forEach((it, i) => {
      it.pop = popped[i] ? 1 : -1;
      it.m.visible = !popped[i];
      it.m.scale.setScalar(1);
    });
  }

  update(dt: number, t: number) {
    for (const it of this.items) {
      if (it.pop < 0) {
        it.m.position.y = it.base + Math.sin(t * 0.8 + it.phase) * 1.2;
        it.m.rotation.y = Math.sin(t * 0.3 + it.phase) * 0.4;
      } else if (it.pop < 1) {
        it.pop += dt * 6;
        it.m.scale.setScalar(1 + it.pop * 0.6);
        if (it.pop >= 1) it.m.visible = false;
      }
    }
  }
}

/** 飛んだ道すじ（高さで色を変える線） */
export function pathLine(points: { x: number; y: number; z: number }[], ground: (x: number, z: number) => number): THREE.Line {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const p of points) {
    pos.push(p.x, p.y, p.z);
    const alt = p.y - ground(p.x, p.z);
    c.setHSL(0.58 - Math.min(1, alt / 300) * 0.5, 0.9, 0.55);
    col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: true }));
  line.frustumCulled = false;
  return line;
}
