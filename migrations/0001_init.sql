-- プレイ記録。個人情報は持たない（player_id はブラウザで生成したランダム ID）
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  mode TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  fuel TEXT NOT NULL,
  passengers TEXT NOT NULL,      -- JSON 配列
  trail_color TEXT NOT NULL,
  outcome TEXT NOT NULL,         -- landed / crashed / fuel / out / quit
  cause TEXT,
  duration_s REAL NOT NULL,
  distance_m REAL NOT NULL,
  max_alt_m REAL NOT NULL,
  max_speed_ms REAL NOT NULL,
  checkpoints INTEGER NOT NULL,
  score INTEGER NOT NULL,
  device TEXT NOT NULL,
  end_x REAL, end_y REAL, end_z REAL,
  path TEXT                      -- JSON [[x,y,z],...]（1 秒ごと、間引き済み）
);
CREATE INDEX IF NOT EXISTS idx_flights_created ON flights(created_at);
CREATE INDEX IF NOT EXISTS idx_flights_player ON flights(player_id);

-- ユーザーが作った要素（今は本人にしか見えない）
CREATE TABLE IF NOT EXISTS elements (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- passenger など
  name TEXT NOT NULL,
  recipe TEXT NOT NULL           -- JSON
);
CREATE INDEX IF NOT EXISTS idx_elements_player ON elements(player_id);
