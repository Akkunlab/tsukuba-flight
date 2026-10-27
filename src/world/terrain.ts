// 地形・建物・森・水面・滑走路の 3D モデルを作る。
import * as THREE from 'three';
import { PAD, RUNWAY, World } from '../sim/world';

export interface PhotoSampler {
  /** ワールド座標 (x, z) の航空写真の色 */
  colorAt(x: number, z: number): THREE.Color;
}

export async function loadTexture(url: string, renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export function makePhotoSampler(img: HTMLImageElement | ImageBitmap, world: World): PhotoSampler {
  const w = 512;
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

export function buildTerrain(world: World, nearTex: THREE.Texture, farTex: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const n = world.data.near;
  const f = world.data.far;

  const near = new THREE.PlaneGeometry(n.maxX - n.minX, n.maxZ - n.minZ, n.size - 1, n.size - 1);
  near.rotateX(-Math.PI / 2);
  near.translate((n.minX + n.maxX) / 2, 0, (n.minZ + n.maxZ) / 2);
  const p = near.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, world.terrainHeight(p.getX(i), p.getZ(i)));
  near.computeVertexNormals();
  const nearMesh = new THREE.Mesh(near, new THREE.MeshBasicMaterial({ map: nearTex }));
  nearMesh.name = 'terrain-near';
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
  const farMesh = new THREE.Mesh(far, new THREE.MeshLambertMaterial({ map: farTex }));
  farMesh.name = 'terrain-far';
  group.add(farMesh);

  // 遠景のさらに外側（地平線まで）
  const horizon = new THREE.Mesh(
    new THREE.CircleGeometry(90000, 48).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x5f7148 }),
  );
  horizon.position.y = -2;
  group.add(horizon);
  return group;
}

function shuffleRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildBuildings(world: World, sampler: PhotoSampler | null): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const rand = shuffleRandom(42);
  const concrete = new THREE.Color(0xd9d4c7);
  const wallColor = new THREE.Color();
  const roofColor = new THREE.Color();
  for (const o of world.obstacles) {
    if (o.kind !== 'building') continue;
    let poly = o.poly;
    if (THREE.ShapeUtils.isClockWise(poly.map(([x, z]) => new THREE.Vector2(x, -z)))) poly = [...poly].reverse();
    const cx = (o.minX + o.maxX) / 2;
    const cz = (o.minZ + o.maxZ) / 2;
    const photo = sampler ? sampler.colorAt(cx, cz) : new THREE.Color(0x999999);
    roofColor.copy(photo).lerp(concrete, 0.25);
    wallColor.copy(concrete).lerp(photo, 0.25).multiplyScalar(0.8 + rand() * 0.2);
    const y0 = o.base - 1;
    const y1 = o.top;
    // 壁（反時計回りの多角形なので外向きの面になる）
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
      // 面の向きで明るさを変える（太陽は南西寄り）
      const nx = -(bz - az);
      const nz = bx - ax;
      const len = Math.hypot(nx, nz) || 1;
      const shade = 0.72 + 0.28 * Math.max(0, (nx / len) * -0.5 + (nz / len) * 0.85);
      for (let k = 0; k < 6; k++) col.push(wallColor.r * shade, wallColor.g * shade, wallColor.b * shade);
    }
    // 屋根
    const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      for (const idx of [t[0], t[2], t[1]]) {
        pos.push(poly[idx][0], y1, poly[idx][1]);
        col.push(roofColor.r, roofColor.g, roofColor.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'buildings';
  return mesh;
}

export function buildTrees(world: World, maxTrees = 14000): THREE.Group {
  const rand = shuffleRandom(7);
  const woods = world.obstacles.filter((o) => o.kind === 'tree');
  const areas = woods.map((o) => Math.abs(THREE.ShapeUtils.area(o.poly.map(([x, z]) => new THREE.Vector2(x, z)))));
  const total = areas.reduce((a, b) => a + b, 0);
  const density = Math.min(1 / 90, maxTrees / Math.max(total, 1));
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
      points.push({ x, z, y: world.terrainHeight(x, z), s: 0.75 + rand() * 0.5 });
      placed++;
    }
  });
  const crown = new THREE.ConeGeometry(4.2, 10, 7).translate(0, 8, 0);
  const crown2 = new THREE.IcosahedronGeometry(4.5, 0).translate(0, 9, 0);
  const trunk = new THREE.CylinderGeometry(0.4, 0.5, 4, 5).translate(0, 2, 0);
  const group = new THREE.Group();
  const leaf = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const meshA = new THREE.InstancedMesh(crown, leaf, Math.ceil(points.length / 2));
  const meshB = new THREE.InstancedMesh(crown2, leaf, Math.ceil(points.length / 2));
  const meshT = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5b4330 }), points.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let a = 0;
  let b = 0;
  points.forEach((p, i) => {
    m.makeRotationY(rand() * Math.PI * 2);
    m.scale(new THREE.Vector3(p.s, p.s * (0.9 + rand() * 0.3), p.s));
    m.setPosition(p.x, p.y, p.z);
    meshT.setMatrixAt(i, m);
    c.setHSL(0.24 + rand() * 0.08, 0.45 + rand() * 0.2, 0.18 + rand() * 0.1);
    if (i % 2 === 0) {
      meshA.setMatrixAt(a, m);
      meshA.setColorAt(a++, c);
    } else {
      meshB.setMatrixAt(b, m);
      meshB.setColorAt(b++, c);
    }
  });
  meshA.count = a;
  meshB.count = b;
  group.add(meshA, meshB, meshT);
  group.name = 'trees';
  return group;
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
  const geos: THREE.BufferGeometry[] = [];
  for (const poly of world.data.water) {
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const [cx, cz] = poly[0];
    g.translate(0, world.terrainHeight(cx, cz) + 0.4, 0);
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  return new THREE.Mesh(
    merged,
    new THREE.MeshPhongMaterial({ color: 0x3c6f8f, shininess: 90, specular: 0x99bbdd, transparent: true, opacity: 0.85 }),
  );
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.attributes.position.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

function runwayTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 2048;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b3d40';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
    g.fillRect(Math.random() * 128, Math.random() * 2048, 2, 2);
  }
  g.fillStyle = '#f2f2f2';
  g.fillRect(4, 0, 3, c.height);
  g.fillRect(c.width - 7, 0, 3, c.height);
  for (let y = 160; y < c.height - 160; y += 60) g.fillRect(62, y, 4, 30);
  for (const y0 of [12, c.height - 80]) for (let x = 14; x < 114; x += 12) g.fillRect(x, y0, 7, 68);
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.save();
  g.translate(64, c.height - 110);
  g.fillText('36', 0, 0);
  g.restore();
  g.save();
  g.translate(64, 110);
  g.rotate(Math.PI);
  g.fillText('18', 0, 0);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildAirfield(world: World): THREE.Group {
  const group = new THREE.Group();
  const y = world.runwayElevation;
  const rw = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: runwayTexture() }),
  );
  rw.position.set(RUNWAY.x, y + 0.12, RUNWAY.z);
  group.add(rw);
  // 芝生の帯
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width + 70, RUNWAY.length + 60).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6f8f4a }),
  );
  grass.position.set(RUNWAY.x, y + 0.06, RUNWAY.z);
  group.add(grass);
  // 発射台
  const padC = document.createElement('canvas');
  padC.width = padC.height = 256;
  const g = padC.getContext('2d')!;
  g.fillStyle = '#555a5f';
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffd400';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 140px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', 128, 136);
  const padTex = new THREE.CanvasTexture(padC);
  padTex.colorSpace = THREE.SRGBColorSpace;
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(14, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: padTex, transparent: true }),
  );
  pad.position.set(PAD.x, world.terrainHeight(PAD.x, PAD.z) + 0.16, PAD.z);
  group.add(pad);
  // 滑走路灯
  const lightGeo = new THREE.SphereGeometry(0.5, 6, 4);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
  const lights = new THREE.InstancedMesh(lightGeo, lightMat, 2 * Math.floor(RUNWAY.length / 50 + 1));
  const m = new THREE.Matrix4();
  let i = 0;
  for (let z = -RUNWAY.length / 2; z <= RUNWAY.length / 2; z += 50) {
    for (const s of [-1, 1]) {
      m.makeTranslation(RUNWAY.x + s * (RUNWAY.width / 2 + 2), y + 0.6, RUNWAY.z + z);
      lights.setMatrixAt(i++, m);
    }
  }
  lights.count = i;
  group.add(lights);
  // 格納庫
  const hangar = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 14, 40, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xb8bcc0 }),
  );
  hangar.position.set(RUNWAY.x - 75, y, RUNWAY.z + RUNWAY.length / 2 - 90);
  group.add(hangar);
  group.name = 'airfield';
  return group;
}
