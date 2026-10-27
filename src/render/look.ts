// 光と空気の表現。中・高は物理ベースの大気（Bruneton の大気散乱）で空・太陽の色・空気遠近を計算し、
// 空から作った環境光、太陽の影、アンビエントオクルージョン、ブルーム、AgX トーンマップ、SMAA をかける。
// 低は軽い従来の空と霧だけにする。
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { AerialPerspectiveEffect, AtmosphereParameters, PrecomputedTexturesGenerator, SkyMaterial, SunDirectionalLight, getSunDirectionECEF } from '@takram/three-atmosphere';
import { Ellipsoid, Geodetic, radians } from '@takram/three-geospatial';

export interface LookOptions {
  realistic: boolean;
  shadows: boolean;
  shadowMap: number;
  halfResAO: boolean;
  /** ワールド原点の緯度経度と標高 */
  origin: { lat: number; lon: number; height: number };
  /** 太陽の位置を決める日時 */
  date: Date;
}

export interface Look {
  /** 太陽の光（影を落とす） */
  sun: THREE.DirectionalLight;
  /** 太陽の向き（ワールド座標、地面から太陽へ） */
  sunDir: THREE.Vector3;
  ready: Promise<void>;
  /** 影を落とす範囲の中心と半径 [m] を決めて、太陽を合わせる */
  update(focus: THREE.Vector3, shadowHalf: number): void;
  render(): void;
  setSize(w: number, h: number): void;
}

/** ワールド座標（x = 東、y = 上、z = 南）から地球中心座標（ECEF）への変換 */
function worldToECEF(origin: LookOptions['origin']): THREE.Matrix4 {
  const pos = new Geodetic(radians(origin.lon), radians(origin.lat), origin.height).toECEF();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  Ellipsoid.WGS84.getEastNorthUpVectors(pos, east, north, up);
  return new THREE.Matrix4().makeBasis(east, up, north.negate()).setPosition(pos);
}

function setupShadow(light: THREE.DirectionalLight, o: LookOptions) {
  light.castShadow = o.shadows;
  light.shadow.mapSize.set(o.shadowMap, o.shadowMap);
  const c = light.shadow.camera;
  c.near = 10;
  c.far = 8000;
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.6;
}

function fitShadow(light: THREE.DirectionalLight, focus: THREE.Vector3, half: number) {
  const c = light.shadow.camera;
  if (c.right !== half) {
    c.left = -half;
    c.right = half;
    c.top = half;
    c.bottom = -half;
    c.updateProjectionMatrix();
  }
  // 影の画素単位でそろえて、動いたときのちらつきを防ぐ
  const texel = (half * 2) / light.shadow.mapSize.x;
  light.target.position.set(Math.round(focus.x / texel) * texel, focus.y, Math.round(focus.z / texel) * texel);
}

export function createLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: LookOptions): Look {
  return o.realistic ? realisticLook(renderer, scene, camera, o) : basicLook(renderer, scene, camera, o);
}

function basicLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: LookOptions): Look {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  scene.fog = new THREE.FogExp2(0xb4c6d6, 0.00005);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(215));
  const sky = new Sky();
  sky.scale.setScalar(120000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5.5;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'sunPosition'] as const) envSky.material.uniforms[k].value = u[k].value;
  env.add(envSky);
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5236, 0.7));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  setupShadow(sun, o);
  scene.add(sun, sun.target);
  return {
    sun,
    sunDir,
    ready: Promise.resolve(),
    update(focus, half) {
      fitShadow(sun, focus, half);
      sun.position.copy(sun.target.position).addScaledVector(sunDir, 3000);
    },
    render: () => renderer.render(scene, camera),
    setSize: (w, h) => renderer.setSize(w, h),
  };
}

const SKY_GAIN = 10;
let brightened = false;

function realisticLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: LookOptions): Look {
  // 大気の明るさは「太陽を 1」とした相対値で小さいので、空と太陽の光を 10 倍にし、
  // 光の当たらないもの（リング・軌跡・炎など）と同じ露出 1 で見られるようにする。
  // 太陽の円盤そのものは元の値のまま（10 倍すると半精度の上限を超えて画面が黒く崩れる）
  if (!brightened) {
    AtmosphereParameters.DEFAULT.skyRadianceToRelativeLuminance.multiplyScalar(SKY_GAIN);
    brightened = true;
  }
  // トーンマップは後処理でかけるので、レンダラーでは何もしない
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  scene.fog = null;
  const toECEF = worldToECEF(o.origin);
  const toWorld = new THREE.Matrix3().setFromMatrix4(toECEF).transpose();
  const sunECEF = getSunDirectionECEF(o.date, new THREE.Vector3());
  const sunDir = sunECEF.clone().applyMatrix3(toWorld).normalize();

  const skyMaterial = new SkyMaterial({ moon: false });
  skyMaterial.sunDirection.copy(sunECEF);
  skyMaterial.uniforms.worldToECEFMatrix.value.copy(toECEF);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const sun = new SunDirectionalLight({ distance: 4000 });
  sun.sunDirection.copy(sunECEF);
  sun.worldToECEFMatrix.copy(toECEF);
  sun.intensity = SKY_GAIN;
  setupShadow(sun, o);
  scene.add(sun, sun.target);

  const aerial = new AerialPerspectiveEffect(camera, { sunDirection: sunECEF });
  aerial.uniforms.get('worldToECEFMatrix')!.value.copy(toECEF);

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
  ao.configuration.aoRadius = 6;
  ao.configuration.distanceFalloff = 1;
  ao.configuration.intensity = 3;
  ao.configuration.halfRes = o.halfResAO;
  ao.configuration.gammaCorrection = false;
  ao.setQualityMode(o.halfResAO ? 'Low' : 'Medium');
  composer.addPass(ao);
  composer.addPass(
    new EffectPass(
      camera,
      aerial,
      new BloomEffect({ intensity: 0.5, luminanceThreshold: 0.9, luminanceSmoothing: 0.3, mipmapBlur: true }),
      new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    ),
  );
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

  // 大気の表（透過率・散乱・放射照度）を GPU で一度だけ作り、空・太陽・空気遠近で使う
  const ready = new PrecomputedTexturesGenerator(renderer).update().then((textures) => {
    Object.assign(skyMaterial, textures);
    Object.assign(aerial, textures);
    sun.transmittanceTexture = textures.transmittanceTexture;
    sun.update();
    // 空を映して、建物や機体の環境光・映り込みにする
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial);
    envSky.frustumCulled = false;
    envScene.add(envSky);
    const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(1, 10, cubeRT);
    cubeCam.position.set(0, 50, 0);
    cubeCam.update(renderer, envScene);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromCubemap(cubeRT.texture).texture;
    scene.environmentIntensity = 1;
    cubeRT.dispose();
  });

  return {
    sun,
    sunDir,
    ready,
    update(focus, half) {
      fitShadow(sun, focus, half);
      sun.update();
    },
    render: () => composer.render(),
    setSize(w, h) {
      renderer.setSize(w, h);
      composer.setSize(w, h);
    },
  };
}
