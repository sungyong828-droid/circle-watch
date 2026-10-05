-- 고객 문의·개선 제안 (/feedback). 관리자 페이지에서만 본다.
-- npx wrangler d1 execute yongs-portfolio-stats --remote --file stats/migrate-4.sql
CREATE TABLE IF NOT EXISTS feedback (
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
