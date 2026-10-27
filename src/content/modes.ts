import type { ModeDef } from './types';

export const MODES: ModeDef[] = [
  {
    id: 'tour',
    name: '筑波大一周ツアー',
    emoji: '🎓',
    description: 'キャンパスの名所に浮かぶリングを順番にくぐって、最後に着陸する。',
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
    id: 'free',
    name: 'フリー飛行',
    emoji: '🕊️',
    description: 'リングなし。好きなところを好きなだけ飛んで、どこかに着陸する。',
    timeLimit: 0,
    wind: 1,
    checkpoints: [],
  },
  {
    id: 'gust',
    name: '春一番チャレンジ',
    emoji: '🌬️',
    description: '強い風の中でキャンパス中央をめぐる短いコース。',
    timeLimit: 240,
    wind: 9,
    checkpoints: [
      { name: '中央図書館', x: -59, z: -347, alt: 60 },
      { name: '大学本部棟', x: 179, z: -608, alt: 70 },
      { name: '中央体育館', x: 172, z: 405, alt: 60 },
      { name: '大学会館', x: -8, z: 61, alt: 60 },
    ],
  },
];
