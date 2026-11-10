import type { ModeDef } from './types';

export const MODES: ModeDef[] = [
  {
    id: 'tour',
    name: '筑波大一周ツアー',
    icon: 'tour',
    description: '名所に浮かぶ 7 つのリングを順にくぐり、春日で終わる。',
    objective: 'リングを順番にくぐって、着陸する',
    timeLimit: 0,
    wind: 2,
    checkpoints: [
      { name: '一の矢学生宿舎', x: -380, z: -1420, alt: 100 },
      { name: '中央図書館', x: -59, z: -347, alt: 90 },
      { name: '大学会館', x: -8, z: 61, alt: 70 },
      { name: 'T-Dome', x: 321, z: 192, alt: 60 },
      { name: '平砂学生宿舎', x: 200, z: 900, alt: 80 },
      { name: '附属病院', x: -83, z: 1436, alt: 110 },
      { name: '春日エリア', x: 400, z: 2200, alt: 80 },
    ],
  },
  {
    id: 'balloons',
    name: '風船割り',
    icon: 'target',
    description: 'キャンパスの上の赤い風船 15 個に体当たり。',
    objective: '4 分以内に、風船をできるだけ多く割る',
    timeLimit: 240,
    wind: 1.5,
    checkpoints: [],
    targets: { count: 15, radius: 9, x: 0, z: -300, spread: 1100, minAlt: 35, maxAlt: 140 },
  },
  {
    id: 'runway',
    name: '滑走路ゆうゆう周回',
    icon: 'wind',
    description: '滑走路のまわりに高めに並んだ 5 つのリングを、風のおだやかな空で一周する。',
    objective: 'リングを順番にくぐって、滑走路に戻る',
    timeLimit: 0,
    wind: 0.5,
    checkpoints: [
      { name: '滑走路の北', x: 50, z: -1700, alt: 120 },
      { name: '一の矢の上空', x: -380, z: -1420, alt: 130 },
      { name: '研究学園の南', x: -250, z: -900, alt: 120 },
      { name: '実験棟の上空', x: 200, z: -1000, alt: 135 },
      { name: '滑走路', x: 50, z: -1300, alt: 70 },
    ],
  },
];
