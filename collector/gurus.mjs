// 유명 투자자 포트폴리오: SEC에 분기마다 내는 13F 보고서(운용 자산 1억 달러 이상 기관의 미국 상장 주식 보유 내역)를 읽어
// 종목별 비중·지난 분기 대비 변화를 만든다 → data/gurus.json
// - 13F는 분기 말 기준, 분기가 끝나고 45일 안에 공개된다(그래서 늘 한 분기 늦은 정보)
// - 미국 상장 주식·ETF·옵션만 담긴다(현금·채권·해외 주식·공매도는 없음)
// - 종목 코드는 OpenFIGI(블룸버그 무료 공개 API)로 CUSIP → 티커 변환, 한 번 찾은 건 state에 저장
const UA = { 'user-agent': 'FirePortfolio dashboard (https://my-fire-portfolio.pages.dev)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 이름·회사는 화면(app.js GURUS)에 있다. 여기는 SEC 제출 번호(CIK)만
// 빌 애크먼: 2026년 3분기부터 Pershing Square Capital Management 대신 Pershing Square Inc.가 제출(이전 회사는 13F-NT만 냄)
export const GURU_CIKS = {
  buffett: 1067983, // Berkshire Hathaway
  thiel: 1562087, // Thiel Macro LLC
  ackman: 2026053, // Pershing Square Inc.
  wood: 1697748, // ARK Investment Management
  druck: 1536411, // Duquesne Family Office
  dalio: 1350694, // Bridgewater Associates
  soros: 1029160, // Soros Fund Management
  tepper: 1656456, // Appaloosa
  lilu: 1709323, // Himalaya Capital
  klarman: 1061768, // Baupost Group
  icahn: 921669, // Carl C. Icahn
  coleman: 1167483, // Tiger Global
  loeb: 1040273, // Third Point
  laffont: 1135730, // Coatue
  pabrai: 1549575, // Dalal Street (Mohnish Pabrai)
  smith: 1569205, // Fundsmith (Terry Smith)
  gates: 1166559, // Gates Foundation Trust
  // ---- 기관(연기금·국부펀드·중앙은행·대학 기금·퀀트) — 화면 목록에서 '기관'으로 묶인다
  nps: 1608046, // National Pension Service (국민연금)
  bok: 1965704, // Bank of Korea (한국은행, 2023년부터 제출)
  kic: 1441689, // Korea Investment Corp (한국투자공사)
  norway: 1374170, // Norges Bank (노르웨이 국부펀드 GPFG)
  snb: 1582202, // Swiss National Bank
  temasek: 1021944, // Temasek Holdings
  pif: 1767640, // Public Investment Fund (사우디)
  mubadala: 1704268, // Mubadala Investment Co (아부다비)
  cpp: 1283718, // Canada Pension Plan Investment Board
  calpers: 919079, // California Public Employees' Retirement System
  harvard: 1082621, // Harvard Management Co
  rentec: 1037389, // Renaissance Technologies
};
const TOP = 40, SOLD = 10;

async function get(url, type = 'json') {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (r.ok) return type === 'json' ? r.json() : r.text();
      last = new Error(`${r.status} ${url}`);
      if (r.status === 404 && i >= 1) break; // SEC는 있는 파일도 가끔 404로 답한다(한국은행 2026-11) → 한 번은 다시
    } catch (e) { last = e; }
    await sleep(1500 * (i + 1));
  }
  throw last;
}
const ent = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (x, n) => ent((String(x).match(new RegExp(`<(?:\\w+:)?${n}>([^<]*)</(?:\\w+:)?${n}>`)) || [])[1]);

async function filingRows(cik, acc) {
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}`;
  const idx = await get(`${base}/index.json`);
  const files = idx.directory.item.map((x) => x.name);
  const prim = files.find((f) => /primary_doc\.xml$/i.test(f));
  const info = files.find((f) => /\.xml$/i.test(f) && f !== prim);
  if (!info) throw new Error('13F 표 파일 없음 ' + acc);
  const P = prim ? await get(`${base}/${prim}`, 'text') : '';
  await sleep(120);
  const X = await get(`${base}/${info}`, 'text');
  const rows = [];
  for (const m of X.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)) {
    const b = m[1];
    const value = Number(tag(b, 'value')), sh = Number(tag(b, 'sshPrnamt'));
    if (!(value >= 0)) continue;
    rows.push({ name: tag(b, 'nameOfIssuer'), cls: tag(b, 'titleOfClass'), cusip: tag(b, 'cusip').toUpperCase(), value, sh: sh || 0, pc: tag(b, 'putCall').toLowerCase() });
  }
  // 2023년부터 금액은 달러 단위인데, 아직 천 달러 단위로 적는 회사가 있다(Duquesne·Baupost 등) → 주당 가격이 1달러도 안 되게 나오면 천 배
  const px = rows.filter((r) => !r.pc && r.sh > 0 && r.value > 0).map((r) => r.value / r.sh).sort((a, b) => a - b);
  if (px.length && px[Math.floor(px.length / 2)] < 0.5) for (const r of rows) r.value *= 1000;
  return { rows, amend: tag(P, 'amendmentType') };
}
// 같은 종목(CUSIP)·같은 종류(주식/풋/콜)는 합친다(공동 운용사별로 나눠 적는 회사가 많다)
function aggregate(rows) {
  const M = new Map();
  for (const r of rows) {
    const k = `${r.cusip}|${r.pc}`;
    const o = M.get(k) || { cu: r.cusip, pc: r.pc, name: r.name, cls: r.cls, v: 0, sh: 0 };
    o.v += r.value; o.sh += r.sh; M.set(k, o);
  }
  return [...M.values()].sort((a, b) => b.v - a.v);
}
async function filingList(cik) {
  const j = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`);
  const R = j.filings.recent, list = [];
  R.form.forEach((f, i) => { if (f === '13F-HR' || f === '13F-HR/A') list.push({ form: f, filed: R.filingDate[i], period: R.reportDate[i], acc: R.accessionNumber[i] }); });
  const periods = [...new Set(list.map((x) => x.period))].sort().reverse().slice(0, 4);
  return { filer: j.name, quarters: periods.map((p) => ({ period: p, filings: list.filter((x) => x.period === p).sort((a, b) => a.filed.localeCompare(b.filed) || a.acc.localeCompare(b.acc)) })) };
}
// 한 분기: 원본에 수정본을 반영(재작성이면 통째로 바꾸고, '신규 보유 추가'면 더한다)
async function quarter(cik, q) {
  let rows = [], filed = null;
  for (const f of q.filings) {
    const r = await filingRows(cik, f.acc);
    if (f.form === '13F-HR' || /RESTATEMENT/i.test(r.amend)) rows = r.rows; else rows = rows.concat(r.rows);
    filed = f.filed;
    await sleep(150);
  }
  return { period: q.period, filed, hold: aggregate(rows) };
}
const sig = (L) => L.quarters.map((q) => q.filings.map((f) => f.acc).join('+')).join('/');

// 대문자 회사 이름을 읽기 쉽게: "BANK OF AMER CORP" → "Bank Of Amer Corp"(약어·짧은 대문자 단어는 그대로)
const KEEP_UP = /^(ETF|ADR|ADS|REIT|LP|LLC|PLC|SA|AG|NV|SE|II|III|IV|US|USA|AI|ARK|SPDR|ISHARES|S&P|NYSE|DE|CV|SAB|AB|ASA|CL|A|B|C|ETN|TR)$/;
const tidy = (s) => String(s || '').toLowerCase().replace(/\b[\w&'.-]+/g, (w) => (KEEP_UP.test(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));

// OpenFIGI: 키 없이 1분에 25번 · 한 번에 10개. 미국 거래소 기준(해외 발행 CINS는 ID_CINS)
async function mapTickers(cusips, figi, log, maxCalls = 40) {
  const need = cusips.filter((c) => !(c in figi));
  let calls = 0;
  for (let i = 0; i < need.length && calls < maxCalls; i += 10) {
    const part = need.slice(i, i + 10);
    const jobs = part.map((c) => ({ idType: /^[A-Z]/.test(c) ? 'ID_CINS' : 'ID_CUSIP', idValue: c, exchCode: 'US' }));
    try {
      const r = await fetch('https://api.openfigi.com/v3/mapping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(jobs), signal: AbortSignal.timeout(30000) });
      calls++;
      if (r.status === 429) { log('gurus: OpenFIGI 한도 — 다음 수집 때 이어서'); break; }
      if (!r.ok) throw new Error('openfigi ' + r.status);
      const j = await r.json();
      j.forEach((x, k) => {
        const d = x.data?.find((y) => y.ticker && !/\s/.test(y.ticker)) || x.data?.[0];
        figi[part[k]] = d?.ticker ? d.ticker.replace('/', '.') : ''; // '' = 못 찾음(이름만 표시)
      });
    } catch (e) { log('gurus: OpenFIGI 실패 →', e.message); break; }
    await sleep(2600);
  }
  return need.length - Object.keys(figi).filter((c) => need.includes(c)).length; // 아직 못 물어본 수
}

// 상위 40개 + 나머지 합계, 지난 분기에 있다가 다 판 종목 상위 10개로 줄인다
function shrink(R) {
  const total = R.cur.reduce((s, h) => s + h.v, 0) || 1, ptotal = R.old.reduce((s, h) => s + h.v, 0) || 1;
  const O = new Map(R.old.map((h) => [`${h.cu}|${h.pc}`, h]));
  const C = new Set(R.cur.map((h) => `${h.cu}|${h.pc}`));
  const top = R.cur.slice(0, TOP).map((h) => {
    const p = O.get(`${h.cu}|${h.pc}`);
    // sh·ps = 이번·지난 분기 주식 수(주식 분할을 반영해 chg를 다시 계산할 때 씀 — fixChanges)
    return { cu: h.cu, n: tidy(h.name), c: h.cls, pc: h.pc || undefined, v: Math.round(h.v), w: +(h.v / total).toFixed(5), sh: h.sh || undefined, ps: p?.sh || undefined, pv: p?.v ? Math.round(p.v) : undefined,
      chg: !R.prevPeriod ? null : !p ? 'new' : p.sh > 0 ? +(h.sh / p.sh - 1).toFixed(4) : null };
  });
  const sold = R.prevPeriod ? R.old.filter((h) => !C.has(`${h.cu}|${h.pc}`)).slice(0, SOLD).map((h) => ({ cu: h.cu, n: tidy(h.name), pc: h.pc || undefined, pw: +(h.v / ptotal).toFixed(5), ps: h.sh || undefined })) : [];
  return {
    cik: R.cik, filer: R.filer, period: R.period, filed: R.filed, prevPeriod: R.prevPeriod,
    count: R.cur.length, total: Math.round(total), opt: R.cur.filter((h) => h.pc).length,
    restW: +(R.cur.slice(TOP).reduce((s, h) => s + h.v, 0) / total).toFixed(5), top, sold,
  };
}

// prev: 지난번 gurus.json · state.gurus: { at, sig: {id: 제출번호들}, figi: {cusip: 티커} }
// 새 보고서가 없으면(제출 번호가 같으면) 지난번 결과를 그대로 쓴다
export async function collectGurus(state, prev, log = console.log) {
  const S = (state.gurus ||= { at: 0, sig: {}, figi: {} });
  S.sig ||= {}; S.figi ||= {};
  // 자료 형식이 바뀌면(주식 수 sh·ps·지난 금액 pv 추가) 모든 보고서를 한 번 다시 읽는다
  if (S.ver !== 3) { S.sig = {}; S.at = 0; S.ver = 3; }
  const prevBy = Object.fromEntries((prev?.list || []).map((g) => [g.id, g]));
  const out = {};
  // 3시간에 한 번만 SEC에 묻는다(새로 넣은 투자자가 아직 없으면 바로)
  if (Date.now() - S.at < 3 * 3600e3 && prev?.list?.length && Object.keys(GURU_CIKS).every((id) => prevBy[id])) Object.assign(out, prevBy);
  else {
    for (const [id, cik] of Object.entries(GURU_CIKS)) {
      try {
        const L = await filingList(cik);
        await sleep(150);
        if (!L.quarters.length) continue;
        const s = sig(L);
        if (S.sig[id] === s && prevBy[id]) { out[id] = prevBy[id]; continue; }
        // 보유 표가 비어 있는 분기는 건너뛴다(노르웨이 중앙은행은 1·3분기를 비공개로 내고 1년 뒤 공개)
        const empty = (q) => !q.hold.some((h) => h.v > 0);
        let k = 0, cur = null, old = null, skipped = null;
        for (; k < L.quarters.length && !cur; k++) { const q = await quarter(cik, L.quarters[k]); if (empty(q)) skipped ||= q.period; else cur = q; }
        if (!cur) throw new Error('보유 표가 비어 있음');
        for (; k < L.quarters.length && !old; k++) { const q = await quarter(cik, L.quarters[k]); if (!empty(q)) old = q; }
        out[id] = { id, ...shrink({ cik, filer: L.filer, period: cur.period, filed: cur.filed, prevPeriod: old?.period || null, cur: cur.hold, old: old?.hold || [] }), ...(skipped ? { skipped } : {}) };
        S.sig[id] = s;
        log(`gurus: ${id} ${cur.period} ${cur.hold.length}종목`);
      } catch (e) {
        log(`gurus: ${id} 실패 →`, e.message);
        if (prevBy[id]) out[id] = prevBy[id]; // 실패하면 지난 값
      }
    }
    S.at = Date.now();
  }
  const list = Object.keys(GURU_CIKS).filter((id) => out[id]).map((id) => out[id]);
  const allCu = [...new Set(list.flatMap((g) => [...g.top, ...g.sold].map((h) => h.cu)))];
  const left = await mapTickers(allCu, S.figi, log);
  if (left) log(`gurus: 티커 변환 ${left}개 남음(다음 수집 때)`);
  for (const g of list) for (const h of [...g.top, ...g.sold]) { const t = S.figi[h.cu]; if (t) h.t = t; else delete h.t; }
  await fixChanges(list, S, log);
  return { at: new Date().toISOString(), list };
}

// 주식 수 변화(chg) 바로잡기 — 매번 sh·ps에서 다시 계산한다
// ① 주식 분할: KLAC 10:1 분할(2026-06) 때 노르웨이 국부펀드가 실제로는 20% 줄였는데 +696%로 보였다
//    → 두 분기 말 사이의 분할 비율(Yahoo 분할 기록)을 지난 분기 주식 수에 곱한다
// ② 분할·합병 뒤 CUSIP이 바뀐 종목: '신규' + '전량 매도'로 따로 보이지 않게 같은 티커면 한 종목으로
const SPLIT_TTL = 3 * 86400e3;
async function splitsOf(t, S) {
  const C = (S.splits ||= {});
  if (C[t] && Date.now() - C[t].at < SPLIT_TTL) return C[t].ev;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.replace('.', '-'))}?range=2y&interval=1mo&events=splits`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('yahoo ' + r.status);
    const sp = (await r.json()).chart?.result?.[0]?.events?.splits || {};
    C[t] = { at: Date.now(), ev: Object.values(sp).map((x) => [x.date * 1000, x.numerator / x.denominator]).filter((x) => x[1] > 0) };
    await sleep(120);
    return C[t].ev;
  } catch { return C[t]?.ev || null; } // 못 물어보면 지난 기록(없으면 분할 없음으로)
}
async function fixChanges(list, S, log) {
  let nSplit = 0, nMerge = 0;
  for (const g of list) {
    if (!g.prevPeriod) continue;
    const from = Date.parse(g.prevPeriod + 'T23:59:59Z'), to = Date.parse(g.period + 'T23:59:59Z');
    for (const h of g.top) {
      if (h.pc || !h.t) continue;
      if (h.chg === 'new') { // 같은 티커가 '전량 매도' 쪽에 있으면 CUSIP만 바뀐 것
        const i = g.sold.findIndex((x) => !x.pc && x.t === h.t && x.ps > 0);
        if (i >= 0 && h.sh > 0) { h.ps = g.sold[i].ps; g.sold.splice(i, 1); nMerge++; } else continue;
      }
      if (!(h.sh > 0 && h.ps > 0)) continue;
      const raw = h.sh / h.ps, px = h.pv > 0 && h.v > 0 ? (h.pv / h.ps) / (h.v / h.sh) : 1; // px = 지난/이번 주당 가격
      let f = 1;
      // 주식 수나 주당 가격이 크게 바뀐 종목만 분할 기록을 본다
      // (분할 뒤 팔면 주식 수는 그대로처럼 보인다 — 무바달라 APH 2:1 분할 + 56% 매도가 −12%로 보였음)
      if (raw >= 1.4 || raw <= 0.7 || px >= 1.4 || px <= 0.7) { const ev = await splitsOf(h.t, S); for (const [d, k] of ev || []) if (d > from && d <= to) f *= k; }
      if (f !== 1) { h.split = +f.toFixed(4); nSplit++; } else delete h.split;
      h.chg = +(h.sh / (h.ps * f) - 1).toFixed(4);
    }
  }
  if (nSplit || nMerge) log(`gurus: 주식 분할 반영 ${nSplit}건 · 티커 같은 종목 합침 ${nMerge}건`);
}
