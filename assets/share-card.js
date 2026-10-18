// 결과 공유 카드(퇴사까지 · 배당금 · 성과급) — 버튼을 누를 때만 받는 모듈(앱 첫 로딩을 가볍게)
// 1080×1350 그림을 캔버스로 그려 미리보기 → 이미지 저장 · 공유하기(휴대폰 공유 시트). 기본은 '금액 가리기'(퍼센트만 보임).
const W = 1080, H = 1350;
const C = { bg0: '#0d1117', bg1: '#161c26', ink: '#f2f4f7', ink2: '#c3cad6', muted: '#8a94a6', line: 'rgba(255,255,255,0.08)', orange: '#f2994a', green: '#3fbf7f' };
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const MASK = '••••••';

let sheet = null;

function loadImg(src) {
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}
function fit(g, text, max, size, weight = 800) {
  let s = size;
  do { g.font = `${weight} ${s}px ${FONT}`; s -= 4; } while (g.measureText(text).width > max && s > 28);
  return g.font;
}
function round(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

async function draw(d, hide, icon) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const accent = d.kind === 'fire' ? C.orange : C.green;
  // 배경
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, C.bg1); bg.addColorStop(1, C.bg0);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W - 120, 140, 0, W - 120, 140, 620); glow.addColorStop(0, accent + '33'); glow.addColorStop(1, accent + '00');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const X = 88;
  // 머리: 로고 · 이름
  if (icon) { g.save(); round(g, X, 88, 92, 92, 22); g.clip(); g.drawImage(icon, X, 88, 92, 92); g.restore(); }
  g.fillStyle = C.ink; g.font = `800 46px ${FONT}`; g.textBaseline = 'middle';
  g.fillText('Fire Portfolio', X + (icon ? 116 : 0), 134);
  // 제목
  g.textBaseline = 'alphabetic';
  g.font = `800 70px ${FONT}`; g.fillStyle = C.ink;
  g.fillText(String(d.title).replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B50\uFE0F]/gu, '').trim(), X, 330); // 이모지 없이(화면은 아이콘)
  // 큰 숫자
  const hero = hide && d.hero.money && d.hero.alt ? d.hero.alt : d.hero;
  g.font = `600 38px ${FONT}`; g.fillStyle = C.muted;
  g.fillText(hero.label, X, 430);
  const hv = hide && hero.money ? MASK : hero.value;
  g.font = fit(g, hv, W - X * 2, 124); g.fillStyle = accent;
  g.fillText(hv, X, 570);
  // 큰 숫자 아래 보조 줄(예: 달러 금액 아래 '원화로 약 ₩2,087만') — 통화가 섞여 보이지 않게 따로 한 줄
  const sub = !(hide && hero.money) && hero.sub ? hero.sub : '';
  if (sub) { g.font = `600 40px ${FONT}`; g.fillStyle = C.ink2; g.fillText(sub, X, 652); }
  const dy = sub ? 64 : 0;
  // 진행 막대
  if (d.bar != null && isFinite(d.bar)) {
    const y = 625 + dy, w = W - X * 2;
    g.fillStyle = 'rgba(255,255,255,0.08)'; round(g, X, y, w, 30, 15); g.fill();
    g.fillStyle = accent; round(g, X, y, Math.max(30, w * Math.min(1, Math.max(0, d.bar))), 30, 15); g.fill();
  }
  // 세부 줄
  let y = 760 + dy;
  for (const L of d.lines.slice(0, 4)) {
    g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.moveTo(X, y - 62); g.lineTo(W - X, y - 62); g.stroke();
    g.font = `600 36px ${FONT}`; g.fillStyle = C.muted; g.textAlign = 'left'; g.fillText(L.label, X, y);
    const v = hide && L.money ? MASK : L.value;
    g.font = fit(g, v, W - X * 2 - g.measureText(L.label).width - 40, 46); g.fillStyle = C.ink; g.textAlign = 'right'; g.fillText(v, W - X, y);
    g.textAlign = 'left';
    y += sub ? 96 : 108; // 보조 줄이 있으면 줄 간격을 조금 줄여 바닥 주소와 띄운다
  }
  // 바닥: 사이트 주소(홍보)
  g.fillStyle = accent; g.font = `800 44px ${FONT}`; g.fillText('my-fire-portfolio.pages.dev', X, H - 128);
  g.fillStyle = C.muted; g.font = `500 32px ${FONT}`; g.fillText(d.tag, X, H - 78);
  return cv;
}

function close() { sheet?.remove(); sheet = null; document.removeEventListener('keydown', onKey); }
function onKey(e) { if (e.key === 'Escape') close(); }

export async function openShareCard(d, ui) {
  close();
  try { await document.fonts?.load(`800 70px ${FONT}`); } catch {}
  const icon = await loadImg('assets/app-icon.png?v=2');
  let hide = true, cv = null;
  sheet = document.createElement('div');
  sheet.className = 'sc-sheet';
  sheet.innerHTML = `<div class="sc-panel" role="dialog" aria-modal="true" aria-label="${ui.title}">
      <div class="sc-head"><b>${ui.title}</b><button type="button" class="sc-x" aria-label="${ui.close}">×</button></div>
      <div class="sc-prev"><img alt="${ui.title}" width="1080" height="1350"></div>
      <label class="sc-hide"><input type="checkbox" checked> <span>${ui.hide}</span></label>
      <div class="sc-btns"><button type="button" class="sc-save">${ui.save}</button><button type="button" class="sc-share">${ui.share}</button></div>
    </div>`;
  document.body.appendChild(sheet);
  document.addEventListener('keydown', onKey);
  const img = sheet.querySelector('img');
  const paint = async () => { cv = await draw(d, hide, icon); img.src = cv.toDataURL('image/png'); };
  await paint();
  sheet.addEventListener('click', async (e) => {
    if (e.target === sheet || e.target.closest('.sc-x')) { close(); return; }
    if (e.target.closest('.sc-save')) {
      const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `fire-portfolio-${d.kind}.png`; document.body.appendChild(a); a.click(); a.remove();
      ui.done?.(ui.saved); return;
    }
    if (e.target.closest('.sc-share')) {
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
      const file = blob ? new File([blob], `fire-portfolio-${d.kind}.png`, { type: 'image/png' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], text: ui.shareText }); } catch {}
      } else {
        const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `fire-portfolio-${d.kind}.png`; document.body.appendChild(a); a.click(); a.remove();
        ui.done?.(ui.noShare);
      }
    }
  });
  sheet.querySelector('.sc-hide input').addEventListener('change', async (e) => { hide = e.target.checked; await paint(); });
}
