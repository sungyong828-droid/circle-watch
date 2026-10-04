// 관리자 페이지: 방문자 통계 (/api/admin/stats, 관리자 키가 있어야 응답)
// 관리자 키는 이 기기의 브라우저에만 저장한다.
(() => {
  'use strict';
  const KEY = 'cw.adminKey';
  const main = document.getElementById('adm-main');
  const myVid = () => {
    let v = store.get('cw.vid');
    if (!/^[a-z0-9]{16,40}$/.test(v || '')) { v = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24); store.set('cw.vid', v); }
    return v;
  };
  // 새로고침 버튼: 대시보드와 같은 표시(돌기 → ✓ 또는 !)
  const btn = document.getElementById('refresh');
  let btnTimer = null;
  const btnState = (s) => { clearTimeout(btnTimer); btn.classList.remove('loading', 'done', 'fail'); if (s) btn.classList.add(s); btn.disabled = s === 'loading'; if (s === 'done' || s === 'fail') btnTimer = setTimeout(() => btnState(null), 1600); };
  const act = document.getElementById('adm-act');
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => new Intl.NumberFormat('ko-KR').format(n || 0);
  let regionName = (c) => c;
  try { const dn = new Intl.DisplayNames(['ko'], { type: 'region' }); regionName = (c) => (c && c !== '?' ? dn.of(c) || c : '알 수 없음'); } catch {}
  const md = (day) => { const [, m, d] = day.split('-'); return `${+m}/${+d}`; };
  const wd = (day) => '일월화수목금토'[new Date(day + 'T12:00:00+09:00').getUTCDay()];

  function loginForm(msg = '') {
    act.hidden = true;
    main.innerHTML = `<section class="card adm-login">
        <h2>관리자 확인</h2>
        <p class="adm-dim">Cloudflare에 설정한 관리자 키(ADMIN_KEY)를 입력하세요. 이 기기의 브라우저에만 저장돼요.</p>
        <form id="adm-form" autocomplete="off">
          <input id="adm-key" type="password" autocomplete="current-password" placeholder="관리자 키" aria-label="관리자 키" required>
          <button type="submit" class="btn-primary">확인</button>
        </form>
        ${msg ? `<p class="adm-err">${esc(msg)}</p>` : ''}
      </section>`;
    document.getElementById('adm-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const k = document.getElementById('adm-key').value.trim();
      if (!k) return;
      store.set(KEY, k);
      load(true);
    });
    document.getElementById('adm-key').focus();
  }

  const api = (path) => fetch(path, { headers: { 'x-admin-key': store.get(KEY) || '' }, cache: 'no-store' });
  async function load(first = false, quiet = false) {
    const key = store.get(KEY);
    if (!key) { loginForm(); return; }
    if (!quiet) btnState('loading');
    const t0 = Date.now();
    let r, j;
    try {
      // 관리자 기기는 처음 로그인할 때 방문 집계에서 뺀다(지난 기록까지 — 아래에서 바꿀 수 있음)
      if (first && store.get('cw.noCount') == null) { await api(`/api/admin/exclude?vid=${myVid()}&on=1`); store.set('cw.noCount', 'true'); }
      r = await api(`/api/admin/stats?vid=${myVid()}`);
      j = await r.json();
    } catch { btnState('fail'); main.innerHTML = '<p class="adm-err">통계를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>'; return; }
    if (r.status === 401) { btnState(null); store.del(KEY); loginForm(j.message || '관리자 키가 맞지 않아요.'); return; }
    if (!r.ok) { btnState(null); store.del(KEY); loginForm(j.message || '통계를 불러오지 못했어요.'); return; }
    // 예전 방식(이 기기에만 '집계 안 함' 저장)으로 켜 둔 기기는 서버 제외 목록에도 맞춰 넣는다
    if (j.me && !j.me.excluded && store.get('cw.noCount') === 'true') {
      try { await api(`/api/admin/exclude?vid=${myVid()}&on=1`); r = await api(`/api/admin/stats?vid=${myVid()}`); j = await r.json(); } catch {}
    }
    render(j);
    if (!quiet) { await new Promise((ok) => setTimeout(ok, Math.max(0, 600 - (Date.now() - t0)))); btnState('done'); } // 너무 빨라도 도는 모습이 보이게
  }

  function bars(days, today) {
    // 최근 30일(빈 날은 0)
    const by = Object.fromEntries(days.map((d) => [d.day, d]));
    const list = [];
    const t = new Date(today + 'T12:00:00+09:00').getTime();
    for (let i = 29; i >= 0; i--) { const day = new Date(t - i * 86400000 + 9 * 3600000).toISOString().slice(0, 10); list.push(by[day] || { day, visitors: 0, views: 0, newbies: 0 }); }
    const max = Math.max(1, ...list.map((d) => d.views));
    const W = 600, H = 150, bw = W / list.length;
    const rect = list.map((d, i) => {
      const hv = (d.views / max) * (H - 18), hu = (d.visitors / max) * (H - 18), x = i * bw + 2;
      return `<g><title>${md(d.day)}(${wd(d.day)}) 방문자 ${d.visitors} · 조회 ${d.views} · 신규 ${d.newbies}</title>
        <rect x="${x}" y="${H - hv}" width="${bw - 4}" height="${hv}" rx="2" class="b-v"/>
        <rect x="${x}" y="${H - hu}" width="${bw - 4}" height="${hu}" rx="2" class="b-u"/></g>`;
    }).join('');
    const ticks = list.map((d, i) => (i % 5 === 4 || i === 0 ? `<text x="${i * bw + bw / 2}" y="${H + 14}" text-anchor="middle">${md(d.day)}</text>` : '')).join('');
    return `<svg class="adm-chart" viewBox="0 -4 ${W} ${H + 22}" preserveAspectRatio="none" role="img" aria-label="최근 30일 방문자">${rect}${ticks}</svg>`;
  }

  const listHtml = (rows, label, fmt = (x) => x) => {
    const tot = rows.reduce((s, r) => s + r.n, 0) || 1;
    return rows.length
      ? `<ul class="adm-list">${rows.map((r) => `<li><span>${esc(fmt(r[label]))}</span><i style="width:${Math.max(3, (r.n / tot) * 100)}%"></i><b>${nf(r.n)}</b></li>`).join('')}</ul>`
      : '<p class="adm-dim">아직 기록이 없어요.</p>';
  };

  function render(j) {
    act.hidden = false;
    const today = j.days.find((d) => d.day === j.today) || { visitors: 0, views: 0, newbies: 0 };
    const yd = j.days.at(-1)?.day === j.today ? j.days.at(-2) : j.days.at(-1);
    const dev = Object.fromEntries((j.devices || []).map((d) => [d.device, d.n]));
    const devTot = (dev.m || 0) + (dev.d || 0) || 1;
    const me = j.me || {};
    const excluded = me.excluded ?? store.get('cw.noCount') === 'true';
    main.innerHTML = `
      <section class="adm-kpis">
        <div class="card k"><span>오늘 방문자</span><b>${nf(today.visitors)}</b><small>신규 ${nf(today.newbies)} · 어제 ${nf(yd?.visitors)}</small></div>
        <div class="card k"><span>오늘 조회수</span><b>${nf(today.views)}</b><small>페이지를 연 횟수</small></div>
        <div class="card k"><span>지금 보는 중</span><b>${nf(j.liveNow)}</b><small>최근 5분 안에 연 기기</small></div>
        <div class="card k"><span>최근 7일</span><b>${nf(j.week)}</b><small>재방문 기기 ${nf(j.returning)}</small></div>
        <div class="card k"><span>누적 방문자</span><b>${nf(j.total.visitors)}</b><small>${j.total.since ? `${esc(j.total.since)}부터` : '집계 시작 전'} · 조회 ${nf(j.total.views)}</small></div>
        <div class="card k"><span>휴대폰 비율</span><b>${Math.round(((dev.m || 0) / devTot) * 100)}%</b><small>최근 7일 · PC ${nf(dev.d)}</small></div>
      </section>
      <section class="card">
        <h2>최근 30일 <small class="adm-leg"><i class="u"></i>방문자 <i class="v"></i>조회수</small></h2>
        ${bars(j.days, j.today)}
      </section>
      <div class="adm-2">
        <section class="card"><h2>오늘 어디서 왔나</h2>${listHtml(j.refsToday, 'ref')}</section>
        <section class="card"><h2>신규 방문 유입 경로 <small>최근 7일</small></h2>${listHtml(j.refs7, 'ref')}</section>
        <section class="card"><h2>국가 <small>최근 7일</small></h2>${listHtml(j.countries, 'country', regionName)}</section>
        <section class="card"><h2>날짜별</h2>
          <table class="adm-tbl"><thead><tr><th>날짜</th><th>방문자</th><th>신규</th><th>조회</th></tr></thead>
          <tbody>${j.days.slice(-14).reverse().map((d) => `<tr><td>${md(d.day)} (${wd(d.day)})</td><td>${nf(d.visitors)}</td><td>${nf(d.newbies)}</td><td>${nf(d.views)}</td></tr>`).join('') || '<tr><td colspan="4">아직 기록이 없어요.</td></tr>'}</tbody></table>
        </section>
      </div>
      <section class="card adm-set">
        <h2>이 기기</h2>
        <label class="chk"><input type="checkbox" id="adm-nocount" ${excluded ? 'checked' : ''}> 이 기기에서 연 방문은 집계하지 않기</label>
        <p class="adm-me">${excluded ? '✅ 통계에서 <b>빠져 있어요</b>' : '⚠️ 통계에 <b>포함돼요</b>'} · 이 기기 방문 기록 ${nf(me.days)}일 · ${nf(me.views)}회${me.last ? ` (마지막 ${md(me.last)})` : ''}${j.excludedDevices ? ` · 통계에서 뺀 기기 ${nf(j.excludedDevices)}대` : ''}<br><small>체크하면 이 기기의 <b>지난 기록까지</b> 위 숫자에서 바로 빠지고, 앞으로의 방문도 기록하지 않아요. 휴대폰·PC는 각각 다른 기기라 기기마다 이 화면에서 한 번씩 체크해 주세요.</small></p>
        <p class="note">방문자 = 하루 동안 사이트를 연 기기 수(한국 시간 기준). 같은 사람도 휴대폰·PC는 따로 세고, 브라우저 저장소를 지우면 새 방문자로 셉니다. 유입 경로는 블로그 등 다른 사이트의 주소, 또는 링크 끝의 <b>?ref=이름</b> 값이에요. 예: <code>https://my-fire-portfolio.pages.dev/?ref=blog</code> · 기준 시각 ${esc(new Date(j.at).toLocaleString('ko-KR'))}</p>
      </section>`;
    document.getElementById('adm-nocount').addEventListener('change', async (ev) => {
      const on = ev.target.checked;
      ev.target.disabled = true;
      store.set('cw.noCount', on ? 'true' : 'false');
      btnState('loading');
      try { const t0 = Date.now(); await api(`/api/admin/exclude?vid=${myVid()}&on=${on ? 1 : 0}`); await load(false, true); await new Promise((ok) => setTimeout(ok, Math.max(0, 600 - (Date.now() - t0)))); btnState('done'); } catch { btnState('fail'); }
    });
  }

  btn.addEventListener('click', () => load());
  document.getElementById('adm-logout').addEventListener('click', () => { store.del(KEY); loginForm('로그아웃했어요.'); });
  load();
  setInterval(() => { if (!document.hidden && store.get(KEY)) load(false, true); }, 60000);
})();
