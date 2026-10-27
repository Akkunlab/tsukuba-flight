// ゲームの「要素」の型。乗り物・燃料・搭乗者・モード・景色はすべてここの型に沿ったデータで増やせる。

export interface SoundRecipe {
  wave: 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';
  /** 基準の音の高さ [Hz] */
  base: number;
  /** 1 ステップ（8 分音符）ごとの音程。基準からの半音数。null は休符 */
  pattern: (number | null)[];
  /** テンポ [BPM]。1 ステップ = 8 分音符 */
  bpm: number;
  /** 1 ステップのうち音が鳴っている割合 (0..1)。1 なら切れ目なく伸ばす */
  gate: number;
  attack: number;
  release: number;
  filter: number;
  vibratoHz: number;
  /** ビブラートの深さ [半音] */
  vibratoDepth: number;
  voices: number;
  /** 声どうしのずれ [cent] */
  detune: number;
  /** 音程を滑らかにつなぐ時間 [秒] */
  glide: number;
  gain: number;
  /** 倍音の強さ（指定するとこの倍音構成の波形になる。クラリネットなら奇数倍音） */
  harmonics?: number[];
  /** 飛行状態で音を変える。altitude: 高度 100m ごとに上げる半音数 / speed: 速さでテンポを上げる係数 */
  follow?: { altitude?: number; speed?: number };
}

export type EngineKind = 'jet' | 'prop' | 'rotor' | 'multirotor' | 'rocket' | 'burner' | 'hiss' | 'whoosh' | 'pedal' | 'ufo' | 'none';

export type FlightModel = 'plane' | 'hover' | 'rocket' | 'balloon';

export interface VehicleDef {
  id: string;
  name: string;
  /** アイコン（ui/icons.ts の ICONS のキー） */
  icon: string;
  description: string;
  model: FlightModel;
  /** 見た目（render/vehicleMesh.ts のビルダー名） */
  shape: string;
  color: string;
  start: 'runway' | 'pad';
  /** 当たり判定の半径 [m] */
  radius: number;
  /** 最高速度 [m/s] */
  maxSpeed: number;
  /** 加速の強さ [m/s^2]（全開時） */
  accel: number;
  /** 旋回の速さ [rad/s] */
  turnRate: number;
  /** 上昇・下降の速さ [m/s]（hover / balloon） */
  climbRate: number;
  /** 離陸できる速さ [m/s]（plane）。これより遅いと失速する */
  takeoffSpeed: number;
  /** 全開で 1 秒あたりに使う燃料（タンク 100 に対して） */
  fuelUse: number;
  engine: EngineKind;
  enginePitch: number;
  /** 使える燃料（省略時はすべて） */
  fuels?: string[];
}

export interface FuelDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** タンク容量の倍率（大きいほど長く飛べる） */
  capacity: number;
  power: number;
  trailColor: string;
  tone: number;
}

export interface PassengerDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  sound: SoundRecipe;
  trailColor: string;
}

export interface CheckpointDef {
  name: string;
  x: number;
  z: number;
  /** 地面からの高さ [m] */
  alt: number;
}

/** 割って回る風船（的）。seed から位置を決める */
export interface TargetsDef {
  count: number;
  /** 当たり判定の半径 [m] */
  radius: number;
  /** 散らばる範囲の中心と半径 [m] */
  x: number;
  z: number;
  spread: number;
  /** 地面からの高さの範囲 [m] */
  minAlt: number;
  maxAlt: number;
}

export interface ModeDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** 目的（格納庫と飛行中の画面に出す。1 文） */
  objective: string;
  /** 順番にくぐるリング。空ならフリー飛行 */
  checkpoints: CheckpointDef[];
  targets?: TargetsDef;
  /** 制限時間 [秒]。0 なら無制限 */
  timeLimit: number;
  /** 風の強さ [m/s] */
  wind: number;
}

/** 景色の要素。render 側で world/scenery.ts のビルダー（kind）が 3D にする */
export interface SceneryDef {
  id: string;
  name: string;
  kind: string;
  params: Record<string, number | string | boolean>;
}

export interface TrailSetting {
  /** auto: 燃料と搭乗者の音から色を決める / custom: 自分で選んだ色 */
  mode: 'auto' | 'custom';
  color: string;
  style: 'ribbon' | 'rainbow' | 'dots';
}

/** ユーザーが作った要素（今は搭乗者のみ。本人だけが使える） */
export interface CustomPassenger extends PassengerDef {
  custom: true;
}

export interface EvolutionEntry {
  generation: number;
  date: string;
  title: string;
  summary: string;
}
