-- 인기 종목 순위: 기기마다 관심 종목에 '새로 추가한' 티커 이름만(수량·금액 없음). 빼면 지운다.
-- npx wrangler d1 execute yongs-portfolio-stats --remote --file stats/migrate-3.sql
CREATE TABLE IF NOT EXISTS picks (vid TEXT NOT NULL, sym TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (vid, sym));
CREATE INDEX IF NOT EXISTS picks_day ON picks (day, sym);
