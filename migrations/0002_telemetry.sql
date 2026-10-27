-- 細かいプレイ記録（すべて数値の JSON 配列）
ALTER TABLE flights ADD COLUMN track TEXT;   -- 0.5 秒ごとの位置・向き・スロットル・速さ・操作
ALTER TABLE flights ADD COLUMN music TEXT;   -- 0.5 秒ごとの搭乗者の音楽の状態
ALTER TABLE flights ADD COLUMN events TEXT;  -- 出来事（離陸・リング・風船など）の時刻
ALTER TABLE flights ADD COLUMN extra TEXT;   -- 軌跡の設定・描画の重さ・カメラ切り替え回数など
