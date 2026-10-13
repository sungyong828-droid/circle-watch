-- 실적 예측 투표(/api/vote) · 다른 기기로 옮기기(/api/move)
-- npx wrangler d1 execute yongs-portfolio-stats --remote --file stats/migrate-5.sql

-- 실적 발표 전 '예상보다 좋을까?' 익명 투표. 기기마다 한 표(바꾸면 덮어씀). k = 'CRCL:2026-09-30'(종목:분기 말일)
CREATE TABLE IF NOT EXISTS votes (
  k TEXT NOT NULL,
  vid TEXT NOT NULL,           -- 기기마다 무작위로 만든 ID(개인 정보 아님)
  v INTEGER NOT NULL,          -- 1 = 기대 이상, 0 = 기대 이하
  at INTEGER NOT NULL,
  iph TEXT,                    -- IP 해시(한 IP 도배 막기, 원래 IP는 저장 안 함)
  PRIMARY KEY (k, vid)
);
CREATE INDEX IF NOT EXISTS votes_iph ON votes (k, iph);

-- 기기 옮기기: 보낸 기기에서 암호화한 내용만 10분 동안 보관(서버는 코드를 몰라 내용을 볼 수 없음). 받으면 바로 지운다
CREATE TABLE IF NOT EXISTS moves (
  id TEXT PRIMARY KEY,         -- 코드의 해시
  d TEXT NOT NULL,             -- 암호문(base64)
  exp INTEGER NOT NULL,
  iph TEXT
);
CREATE INDEX IF NOT EXISTS moves_exp ON moves (exp);
