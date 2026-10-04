-- 이미 만든 DB에 한 번만: npx wrangler d1 execute yongs-portfolio-stats --remote --file stats/migrate-2.sql
ALTER TABLE visits ADD COLUMN used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visits ADD COLUMN lang TEXT;
CREATE TABLE IF NOT EXISTS errors (day TEXT NOT NULL, msg TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, last_at INTEGER NOT NULL, PRIMARY KEY (day, msg));
CREATE TABLE IF NOT EXISTS auth_fail (day TEXT NOT NULL, iph TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, last_at INTEGER NOT NULL, PRIMARY KEY (day, iph));
CREATE INDEX IF NOT EXISTS visits_iph ON visits (day, iph);
