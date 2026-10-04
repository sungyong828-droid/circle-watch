// 관리자 페이지: 방문자 통계 (/api/admin/stats, 관리자 키가 있어야 응답)
// 관리자 키는 이 기기의 브라우저에만 저장한다.
(() => {
  'use strict';
  const KEY = 'cw.adminKey';
  const main = document.getElementById('adm-main');
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

  async function load(first = false) {
    const key = store.get(KEY);
    if (!key) { loginForm(); return; }
    let r, j;
    try {
      r = await fetch('/api/admin/stats', { headers: { 'x-admin-key': key }, cache: 'no-store' });
      j = await r.json();
    } catch { main.innerHTML = '<p class="adm-err">통계를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>'; return; }
    if (r.status === 401) { store.del(KEY); loginForm(j.message || '관리자 키가 맞지 않아요.'); return; }
    if (!r.ok) { store.del(KEY); loginForm(j.message || '통계를 불러오지 못했어요.'); return; }
    // 관리자 기기는 처음 로그인할 때 방문 집계에서 뺀다(아래에서 바꿀 수 있음)
    if (first && store.get('cw.noCount') == null) store.set('cw.noCount', 'true');
    render(j);
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
    const excluded = store.get('cw.noCount') === 'true';
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
        <label class="chk"><input type="checkbox" id="adm-nocount" ${excluded ? 'checked' : ''}> 이 기기에서 연 방문은 집계하지 않기</label>
        <p class="note">방문자 = 하루 동안 사이트를 연 기기 수(한국 시간 기준). 같은 사람도 휴대폰·PC는 따로 세고, 브라우저 저장소를 지우면 새 방문자로 셉니다. 유입 경로는 블로그 등 다른 사이트의 주소, 또는 링크 끝의 <b>?ref=이름</b> 값이에요. 예: <code>https://yongs-portfolio.pages.dev/?ref=blog</code> · 기준 시각 ${esc(new Date(j.at).toLocaleString('ko-KR'))}</p>
      </section>`;
    document.getElementById('adm-nocount').addEventListener('change', (ev) => store.set('cw.noCount', ev.target.checked ? 'true' : 'false'));
  }

  document.getElementById('adm-reload').addEventListener('click', () => load());
  document.getElementById('adm-logout').addEventListener('click', () => { store.del(KEY); loginForm('로그아웃했어요.'); });
  load();
  setInterval(() => { if (!document.hidden && store.get(KEY)) load(); }, 60000);
})();
