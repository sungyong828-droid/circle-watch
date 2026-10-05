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
    render(j, quiet);
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

  // 화면·기능 이름(functions/api/admin/stats.js USE_BITS 와 같은 키)
  const USE_LABEL = {
    home: ['🏠 홈', 'screen'], crcl: ['서클 주가·수급', 'screen'], earn: ['서클 실적', 'screen'], usdc: ['USDC', 'screen'], arc: ['Arc 체인', 'screen'], news: ['서클 뉴스', 'screen'],
    fire: ['🔥 퇴사까지', 'screen'], div: ['💰 배당금', 'screen'], sprice: ['다른 종목 주가', 'screen'], searn: ['다른 종목 실적', 'screen'], snews: ['다른 종목 뉴스', 'screen'],
    fireSet: ['퇴사 계산 입력해 둔 기기', 'feat'], divSet: ['배당 종목 입력해 둔 기기', 'feat'], watch: ['관심 종목을 추가한 기기', 'feat'],
    ocr: ['📷 사진으로 거래 넣기', 'feat'], share: ['공유 버튼', 'feat'], blog: ['📝 블로그 링크 누름', 'feat'],
  };
  const delta = (a, b) => {
    if (!b) return a ? '<em class="up">새로 시작</em>' : '';
    const p = Math.round(((a - b) / b) * 100);
    return `<em class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</em>`;
  };
  function hourBars(hours) {
    const by = Object.fromEntries((hours || []).map((h) => [h.h, h.n]));
    const list = Array.from({ length: 24 }, (_, h) => by[h] || 0);
    const max = Math.max(1, ...list), W = 480, H = 90, bw = W / 24;
    const peak = list.indexOf(Math.max(...list));
    return `<svg class="adm-chart adm-hours" viewBox="0 -4 ${W} ${H + 20}" preserveAspectRatio="none" role="img" aria-label="시간대별 방문">
      ${list.map((n, h) => `<g><title>${h}시 · ${n}명</title><rect x="${h * bw + 2}" y="${H - (n / max) * (H - 6)}" width="${bw - 4}" height="${(n / max) * (H - 6)}" rx="2" class="${h === peak && n ? 'b-u' : 'b-v'}"/></g>`).join('')}
      ${[0, 6, 12, 18, 23].map((h) => `<text x="${h * bw + bw / 2}" y="${H + 14}" text-anchor="middle">${h}시</text>`).join('')}</svg>
      <p class="adm-dim">처음 연 시각(한국 시간) 기준 · 가장 많은 때 <b>${list[peak] ? `${peak}시` : '–'}</b> — 블로그·SNS 글은 이 시간 조금 전에 올리면 좋아요.</p>`;
  }
  function usageHtml(u, bits) {
    const dev = u?.devices || 0;
    if (!dev) return '<p class="adm-dim">아직 기록이 없어요. (오늘부터 모으기 시작했어요)</p>';
    const row = (k) => { const n = u[k] || 0; return `<li><span>${esc(USE_LABEL[k]?.[0] || k)}</span><i style="width:${Math.max(2, (n / dev) * 100)}%"></i><b>${Math.round((n / dev) * 100)}%</b></li>`; };
    const sc = bits.filter((k) => USE_LABEL[k]?.[1] === 'screen').sort((a, b) => (u[b] || 0) - (u[a] || 0));
    const ft = bits.filter((k) => USE_LABEL[k]?.[1] === 'feat');
    return `<div class="adm-2 adm-in"><div><h3>화면 <small>연 기기 비율</small></h3><ul class="adm-list adm-pct">${sc.map(row).join('')}</ul></div>
      <div><h3>기능 <small>쓴 기기 비율</small></h3><ul class="adm-list adm-pct">${ft.map(row).join('')}</ul></div></div>
      <p class="adm-dim">최근 7일 방문 기기 ${nf(dev)}대 중. 어떤 종목·금액인지는 보내지 않고 '열었다/썼다'만 기록해요. (10/4부터 집계 — 그 전 방문은 0으로 보여요)</p>`;
  }
  // 서비스 상태: 사이트가 쓰는 데이터 API를 이 화면에서 직접 불러 본다
  const HEALTH = [
    ['/api/data', '대시보드 기본 데이터'], ['/api/quote', '실시간 시세'], ['/api/market', '시장 개요'], ['/api/news?s=CRCL', '뉴스·AI 요약'],
    ['/api/earnings?s=CRCL', '실적'], ['/api/dividends?s=SCHD', '배당 기록'], ['/api/chart?s=CRCL&r=1d', '차트'],
  ];
  let healthHtml = '';
  async function runHealth() {
    const box = document.getElementById('adm-health');
    if (!box) return;
    box.innerHTML = HEALTH.map(([u, name], i) => `<li id="hl-${i}"><span>${esc(name)}</span><em class="hl-wait">확인 중…</em></li>`).join('');
    await Promise.all(HEALTH.map(async ([u], i) => {
      const t0 = performance.now();
      let ok = false, note = '';
      try {
        const r = await fetch(u, { cache: 'no-store' });
        const txt = await r.text();
        let j = null; try { j = JSON.parse(txt); } catch {}
        ok = r.ok && !j?.error;
        note = r.ok ? (j?.error ? String(j.error).slice(0, 40) : '') : `HTTP ${r.status}`;
      } catch (e) { note = '연결 실패'; }
      const ms = Math.round(performance.now() - t0);
      const li = document.getElementById('hl-' + i);
      if (li) li.lastElementChild.outerHTML = `<em class="${ok ? (ms > 4000 ? 'hl-slow' : 'hl-ok') : 'hl-bad'}">${ok ? (ms > 4000 ? '느림' : '정상') : '문제'} · ${ms >= 1000 ? (ms / 1000).toFixed(1) + '초' : ms + 'ms'}${note ? ' · ' + esc(note) : ''}</em>`;
    }));
    healthHtml = box.innerHTML;
  }
  const SITE = 'https://my-fire-portfolio.pages.dev/';
  function refLink() {
    const name = (document.getElementById('adm-ref')?.value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣._-]/g, '').slice(0, 40);
    const page = document.getElementById('adm-ref-page')?.value || '';
    const out = document.getElementById('adm-ref-out');
    if (!out) return;
    if (!name) { out.innerHTML = '<span class="adm-dim">이름을 넣으면 링크가 만들어져요.</span>'; return; }
    const url = `${SITE}${page}?ref=${encodeURIComponent(name)}`;
    out.innerHTML = `<code>${esc(url)}</code><button type="button" class="btn-ghost sm" data-copy="${esc(url)}">복사</button>`;
  }
  function downloadCsv(j) {
    const rows = [['날짜', '방문자', '신규', '조회수', 'IP 수'], ...j.days.map((d) => [d.day, d.visitors, d.newbies, d.views, d.ips])];
    const blob = new Blob(['\ufeff' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `fire-portfolio-visits-${j.today}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  let lastStats = null;
  // 고객 문의(/feedback)
  const FB_KIND = { idea: ['💡', '개선 제안'], bug: ['🐞', '오류·숫자'], question: ['❓', '질문'], etc: ['💬', '기타'] };
  const VIEW_NAME = { home: '홈', crcl: '서클 주가', earn: '서클 실적', usdc: 'USDC', arc: 'Arc', news: '뉴스', fire: 'Fire', sprice: '종목 주가', searn: '종목 실적', snews: '종목 뉴스', app: '대시보드' };
  let fbFilter = 'new';
  function feedbackHtml(list, cnt) {
    const c = cnt || {};
    const rows = (list || []).filter((f) => fbFilter === 'all' || f.status === fbFilter);
    const tabs = [['new', `새 글 ${nf(c.new)}`], ['done', `처리함 ${nf(c.done)}`], ['all', '전체']];
    return `<div class="fb-tabs" role="group" aria-label="문의 보기">${tabs.map(([k, l]) => `<button type="button" class="btn-ghost sm" data-fbf="${k}" aria-pressed="${k === fbFilter}">${l}</button>`).join('')}</div>
      ${rows.length ? `<ul class="fb-list">${rows.map((f) => {
        const [ic, kl] = FB_KIND[f.kind] || FB_KIND.etc;
        const when = new Date(f.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<li class="fb-${f.status}"><div class="fb-meta"><span class="fb-kind">${ic} ${kl}</span><small>${esc(when)}${f.page ? ` · ${esc(VIEW_NAME[f.page] || f.page)}에서` : ''}${f.lang === 'en' ? ' · 영어' : ''}</small></div>
          <p class="fb-msg">${esc(f.msg)}</p>
          ${f.contact ? `<p class="fb-contact">연락처: <b>${esc(f.contact)}</b></p>` : ''}
          <div class="fb-act">${f.status === 'new' ? `<button type="button" class="btn-ghost sm" data-fbid="${f.id}" data-fbs="done">✓ 처리 완료</button>` : `<button type="button" class="btn-ghost sm" data-fbid="${f.id}" data-fbs="new">새 글로 되돌리기</button>`}
            <button type="button" class="btn-ghost sm fb-hide" data-fbid="${f.id}" data-fbs="hidden">숨기기</button></div></li>`;
      }).join('')}</ul>` : `<p class="adm-dim">${fbFilter === 'new' ? '✅ 새로 들어온 문의가 없어요.' : '아직 문의가 없어요.'}</p>`}
      <p class="adm-dim">방문자는 대시보드 맨 아래 <b>💬 문의·개선 제안</b>에서 글을 남겨요. 도배를 막으려고 한 사람(IP·기기)당 10분에 3건·하루 8건, 사이트 전체 하루 150건까지만 받고, 같은 내용은 7일 동안 다시 받지 않아요. '숨기기'는 목록에서만 빼고 지우지는 않아요.</p>`;
  }
  function picksHtml(rows, dev) {
    if (!rows?.length) return '<p class="adm-dim">아직 기록이 없어요. 방문자가 관심 종목을 추가하면 여기에 쌓여요.</p>';
    const max = rows[0].n || 1;
    return `<ol class="adm-picks">${rows.map((r, i) => `<li><em>${i + 1}</em><b>${esc(r.sym)}</b><i style="width:${Math.max(4, (r.n / max) * 100)}%"></i><span>${nf(r.n)}대${r.n >= 3 ? '' : ' <small>비공개</small>'}</span></li>`).join('')}</ol>
      <p class="adm-dim">종목을 추가한 기기 ${nf(dev)}대 기준. 3대 이상인 종목만 방문자 화면(종목 추가 창)의 '많이 추가한 종목'에 보여요 — 블로그 글감으로 써 보세요.</p>`;
  }

  const listHtml = (rows, label, fmt = (x) => x) => {
    const tot = rows.reduce((s, r) => s + r.n, 0) || 1;
    return rows.length
      ? `<ul class="adm-list">${rows.map((r) => `<li><span>${esc(fmt(r[label]))}</span><i style="width:${Math.max(3, (r.n / tot) * 100)}%"></i><b>${nf(r.n)}</b></li>`).join('')}</ul>`
      : '<p class="adm-dim">아직 기록이 없어요.</p>';
  };

  let refDraft = null;
  function render(j, quiet = false) {
    act.hidden = false;
    const ri = document.getElementById('adm-ref');
    refDraft = ri ? { name: ri.value, page: document.getElementById('adm-ref-page')?.value || '' } : refDraft;
    if (quiet && document.activeElement?.closest?.('.adm-ref')) return; // 링크 이름을 입력하는 중이면 자동 새로고침으로 덮지 않는다
    const today = j.days.find((d) => d.day === j.today) || { visitors: 0, views: 0, newbies: 0 };
    const yd = j.days.at(-1)?.day === j.today ? j.days.at(-2) : j.days.at(-1);
    const dev = Object.fromEntries((j.devices || []).map((d) => [d.device, d.n]));
    const devTot = (dev.m || 0) + (dev.d || 0) || 1;
    const me = j.me || {};
    const excluded = me.excluded ?? store.get('cw.noCount') === 'true';
    const lg = Object.fromEntries((j.langs || []).map((x) => [x.lang, x.n]));
    const langPct = Math.round(((lg.en || 0) / ((lg.en || 0) + (lg.ko || 0) || 1)) * 100);
    const fails = j.authFails || [], failN = fails.reduce((a, f) => a + f.n, 0), lockedNow = fails.some((f) => f.locked);
    lastStats = j;
    main.innerHTML = `
      <section class="adm-kpis">
        <div class="card k"><span>오늘 방문자</span><b>${nf(today.visitors)}</b><small>신규 ${nf(today.newbies)} · 어제 ${nf(yd?.visitors)}</small></div>
        <div class="card k"><span>오늘 조회수</span><b>${nf(today.views)}</b><small>페이지를 연 횟수</small></div>
        <div class="card k"><span>지금 보는 중</span><b>${nf(j.liveNow)}</b><small>최근 5분 안에 연 기기</small></div>
        <div class="card k"><span>최근 7일</span><b>${nf(j.week)} ${delta(j.week, j.prevWeek)}</b><small>지난 7일 ${nf(j.prevWeek)} · 재방문 ${nf(j.returning)}</small></div>
        <div class="card k"><span>누적 방문자</span><b>${nf(j.total.visitors)}</b><small>${j.total.since ? `${esc(j.total.since)}부터` : '집계 시작 전'} · 조회 ${nf(j.total.views)}</small></div>
        <div class="card k"><span>휴대폰 비율</span><b>${Math.round(((dev.m || 0) / devTot) * 100)}%</b><small>최근 7일 · PC ${nf(dev.d)} · 영어 화면 ${langPct}%</small></div>
      </section>
      <section class="card">
        <h2>최근 30일 <small class="adm-leg"><i class="u"></i>방문자 <i class="v"></i>조회수</small></h2>
        ${bars(j.days, j.today)}
        <div class="adm-row"><span class="adm-dim">최근 7일 신규 ${nf(j.weekNew)} ${delta(j.weekNew, j.prevWeekNew)} · 지난 7일 신규 ${nf(j.prevWeekNew)}</span><button type="button" class="btn-ghost sm" id="adm-csv">CSV 내려받기</button></div>
      </section>
      <section class="card" id="adm-fb"><h2>💬 고객 문의 · 개선 제안 ${j.feedbackCount?.new ? `<em class="fb-badge">새 글 ${nf(j.feedbackCount.new)}</em>` : ''}</h2><div id="adm-fb-body">${feedbackHtml(j.feedback, j.feedbackCount)}</div></section>
      <section class="card"><h2>인기 종목 <small>관심 종목에 새로 추가한 티커 · 최근 30일</small></h2>${picksHtml(j.picks, j.pickDevices)}</section>
      <section class="card"><h2>많이 쓰는 화면 · 기능 <small>최근 7일</small></h2>${usageHtml(j.usage, j.useBits || [])}</section>
      <div class="adm-2">
        <section class="card"><h2>시간대별 방문 <small>최근 7일</small></h2>${hourBars(j.hours)}</section>
        <section class="card"><h2>서비스 상태 <small>지금 이 화면에서 확인</small></h2><ul class="adm-health" id="adm-health"></ul>
          <div class="adm-row"><span class="adm-dim">데이터가 안 나오는 곳이 있으면 여기서 먼저 확인해요.</span><button type="button" class="btn-ghost sm" id="adm-health-run">다시 확인</button></div></section>
      </div>
      <section class="card"><h2>유입 추적 링크 만들기</h2>
        <p class="adm-dim">블로그 글·SNS마다 다른 이름을 붙인 링크를 쓰면 아래 '유입 경로'에서 어디서 몇 명이 왔는지 따로 보여요.</p>
        <div class="adm-ref"><input id="adm-ref" placeholder="예: blog-msty, insta-1004" maxlength="40" autocomplete="off" aria-label="유입 이름">
          <select id="adm-ref-page" aria-label="열 페이지"><option value="">대시보드</option><option value="dividend">배당금 계산기 소개</option><option value="fire">퇴사 계산기 소개</option><option value="about">사이트 소개</option><option value="en">영어 소개</option><option value="crcl">서클 소개</option></select></div>
        <div class="adm-ref-out" id="adm-ref-out"></div>
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
      <div class="adm-2">
        <section class="card"><h2>화면 오류 <small>최근 7일 · 방문자 화면에서 난 오류</small></h2>
          ${(j.errors || []).length ? `<ul class="adm-errs">${j.errors.map((e) => `<li><code>${esc(e.msg)}</code><small>${nf(e.n)}회 · ${e.days}일 · 마지막 ${esc(new Date(e.last_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small></li>`).join('')}</ul>` : '<p class="adm-dim">✅ 최근 7일 동안 보고된 오류가 없어요.</p>'}
        </section>
        <section class="card"><h2>보안 <small>최근 7일</small></h2>
          <p class="adm-sec ${failN ? (lockedNow ? 'bad' : 'warn') : 'ok'}">${failN ? `⚠️ 관리자 키를 틀린 시도 <b>${nf(failN)}회</b> (IP ${nf(fails.reduce((a, f) => a + f.ips, 0))}곳)${lockedNow ? ' · 지금 잠긴 IP 있음' : ''}` : '✅ 관리자 키를 틀린 시도가 없어요.'}</p>
          ${fails.length ? `<ul class="adm-list adm-plain">${fails.map((f) => `<li><span>${md(f.day)} (${wd(f.day)})</span><span class="adm-dim">${nf(f.ips)}곳 · 마지막 ${esc(new Date(f.last_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))}</span><b>${nf(f.n)}</b></li>`).join('')}</ul>` : ''}
          <p class="adm-dim">키를 ${j.lockRule?.fails || 8}번 틀린 IP는 ${j.lockRule?.minutes || 30}분 동안 잠겨요. 본인이 아닌데 시도가 많으면 관리자 키를 새로 바꿔 주세요(Cloudflare 비밀값).</p>
          <ul class="adm-checks">
            <li>✅ 보유 정보·관심 종목은 서버에 없음(각 기기 브라우저에만)</li>
            <li>✅ 다른 사이트에서 API 끌어다 쓰기 차단 · IP당 분당 호출 제한</li>
            <li>✅ 보안 헤더(CSP·HSTS·클릭재킹 차단) · 관리자 페이지 검색 노출·캐시 안 함</li>
            <li>✅ 추가 종목 AI 요약 하루 상한(사용량 폭주 방지)</li>
          </ul>
        </section>
      </div>
      <section class="card adm-set">
        <h2>이 기기</h2>
        <label class="chk"><input type="checkbox" id="adm-nocount" ${excluded ? 'checked' : ''}> 이 기기에서 연 방문은 집계하지 않기</label>
        <p class="adm-me">${excluded ? '✅ 통계에서 <b>빠져 있어요</b>' : '⚠️ 통계에 <b>포함돼요</b>'} · 이 기기 방문 기록 ${nf(me.days)}일 · ${nf(me.views)}회${me.last ? ` (마지막 ${md(me.last)})` : ''}${j.excludedDevices ? ` · 통계에서 뺀 기기 ${nf(j.excludedDevices)}대` : ''}<br><small>체크하면 이 기기의 <b>지난 기록까지</b> 위 숫자에서 바로 빠지고, 앞으로의 방문도 기록하지 않아요. 휴대폰·PC는 각각 다른 기기라 기기마다 이 화면에서 한 번씩 체크해 주세요.</small></p>
        <p class="note">방문자 = 하루 동안 사이트를 연 기기 수(한국 시간 기준). 같은 사람도 휴대폰·PC는 따로 세고, 브라우저 저장소를 지우면 새 방문자로 셉니다. 유입 경로는 블로그 등 다른 사이트의 주소, 또는 링크 끝의 <b>?ref=이름</b> 값이에요. 예: <code>https://my-fire-portfolio.pages.dev/?ref=blog</code> · 기준 시각 ${esc(new Date(j.at).toLocaleString('ko-KR'))}</p>
      </section>`;
    document.getElementById('adm-csv')?.addEventListener('click', () => downloadCsv(j));
    document.getElementById('adm-health-run')?.addEventListener('click', runHealth);
    document.getElementById('adm-ref')?.addEventListener('input', refLink);
    document.getElementById('adm-ref-page')?.addEventListener('change', refLink);
    if (refDraft) { document.getElementById('adm-ref').value = refDraft.name; document.getElementById('adm-ref-page').value = refDraft.page; }
    refLink();
    if (quiet && healthHtml) document.getElementById('adm-health').innerHTML = healthHtml; else runHealth(); // 자동 새로고침 때는 지난 확인 결과 유지
    document.getElementById('adm-nocount').addEventListener('change', async (ev) => {
      const on = ev.target.checked;
      ev.target.disabled = true;
      store.set('cw.noCount', on ? 'true' : 'false');
      btnState('loading');
      try { const t0 = Date.now(); await api(`/api/admin/exclude?vid=${myVid()}&on=${on ? 1 : 0}`); await load(false, true); await new Promise((ok) => setTimeout(ok, Math.max(0, 600 - (Date.now() - t0)))); btnState('done'); } catch { btnState('fail'); }
    });
  }

  btn.addEventListener('click', () => load());
  main.addEventListener('click', async (ev) => {
    const ff = ev.target.closest('[data-fbf]');
    if (ff) { fbFilter = ff.dataset.fbf; const box = document.getElementById('adm-fb-body'); if (box && lastStats) box.innerHTML = feedbackHtml(lastStats.feedback, lastStats.feedbackCount); return; }
    const fa = ev.target.closest('[data-fbid]');
    if (fa) {
      if (fa.dataset.fbs === 'hidden' && !confirm('이 문의를 목록에서 숨길까요? (지우지는 않아요)')) return;
      fa.disabled = true;
      try { await api(`/api/admin/feedback?id=${fa.dataset.fbid}&status=${fa.dataset.fbs}`); await load(false, true); } catch { fa.disabled = false; }
      return;
    }
    const b = ev.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✓ 복사됨'; } catch { b.textContent = '복사 실패'; }
    setTimeout(() => { b.textContent = '복사'; }, 1500);
  });
  document.getElementById('adm-logout').addEventListener('click', () => { store.del(KEY); loginForm('로그아웃했어요.'); });
  load();
  setInterval(() => { if (!document.hidden && store.get(KEY)) load(false, true); }, 60000);
})();
