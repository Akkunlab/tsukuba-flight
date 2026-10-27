// 乗り物の 3D モデル（プリミティブの組み合わせ、PBR マテリアル）。前が -z、上が +y、原点は機体の一番下。
// 新しい乗り物の見た目を足すときは SHAPES にビルダーを追加する。
import * as THREE from 'three';

export interface VehicleModel {
  group: THREE.Group;
  /** 回転させる部品（プロペラなど）と回転軸 */
  spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  /** 回転が速いときに見える残像の円盤 */
  discs: THREE.Mesh[];
  /** スロットルで大きさが変わる炎 */
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

/** 機体に貼る登録記号（JA で始まる架空の番号） */
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
  // 高翼の 4 人乗り単発機（全長 8.3m・翼幅 11m）
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
    // 胴体のライン
    for (const s of [-1, 1]) {
      const stripe = mesh(new THREE.BoxGeometry(0.02, 0.12, 6.4), accent, s * 0.7, 1.3, -0.6);
      stripe.rotation.x = 0.03;
      g.add(stripe);
      const reg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), registration('JA4TF'));
      reg.position.set(s * 0.56, 1.55, 1.6);
      reg.rotation.y = s * Math.PI / 2;
      g.add(reg);
    }
    // 窓
    const cabin = mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.66, 0.5, 1.45), glass(), 0, 1.9, -1.35);
    g.add(cabin);
    // 主翼（高翼）と支柱
    const w = mesh(wing([[-5.5, -0.75], [5.5, -0.75], [5.5, 0.65], [-5.5, 0.65]], 0.12), paint, 0, 2.4, -1.15);
    g.add(w);
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.14, 1.42), accent, s * 5.4, 2.46, -1.2));
      const strut = mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), metal(0xd8d8d8), s * 1.55, 1.75, -1.1);
      strut.rotation.z = s * -1.05;
      g.add(strut);
    }
    // 尾翼
    g.add(mesh(wing([[-1.7, -0.35], [1.7, -0.35], [1.4, 0.5], [-1.4, 0.5]], 0.07), paint, 0, 1.55, 3.55));
    const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.5, 0), new THREE.Vector2(1.3, 1.6), new THREE.Vector2(0.6, 1.6)]);
    const finMesh = mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.07, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.035, 0, 0), paint, 0, 1.6, 2.6);
    g.add(finMesh);
    g.add(mesh(new THREE.BoxGeometry(0.075, 0.3, 0.6), accent, 0, 2.9, 3.85));
    // 脚
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
    // プロペラ
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

  // 人力飛行機（翼幅 25m、透明フィルム張り）
  birdman(color) {
    const g = new THREE.Group();
    const film = new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, transmission: 0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, clearcoat: 0.6 });
    const carbon = std(0x1c1c1c, 0.35, 0.3);
    const w = mesh(wing([[-12.5, -0.45], [12.5, -0.3], [12.5, 0.4], [-12.5, 0.4]], 0.14), film, 0, 3.4, 0);
    w.castShadow = true;
    g.add(w);
    // 翼のリブと桁
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 25, 8).rotateZ(Math.PI / 2), carbon, 0, 3.47, -0.1));
    for (let x = -12; x <= 12; x += 1.5) g.add(mesh(new THREE.BoxGeometry(0.03, 0.16, 0.86), carbon, x, 3.47, 0.04));
    // 胴体（ポッド）とパイロット
    const pod = mesh(lathe([[0.05, -1.6], [0.45, -1.2], [0.6, -0.3], [0.55, 0.6], [0.25, 1.4], [0.08, 1.8]]), film, 0, 1.6, 0);
    pod.scale.set(0.8, 1.5, 1);
    g.add(pod);
    const pilot = new THREE.Group();
    pilot.add(mesh(new THREE.SphereGeometry(0.16, 12, 8), std(0xf0c8a0, 0.7), 0, 2.05, -0.15));
    pilot.add(mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd83a2e, 0.4), 0, 2.08, -0.15));
    pilot.add(mesh(new THREE.CapsuleGeometry(0.17, 0.45, 4, 8), std(0x2f6fb5, 0.8), 0, 1.65, 0.05));
    g.add(pilot);
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), carbon, 0, 2.5, 0));
    // 尾部のブームと尾翼
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.04, 6.5, 8).rotateX(Math.PI / 2), carbon, 0, 2.3, 4.3));
    g.add(mesh(wing([[-2, -0.3], [2, -0.3], [2, 0.3], [-2, 0.3]], 0.06), film, 0, 2.3, 7.3));
    const fin = mesh(new THREE.BoxGeometry(0.04, 1.4, 0.7), film, 0, 2.9, 7.3);
    g.add(fin);
    const wl = wheel(0.25, 0.08);
    wl.position.set(0, 0.25, 0.2);
    g.add(wl);
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), carbon, 0, 0.7, 0.2));
    // 大きな前のプロペラ
    const prop = new THREE.Group();
    prop.position.set(0, 1.9, -1.75);
    for (const s of [-1, 1]) {
      const blade = mesh(new THREE.BoxGeometry(0.22, 1.5, 0.03), std(0xf2f2f2, 0.4), 0, s * 0.75, 0);
      blade.rotation.y = s * 0.25;
      prop.add(blade);
    }
    g.add(prop);
    const d = disc(1.5, 'z');
    d.position.copy(prop.position);
    g.add(d);
    return { group: g, spinners: [{ obj: prop, axis: 'z', speed: 14 }], discs: [d], flames: [], tail: new THREE.Vector3(0, 3.4, 0.4) };
  },

  paper(color) {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    // 折り紙の紙飛行機：中央の折り目と左右の翼
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
    // 後ろの送風機
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
    // ジンバルとカメラ
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
    // 布団（少しふくらんだ箱）
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
    // みかん
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.1, 20), std(0xc9a46a, 0.8), 0.25, 0.81, 0.15));
    for (const [x, z] of [[0.2, 0.1], [0.33, 0.22], [0.2, 0.3], [0.32, 0.05]]) {
      g.add(mesh(new THREE.SphereGeometry(0.11, 14, 10).scale(1, 0.85, 1), std(0xff8a1a, 0.6), x, 0.92, z));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12), std(0x3d6a4a, 0.4), -0.4, 0.82, -0.3));
    // 底のファン
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
    // 尾翼：外側ほど後ろに流れた台形（y = 胴体から外向き、z = 前後）
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

  petbottle(color) {
    const g = new THREE.Group();
    const plastic = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, envMapIntensity: 2 });
    g.add(mesh(lathe([[0.2, 0.05], [0.2, -0.2], [0.45, -0.75], [0.45, -2.5], [0.38, -2.8], [0.1, -2.95]], 24), plastic, 0, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.22, 16).rotateX(Math.PI / 2), std(0x2266dd, 0.4), 0, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.1, 20).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x5ab8f0, roughness: 0.1, transparent: true, opacity: 0.45 }), 0, 0, -1.2));
    g.add(mesh(new THREE.CylinderGeometry(0.455, 0.455, 0.6, 20, 1, true).rotateX(Math.PI / 2), std(0xf2f2f2, 0.6, 0, { side: THREE.DoubleSide }), 0, 0, -1.9));
    for (let i = 0; i < 3; i++) {
      const holder = new THREE.Group();
      const fin = mesh(new THREE.BoxGeometry(0.03, 0.55, 0.8), std(0xff3366, 0.6), 0, 0.7, -0.9);
      holder.add(fin);
      holder.rotation.z = (i * Math.PI * 2) / 3;
      g.add(holder);
    }
    const f = flame(0.2, 2.5, 0xbfefff);
    g.add(f);
    return { group: g, spinners: [], discs: [], flames: [f], tail: new THREE.Vector3(0, 0, 0.3) };
  },

  balloon(color) {
    const g = new THREE.Group();
    const env = new THREE.SphereGeometry(8, 32, 24);
    const pos = env.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const a = new THREE.Color(color);
    const b = new THREE.Color(0xf2e2c4);
    const c2 = new THREE.Color(0x1f3d6b);
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const y = pos.getY(i);
      const gore = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0;
      const band = y > 2.5 && y < 4;
      const c = band ? c2 : gore ? a : b;
      colors.push(c.r, c.g, c.b);
      // 下側をすぼめて気球の形に
      if (y < 0) {
        const k = 1 + (y / 8) * 0.62;
        pos.setX(i, pos.getX(i) * k);
        pos.setZ(i, pos.getZ(i) * k);
      } else {
        pos.setY(i, y * 1.08);
      }
    }
    env.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    env.computeVertexNormals();
    g.add(mesh(env, std(0xffffff, 0.75, 0, { vertexColors: true }), 0, 13, 0));
    const wicker = canvasTexture(128, 128, (c) => {
      c.fillStyle = '#8a5a2b';
      c.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 8) {
        for (let x = 0; x < 128; x += 8) {
          c.fillStyle = (x + y) % 16 === 0 ? '#a8763f' : '#6f4620';
          c.fillRect(x, y, 7, 7);
        }
      }
    }, 2);
    g.add(mesh(new THREE.BoxGeometry(1.6, 1.1, 1.6), std(0xffffff, 0.9, 0, { map: wicker }), 0, 0.55, 0));
    g.add(mesh(new THREE.BoxGeometry(1.7, 0.1, 1.7), std(0x5a3a1a, 0.7), 0, 1.12, 0));
    // バーナーの枠とロープ
    g.add(mesh(new THREE.BoxGeometry(1.0, 0.06, 1.0), metal(), 0, 2.4, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.45, 12), metal(0x8a8a8a, 0.3), 0, 2.2, 0));
    const rope = new THREE.LineBasicMaterial({ color: 0x2b2b2b });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sx * 0.78, 1.1, sz * 0.78), new THREE.Vector3(sx * 0.5, 2.4, sz * 0.5), new THREE.Vector3(sx * 2.6, 7.3, sz * 2.6)]), rope));
    }
    const f = flame(0.35, 2.2);
    f.rotation.x = -Math.PI / 2;
    f.position.set(0, 2.5, 0);
    g.add(f);
    return { group: g, spinners: [], discs: [], flames: [f], tail: new THREE.Vector3(0, 6, 0) };
  },

  broom(color) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.2, 10).rotateX(Math.PI / 2), std(color, 0.5), 0, 0.8, -0.3));
    const straw = canvasTexture(64, 64, (c) => {
      c.fillStyle = '#c9a24a';
      c.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 2) {
        c.fillStyle = `rgba(${120 + Math.random() * 80},${90 + Math.random() * 60},30,0.6)`;
        c.fillRect(x, 0, 1, 64);
      }
    });
    g.add(mesh(new THREE.ConeGeometry(0.38, 1.5, 16, 1, true).rotateX(Math.PI / 2), std(0xffffff, 0.9, 0, { map: straw, side: THREE.DoubleSide }), 0, 0.8, 1.85));
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 10).rotateX(Math.PI / 2), std(0x7a1f1f, 0.6), 0, 0.8, 1.1));
    const sparkle = flame(0.15, 1.2, 0xc58bff);
    sparkle.position.set(0, 0.8, 2.6);
    g.add(sparkle);
    return { group: g, spinners: [], discs: [], flames: [sparkle], tail: new THREE.Vector3(0, 0.8, 2.6) };
  },
};

export const SHAPE_IDS = Object.keys(SHAPES);

export function buildVehicleModel(shape: string, color: string): VehicleModel {
  return (SHAPES[shape] ?? SHAPES.prop)(color);
}
