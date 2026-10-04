-- 방문자 통계 (Cloudflare D1: yongs-portfolio-stats)
-- 하루(한국 시간) × 기기 한 줄. 같은 기기가 하루에 여러 번 열면 views만 늘어난다.
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,          -- YYYY-MM-DD (KST)
  vid TEXT NOT NULL,          -- 기기마다 무작위로 만든 익명 ID
  first_at INTEGER NOT NULL,  -- 그날 첫 방문 시각(ms)
  last_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 1,
  is_new INTEGER NOT NULL DEFAULT 0, -- 처음 온 기기
  ref TEXT,                   -- 유입 경로(사이트 주소나 ?ref= 값)
  country TEXT,
  device TEXT,                -- m(휴대폰) / d(PC)
  iph TEXT,                   -- IP를 비밀값과 날짜로 섞은 해시(원래 IP는 저장 안 함)
  PRIMARY KEY (day, vid)
);
CREATE INDEX IF NOT EXISTS visits_vid ON visits (vid);
