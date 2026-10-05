// 문의·개선 제안 보내기 (/feedback) — 서버(/api/feedback)가 도배를 막고, 관리자 페이지에서만 볼 수 있다.
(() => {
  'use strict';
  const form = document.getElementById('fb-form');
  if (!form) return;
  const shownAt = Date.now();
  const $ = (id) => document.getElementById(id);
  // 영어: 대시보드에서 영어로 보던 사람이거나 ?lang=en
  let en = false;
  try { en = new URLSearchParams(location.search).get('lang') === 'en' || localStorage.getItem('cw.lang') === 'en'; } catch {}
  if (en) {
    document.documentElement.lang = 'en';
    for (const el of document.querySelectorAll('[data-en]')) el.innerHTML = el.dataset.en;
    for (const el of document.querySelectorAll('[data-en-ph]')) el.placeholder = el.dataset.enPh;
    document.title = 'Feedback | Fire Portfolio';
  }
  const T = (ko, e) => (en ? e : ko);
  const msg = $('fb-msg'), n = $('fb-n'), st = $('fb-status'), btn = $('fb-send');
  msg.addEventListener('input', () => { n.textContent = msg.value.length; });
  const setStatus = (text, kind) => { st.textContent = text; st.className = 'fb-status' + (kind ? ' ' + kind : ''); };
  let busy = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const text = msg.value.trim();
    if (text.length < 5) { setStatus(T('내용을 5자 이상 적어 주세요.', 'Please write at least 5 characters.'), 'err'); msg.focus(); return; }
    busy = true; btn.disabled = true; setStatus(T('보내는 중…', 'Sending…'));
    let vid = null;
    try { vid = localStorage.getItem('cw.vid'); } catch {}
    const from = new URLSearchParams(location.search).get('from') || '';
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ kind: form.elements.kind.value, msg: text, contact: $('fb-contact').value.trim(), page: from, lang: en ? 'en' : 'ko', vid, hp: form.elements.website.value, t: Date.now() - shownAt }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        form.reset(); n.textContent = '0';
        setStatus(T('✓ 보냈어요. 고마워요! 보내 주신 내용은 꼭 읽어 볼게요.', '✓ Sent. Thank you — every message gets read!'), 'ok');
      } else {
        const enErr = { 409: 'We already received this message. Thank you!', 429: 'Too many messages right now — please try again later.', 413: 'Your message is too long.' }[r.status];
        setStatus(en ? enErr || 'Couldn’t send. Please check your message and try again.' : j.error || '보내지 못했어요. 잠시 후 다시 시도해 주세요.', 'err');
      }
    } catch {
      setStatus(T('연결이 끊겼어요. 잠시 후 다시 시도해 주세요.', 'Connection failed. Please try again later.'), 'err');
    }
    setTimeout(() => { busy = false; btn.disabled = false; }, 2500);
  });
})();
