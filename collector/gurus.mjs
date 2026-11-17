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
};
const TOP = 40, SOLD = 10;

async function get(url, type = 'json') {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (r.ok) return type === 'json' ? r.json() : r.text();
      last = new Error(`${r.status} ${url}`);
      if (r.status === 404) break;
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
  const periods = [...new Set(list.map((x) => x.period))].sort().reverse().slice(0, 2);
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
    return { cu: h.cu, n: tidy(h.name), c: h.cls, pc: h.pc || undefined, v: Math.round(h.v), w: +(h.v / total).toFixed(5), chg: !R.prevPeriod ? null : !p ? 'new' : p.sh > 0 ? +(h.sh / p.sh - 1).toFixed(4) : null };
  });
  const sold = R.prevPeriod ? R.old.filter((h) => !C.has(`${h.cu}|${h.pc}`)).slice(0, SOLD).map((h) => ({ cu: h.cu, n: tidy(h.name), pc: h.pc || undefined, pw: +(h.v / ptotal).toFixed(5) })) : [];
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
  const prevBy = Object.fromEntries((prev?.list || []).map((g) => [g.id, g]));
  const out = {};
  if (Date.now() - S.at < 3 * 3600e3 && prev?.list?.length) Object.assign(out, prevBy); // 3시간에 한 번만 SEC에 묻는다
  else {
    for (const [id, cik] of Object.entries(GURU_CIKS)) {
      try {
        const L = await filingList(cik);
        await sleep(150);
        if (!L.quarters.length) continue;
        const s = sig(L);
        if (S.sig[id] === s && prevBy[id]) { out[id] = prevBy[id]; continue; }
        const cur = await quarter(cik, L.quarters[0]);
        const old = L.quarters[1] ? await quarter(cik, L.quarters[1]) : null;
        out[id] = { id, ...shrink({ cik, filer: L.filer, period: cur.period, filed: cur.filed, prevPeriod: old?.period || null, cur: cur.hold, old: old?.hold || [] }) };
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
  return { at: new Date().toISOString(), list };
}
