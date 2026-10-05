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
  used INTEGER NOT NULL DEFAULT 0, -- 연 화면·쓴 기능 비트
  lang TEXT,                  -- ko / en
  PRIMARY KEY (day, vid)
);
CREATE INDEX IF NOT EXISTS visits_vid ON visits (vid);
CREATE INDEX IF NOT EXISTS visits_iph ON visits (day, iph);

-- 통계에서 뺄 기기(관리자 기기 등). 관리자 페이지의 '이 기기 방문은 집계하지 않기'로 켜고 끈다.
CREATE TABLE IF NOT EXISTS excluded (
  vid TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

-- 2026-10-04 추가 (이미 만든 DB에는 stats/migrate-2.sql 로 한 번 적용)
-- visits.used: 그날 그 기기가 연 화면·쓴 기능 비트(값·종목은 보내지 않음) / visits.lang: ko·en
-- errors: 화면 오류(같은 메시지는 하루 한 줄로 합침) / auth_fail: 관리자 키 틀린 횟수(IP 해시 기준, 잠금용)
CREATE TABLE IF NOT EXISTS errors (
  day TEXT NOT NULL,
  msg TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 1,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (day, msg)
);
CREATE TABLE IF NOT EXISTS auth_fail (
  day TEXT NOT NULL,
  iph TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 1,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (day, iph)
);
-- 인기 종목 순위(관심 종목에 새로 추가한 티커 이름만 · 기기에서 빼면 지움 · day = 마지막으로 확인한 날)
CREATE TABLE IF NOT EXISTS picks (vid TEXT NOT NULL, sym TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (vid, sym));
CREATE INDEX IF NOT EXISTS picks_day ON picks (day, sym);

-- 고객 문의·개선 제안(/feedback) — 자세한 설명은 stats/migrate-4.sql
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,          -- idea / bug / question / etc
  msg TEXT NOT NULL,
  contact TEXT,                -- 남긴 사람이 원할 때만(이메일·블로그 아이디 등)
  page TEXT,                   -- 어느 화면에서 왔는지
  lang TEXT,
  vid TEXT,
  iph TEXT,                    -- IP 해시(도배 막기용, 원래 IP는 저장 안 함)
  hash TEXT,                   -- 같은 글 반복 막기
  status TEXT NOT NULL DEFAULT 'new'  -- new / done / hidden
);
CREATE INDEX IF NOT EXISTS feedback_day ON feedback (day, iph);
CREATE INDEX IF NOT EXISTS feedback_hash ON feedback (hash);
