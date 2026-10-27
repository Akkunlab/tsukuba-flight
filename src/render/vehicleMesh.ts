// 乗り物の 3D モデル（プリミティブの組み合わせ、PBR マテリアル）。前が -z、上が +y、原点は機体の一番下。
import * as THREE from 'three';

export interface VehicleModel {
  group: THREE.Group;
  spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  /** 回転が速いときに見える残像の円盤 */
  discs: THREE.Mesh[];
  flames: THREE.Object3D[];
  /** 軌跡が出る位置（ローカル座標） */
  tail: THREE.Vector3;
}

const std = (color: THREE.ColorRepresentation, roughness = 0.5, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const glass = () =>
  new THREE.MeshPhysicalMaterial({ color: 0x1b2a36, roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.82, envMapIntensity: 1.6 });
const rubber = () => std(0x161616, 0.9);
const metal = (c: THREE.ColorRepresentation = 0xb8bcc2, r = 0.35) => std(c, r, 0.9);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 前後方向（z）に沿った回転体。profile は [半径, z] の列 */
function lathe(profile: [number, number][], segments = 20) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.001), z));
  return new THREE.LatheGeometry(pts, segments).rotateX(Math.PI / 2);
}

/** 翼：平面形（x = 翼幅方向、z = 前後）を厚みつきで押し出す */
function wing(outline: [number, number][], thickness: number) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.4, bevelSize: thickness * 0.4, bevelSegments: 2 })
    .rotateX(Math.PI / 2)
    .translate(0, thickness / 2, 0);
}

function wheel(r: number, w: number) {
  return mesh(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2), rubber());
}

function disc(radius: number, axis: 'y' | 'z') {
  const geo = new THREE.CircleGeometry(radius, 32);
  if (axis === 'y') geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  return m;
}

function flame(radius: number, length: number, color = 0xffa030) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, length / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.5, length * 0.6, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, length * 0.3),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  g.add(outer, inner);
  return g;
}

function registration(text: string, color = '#1d2a3a') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 96px "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

type Builder = (color: string) => VehicleModel;

const SHAPES: Record<string, Builder> = {
  prop(color) {
    const g = new THREE.Group();
    const paint = std(color, 0.32, 0.05, { envMapIntensity: 1.2 });
    const accent = std(0x1f4e8c, 0.35, 0.05);
    const body = mesh(
      lathe([[0.05, -4.25], [0.42, -4.05], [0.62, -3.6], [0.7, -2.6], [0.74, -1.4], [0.68, 0], [0.5, 1.6], [0.3, 3.0], [0.16, 4.1]]),
      paint,
      0,
      1.45,
      0,
    );
    body.scale.set(1, 1.18, 1);
    g.add(body);
    for (const s of [-1, 1]) {
      const stripe = mesh(new THREE.BoxGeometry(0.02, 0.12, 6.4), accent, s * 0.7, 1.3, -0.6);
      stripe.rotation.x = 0.03;
      g.add(stripe);
      const reg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), registration('JA4TF'));
      reg.position.set(s * 0.56, 1.55, 1.6);
      reg.rotation.y = s * Math.PI / 2;
      g.add(reg);
    }
    const cabin = mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.66, 0.5, 1.45), glass(), 0, 1.9, -1.35);
    g.add(cabin);
    const w = mesh(wing([[-5.5, -0.75], [5.5, -0.75], [5.5, 0.65], [-5.5, 0.65]], 0.12), paint, 0, 2.4, -1.15);
    g.add(w);
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.14, 1.42), accent, s * 5.4, 2.46, -1.2));
      const strut = mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), metal(0xd8d8d8), s * 1.55, 1.75, -1.1);
      strut.rotation.z = s * -1.05;
      g.add(strut);
    }
    g.add(mesh(wing([[-1.7, -0.35], [1.7, -0.35], [1.4, 0.5], [-1.4, 0.5]], 0.07), paint, 0, 1.55, 3.55));
    const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.5, 0), new THREE.Vector2(1.3, 1.6), new THREE.Vector2(0.6, 1.6)]);
    const finMesh = mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.07, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.035, 0, 0), paint, 0, 1.6, 2.6);
    g.add(finMesh);
    g.add(mesh(new THREE.BoxGeometry(0.075, 0.3, 0.6), accent, 0, 2.9, 3.85));
    for (const s of [-1, 1]) {
      const leg = mesh(new THREE.BoxGeometry(0.06, 1.05, 0.12), metal(0xe0e0e0), s * 0.95, 0.75, -0.6);
      leg.rotation.z = s * 0.55;
      g.add(leg);
      const wl = wheel(0.3, 0.16);
      wl.position.set(s * 1.25, 0.3, -0.6);
      g.add(wl);
      g.add(mesh(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.5, 0.8, 1.3), paint, s * 1.25, 0.36, -0.6));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6), metal(), 0, 0.75, -3.4));
    const nw = wheel(0.24, 0.12);
    nw.position.set(0, 0.24, -3.4);
    g.add(nw);
    const prop = new THREE.Group();
    prop.position.set(0, 1.45, -4.35);
    prop.add(mesh(new THREE.ConeGeometry(0.22, 0.5, 16).rotateX(-Math.PI / 2), paint, 0, 0, -0.1));
    for (const s of [-1, 1]) {
      const blade = mesh(new THREE.BoxGeometry(0.16, 0.95, 0.03), std(0x1a1a1a, 0.6), 0, s * 0.5, 0);
      blade.rotation.y = s * 0.35;
      prop.add(blade);
      prop.add(mesh(new THREE.BoxGeometry(0.17, 0.08, 0.035), std(0xffd400, 0.5), 0, s * 0.95, 0));
    }
    g.add(prop);
    const d = disc(1, 'z');
    d.position.set(0, 1.45, -4.4);
    g.add(d);
    return { group: g, spinners: [{ obj: prop, axis: 'z', speed: 60 }], discs: [d], flames: [], tail: new THREE.Vector3(0, 1.6, 4) };
  },

  paper(color) {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const v = [0, 1, -4, -3.2, 1.6, 3, 0, 1, 3, 0, 1, -4, 0, 1, 3, 3.2, 1.6, 3, 0, 1, -4, 0, 0.2, 3, 0, 1, 3];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const paperTex = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = 'rgba(120,150,200,0.25)';
      for (let y = 8; y < 256; y += 16) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(256, y);
        c.stroke();
      }
    });
    const uv = [0.5, 0, 0, 1, 0.5, 1, 0.5, 0, 0.5, 1, 1, 1, 0.5, 0, 0.6, 1, 0.5, 1];
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.add(mesh(geo, std(color, 0.95, 0, { side: THREE.DoubleSide, map: paperTex })));
    const fan = new THREE.Group();
    fan.position.set(0, 1.0, 3.3);
    g.add(mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 24), std(0x3a6fb0, 0.5), 0, 1.0, 3.3));
    for (let i = 0; i < 4; i++) {
      const b = mesh(new THREE.BoxGeometry(0.12, 0.4, 0.02), std(0x9ac0e8, 0.5), 0, 0, 0);
      b.position.set(Math.cos((i * Math.PI) / 2) * 0.2, Math.sin((i * Math.PI) / 2) * 0.2, 0);
      b.rotation.z = (i * Math.PI) / 2;
      fan.add(b);
    }
    g.add(fan);
    return { group: g, spinners: [{ obj: fan, axis: 'z', speed: 40 }], discs: [], flames: [], tail: new THREE.Vector3(0, 1, 3) };
  },

  drone(color) {
    const g = new THREE.Group();
    const body = std(color, 0.45, 0.2);
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.16, 0.7), body, 0, 0.42, 0));
    g.add(mesh(new THREE.SphereGeometry(0.22, 16, 10).scale(1, 0.55, 1.6), body, 0, 0.5, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), metal(0x555555), 0, 0.3, -0.28));
    g.add(mesh(new THREE.SphereGeometry(0.07, 12, 8), glass(), 0, 0.26, -0.33));
    const spinners: VehicleModel['spinners'] = [];
    const discs: THREE.Mesh[] = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const arm = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.62), body, sx * 0.28, 0.46, sz * 0.32);
      arm.rotation.y = Math.atan2(sx, sz) + Math.PI;
      g.add(arm);
      g.add(mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 12), metal(0x222222), sx * 0.5, 0.5, sz * 0.56));
      const r = new THREE.Group();
      r.position.set(sx * 0.5, 0.57, sz * 0.56);
      r.add(mesh(new THREE.BoxGeometry(0.5, 0.008, 0.045), std(0xd8d8d8, 0.5)));
      g.add(r);
      spinners.push({ obj: r, axis: 'y', speed: 80 * sx * sz });
      const d = disc(0.26, 'y');
      d.position.copy(r.position);
      g.add(d);
      discs.push(d);
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 4), std(0x111111, 0.6), sx * 0.15, 0.18, sz * 0.12));
    }
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.015, 0.03), std(0x111111, 0.6), 0, 0.01, -0.12));
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.015, 0.03), std(0x111111, 0.6), 0, 0.01, 0.12));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: 0x33ff66 }));
    led.position.set(0, 0.46, 0.36);
    g.add(led);
    g.scale.setScalar(1.6);
    return { group: g, spinners, discs, flames: [], tail: new THREE.Vector3(0, 0.45, 0.4) };
  },

  kotatsu(color) {
    const g = new THREE.Group();
    const futonTex = canvasTexture(256, 256, (c) => {
      c.fillStyle = color;
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = 'rgba(255,230,190,0.55)';
      c.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          const x = i * 32 + 16;
          const y = j * 32 + 16;
          c.beginPath();
          c.arc(x, y, 9, 0, Math.PI * 2);
          c.stroke();
          c.beginPath();
          c.moveTo(x - 5, y);
          c.lineTo(x + 5, y);
          c.moveTo(x, y - 5);
          c.lineTo(x, y + 5);
          c.stroke();
        }
      }
    }, 2);
    const futon = std(0xffffff, 0.95, 0, { map: futonTex });
    const wood = std(0x9c6b3e, 0.55);
    const f = mesh(new THREE.BoxGeometry(2.4, 0.55, 2.4, 6, 2, 6), futon, 0, 0.42, 0);
    const p = f.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = 1 + (0.28 - y) * 0.12;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    f.geometry.computeVertexNormals();
    g.add(f);
    g.add(mesh(new THREE.BoxGeometry(1.8, 0.06, 1.8), wood, 0, 0.73, 0));
    g.add(mesh(new THREE.BoxGeometry(1.84, 0.02, 1.84), std(0x6b4423, 0.45), 0, 0.7, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.1, 20), std(0xc9a46a, 0.8), 0.25, 0.81, 0.15));
    for (const [x, z] of [[0.2, 0.1], [0.33, 0.22], [0.2, 0.3], [0.32, 0.05]]) {
      g.add(mesh(new THREE.SphereGeometry(0.11, 14, 10).scale(1, 0.85, 1), std(0xff8a1a, 0.6), x, 0.92, z));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12), std(0x3d6a4a, 0.4), -0.4, 0.82, -0.3));
    const spinners: VehicleModel['spinners'] = [];
    const discs: THREE.Mesh[] = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const r = new THREE.Group();
      r.position.set(sx * 0.75, 0.1, sz * 0.75);
      r.add(mesh(new THREE.BoxGeometry(0.6, 0.01, 0.06), std(0x333333, 0.5)));
      g.add(r);
      g.add(mesh(new THREE.TorusGeometry(0.33, 0.03, 6, 20).rotateX(Math.PI / 2), metal(0x777777), sx * 0.75, 0.1, sz * 0.75));
      spinners.push({ obj: r, axis: 'y', speed: 50 * sx * sz });
      const d = disc(0.32, 'y');
      d.position.copy(r.position);
      g.add(d);
      discs.push(d);
    }
    return { group: g, spinners, discs, flames: [], tail: new THREE.Vector3(0, 0.4, 1.2) };
  },

  rocket(color) {
    const g = new THREE.Group();
    const body = std(color, 0.35, 0.1);
    const accent = std(0xc8202a, 0.4);
    // 尾部が原点、機首が -z 方向（ピッチ 90° で真上を向く）
    g.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 12, 24).rotateX(Math.PI / 2), body, 0, 0, -6.5));
    g.add(mesh(lathe([[1.1, -12.5], [0.95, -14], [0.55, -15.5], [0.05, -16.4]], 24), accent, 0, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.8, 24).rotateX(Math.PI / 2), std(0x1a1a1a, 0.5), 0, 0, -9));
    g.add(mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.3, 24).rotateX(Math.PI / 2), accent, 0, 0, -3));
    g.add(mesh(lathe([[0.45, -0.9], [0.6, -0.4], [0.95, 0.3]], 20), metal(0x6a6a6a, 0.3), 0, 0, 0));
    const finShape = new THREE.Shape([new THREE.Vector2(0, -3.2), new THREE.Vector2(0, 0.2), new THREE.Vector2(1.9, 0.6), new THREE.Vector2(1.9, -1.0)]);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false });
    // 押し出しは (x = 外向き, y = 前後, z = 厚み) なので、(厚み, 外向き, 前後) に並べ替える
    const fp = finGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) fp.setXYZ(i, fp.getZ(i) - 0.05, fp.getX(i) + 1.05, fp.getY(i));
    finGeo.computeVertexNormals();
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      holder.add(mesh(finGeo, std(0xc8202a, 0.4, 0, { side: THREE.DoubleSide })));
      holder.rotation.z = (i * Math.PI) / 2;
      g.add(holder);
    }
    const f = flame(0.9, 7);
    f.position.set(0, 0, 0.3);
    g.add(f);
    return { group: g, spinners: [], discs: [], flames: [f], tail: new THREE.Vector3(0, 0, 1) };
  },

  // ロケットを積んだママチャリ。前が -z、車輪の下が原点
  mamachari(color) {
    const g = new THREE.Group();
    const frame = std(color, 0.35, 0.4);
    const chrome = metal(0xd0d4d8, 0.25);
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.03, mat: THREE.Material = frame) => {
      const len = a.distanceTo(b);
      const m = mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      return m;
    };
    const spinners: VehicleModel['spinners'] = [];
    for (const z of [-0.55, 0.55]) {
      const w = new THREE.Group();
      w.position.set(0, 0.33, z);
      w.add(mesh(new THREE.TorusGeometry(0.31, 0.025, 8, 32).rotateY(Math.PI / 2), rubber()));
      for (let i = 0; i < 12; i++) {
        const sp = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.6, 3), chrome);
        sp.rotation.x = (i * Math.PI) / 12;
        w.add(sp);
      }
      g.add(w);
      spinners.push({ obj: w, axis: 'x', speed: -30 });
    }
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    g.add(tube(V(0, 0.33, 0.55), V(0, 0.75, 0.1)), tube(V(0, 0.75, 0.1), V(0, 0.45, -0.1)), tube(V(0, 0.45, -0.1), V(0, 0.33, 0.55)));
    g.add(tube(V(0, 0.45, -0.1), V(0, 0.82, -0.42), 0.035), tube(V(0, 0.33, -0.55), V(0, 0.95, -0.45)));
    g.add(tube(V(-0.28, 0.98, -0.4), V(0.28, 0.98, -0.4), 0.018, chrome));
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26), std(0x222222, 0.6), 0, 0.92, -0.62));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.05, 0.26), std(0x1a1a1a, 0.7), 0, 0.86, 0.12));
    // 乗っている人
    g.add(mesh(new THREE.CapsuleGeometry(0.16, 0.4, 4, 8), std(0x2f4f8f, 0.8), 0, 1.25, 0.02));
    g.add(mesh(new THREE.SphereGeometry(0.13, 14, 10), std(0xf0c8a0, 0.7), 0, 1.68, -0.08));
    g.add(mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0xffffff, 0.3), 0, 1.71, -0.08));
    // 後ろの荷台に縛りつけたロケット
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 16).rotateX(Math.PI / 2), std(0xe8e8e8, 0.3, 0.3), 0, 0.92, 0.55));
    g.add(mesh(new THREE.ConeGeometry(0.16, 0.3, 16).rotateX(-Math.PI / 2), std(0xc8202a, 0.4), 0, 0.92, -0.05));
    g.add(mesh(lathe([[0.1, 1.05], [0.13, 1.18], [0.2, 1.3]], 16), metal(0x555555, 0.3), 0, 0.92, 0));
    // 段ボールの翼
    g.add(mesh(new THREE.BoxGeometry(2.4, 0.02, 0.45), std(0xb08850, 0.95), 0, 0.88, 0.25));
    const f = flame(0.18, 1.8, 0xffb060);
    f.position.set(0, 0.92, 1.3);
    g.add(f);
    g.scale.setScalar(1.4);
    return { group: g, spinners, discs: [], flames: [f], tail: new THREE.Vector3(0, 1.3, 2) };
  },

  ufo(color) {
    const g = new THREE.Group();
    const hull = std(color, 0.18, 0.95, { envMapIntensity: 1.6 });
    g.add(mesh(lathe([[0.1, -1.0], [3.2, -0.6], [6, 0], [3.2, 0.5], [0.1, 0.9]], 48).rotateX(-Math.PI / 2), hull, 0, 1.6, 0));
    g.add(mesh(new THREE.SphereGeometry(2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x9fe8ff, roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1 }), 0, 2.4, 0));
    const ring = new THREE.Group();
    ring.position.y = 1.6;
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x7fffe0, emissive: 0x6fffd8, emissiveIntensity: 2.5 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lightMat);
      l.position.set(Math.cos(a) * 5.6, 0, Math.sin(a) * 5.6);
      ring.add(l);
    }
    g.add(ring);
    const glow = flame(2.4, 1.6, 0x66ffe0);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 0.7;
    g.add(glow);
    for (const [x, z] of [[2, 1.2], [-2, 1.2], [0, -2.3]]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.9, 6), metal(), x, 0.45, z));
    return { group: g, spinners: [{ obj: ring, axis: 'y', speed: 4 }], discs: [], flames: [glow], tail: new THREE.Vector3(0, 1.6, 0) };
  },
};

export const SHAPE_IDS = Object.keys(SHAPES);

export function buildVehicleModel(shape: string, color: string): VehicleModel {
  return (SHAPES[shape] ?? SHAPES.prop)(color);
}
