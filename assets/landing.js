// 소개 페이지 방문 집계(익명) — 대시보드와 같은 기기 ID를 쓴다. 관리자 페이지에서만 조회
// p = 페이지 이름(주소 첫 단계 · /daily/날짜 는 daily) → 관리자 페이지 '소개·검색 페이지 조회'
(() => {
  try {
    if (location.hostname !== 'my-fire-portfolio.pages.dev' || localStorage.getItem('cw.noCount') === 'true') return; // 운영 주소만 집계
    let vid = localStorage.getItem('cw.vid'), isNew = 0;
    if (!/^[a-z0-9]{16,40}$/.test(vid || '')) {
      vid = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
      localStorage.setItem('cw.vid', vid); isNew = 1;
    }
    const qs = new URLSearchParams(location.search);
    let ref = qs.get('ref') || qs.get('utm_source') || '';
    if (!ref && document.referrer) { try { const h = new URL(document.referrer).hostname; if (h !== location.hostname) ref = h; } catch {} }
    const page = (location.pathname.split('/')[1] || 'about').replace(/\.html$/, '').toLowerCase();
    if (!ref) ref = 'page-' + page;
    const dev = matchMedia('(pointer: coarse)').matches ? 'm' : 'd';
    fetch(`/api/hit?v=${vid}&n=${isNew}&d=${dev}&r=${encodeURIComponent(ref.slice(0, 80))}&p=${encodeURIComponent(page.slice(0, 40))}`, { cache: 'no-store', keepalive: true }).catch(() => {});
  } catch {}
})();
