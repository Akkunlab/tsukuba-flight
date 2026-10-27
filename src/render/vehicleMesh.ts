// 乗り物の 3D モデル（プリミティブの組み合わせ）。前が -z、上が +y、原点は機体の一番下。
// 新しい乗り物の見た目を足すときは SHAPES にビルダーを追加する。
import * as THREE from 'three';

export interface VehicleModel {
  group: THREE.Group;
  /** 回転させる部品（プロペラなど）と回転軸 */
  spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  /** スロットルで大きさが変わる炎 */
  flames: THREE.Object3D[];
  /** 軌跡が出る位置（ローカル座標） */
  tail: THREE.Vector3;
  /** 搭乗者を乗せる位置（ローカル座標） */
  seat: THREE.Vector3;
}

const lambert = (color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function flame(radius: number, length: number, color = 0xffa030) {
  const g = new THREE.Group();
  const outer = mesh(
    new THREE.ConeGeometry(radius, length, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, length / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const inner = mesh(
    new THREE.ConeGeometry(radius * 0.5, length * 0.6, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, length * 0.3),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  g.add(outer, inner);
  return g;
}

type Builder = (color: string) => VehicleModel;

const SHAPES: Record<string, Builder> = {
  prop(color) {
    const g = new THREE.Group();
    const body = lambert(color);
    const accent = lambert(0xd8322b);
    g.add(mesh(new THREE.CylinderGeometry(0.75, 0.45, 8, 12).rotateX(Math.PI / 2), body, 0, 1.6, 0));
    g.add(mesh(new THREE.SphereGeometry(0.75, 12, 8), body, 0, 1.6, -4));
    g.add(mesh(new THREE.BoxGeometry(11, 0.15, 1.6), body, 0, 1.9, -0.8));
    g.add(mesh(new THREE.BoxGeometry(11.02, 0.16, 0.3), accent, 0, 1.9, -1.5));
    g.add(mesh(new THREE.BoxGeometry(3.6, 0.12, 0.9), body, 0, 1.8, 3.6));
    g.add(mesh(new THREE.BoxGeometry(0.12, 1.6, 1.1), accent, 0, 2.6, 3.6));
    g.add(mesh(new THREE.SphereGeometry(0.55, 10, 8).scale(1, 0.8, 1.6), lambert(0x22445a, { transparent: true, opacity: 0.8 }), 0, 2.25, -1.8));
    for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 10).rotateZ(Math.PI / 2), lambert(0x222222), s * 1.2, 0.35, -1.2));
    g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 10).rotateZ(Math.PI / 2), lambert(0x222222), 0, 0.25, 3.4));
    const prop = new THREE.Group();
    prop.position.set(0, 1.6, -4.7);
    prop.add(mesh(new THREE.BoxGeometry(3.2, 0.25, 0.08), lambert(0x333333)));
    prop.add(mesh(new THREE.ConeGeometry(0.3, 0.6, 10).rotateX(-Math.PI / 2), accent, 0, 0, -0.2));
    g.add(prop);
    return { group: g, spinners: [{ obj: prop, axis: 'z', speed: 60 }], flames: [], tail: new THREE.Vector3(0, 1.8, 4), seat: new THREE.Vector3(0, 2.8, -1) };
  },

  jet(color) {
    const g = new THREE.Group();
    const body = lambert(color);
    const accent = lambert(0x1f5fbf);
    g.add(mesh(new THREE.CylinderGeometry(1.7, 1.4, 22, 16).rotateX(Math.PI / 2), body, 0, 3, 0));
    g.add(mesh(new THREE.SphereGeometry(1.7, 16, 10).scale(1, 1, 2), body, 0, 3, -11));
    g.add(mesh(new THREE.ConeGeometry(1.4, 4, 16).rotateX(Math.PI / 2), body, 0, 3.3, 13));
    const wing = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(13, 5), new THREE.Vector2(13, 7), new THREE.Vector2(0, 6)]);
    for (const s of [-1, 1]) {
      const w = mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.3, bevelEnabled: false }).rotateX(Math.PI / 2), body, 0, 2.6, -3);
      w.scale.x = s;
      g.add(w);
      g.add(mesh(new THREE.CylinderGeometry(0.8, 0.7, 3.5, 12).rotateX(Math.PI / 2), accent, s * 5, 1.6, -1));
    }
    const tailw = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(5, 2.5), new THREE.Vector2(5, 3.5), new THREE.Vector2(0, 3)]);
    for (const s of [-1, 1]) {
      const t = mesh(new THREE.ExtrudeGeometry(tailw, { depth: 0.2, bevelEnabled: false }).rotateX(Math.PI / 2), body, 0, 3.5, 9.5);
      t.scale.x = s;
      g.add(t);
    }
    g.add(mesh(new THREE.BoxGeometry(0.3, 5, 3.4), accent, 0, 6, 12));
    g.add(mesh(new THREE.BoxGeometry(3.42, 0.4, 0.1), lambert(0x18324f), 0, 3.6, -12.4));
    const flames = [-1, 1].map((s) => {
      const f = flame(0.55, 3, 0x9fd0ff);
      f.position.set(s * 5, 1.6, 0.8);
      g.add(f);
      return f;
    });
    for (const z of [-8, 2]) g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10).rotateZ(Math.PI / 2), lambert(0x222222), 0, 0.5, z));
    return { group: g, spinners: [], flames, tail: new THREE.Vector3(0, 3, 13), seat: new THREE.Vector3(0, 5.2, -6) };
  },

  paper(color) {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    // 折り紙の紙飛行機：中央の折り目と左右の翼
    const v = [
      0, 1, -4, -3.2, 1.6, 3, 0, 1, 3,
      0, 1, -4, 0, 1, 3, 3.2, 1.6, 3,
      0, 1, -4, 0, 0.2, 3, 0, 1, 3,
    ];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, lambert(color, { side: THREE.DoubleSide })));
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x8899aa }),
    );
    g.add(lines);
    return { group: g, spinners: [], flames: [], tail: new THREE.Vector3(0, 1, 3), seat: new THREE.Vector3(0, 1.8, 0.5) };
  },

  heli(color) {
    const g = new THREE.Group();
    const body = lambert(color);
    g.add(mesh(new THREE.SphereGeometry(1.6, 16, 12).scale(1, 0.95, 1.5), body, 0, 2.1, 0));
    g.add(mesh(new THREE.SphereGeometry(1.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1.2).rotateX(-Math.PI / 2.4), lambert(0x203848, { transparent: true, opacity: 0.8 }), 0, 2.3, -1));
    g.add(mesh(new THREE.CylinderGeometry(0.25, 0.4, 6, 8).rotateX(Math.PI / 2), body, 0, 2.5, 4.5));
    g.add(mesh(new THREE.BoxGeometry(0.15, 1.5, 0.9), body, 0, 3.1, 7.3));
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.5, 6).rotateX(Math.PI / 2), lambert(0x333333), s * 1.2, 0.1, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), lambert(0x333333), s * 1.2, 0.6, -1));
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), lambert(0x333333), s * 1.2, 0.6, 1));
    }
    const rotor = new THREE.Group();
    rotor.position.set(0, 3.8, 0);
    rotor.add(mesh(new THREE.BoxGeometry(11, 0.06, 0.4), lambert(0x222222)));
    rotor.add(mesh(new THREE.BoxGeometry(0.4, 0.06, 11), lambert(0x222222)));
    rotor.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 8), lambert(0x444444), 0, -0.3, 0));
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.25, 3.1, 7.4);
    tailRotor.add(mesh(new THREE.BoxGeometry(0.05, 1.8, 0.2), lambert(0x222222)));
    g.add(rotor, tailRotor);
    return {
      group: g,
      spinners: [
        { obj: rotor, axis: 'y', speed: 25 },
        { obj: tailRotor, axis: 'x', speed: 60 },
      ],
      flames: [],
      tail: new THREE.Vector3(0, 2.6, 7.5),
      seat: new THREE.Vector3(0, 4.6, 0),
    };
  },

  drone(color) {
    const g = new THREE.Group();
    const body = lambert(color);
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.18, 0.7), body, 0, 0.35, 0));
    g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), lambert(0x44aaff), 0, 0.35, -0.38));
    const spinners: VehicleModel['spinners'] = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const arm = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.75), body, sx * 0.3, 0.38, sz * 0.3);
      arm.rotation.y = Math.atan2(sx, sz);
      g.add(arm);
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), lambert(0x111111), sx * 0.55, 0.44, sz * 0.55));
      const r = new THREE.Group();
      r.position.set(sx * 0.55, 0.52, sz * 0.55);
      r.add(mesh(new THREE.BoxGeometry(0.55, 0.01, 0.05), lambert(0xeeeeee)));
      g.add(r);
      spinners.push({ obj: r, axis: 'y', speed: 80 * sx * sz });
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 4), lambert(0x111111), sx * 0.2, 0.15, sz * 0.25));
    }
    return { group: g, spinners, flames: [], tail: new THREE.Vector3(0, 0.35, 0.4), seat: new THREE.Vector3(0, 0.75, 0) };
  },

  rocket(color) {
    const g = new THREE.Group();
    const body = lambert(color);
    const accent = lambert(0xd72a2a);
    // 尾部が原点、機首が -z 方向（ピッチ 90° で真上を向く）
    g.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 12, 16).rotateX(Math.PI / 2), body, 0, 0, -6.5));
    g.add(mesh(new THREE.ConeGeometry(1.1, 3.5, 16).rotateX(-Math.PI / 2), accent, 0, 0, -14.2));
    g.add(mesh(new THREE.CylinderGeometry(1.12, 1.12, 1, 16).rotateX(Math.PI / 2), accent, 0, 0, -9));
    g.add(mesh(new THREE.CylinderGeometry(0.7, 1, 1, 12).rotateX(Math.PI / 2), lambert(0x333333), 0, 0, -0.3));
    for (let i = 0; i < 4; i++) {
      const fin = mesh(new THREE.BoxGeometry(0.12, 2.2, 2.5), accent, 0, 0, -1.5);
      const holder = new THREE.Group();
      fin.position.y = 1.9;
      holder.add(fin);
      holder.rotation.z = (i * Math.PI) / 2;
      g.add(holder);
    }
    const f = flame(0.9, 7);
    f.position.set(0, 0, 0.2);
    g.add(f);
    return { group: g, spinners: [], flames: [f], tail: new THREE.Vector3(0, 0, 1), seat: new THREE.Vector3(0, 1.6, -9) };
  },

  petbottle(color) {
    const g = new THREE.Group();
    const plastic = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.55, shininess: 100 });
    g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.2, 16).rotateX(Math.PI / 2), plastic, 0, 0, -1.7));
    g.add(mesh(new THREE.CylinderGeometry(0.18, 0.45, 0.6, 16).rotateX(Math.PI / 2), plastic, 0, 0, -0.3));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12).rotateX(Math.PI / 2), lambert(0x2266dd), 0, 0, 0));
    g.add(mesh(new THREE.SphereGeometry(0.45, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), plastic, 0, 0, -2.8));
    g.add(mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.2, 16).rotateX(Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0x3fa9f5, transparent: true, opacity: 0.4 }), 0, 0, -1));
    for (let i = 0; i < 3; i++) {
      const holder = new THREE.Group();
      const fin = mesh(new THREE.BoxGeometry(0.04, 0.6, 0.8), lambert(0xff3366), 0, 0.7, -0.9);
      holder.add(fin);
      holder.rotation.z = (i * Math.PI * 2) / 3;
      g.add(holder);
    }
    const f = flame(0.2, 2.5, 0xbfefff);
    g.add(f);
    return { group: g, spinners: [], flames: [f], tail: new THREE.Vector3(0, 0, 0.3), seat: new THREE.Vector3(0, 0.75, -1.7) };
  },

  balloon(color) {
    const g = new THREE.Group();
    const env = new THREE.SphereGeometry(8, 24, 16);
    const pos = env.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const a = new THREE.Color(color);
    const b = new THREE.Color(0xffe14d);
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const stripe = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 12) % 2 === 0;
      const c = stripe ? a : b;
      colors.push(c.r, c.g, c.b);
      // 下側をすぼめて気球の形に
      const y = pos.getY(i);
      if (y < 0) {
        const k = 1 + (y / 8) * 0.55;
        pos.setX(i, pos.getX(i) * k);
        pos.setZ(i, pos.getZ(i) * k);
      }
    }
    env.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    env.computeVertexNormals();
    g.add(mesh(env, new THREE.MeshLambertMaterial({ vertexColors: true }), 0, 13, 0));
    g.add(mesh(new THREE.BoxGeometry(1.6, 1.1, 1.6), lambert(0x8a5a2b), 0, 0.55, 0));
    const rope = new THREE.LineBasicMaterial({ color: 0x333333 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sx * 0.75, 1.1, sz * 0.75), new THREE.Vector3(sx * 2.4, 7, sz * 2.4)]);
      g.add(new THREE.Line(geo, rope));
    }
    const f = flame(0.4, 2.2);
    f.rotation.x = -Math.PI / 2;
    f.position.set(0, 2.2, 0);
    g.add(f);
    return { group: g, spinners: [], flames: [f], tail: new THREE.Vector3(0, 6, 0), seat: new THREE.Vector3(0, 1.6, 0) };
  },

  broom(color) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6).rotateX(Math.PI / 2), lambert(color), 0, 0.8, -0.3));
    g.add(mesh(new THREE.ConeGeometry(0.35, 1.4, 10).rotateX(Math.PI / 2), lambert(0xd8b25a), 0, 0.8, 1.8));
    const sparkle = flame(0.15, 1.2, 0xc58bff);
    sparkle.position.set(0, 0.8, 2.4);
    g.add(sparkle);
    return { group: g, spinners: [], flames: [sparkle], tail: new THREE.Vector3(0, 0.8, 2.4), seat: new THREE.Vector3(0, 1.5, -0.4) };
  },
};

export const SHAPE_IDS = Object.keys(SHAPES);

export function buildVehicleModel(shape: string, color: string): VehicleModel {
  return (SHAPES[shape] ?? SHAPES.prop)(color);
}

export function emojiSprite(emoji: string, size: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '76px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 48, 54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(size, size, 1);
  return s;
}
