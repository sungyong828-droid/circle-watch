-- 소개·검색용 페이지(/stablecoin · /calendar · /money-flow · /dividend-etf · /daily …) 페이지별 조회수
-- npx wrangler d1 execute yongs-portfolio-stats --remote --file stats/migrate-6.sql
-- 하루(한국 시간) × 페이지 × 기기 한 줄. 같은 기기가 같은 페이지를 또 열면 views만 늘어난다.
-- 그날 visits 기록이 있는 기기만 넣는다(유입 경로·신규 여부는 visits 쪽을 본다)
CREATE TABLE IF NOT EXISTS pageviews (
  day TEXT NOT NULL,           -- YYYY-MM-DD (KST)
  page TEXT NOT NULL,          -- 주소 첫 단계(stablecoin, daily, about …) · /daily/날짜 는 daily
  vid TEXT NOT NULL,           -- 기기마다 무작위로 만든 익명 ID
  views INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, page, vid)
);
CREATE INDEX IF NOT EXISTS pageviews_page ON pageviews (page, day);
