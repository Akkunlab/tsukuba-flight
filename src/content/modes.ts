import type { ModeDef } from './types';

export const MODES: ModeDef[] = [
  {
    id: 'tour',
    name: '筑波大一周ツアー',
    icon: 'tour',
    description: '名所に浮かぶ 8 つのリングを順にくぐる。',
    objective: 'リングを順番にくぐって、着陸する',
    timeLimit: 0,
    wind: 2,
    checkpoints: [
      { name: '一の矢学生宿舎', x: -380, z: -1420, alt: 70 },
      { name: '中央図書館', x: -59, z: -347, alt: 80 },
      { name: '大学会館', x: -8, z: 61, alt: 70 },
      { name: 'T-Dome', x: 321, z: 192, alt: 60 },
      { name: '平砂学生宿舎', x: 200, z: 900, alt: 80 },
      { name: '附属病院', x: -83, z: 1436, alt: 110 },
      { name: '春日エリア', x: 400, z: 2200, alt: 80 },
      { name: '地図と測量の科学館', x: -1474, z: 225, alt: 70 },
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
];
