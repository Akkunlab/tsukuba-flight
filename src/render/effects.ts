// 軌跡（テール）・リング・爆発・影。
import * as THREE from 'three';
import type { TrailSetting } from '../content/types';

const MAX = 600;

export class Trail {
  readonly mesh: THREE.Mesh;
  private positions = new Float32Array(MAX * 2 * 3);
  private colors = new Float32Array(MAX * 2 * 4);
  /** c: おまかせの色、w: 太さ、id: 通し番号（点線と虹の模様に使う） */
  private pts: { p: THREE.Vector3; side: THREE.Vector3; c: THREE.Color; w: number; id: number }[] = [];
  private geo: THREE.BufferGeometry;
  /** 色と形は描くたびに読むので、変えるとすぐ軌跡全体に反映される */
  setting: TrailSetting = { mode: 'auto', color: '#ffffff', style: 'ribbon' };
  baseWidth = 1.5;
  private emitTimer = 0;
  private nextId = 0;
  private time = 0;
  private custom = new THREE.Color();
  private tmp = new THREE.Color();

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
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    this.mesh.frustumCulled = false;
  }

  clear() {
    this.pts = [];
    this.geo.setDrawRange(0, 0);
  }

  /** 毎フレーム呼ぶ。autoColor はおまかせのときの今の色、level は音の大きさ (0..1) */
  update(dt: number, pos: THREE.Vector3, right: THREE.Vector3, autoColor: THREE.Color, level: number, emit: boolean) {
    this.emitTimer += dt;
    this.time += dt;
    if (emit && this.emitTimer >= 1 / 30) {
      this.emitTimer = 0;
      const last = this.pts[this.pts.length - 1];
      if (!last || last.p.distanceToSquared(pos) > 0.04) {
        this.pts.push({ p: pos.clone(), side: right.clone(), c: autoColor.clone(), w: this.baseWidth * (0.6 + level * 1.4), id: this.nextId++ });
        if (this.pts.length > MAX) this.pts.shift();
      }
    }
    const style = this.setting.style;
    this.custom.set(this.setting.color);
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const pt = this.pts[i];
      const age = 1 - i / Math.max(n - 1, 1);
      let w = pt.w * (1 - age * 0.4);
      if (style === 'dots' && pt.id % 6 >= 3) w = 0;
      const c = style === 'rainbow' ? this.tmp.setHSL((pt.id * 0.012 + this.time * 0.1) % 1, 0.9, 0.6) : this.setting.mode === 'custom' ? this.custom : pt.c;
      const a = (1 - age) * 0.85;
      const o = i * 6;
      this.positions[o] = pt.p.x - pt.side.x * w;
      this.positions[o + 1] = pt.p.y - pt.side.y * w;
      this.positions[o + 2] = pt.p.z - pt.side.z * w;
      this.positions[o + 3] = pt.p.x + pt.side.x * w;
      this.positions[o + 4] = pt.p.y + pt.side.y * w;
      this.positions[o + 5] = pt.p.z + pt.side.z * w;
      const k = i * 8;
      for (let sd = 0; sd < 2; sd++) {
        this.colors[k + sd * 4] = c.r;
        this.colors[k + sd * 4 + 1] = c.g;
        this.colors[k + sd * 4 + 2] = c.b;
        this.colors[k + sd * 4 + 3] = a;
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

function softTexture(kind: 'fire' | 'smoke' | 'scorch'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // ふちが不規則な、やわらかい塊を何枚も重ねる
  for (let i = 0; i < (kind === 'scorch' ? 6 : 14); i++) {
    const x = 64 + (Math.random() - 0.5) * 40;
    const y = 64 + (Math.random() - 0.5) * 40;
    const r = 18 + Math.random() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = kind === 'fire' ? 0.5 : kind === 'smoke' ? 0.35 : 0.5;
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let fireTex: THREE.Texture | null = null;
let smokeTex: THREE.Texture | null = null;
let scorchTex: THREE.Texture | null = null;

interface Particle {
  obj: THREE.Object3D;
  mat: THREE.SpriteMaterial | THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  v: THREE.Vector3;
  life: number;
  max: number;
  kind: 'fire' | 'smoke' | 'debris' | 'spark' | 'ember';
  grow: number;
  spin?: THREE.Vector3;
  ground: number;
}

/** 墜落の爆発：閃光・火球・破片・火花・黒煙・残り火・焦げ跡・画面の揺れ */
export class Explosion {
  readonly group = new THREE.Group();
  private parts: Particle[] = [];
  private flash = new THREE.PointLight(0xffa040, 0, 400, 1.6);
  private wrecks: { at: THREE.Vector3; ground: number; t: number; scale: number }[] = [];
  private decals: THREE.Mesh[] = [];
  /** カメラを揺らす強さ（main で読む） */
  shake = 0;

  constructor() {
    this.group.add(this.flash);
  }

  burst(at: THREE.Vector3, scale: number, color: THREE.ColorRepresentation = 0xcccccc, ground = at.y - 1) {
    fireTex ??= softTexture('fire');
    smokeTex ??= softTexture('smoke');
    scorchTex ??= softTexture('scorch');
    const s = Math.max(1.5, scale);
    this.flash.position.copy(at);
    this.flash.intensity = 4000 * s;
    this.shake = 1.2;
    for (let i = 0; i < 26; i++) this.fire(at, s, 1);
    for (let i = 0; i < 18; i++) this.smoke(at, s, true);
    // 破片：機体の色と焦げた金属
    const debrisMats = [new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8, metalness: 0.6 })];
    for (let i = 0; i < 34; i++) {
      const sz = s * (0.08 + Math.random() * 0.35);
      const geo = Math.random() < 0.5 ? new THREE.BoxGeometry(sz, sz * 0.2, sz * 0.7) : new THREE.TetrahedronGeometry(sz * 0.6);
      const mat = debrisMats[i % 2];
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.position.copy(at);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize();
      this.add({ obj: m, mat, v: dir.multiplyScalar(s * (6 + Math.random() * 14)), life: 8 + Math.random() * 4, max: 12, kind: 'debris', grow: 0, spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12), ground });
    }
    // 火花
    for (let i = 0; i < 60; i++) {
      const mat = new THREE.SpriteMaterial({ color: 0xffd080, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(0.25 + Math.random() * 0.25);
      sp.position.copy(at);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.add({ obj: sp, mat, v: dir.multiplyScalar(20 + Math.random() * 35), life: 0.6 + Math.random() * 0.8, max: 1.4, kind: 'spark', grow: 0, ground });
    }
    // 地面の焦げ跡
    const scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: scorchTex, color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    scorch.scale.setScalar(s * 9);
    scorch.position.set(at.x, ground + 0.2, at.z);
    this.group.add(scorch);
    this.decals.push(scorch);
    this.wrecks.push({ at: new THREE.Vector3(at.x, ground + 0.5, at.z), ground, t: 0, scale: s });
  }

  private add(p: Particle) {
    this.parts.push(p);
    this.group.add(p.obj);
  }

  private fire(at: THREE.Vector3, s: number, power: number) {
    const mat = new THREE.SpriteMaterial({ map: fireTex, color: 0xfff0c0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * s, Math.random() * s * 0.5, (Math.random() - 0.5) * s));
    sp.scale.setScalar(s * (2 + Math.random() * 2) * power);
    sp.material.rotation = Math.random() * Math.PI * 2;
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).multiplyScalar(s * 6 * power);
    const life = (0.8 + Math.random() * 0.9) * power;
    this.add({ obj: sp, mat, v, life, max: life, kind: 'fire', grow: s * 3 * power, ground: -Infinity });
  }

  private smoke(at: THREE.Vector3, s: number, big: boolean) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, color: 0x1c1b1a, transparent: true, depthWrite: false, opacity: 0 });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * s, 0, (Math.random() - 0.5) * s));
    sp.scale.setScalar(s * (big ? 3 : 1.6));
    sp.material.rotation = Math.random() * Math.PI * 2;
    const v = new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2).multiplyScalar(big ? s * 0.8 : 1.4);
    const life = big ? 5 + Math.random() * 4 : 9 + Math.random() * 6;
    this.add({ obj: sp, mat, v, life, max: life, kind: 'smoke', grow: s * (big ? 2.5 : 1.8), ground: -Infinity });
  }

  update(dt: number, wind: { x: number; z: number } = { x: 0, z: 0 }) {
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.flash.intensity *= Math.max(0, 1 - dt * 7);
    // 残骸からは、しばらく炎と黒煙が出続ける
    for (const w of this.wrecks) {
      w.t += dt;
      if (w.t < 22) {
        const k = 1 - w.t / 22;
        if (Math.random() < dt * 14 * k) this.fire(w.at, w.scale * 0.45, 0.6 + k * 0.4);
        if (Math.random() < dt * 7) this.smoke(w.at, w.scale * 0.7, false);
      }
    }
    this.wrecks = this.wrecks.filter((w) => w.t < 22);
    for (const p of this.parts) {
      p.life -= dt;
      const t = 1 - p.life / p.max;
      switch (p.kind) {
        case 'fire': {
          p.obj.position.addScaledVector(p.v, dt);
          p.v.multiplyScalar(1 - dt * 2.5);
          p.v.y += dt * 4;
          p.obj.scale.addScalar(p.grow * dt);
          const m = p.mat as THREE.SpriteMaterial;
          // 白っぽい黄 → 橙 → 暗い赤へ
          m.color.setHSL(0.11 - t * 0.09, 1, 0.75 - t * 0.5);
          m.opacity = Math.max(0, Math.min(1, p.life / p.max) * 1.2);
          break;
        }
        case 'smoke': {
          p.obj.position.addScaledVector(p.v, dt);
          p.obj.position.x += wind.x * dt * 0.8;
          p.obj.position.z += wind.z * dt * 0.8;
          p.v.multiplyScalar(1 - dt * 0.4);
          p.obj.scale.addScalar(p.grow * dt * 0.6);
          (p.mat as THREE.SpriteMaterial).opacity = Math.min(0.85, t * 6) * Math.max(0, p.life / p.max);
          (p.mat as THREE.SpriteMaterial).rotation += dt * 0.1;
          break;
        }
        case 'debris': {
          p.v.y -= 9.8 * dt;
          p.obj.position.addScaledVector(p.v, dt);
          if (p.obj.position.y < p.ground + 0.1) {
            p.obj.position.y = p.ground + 0.1;
            p.v.y = Math.abs(p.v.y) * 0.3;
            p.v.x *= 0.6;
            p.v.z *= 0.6;
            p.spin!.multiplyScalar(0.5);
          }
          p.obj.rotation.x += p.spin!.x * dt;
          p.obj.rotation.y += p.spin!.y * dt;
          p.obj.rotation.z += p.spin!.z * dt;
          break;
        }
        case 'spark':
        case 'ember': {
          p.v.y -= 9.8 * dt;
          p.obj.position.addScaledVector(p.v, dt);
          (p.mat as THREE.SpriteMaterial).opacity = Math.max(0, p.life / p.max);
          break;
        }
      }
    }
    for (const p of this.parts) {
      if (p.life > 0) continue;
      this.group.remove(p.obj);
      if (p.kind !== 'debris') p.mat.dispose();
    }
    this.parts = this.parts.filter((p) => p.life > 0);
  }

  clear() {
    for (const p of this.parts) this.group.remove(p.obj);
    for (const d of this.decals) this.group.remove(d);
    this.parts = [];
    this.decals = [];
    this.wrecks = [];
    this.flash.intensity = 0;
    this.shake = 0;
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

  /** リプレイの時刻 t に合わせる。この呼び出しで新しく割れた風船の番号を返す */
  replayAt(t: number, popTimes: number[]): number[] {
    const popped: number[] = [];
    this.items.forEach((it, i) => {
      const done = popTimes[i] >= 0 && popTimes[i] <= t;
      if (done && it.pop < 0) {
        it.pop = 0;
        popped.push(i);
      } else if (!done && it.pop >= 0) {
        it.pop = -1;
        it.m.visible = true;
        it.m.scale.setScalar(1);
      }
    });
    return popped;
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
