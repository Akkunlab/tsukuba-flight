// 光と空気の表現。描画の重さに合わせて 3 段階に分ける。
// 高：物理ベースの大気・立体の雲・遠くまでの影（カスケード）・AO・ブルーム
// 中：物理ベースの大気・自機のまわりの影・ブルーム
// 低：従来の空と霧だけ
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import * as CSMShaderModule from 'three/examples/jsm/csm/CSMShader.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, type Effect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { AerialPerspectiveEffect, AtmosphereParameters, PrecomputedTexturesGenerator, SkyMaterial, SunDirectionalLight, getSunDirectionECEF } from '@takram/three-atmosphere';
import { CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, CLOUD_SHAPE_TEXTURE_SIZE, CloudsEffect } from '@takram/three-clouds';
import { DEFAULT_STBN_URL, DataTextureLoader, Ellipsoid, Geodetic, STBNLoader, parseUint8Array, radians } from '@takram/three-geospatial';

// @types/three では CSMShader が型としてしか書かれていないので、値として取り出す
const CSMShader = (CSMShaderModule as unknown as { CSMShader: { lights_fragment_begin: string; lights_pars_begin: string } }).CSMShader;

export type LookLevel = 'basic' | 'atmosphere' | 'full';

export interface LookOptions {
  level: LookLevel;
  shadowMap: number;
  /** full のときのカスケードの段数と、影を落とす最遠距離 [m] */
  cascades: number;
  shadowFar: number;
  origin: { lat: number; lon: number; height: number };
  date: Date;
}

export interface Look {
  sunDir: THREE.Vector3;
  ready: Promise<void>;
  /** 立体の雲を描くか（描くなら板の雲は要らない） */
  volumetricClouds: boolean;
  update(focus: THREE.Vector3, shadowHalf: number): void;
  render(): void;
  setSize(w: number, h: number): void;
}

function worldToECEF(origin: LookOptions['origin']): THREE.Matrix4 {
  const pos = new Geodetic(radians(origin.lon), radians(origin.lat), origin.height).toECEF();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  Ellipsoid.WGS84.getEastNorthUpVectors(pos, east, north, up);
  // ワールドは x = 東、y = 上、z = 南
  return new THREE.Matrix4().makeBasis(east, up, north.negate()).setPosition(pos);
}

function setupShadow(light: THREE.DirectionalLight, mapSize: number) {
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.camera.near = 10;
  light.shadow.camera.far = 8000;
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.6;
}

function fitShadow(light: THREE.DirectionalLight, focus: THREE.Vector3, half: number, dir: THREE.Vector3) {
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
  light.position.copy(light.target.position).addScaledVector(dir, 3000);
}

export function createLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: LookOptions): Look {
  // 影は 2 フレームに 1 回だけ描き直す
  let frame = 0;
  renderer.shadowMap.autoUpdate = false;
  const tickShadow = () => {
    renderer.shadowMap.needsUpdate = frame++ % 2 === 0;
  };
  const look = o.level === 'basic' ? basicLook(renderer, scene, camera) : atmosphereLook(renderer, scene, camera, o);
  const render = look.render;
  look.render = () => {
    tickShadow();
    render();
  };
  return look;
}

function basicLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): Look {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.shadowMap.enabled = false;
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
  scene.add(sun, sun.target);
  return {
    sunDir,
    ready: Promise.resolve(),
    volumetricClouds: false,
    update(focus) {
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, 3000);
    },
    render: () => renderer.render(scene, camera),
    setSize: (w, h) => renderer.setSize(w, h),
  };
}

// 大気の明るさは「太陽を 1」とした相対値で小さいので、空を 10 倍、太陽の光を 10 倍にして露出 1 で見る。
// 太陽の円盤は元のまま（10 倍すると半精度の上限を超えて画面が黒く崩れる）
const SKY_GAIN = 10;
let brightened = false;

function atmosphereLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: LookOptions): Look {
  const full = o.level === 'full';
  if (!brightened) {
    AtmosphereParameters.DEFAULT.skyRadianceToRelativeLuminance.multiplyScalar(SKY_GAIN);
    brightened = true;
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
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

  // 太陽の色は大気から計算する。中は 1 枚の影、高はカスケードの光に影を任せる
  const sun = new SunDirectionalLight({ distance: 4000 });
  sun.sunDirection.copy(sunECEF);
  sun.worldToECEFMatrix.copy(toECEF);
  sun.intensity = SKY_GAIN;
  const csm = full
    ? new CSM({
        camera,
        parent: scene,
        cascades: o.cascades,
        maxFar: o.shadowFar,
        mode: 'practical',
        shadowMapSize: o.shadowMap,
        shadowBias: -0.0003,
        lightDirection: sunDir.clone().negate(),
        lightIntensity: SKY_GAIN,
        lightMargin: 600,
      })
    : null;
  if (csm) {
    csm.fade = true;
    // 遠い段ほど 1 画素が広いので、平らな地面が自分の影で黒ずまないよう押し出しを大きくする
    csm.lights.forEach((l, i) => {
      l.shadow.normalBias = 0.5 * (i + 1) ** 2;
      l.shadow.camera.far = o.shadowFar * 2;
    });
    THREE.ShaderChunk.lights_fragment_begin = CSMShader.lights_fragment_begin;
    THREE.ShaderChunk.lights_pars_begin = CSMShader.lights_pars_begin;
  } else {
    setupShadow(sun, o.shadowMap);
    scene.add(sun, sun.target);
  }
  const prepared = new WeakSet<THREE.Material>();
  // カスケードを受けない材質はカスケードの光を全部足して明るくなりすぎるので、光の当たる材質は全部準備する
  const prepare = () => {
    if (!csm) return;
    scene.traverse((obj) => {
      const m = (obj as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (prepared.has(mat) || !(mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshLambertMaterial || mat instanceof THREE.MeshPhongMaterial)) continue;
        prepared.add(mat);
        const prev = mat.onBeforeCompile;
        const prevKey = mat.customProgramCacheKey();
        csm.setupMaterial(mat);
        const hook = mat.onBeforeCompile;
        mat.onBeforeCompile = (sh, r) => {
          prev.call(mat, sh, r);
          hook.call(mat, sh, r);
        };
        mat.customProgramCacheKey = () => `${prevKey}|csm`;
        mat.needsUpdate = true;
      }
    });
  };

  const aerial = new AerialPerspectiveEffect(camera, { sunDirection: sunECEF });
  aerial.uniforms.get('worldToECEFMatrix')!.value.copy(toECEF);
  const clouds = full ? makeClouds(camera, sunECEF, toECEF, aerial) : null;

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  if (full) {
    const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
    ao.configuration.aoRadius = 6;
    ao.configuration.distanceFalloff = 1;
    ao.configuration.intensity = 3;
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode('Low');
    ao.configuration.halfRes = true;
    composer.addPass(ao);
  }
  const effects: Effect[] = [];
  if (clouds) effects.push(clouds);
  effects.push(aerial, new BloomEffect({ intensity: 0.5, luminanceThreshold: 0.9, luminanceSmoothing: 0.3, mipmapBlur: true }), new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
  composer.addPass(new EffectPass(camera, ...effects));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: full ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));

  const ready = new PrecomputedTexturesGenerator(renderer).update().then((textures) => {
    Object.assign(skyMaterial, textures);
    Object.assign(aerial, textures);
    if (clouds) Object.assign(clouds, textures);
    sun.transmittanceTexture = textures.transmittanceTexture;
    sun.update();
    // 空を映して、建物や機体の環境光・映り込みにする
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial);
    envSky.frustumCulled = false;
    envScene.add(envSky);
    const cubeRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(1, 10, cubeRT);
    cubeCam.position.set(0, 50, 0);
    cubeCam.update(renderer, envScene);
    scene.environment = new THREE.PMREMGenerator(renderer).fromCubemap(cubeRT.texture).texture;
    scene.environmentIntensity = 1;
    cubeRT.dispose();
  });

  return {
    sunDir,
    ready,
    volumetricClouds: !!clouds,
    update(focus, half) {
      sun.target.position.copy(csm ? camera.position : focus);
      sun.update();
      if (csm) {
        for (const l of csm.lights) l.color.copy(sun.color);
        csm.update();
      } else {
        fitShadow(sun, focus, half, sunDir);
      }
    },
    render() {
      prepare();
      composer.render();
    },
    setSize(w, h) {
      renderer.setSize(w, h);
      composer.setSize(w, h);
      csm?.updateFrustums();
    },
  };
}

function makeClouds(camera: THREE.Camera, sunECEF: THREE.Vector3, toECEF: THREE.Matrix4, aerial: AerialPerspectiveEffect): CloudsEffect {
  const clouds = new CloudsEffect(camera);
  clouds.qualityPreset = 'medium';
  clouds.coverage = 0.32;
  clouds.sunDirection.copy(sunECEF);
  clouds.worldToECEFMatrix.copy(toECEF);
  const tex2d = (url: string) =>
    new THREE.TextureLoader().load(url, (t) => {
      t.minFilter = THREE.LinearMipMapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
    });
  const tex3d = (url: string, size: number) =>
    new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, {
      width: size,
      height: size,
      depth: size,
      format: THREE.RedFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      wrapR: THREE.RepeatWrapping,
      colorSpace: THREE.NoColorSpace,
    }).load(url);
  clouds.localWeatherTexture = tex2d('/clouds/local_weather.png');
  clouds.turbulenceTexture = tex2d('/clouds/turbulence.png');
  clouds.shapeTexture = tex3d('/clouds/shape.bin', CLOUD_SHAPE_TEXTURE_SIZE);
  clouds.shapeDetailTexture = tex3d('/clouds/shape_detail.bin', CLOUD_SHAPE_DETAIL_TEXTURE_SIZE);
  clouds.stbnTexture = new STBNLoader().load(DEFAULT_STBN_URL);
  // 雲の影と光の筋を、空気遠近の計算に渡す
  const link = () => {
    aerial.overlay = clouds.atmosphereOverlay;
    aerial.shadow = clouds.atmosphereShadow;
    aerial.shadowLength = clouds.atmosphereShadowLength;
  };
  clouds.events.addEventListener('change', link);
  link();
  return clouds;
}
