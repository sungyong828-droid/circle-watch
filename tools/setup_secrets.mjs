// 폰 알림·데이터 멈춤 알림에 필요한 비밀값을 한 번에 넣는다(화면에 값을 출력하지 않음)
//   node tools/setup_secrets.mjs push    → 폰 알림 열쇠(VAPID_JWK)를 새로 만들어 Worker·Pages(실제·테스트)에 넣는다
//   node tools/setup_secrets.mjs alert   → .env.local 의 DISCORD_WEBHOOK_URL 을 Worker의 ALERT_WEBHOOK 으로 넣는다(데이터 멈춤 알림)
// 열쇠를 다시 만들면 이미 켠 폰 알림은 모두 꺼지므로(다시 켜야 함) push 는 처음 한 번만 하면 된다.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const put = (args, cwd, value) => {
  // 윈도에서는 npx가 .cmd라 셸로 실행한다(인자는 모두 고정 문자열)
  const r = process.platform === 'win32'
    ? spawnSync(['npx', 'wrangler', ...args].join(' '), { cwd, input: value, stdio: ['pipe', 'inherit', 'inherit'], shell: true })
    : spawnSync('npx', ['wrangler', ...args], { cwd, input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) { console.error('실패:', args.join(' ')); process.exit(1); }
};
const what = process.argv[2];
if (what === 'push') {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const jwk = JSON.stringify({ kty, crv, x, y, d });
  put(['secret', 'put', 'VAPID_JWK'], join(ROOT, 'worker'), jwk);
  put(['pages', 'secret', 'put', 'VAPID_JWK', '--project-name', 'my-fire-portfolio'], ROOT, jwk);
  put(['pages', 'secret', 'put', 'VAPID_JWK', '--project-name', 'my-fire-portfolio', '--env', 'preview'], ROOT, jwk);
  console.log('✓ 폰 알림 열쇠를 넣었어요(Worker · 실제 사이트 · 테스트 사이트)');
} else if (what === 'alert') {
  let url = '';
  try { url = (readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^DISCORD_WEBHOOK_URL=(.+)$/m) || [])[1]?.trim() || ''; } catch {}
  if (!url) { console.error('.env.local 에 DISCORD_WEBHOOK_URL 이 없어요'); process.exit(1); }
  put(['secret', 'put', 'ALERT_WEBHOOK'], join(ROOT, 'worker'), url);
  console.log('✓ 데이터 멈춤 알림을 디스코드로 보내도록 넣었어요');
} else {
  console.log('사용: node tools/setup_secrets.mjs push | alert');
}
