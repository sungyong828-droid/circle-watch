// 보유 종목 한 번에 넣기 — CSV 파일 · 증권 앱 '보유 종목' 캡처(글자 읽기) · 종목 검색 → 퇴사까지·배당금의 수량·평단
// 버튼을 누를 때만 받는 모듈(앱 첫 로딩을 가볍게). 파일·사진은 이 기기 안에서만 읽고 서버로 보내지 않는다
// (종목 이름 → 티커를 찾을 때만 검색 서버에 이름을 물어본다).
// ctx(app.js가 넘김): { EN, esc, toast, TICKER_RE, krTk, resolveTicker, search, fx, held, apply }

// ---------------------------------------------------------------- 숫자·이름 공통
const HANGUL = /[가-힣]/;
const num = (s) => {
  let t = String(s ?? '').trim();
  const neg = /^\(.*\)$/.test(t) || /^[-−–]/.test(t);
  t = t.replace(/[()\s,$₩원주+\-−–]|USD|KRW|US\$/gi, '');
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const v = parseFloat(t);
  return isFinite(v) ? (neg ? -v : v) : null;
};
// 종목 칸에서 티커 꺼내기: 'TSLA', 'BRK/B', 'A005930', '005930', '삼성전자(005930)', 'Tesla (TSLA)'
function tickOf(s) {
  const t = String(s || '').trim();
  let m = t.match(/^A?(\d{6})$/) || t.match(/\(A?(\d{6})\)/);
  if (m) return m[1];
  if (/^\d{1,5}$/.test(t)) return t.padStart(6, '0'); // 엑셀이 앞의 0을 지운 종목코드
  m = t.match(/^([A-Z]{1,5})(?:[./ ]([A-Z]))?\**$/) || t.match(/\(([A-Z]{1,5})(?:[./]([A-Z]))?\)/);
  if (m) return m[2] ? `${m[1]}.${m[2]}` : m[1];
  return '';
}
const cleanName = (s) => String(s || '').replace(/\(\s*A?\d{6}\s*\)|\(\s*[A-Z]{1,5}\s*\)/g, '').replace(/([가-힣])\s+(?=[가-힣])/g, '$1').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- CSV · 붙여넣은 표
function splitRows(text) {
  const first = text.split(/\r?\n/).slice(0, 30).join('\n');
  const cnt = (c) => (first.match(new RegExp(c === '\t' ? '\\t' : c, 'g')) || []).length;
  const sep = cnt('\t') > cnt(',') && cnt('\t') >= cnt(';') ? '\t' : cnt(';') > cnt(',') ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}
// 제목 칸 → 역할. 순서가 중요하다(평가손익은 '손익', 평균매입가는 '평균', 매입금액은 '원가 합계')
const ROLES = [
  ['skip', /가능|미체결|주문|대출|신용|전일|금일|당일|대비|계좌|change|day|account/i],
  ['rate', /률|%|rate|yield|percent/i],
  ['profit', /손익|수익|gain|p&l|profit/i],
  ['value', /평가|market\s*value|current\s*value|^value$|총\s*금액/i],
  ['avg', /평균|평단|단가|매입가|매수가|구매가|average|avg|per\s*share|\/\s*share|unit\s*cost/i],
  ['cost', /매입\s*금액|매수\s*금액|원금|투자\s*금|cost\s*basis|total\s*cost|book|cost|invested/i],
  ['qty', /수량|잔고|보유량|주식\s*수|quantity|qty|shares|units/i],
  ['ticker', /티커|심볼|종목\s*코드|단축\s*코드|^코드$|symbol|ticker|^code$/i],
  ['name', /종목|상품명|name|description|security|instrument|stock|holding/i],
  ['cur', /통화|currency|ccy/i],
  ['market', /시장|국가|거래소|market|exchange|country/i],
  ['price', /현재가|현재|price|시세|종가/i],
];
const roleOf = (h) => (ROLES.find(([, re]) => re.test(h)) || [null])[0];
const curHint = (h) => (/원화|\(원\)|krw|₩/i.test(h) ? 'krw' : /외화|\(\$\)|usd|\$|달러/i.test(h) ? 'usd' : 'nat');
const curOfCell = (s) => (/^(usd|us\$|\$|달러|미국|us|nasdaq|nyse|amex|해외)/i.test(String(s || '').trim()) ? 'usd' : /^(krw|원|₩|한국|kr|kospi|kosdaq|코스피|코스닥|국내)/i.test(String(s || '').trim()) ? 'krw' : null);
const SKIP_ROW = /합계|소계|총계|^total|^cash|예수금|account total|pending/i;

export function parseTable(text) {
  const R = splitRows(String(text || '').replace(/^﻿/, ''));
  let hi = -1, cols = null;
  for (let i = 0; i < Math.min(R.length, 30); i++) {
    const roles = R[i].map((h) => (num(h) == null ? roleOf(h) : null));
    if (roles.includes('qty') && (roles.includes('name') || roles.includes('ticker'))) { hi = i; cols = roles; break; }
  }
  const out = [];
  if (hi < 0) {
    // 제목 줄이 없는 표: 글자 칸 = 종목, 숫자 칸 첫째 = 수량, 둘째 = 평단
    for (const r of R) {
      const label = r.find((c) => num(c) == null && /[A-Za-z가-힣]/.test(c));
      const ns = r.map(num).filter((v) => v != null);
      if (!label || ns.length < 2 || SKIP_ROW.test(label)) continue;
      out.push({ raw: cleanName(label), tick: tickOf(label), sh: ns[0], p: { nat: ns[1] }, warn: false });
    }
    return { rows: out, noHeader: true };
  }
  const H = R[hi], idx = (role) => cols.map((c, i) => (c === role ? i : -1)).filter((i) => i >= 0);
  const qi = idx('qty')[0], ti = idx('ticker')[0], ni = idx('name')[0], ci = idx('cur')[0], mi = idx('market')[0];
  const avgs = idx('avg').map((i) => ({ i, c: curHint(H[i]) })), costs = idx('cost').map((i) => ({ i, c: curHint(H[i]) }));
  const vals = idx('value').map((i) => ({ i, c: curHint(H[i]) })), profs = idx('profit').map((i) => ({ i, c: curHint(H[i]) }));
  for (const r of R.slice(hi + 1)) {
    const sh = num(r[qi]);
    const nm = ni != null ? r[ni] : '', tk = ti != null ? r[ti] : '';
    if (!(sh > 0) || (!nm && !tk) || SKIP_ROW.test(nm || tk)) continue;
    const rowCur = curOfCell(r[ci]) || curOfCell(r[mi]);
    const p = {};
    const put = (list, f) => { for (const { i, c } of list) { const v = num(r[i]); if (v != null && v > 0) { const k = c === 'nat' && rowCur ? rowCur : c; p[k] ??= f(v, i); } } };
    put(avgs, (v) => v);
    if (!Object.keys(p).length) put(costs, (v) => v / sh); // 평단 칸이 없으면 매입금액 ÷ 수량
    if (!Object.keys(p).length && vals.length && profs.length) {
      for (const { i, c } of vals) { const v = num(r[i]), pr = profs.find((x) => x.c === c) || profs[0], g = num(r[pr.i]); if (v > 0 && g != null && v - g > 0) { const k = c === 'nat' && rowCur ? rowCur : c; p[k] ??= (v - g) / sh; } }
    }
    out.push({ raw: cleanName(nm || tk), tick: tickOf(tk) || tickOf(nm), sh, p, warn: !Object.keys(p).length });
  }
  return { rows: out, noHeader: false };
}

// ---------------------------------------------------------------- 캡처(글자 읽기 결과) → 종목·수량·평단
// 어떤 증권 앱이든 대략 세 모양: ① 목록(종목명 / 12주 · 평가금액 · 수익(%))  ② 표(제목 줄 + 줄마다 종목)  ③ 한 종목 상세(라벨 · 값)
const LBL = [
  ['cost', /매입\s*금액|매수\s*금액|투자\s*원금|원금|투자\s*금/],
  ['avg', /평균|평단|매입\s*가|매입\s*단가|매수\s*가|매수\s*단가|구매\s*가|단가|avg|average/i],
  ['rate', /수익률|손익률|rate/i],
  ['profit', /손익|수익|gain|p&l/i],
  ['value', /평가|총\s*금액|금액|value/i],
  ['qty', /수량|잔고|보유|shares|qty/i],
  ['price', /현재가|현재|시세|price/i],
];
const lblOf = (s) => (LBL.find(([, re]) => re.test(s)) || [null])[0];
const LABEL_WORDS = /내|개|보유|수량|평균|평단|단가|매입|매수|매도|평가|금액|손익|수익률?|현재가|현재|원금|투자|주문|가능|잔고|총|합계|전체|국내|해외|미국|한국|계좌|예수금|원화|외화|달러|정렬|내\s*주식|주식|일간|오늘|비중|배당|기준|실시간|체결|구매|1주|종목명?|평가손익|더보기|순서|LTE|5G|SKT|KT|LG|U\+|Wi-?Fi/gi;
const tokRe = () => /([+\-−–]?)\s*(US\$|\$|₩)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(주|원|%|달러|USD|KRW)?/g;
function tokens(line) {
  const out = [];
  let last = 0, m;
  const re = tokRe();
  while ((m = re.exec(line))) {
    if (/[:/]/.test(line[m.index + m[0].length] || '') || /[:/A-Za-z&]$/.test(line.slice(0, m.index))) { last = m.index + m[0].length; continue; } // 시각 19:00 · 날짜 10/13 · 이름 속 숫자(S&P500)
    const pre = line.slice(last, m.index);
    const suf = m[4] || '', cur = m[2] === '₩' || suf === '원' || /KRW/.test(suf) ? 'krw' : m[2] || /달러|USD/.test(suf) ? 'usd' : null;
    const v = parseFloat(m[3].replace(/,/g, ''));
    const t = { v, sign: m[1] ? (m[1] === '+' ? 1 : -1) : 0, cur, pct: suf === '%', sh: suf === '주', lbl: lblOf(pre), money: false, at: m.index, end: m.index + m[0].length };
    if (t.sh && (/^\s*당/.test(line.slice(t.end)) || (v === 1 && /^\s*(평균|가격|평단)/.test(line.slice(t.end))))) { t.sh = false; t.perShare = true; } // '1주 평균금액'·'주당'은 수량이 아님
    t.money = !t.pct && !t.sh && !t.perShare && (!!cur || /[,.]/.test(m[3]) || v >= 1000);
    out.push(t);
    last = t.end;
  }
  return out;
}
function nameText(line) {
  let s = line.replace(tokRe(), (m0, a, b, c, d, off, str) => (/[A-Za-z&]$/.test(str.slice(0, off)) ? m0 : ' ')).replace(/[()[\]{}|·•@©®>:<_=~^*#"'`,.!?%$₩+\-−–]/g, ' ').split(/\s+/)
    .filter((w) => w.replace(LABEL_WORDS, '').replace(/[^A-Za-z0-9가-힣&]/g, '').length > 0).join(' ').trim();
  if (HANGUL.test(s)) s = s.replace(/^(?:[A-Za-z0-9]{1,2}\s+)+/, '').replace(/(?:\s+[A-Za-z0-9]{1,2})+$/, ''); // 로고를 글자로 잘못 읽은 조각
  s = cleanName(s);
  if (!/[가-힣]{2,}|[A-Za-z]{2,}/.test(s) || s.length > 40) return '';
  return s;
}
function fixLine(s) {
  return s.replace(/(^|[\s(+\-−–])[Ss](?=\d)/g, '$1$').replace(/(^|[\s(+\-−–])W(?=\d{1,3}(,\d{3})+)/g, '$1₩').replace(/\s+/g, ' ').trim();
}
// 한 종목 블록의 숫자들 → 평단
function pick(sh, toks) {
  const by = (l) => toks.find((t) => t.lbl === l && !t.pct && !t.sh && !t.perShare);
  const rate = toks.find((t) => t.pct);
  let src = by('avg'), avg = src?.v ?? null, warn = false;
  if (avg == null) { const i = toks.findIndex((t) => t.perShare); if (i >= 0 && toks[i + 1]?.money) { src = toks[i + 1]; avg = src.v; } } // '1주 평균금액 $245.30'
  const cost = by('cost');
  if (avg == null && cost?.v > 0) { src = cost; avg = cost.v / sh; }
  if (avg == null) {
    const free = toks.filter((t) => t.money && !['avg', 'cost', 'price', 'rate', 'qty'].includes(t.lbl));
    let value = by('value')?.v ?? null, profit = by('profit') ? by('profit').v * (by('profit').sign || (rate?.sign ?? 1)) : null;
    const signed = free.filter((t) => t.sign && t !== by('value'));
    const plain = free.filter((t) => !t.sign && t !== by('profit'));
    if (profit == null && signed.length) profit = signed[0].v * signed[0].sign;
    if (value == null && plain.length) value = Math.max(...plain.map((t) => t.v));
    src = by('value') || plain.find((t) => t.v === value) || signed[0];
    if (profit == null && plain.length >= 2 && rate) { // 부호 없이 색으로만 보이는 수익: 수익률 부호를 따른다
      const others = plain.filter((t) => t.v !== value);
      if (others.length) profit = Math.min(...others.map((t) => t.v)) * (rate.sign || 1);
    }
    if (value > 0 && profit != null && value - profit > 0) {
      avg = (value - profit) / sh;
      if (rate && Math.abs((profit / (value - profit)) * 100 - rate.v * (rate.sign || Math.sign(profit) || 1)) > 1.5) warn = true; // 수익률과 안 맞으면 확인
    }
  }
  if (!(avg > 0)) return { p: {}, warn: true };
  const cur = src?.cur || (toks.find((t) => t.money && t.cur)?.cur) || 'nat';
  return { p: { [cur]: avg }, warn };
}
// ② 표 모양: 제목 줄(라벨 2개 이상, 숫자 없음) 한두 줄 + 종목마다 같은 줄 수
function tableParse(lines) {
  const heads = (s) => (s.match(/종목명|종목|보유\s*수량|수량|평가\s*손익|손익|수익률|평가\s*금액|평가액|매입\s*금액|매입\s*가|평균\s*단가|평단가?|매입\s*단가|현재가|잔고/g) || []).map((w) => (/종목/.test(w) ? 'name' : lblOf(w)));
  const hi = lines.findIndex((l) => heads(l).length >= 2 && !tokens(l).some((t) => t.money || t.sh));
  if (hi < 0) return [];
  const H = [heads(lines[hi])];
  if (lines[hi + 1] && heads(lines[hi + 1]).length >= 2 && !tokens(lines[hi + 1]).some((t) => t.money || t.sh)) H.push(heads(lines[hi + 1]));
  if (!H.flat().includes('qty')) return [];
  const out = [];
  for (let j = hi + H.length; j < lines.length;) {
    const nm = nameText(lines[j]);
    if (!nm) { j++; continue; }
    const rec = {}, all = [];
    H.forEach((cols, k) => {
      const T = tokens(lines[j + k] || '').filter((t) => !t.perShare);
      const C = cols.filter((c) => c !== 'name');
      C.forEach((c, m) => { if (T[m]) { rec[c] ??= T[m]; all.push({ ...T[m], lbl: T[m].lbl || c }); } });
    });
    const sh = rec.qty?.v;
    if (sh > 0) { const r = pick(sh, all); out.push({ raw: nm, tick: tickOf(nm), sh, ...r }); }
    j += H.length;
  }
  return out;
}
// ①·③ 목록·상세: 'N주'(또는 '보유수량 N')가 있는 줄을 기준으로 위아래 줄을 한 종목으로 묶는다
function anchorParse(lines) {
  const T = lines.map(tokens);
  const anchors = [];
  T.forEach((ts, i) => {
    let q = ts.find((t) => t.sh) || ts.find((t) => t.lbl === 'qty' && !t.pct && t.v > 0 && t.v < 1e8);
    if (!q && ts[0] && ts[0].at === 0 && !ts[0].cur && !ts[0].pct && /^[\d,.]+\s?[F추쭈수季주]/.test(lines[i]) && ts.some((t) => t.pct || t.sign)) { q = ts[0]; q.sh = true; q.money = false; }
    if (q && q.v > 0) anchors.push({ i, sh: q.v, q });
  });
  let prevEnd = -1;
  const blocks = anchors.map((a) => {
    let ni = -1;
    for (let k = a.i; k >= Math.max(prevEnd + 1, a.i - 3); k--) if (nameText(lines[k])) { ni = k; break; }
    const b = { ...a, start: ni >= 0 ? ni : Math.max(prevEnd + 1, a.i - 4), name: ni >= 0 ? nameText(lines[ni]) : '' };
    prevEnd = a.i;
    return b;
  });
  return blocks.map((b, n) => {
    const end = Math.min(n + 1 < blocks.length ? blocks[n + 1].start - 1 : lines.length - 1, b.i + 4);
    const toks = [];
    for (let k = b.start; k <= end; k++) {
      let carry = null;
      if (!T[k].length && lblOf(lines[k])) carry = lblOf(lines[k]); // 라벨만 있는 줄 → 다음 줄 첫 숫자의 라벨
      for (const t of T[k]) if (t !== b.q) toks.push(t);
      if (carry && T[k + 1]?.[0] && !T[k + 1][0].lbl) T[k + 1][0].lbl = carry;
    }
    return { raw: b.name, tick: tickOf(b.name), sh: b.sh, ...pick(b.sh, toks) };
  });
}
export function parseHoldText(text) {
  const lines = String(text || '').split(/\r?\n/).map(fixLine).filter(Boolean);
  const t = tableParse(lines);
  return t.length ? t : anchorParse(lines);
}

// ---------------------------------------------------------------- 글자 읽기(한글+영어) — trade-ocr.js와 같은 엔진, 한국어 데이터를 더 받는다
let ocrP = null, onProg = null;
function loadScript(src) {
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('OCR')); document.head.appendChild(s); });
}
function ocrWorker() {
  if (!ocrP) {
    ocrP = (window.Tesseract ? Promise.resolve() : loadScript('assets/ocr/tesseract.min.js'))
      .then(() => window.Tesseract.createWorker(['kor', 'eng'], 1, {
        workerPath: 'assets/ocr/worker.min.js', corePath: 'assets/ocr/core', langPath: 'assets/ocr/lang', workerBlobURL: false, gzip: true,
        logger: (m) => onProg?.(m),
      }))
      .then(async (w) => { try { await w.setParameters({ preserve_interword_spaces: '1' }); } catch {} return w; });
    ocrP.catch(() => { ocrP = null; });
  }
  return ocrP;
}
async function prepImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 900 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = bmp.width * scale; c.height = bmp.height * scale;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
  const dark = sum / n < 128; // 어두운 화면이면 흑백을 뒤집는다
  // 회색·빨강·파랑 글자(수량·수익)가 흐리게 읽히지 않게: 바탕(가장 많은 밝기)보다 조금이라도 어두우면 검정, 아니면 흰색
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (dark) v = 255 - v;
    d[i] = v = Math.round(v); hist[v]++;
  }
  const th = hist.indexOf(Math.max(...hist)) - 45;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] < th ? 0 : 255;
  g.putImageData(img, 0, 0);
  return c;
}
export async function readHoldShots(files, progress) {
  onProg = progress;
  const w = await ocrWorker();
  const all = [], seen = new Set();
  for (const [i, f] of [...files].entries()) {
    progress?.({ status: 'image', progress: i / files.length });
    const { data } = await w.recognize(await prepImage(f));
    for (const r of parseHoldText(data.text)) {
      const k = `${r.raw}|${r.sh}`;
      if (seen.has(k)) continue; // 여러 장에 같은 종목이 겹쳐 찍힌 경우
      seen.add(k); all.push(r);
    }
  }
  return all;
}

// ---------------------------------------------------------------- 화면(아래에서 올라오는 창)
let C = null, rows = [], mode = 'csv', findFor = null, seq = 0, sTimer = null, results = [], lastFx = null;
let toFire = true, toDiv = true, replaceAll = false; // 반영할 곳·방식(목록을 다시 그려도 유지)
const L = (ko, en) => (C?.EN ? en : ko);
const nfx = (v, dp) => (v == null || !isFinite(v) ? '' : v.toLocaleString('en-US', { maximumFractionDigits: dp }));
const isKr = (t) => C.krTk(t);
const resolveCache = new Map();

async function resolveRow(r) {
  if (r.t) return;
  const key = `${r.tick}|${r.raw}`;
  if (!resolveCache.has(key)) {
    resolveCache.set(key, (async () => {
      if (r.tick && /^\d{6}$/.test(r.tick)) { const t = await C.resolveTicker(r.tick); return C.TICKER_RE.test(t) ? { t } : null; }
      if (r.tick && C.TICKER_RE.test(r.tick)) return { t: r.tick };
      const name = r.raw;
      if (!name) return null;
      if (HANGUL.test(name)) {
        // 내 관심·보유 종목의 한글 이름이 먼저('조비' → JOBY 조비 에비에이션, '서클' → CRCL)
        const nn = name.replace(/\s+/g, ''), KN = C.knownNames?.() || [];
        const kn = KN.find(([, ns]) => ns.some((n) => n.replace(/\s+/g, '') === nn)) || (nn.length >= 2 && KN.find(([, ns]) => ns.some((n) => n.replace(/\s+/g, '').startsWith(nn))));
        if (kn) return { t: kn[0], name: kn[1][0] };
        const t = await C.resolveTicker(name);
        if (C.TICKER_RE.test(t) && (C.krTk(t) || t !== name.toUpperCase())) return { t };
      }
      const core = name.replace(/^[^가-힣]+/, '');
      if (HANGUL.test(name) && core.length >= 3 && core !== name) {
        const t = await C.resolveTicker(core);
        if (C.TICKER_RE.test(t) && (C.krTk(t) || t !== core.toUpperCase())) return { t };
      }
      if (HANGUL.test(name) && core.length >= 2) {
        // '서클' → 서클 인터넷 그룹(앞부분이 같은 종목), '하이닉스' → SK하이닉스(3글자 이상이면 이름 안에 들어 있는 종목)
        const R2 = await C.search(core).catch(() => []), n2 = (x) => String(x || '').replace(/\s+/g, '');
        // 고르는 순서: 내 관심·보유 종목 → 이름 첫 낱말이 같음('서클 인터넷 그룹') → 앞부분이 같음 → 이름 안에 있음
        const known = C.known?.() || new Set();
        const sc = (x) => {
          const vs = [x.label, x.kr, x.name].filter(Boolean);
          const st = vs.some((v) => n2(v).startsWith(core)), inc = core.length >= 3 && vs.some((v) => n2(v).includes(core));
          if (known.has(x.symbol)) return 0; // 검색이 찾아 준 내 종목(네이버 표기 '써클'처럼 글자가 조금 달라도)
          if (!st && !inc) return 9;
          return vs.some((v) => String(v).trim().split(/\s+/)[0] === core) ? 1 : st ? 2 : 3;
        };
        const h2 = R2.map((x) => [sc(x), x]).filter(([k]) => k < 9).sort((a, b) => a[0] - b[0])[0]?.[1];
        if (h2) return { t: h2.symbol, name: h2.label };
      }
      const res = await C.search(name).catch(() => []);
      const q = name.toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
      const exact = res.find((x) => [x.symbol, x.name, x.kr].some((v) => String(v || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '') === q));
      const hit = exact || (r.tick && res.find((x) => x.symbol === r.tick)) || (res.length && q.length >= 4 && String(res[0].name || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '').startsWith(q.slice(0, 6)) ? res[0] : null);
      return hit ? { t: hit.symbol, name: hit.label } : null;
    })().catch(() => null));
  }
  const hit = await resolveCache.get(key);
  if (hit) { r.t = hit.t; r.name = hit.name || r.name; }
}
// 통화 정리: 미국 종목은 달러, 한국 종목은 원. 원화로만 적힌 미국 종목 평단은 지금 환율로 바꾸고 표시해 둔다
function settle(r, fx) {
  if (!r.t || r.avg != null) return;
  const p = r.p || {}, kr = isKr(r.t);
  if (kr) r.avg = p.krw ?? p.nat ?? (p.usd != null && fx ? p.usd * fx : null);
  else if (p.usd != null || p.nat != null) r.avg = p.usd ?? p.nat;
  else if (p.krw != null && fx) { r.avg = p.krw / fx; r.note = L(`원화 평단을 지금 환율(${Math.round(fx)}원)로 바꾼 값이에요. 달러 평단이 있으면 고쳐 주세요.`, `Converted from KRW at today's rate (₩${Math.round(fx)}). Fix it if you know the USD average.`); }
  if (r.avg != null) r.avg = Math.round(r.avg * (kr ? 1 : 10000)) / (kr ? 1 : 10000);
}
async function finishRows(list) {
  const fx = await C.fx().catch(() => null);
  const out = list.map((r) => ({ id: ++seq, on: true, name: r.raw, ...r }));
  const q = [...out];
  await Promise.all([0, 1, 2].map(async () => { while (q.length) await resolveRow(q.shift()); }));
  lastFx = fx;
  for (const r of out) { if (r.t && (!r.name || r.name.toUpperCase() === r.t)) r.name = C.nameOf(r.t); settle(r, fx); }
  return out;
}

function rowHtml(r) {
  const { esc } = C, kr = r.t && isKr(r.t);
  const now = r.t ? C.held(r.t) : '';
  const bad = !r.t || !(r.sh > 0) || !(r.avg > 0) || r.warn;
  return `<div class="hi-row${bad ? ' hi-warn' : ''}${r.on ? '' : ' hi-off'}" data-hid="${r.id}">
    <label class="hi-on"><input type="checkbox" class="hi-chk" ${r.on ? 'checked' : ''} aria-label="${L('넣기', 'Include')}"></label>
    <div class="hi-nm">${r.t
      ? `<b>${esc(kr ? r.name || r.t.slice(0, 6) : r.t)}</b><small>${esc(kr ? r.t.slice(0, 6) : r.name && r.name !== r.t ? r.name : '')}</small>`
      : `<b>${esc(r.raw || L('이름을 못 읽은 종목', 'Unnamed holding'))}</b><small class="warn">${L('어떤 종목인지 골라 주세요', 'Pick which stock this is')}</small>`}</div>
    <button type="button" class="btn-ghost sm hi-find" data-hifind="${r.id}">${r.t ? L('바꾸기', 'Change') : L('🔍 찾기', '🔍 Find')}</button>
    <button type="button" class="f-rm" data-hirm="${r.id}" aria-label="${L('이 줄 빼기', 'Remove')}">×</button>
    <div class="hi-in">
      <label><span>${L('수량', 'Shares')}</span><input class="hi-sh" inputmode="decimal" value="${esc(nfx(r.sh, 4))}" placeholder="0" aria-label="${L('보유 수량', 'Shares')}"><em>${L('주', 'sh')}</em></label>
      <label><span>${L('평단', 'Avg')}</span><input class="hi-avg" inputmode="decimal" value="${esc(nfx(r.avg, kr ? 0 : 4))}" placeholder="0" aria-label="${L('평균 단가', 'Average cost')}"><em>${kr ? L('원', '₩') : '$'}</em></label>
    </div>
    ${now ? `<small class="hi-now"><em>${L('지금 저장된 값', 'Saved now')}</em>${now.split(' / ').map((x) => `<span>${esc(x)}</span>`).join('')}</small>` : ''}
    ${r.note ? `<small class="hi-note">${esc(r.note)}</small>` : r.warn && r.t ? `<small class="hi-note">${L('⚠ 숫자를 확실히 읽지 못했어요. 증권 앱과 비교해 주세요.', '⚠ Not sure about these numbers — compare with your broker app.')}</small>` : ''}
  </div>`;
}
function srcHtml() {
  if (mode === 'csv') {
    return `<p class="note">${L('증권사 앱·홈페이지의 <b>잔고(보유 종목)</b>를 CSV로 내려받아 골라 주세요. 종목명(또는 티커)·수량·평균 단가 칸을 알아서 찾아요. 엑셀 파일(.xlsx)은 <b>다른 이름으로 저장 → CSV</b>로 바꿔 주세요.', 'Export your holdings as CSV from your broker and pick the file. Symbol/name, quantity and average cost columns are detected automatically. Save .xlsx files as CSV first.')}</p>
      <div class="hi-pick"><label class="btn-primary oc-pick">${L('CSV 파일 고르기', 'Choose CSV file')}<input type="file" id="hi-csv" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden></label><button type="button" class="btn-ghost sm" data-hitpl="1">${L('빈 양식 받기', 'Get template')}</button></div>
      <details class="hi-paste"><summary>${L('표를 복사해서 붙여넣기', 'Paste a table instead')}</summary>
        <textarea id="hi-text" rows="4" placeholder="${L('엑셀·구글 시트에서 종목·수량·평단 칸을 복사해 붙여넣어 주세요', 'Paste name/quantity/average cost cells from a spreadsheet')}"></textarea>
        <button type="button" class="btn-ghost sm" data-hipaste="1">${L('붙여넣은 표 읽기', 'Read pasted table')}</button></details>`;
  }
  if (mode === 'shot') {
    return `<p class="note">${L('증권 앱의 <b>보유 종목(잔고)</b> 화면을 캡처해 골라 주세요. 여러 장도 한 번에 돼요. 종목 이름·수량과 평균 단가(없으면 평가금액·수익)를 읽어요. 사진은 이 기기 안에서만 읽어요.', 'Pick screenshots of your broker app’s holdings screen (several at once is fine). Names, shares and average cost (or value and gain) are read on this device only.')}</p>
      <div class="hi-pick"><label class="btn-primary oc-pick">${L('캡처 사진 고르기', 'Choose screenshots')}<input type="file" id="hi-img" accept="image/*" multiple hidden></label></div>`;
  }
  return `<div class="ws-search"><input id="hi-q" type="search" placeholder="${L('티커·회사명 (예: TSLA, 테슬라, 삼성전자)', 'Ticker or company (e.g. TSLA, Tesla)')}" aria-label="${L('종목 검색', 'Search stocks')}" autocomplete="off" autocapitalize="characters" enterkeyhint="search"></div>
    ${findFor ? `<p class="note hi-for">${L(`<b>${C.esc(rows.find((r) => r.id === findFor)?.raw || '')}</b> 줄에 넣을 종목을 골라 주세요.`, `Pick the stock for <b>${C.esc(rows.find((r) => r.id === findFor)?.raw || '')}</b>.`)} <button type="button" class="hi-x" data-hifindx="1">${L('취소', 'Cancel')}</button></p>` : `<p class="note">${L('관심 종목·보유 종목에 없던 종목도 찾아서 넣을 수 있어요. 고른 뒤 아래에 수량·평단을 넣어 주세요.', 'Any stock works, even ones not in your watchlist. Pick it, then enter shares and average cost below.')}</p>`}
    <ul class="ws-list hi-res" id="hi-res">${resHtml()}</ul>`;
}
function resHtml() {
  const { esc } = C;
  if (results === null) return `<li class="empty">${L('검색 중…', 'Searching…')}</li>`;
  return results.map((x) => {
    const has = rows.some((r) => r.t === x.symbol);
    return `<li><span class="ws-logo ws-letter">${esc(String(x.title || '?')[0])}</span><div class="ws-name"><b>${esc(x.title)}</b><small>${esc(x.sub || '')}</small></div>
      ${has && !findFor ? `<span class="ws-added">${L('목록에 있음', 'Added')}</span>` : `<button type="button" class="ws-btn add" data-hipick="${esc(x.symbol)}" data-hiname="${esc(x.label || '')}">${findFor ? L('이 종목', 'Use') : L('+ 넣기', '+ Add')}</button>`}</li>`;
  }).join('');
}
function listHtml() {
  if (!rows.length) return `<p class="note hi-empty">${L('아직 넣을 종목이 없어요. 위에서 CSV·캡처를 고르거나 종목을 검색해 주세요.', 'Nothing yet — pick a CSV, screenshots, or search above.')}</p>`;
  const on = rows.filter((r) => r.on).length, bad = rows.filter((r) => r.on && (!r.t || !(r.sh > 0) || !(r.avg > 0))).length;
  return `<div class="hi-h"><b>${L(`넣을 종목 ${rows.length}개`, `${rows.length} holding${rows.length === 1 ? '' : 's'}`)}</b><small>${bad ? `<span class="warn">${L(`⚠ 확인 필요 ${bad}`, `⚠ ${bad} to check`)}</span>` : L('수량·평단을 확인해 주세요', 'Check shares and average cost')}</small></div>
    ${rows.map(rowHtml).join('')}
    <div class="hi-to"><span>${L('반영할 곳', 'Apply to')}</span>
      <label class="chk"><input type="checkbox" id="hi-fire" ${toFire ? 'checked' : ''}> 🔥 ${L('퇴사까지', 'Road to FIRE')}</label>
      <label class="chk"><input type="checkbox" id="hi-div" ${toDiv ? 'checked' : ''}> 💰 ${L('배당금', 'Dividends')}</label></div>
    <div class="hi-mode">
      <label class="chk"><input type="radio" name="hi-m" value="merge" ${replaceAll ? '' : 'checked'}> ${L('같은 종목은 수량·평단만 바꾸고, 목록에 없는 종목은 그대로 두기', 'Update matching stocks, keep the others')}</label>
      <label class="chk"><input type="radio" name="hi-m" value="replace" ${replaceAll ? 'checked' : ''}> ${L('저장된 보유 종목을 모두 이 목록으로 바꾸기', 'Replace all saved holdings with this list')}</label></div>
    <button type="button" class="btn-primary oc-add" data-hiapply="1">${L(`${on}종목 반영하기`, `Apply ${on} holding${on === 1 ? '' : 's'}`)}</button>`;
}
function paintList() { syncRows(); const el = document.getElementById('hi-list'); if (el) el.innerHTML = listHtml(); }
function paint() {
  const el = document.getElementById('hi-sheet');
  if (!el) return;
  el.innerHTML = `<div class="sheet-bg" data-hiclose="1"></div><div class="sheet-panel oc-panel hi-panel">
    <div class="sheet-h"><b>📥 ${L('보유 종목 한 번에 넣기', 'Import holdings')}</b><button type="button" class="ws-btn" data-hiclose="1">${L('닫기', 'Close')}</button></div>
    <div class="div-tabs hi-tabs" role="tablist">${[['csv', L('📄 CSV 파일', '📄 CSV')], ['shot', L('📷 캡처', '📷 Screenshot')], ['search', L('🔍 검색', '🔍 Search')]].map(([k, l]) => `<button type="button" role="tab" data-himode="${k}" aria-selected="${mode === k}">${l}</button>`).join('')}</div>
    <section class="tx-box hi-src">${srcHtml()}<p class="oc-status" id="hi-status">${mode === 'shot' ? L('처음 한 번은 글자 읽기 엔진(약 9MB)을 받느라 시간이 걸려요.', 'The first time, the text-reading engine (~9MB) takes a moment to download.') : ''}</p></section>
    <section class="tx-box" id="hi-list">${listHtml()}</section>
    <p class="note">🔒 ${L('파일·사진은 이 기기 안에서만 읽고 서버로 보내지 않아요. 반영한 값도 이 기기(브라우저)에만 저장돼요.', 'Files and photos are read on this device only and never uploaded. Saved values stay in this browser.')}</p>
  </div>`;
  if (mode === 'search') document.getElementById('hi-q')?.focus({ preventScroll: true });
}
// 화면의 입력값 → rows (다시 그리기 전에)
function syncRows() {
  for (const el of document.querySelectorAll('#hi-sheet .hi-row')) {
    const r = rows.find((x) => x.id === +el.dataset.hid);
    if (!r) continue;
    r.on = el.querySelector('.hi-chk').checked;
    r.sh = num(el.querySelector('.hi-sh').value);
    r.avg = num(el.querySelector('.hi-avg').value);
  }
}
const status = (h) => { const s = document.getElementById('hi-status'); if (s) s.innerHTML = h; };
function addRows(list, how) {
  syncRows();
  rows = [...rows, ...list];
  const ok = list.filter((r) => r.t).length, miss = list.length - ok;
  status(list.length
    ? L(`✓ <b>${list.length}종목</b>을 읽었어요${miss ? ` · <span class="warn">종목을 못 찾은 ${miss}줄은 🔍 찾기로 골라 주세요</span>` : ''}${how ? ` · ${how}` : ''}`, `✓ Read <b>${list.length}</b>${miss ? ` · <span class="warn">${miss} need 🔍 Find</span>` : ''}`)
    : L('종목·수량을 찾지 못했어요. 보유 종목(잔고) 화면인지 확인해 주세요.', 'No holdings found. Make sure it’s the holdings screen.'));
  paintList();
  if (list.length) C.markUse?.();
}
async function readCsvFile(f) {
  const buf = await f.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('euc-kr').decode(buf); } // 한국 증권사 파일은 EUC-KR이 많다
  await readText(text);
}
async function readText(text) {
  status(L('읽는 중…', 'Reading…'));
  const { rows: R, noHeader } = parseTable(text);
  addRows(await finishRows(R), noHeader ? L('제목 줄이 없어 첫 숫자를 수량, 둘째를 평단으로 읽었어요', 'No header row: first number = shares, second = average cost') : '');
}
async function readShots(files) {
  status(L('글자 읽기 엔진 준비 중…', 'Preparing text reader…'));
  try {
    const R = await readHoldShots(files, (m) => {
      if (m.status === 'image') status(L(`사진 읽는 중… ${Math.round(m.progress * files.length) + 1}/${files.length}`, `Reading ${Math.round(m.progress * files.length) + 1}/${files.length}…`));
      else if (/load|initializ/i.test(m.status || '')) status(L(`글자 읽기 엔진 준비 중… ${Math.round((m.progress || 0) * 100)}%`, `Preparing… ${Math.round((m.progress || 0) * 100)}%`));
    });
    status(L('종목 찾는 중…', 'Matching stocks…'));
    addRows(await finishRows(R));
  } catch (e) { status(L(`읽지 못했어요: ${e.message || e}`, `Couldn’t read: ${e.message || e}`)); }
}
function doSearch(q) {
  clearTimeout(sTimer);
  if (!q.trim()) { results = []; const u = document.getElementById('hi-res'); if (u) u.innerHTML = ''; return; }
  sTimer = setTimeout(async () => {
    results = null; const u = document.getElementById('hi-res'); if (u) u.innerHTML = resHtml();
    const R = await C.search(q).catch(() => []);
    if ((document.getElementById('hi-q')?.value || '') !== q) return;
    results = R; const u2 = document.getElementById('hi-res'); if (u2) u2.innerHTML = resHtml();
  }, 300);
}
function pickResult(sym, name) {
  syncRows();
  let r;
  if (findFor) {
    r = rows.find((x) => x.id === findFor);
    if (r) { r.t = sym; r.name = name || C.nameOf(sym); settle(r, lastFx); }
    findFor = null; mode = 'search'; results = []; paint();
  } else {
    r = rows.find((x) => x.t === sym);
    if (!r) { r = { id: ++seq, on: true, t: sym, name: name || C.nameOf(sym), raw: name || sym, sh: null, avg: null, p: {} }; rows.push(r); }
    paintList();
    const b = document.querySelector(`#hi-res [data-hipick="${CSS.escape(sym)}"]`); if (b) b.outerHTML = `<span class="ws-added">${L('목록에 있음', 'Added')}</span>`;
  }
  const inp = document.querySelector(`#hi-sheet .hi-row[data-hid="${r?.id}"] .hi-sh`);
  if (inp) { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => inp.focus({ preventScroll: true }), 250); }
}
function template() {
  const csv = '﻿티커,종목명,수량,평균단가\nTSLA,테슬라,10,245.30\nSCHD,슈왑 미국 배당주,50,27.10\n005930,삼성전자,20,71500\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'fire-portfolio-holdings.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function apply() {
  syncRows();
  const on = rows.filter((r) => r.on);
  if (!on.length) { C.toast(L('넣을 종목을 골라 주세요', 'Select at least one'), true); return; }
  const miss = on.find((r) => !r.t);
  if (miss) { C.toast(L('종목을 못 찾은 줄이 있어요 · 🔍 찾기로 고르거나 체크를 빼 주세요', 'Some rows need 🔍 Find, or uncheck them'), true); return; }
  const bad = on.find((r) => !(r.sh > 0) || !(r.avg > 0));
  if (bad) { C.toast(L(`${C.nameOf(bad.t)}: 수량·평단을 숫자로 넣어 주세요`, `${bad.t}: enter shares and average cost`), true); document.querySelector(`#hi-sheet .hi-row[data-hid="${bad.id}"] ${bad.sh > 0 ? '.hi-avg' : '.hi-sh'}`)?.focus(); return; }
  const fire = document.getElementById('hi-fire')?.checked, div = document.getElementById('hi-div')?.checked;
  if (!fire && !div) { C.toast(L('반영할 곳(퇴사까지·배당금)을 골라 주세요', 'Choose where to apply'), true); return; }
  // 같은 종목이 두 줄이면 합친다(수량 더하고 평단은 가중 평균)
  const m = new Map();
  for (const r of on) {
    const x = m.get(r.t);
    if (x) { const sh = x.sh + r.sh; x.avg = (x.sh * x.avg + r.sh * r.avg) / sh; x.sh = sh; } else m.set(r.t, { t: r.t, name: r.name, sh: r.sh, avg: r.avg });
  }
  const replace = document.querySelector('#hi-sheet input[name="hi-m"]:checked')?.value === 'replace';
  close();
  C.apply([...m.values()], { fire, div, replace });
}
export function close() {
  const el = document.getElementById('hi-sheet');
  if (el) el.hidden = true;
  document.body.classList.remove('sheet-open');
  document.removeEventListener('keydown', onKey);
}
const onKey = (e) => { if (e.key === 'Escape') close(); };
function onClick(ev) {
  const t = ev.target;
  if (t.closest('[data-hiclose]')) { close(); return; }
  const md = t.closest('[data-himode]');
  if (md) { syncRows(); mode = md.dataset.himode; findFor = null; results = []; paint(); return; }
  if (t.closest('[data-hitpl]')) { template(); return; }
  if (t.closest('[data-hipaste]')) { const v = document.getElementById('hi-text')?.value || ''; if (v.trim()) readText(v); return; }
  const rm = t.closest('[data-hirm]');
  if (rm) { syncRows(); rows = rows.filter((r) => r.id !== +rm.dataset.hirm); paintList(); return; }
  const fd = t.closest('[data-hifind]');
  if (fd) {
    syncRows(); findFor = +fd.dataset.hifind; mode = 'search'; results = []; paint();
    const r = rows.find((x) => x.id === findFor), q = document.getElementById('hi-q');
    const qs = String(r?.raw || '').replace(/^[^가-힣A-Za-z]+/, '');
    if (q && qs) { q.value = qs; doSearch(qs); }
    document.querySelector('#hi-sheet .sheet-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (t.closest('[data-hifindx]')) { findFor = null; paint(); return; }
  const pk = t.closest('[data-hipick]');
  if (pk) { pickResult(pk.dataset.hipick, pk.dataset.hiname); return; }
  if (t.closest('[data-hiapply]')) { apply(); return; }
}
function onChange(ev) {
  const t = ev.target;
  if (t.id === 'hi-csv' && t.files?.[0]) { readCsvFile(t.files[0]).catch((e) => status(L(`읽지 못했어요: ${e.message || e}`, `Couldn’t read: ${e.message || e}`))); t.value = ''; return; }
  if (t.id === 'hi-img' && t.files?.length) { readShots([...t.files]); t.value = ''; return; }
  if (t.id === 'hi-fire') toFire = t.checked;
  if (t.id === 'hi-div') toDiv = t.checked;
  if (t.name === 'hi-m') replaceAll = t.value === 'replace';
  if (t.classList.contains('hi-chk')) { syncRows(); t.closest('.hi-row')?.classList.toggle('hi-off', !t.checked); const b = document.querySelector('#hi-sheet [data-hiapply]'); if (b) b.textContent = L(`${rows.filter((r) => r.on).length}종목 반영하기`, `Apply ${rows.filter((r) => r.on).length}`); }
}
function onInput(ev) { if (ev.target.id === 'hi-q') doSearch(ev.target.value); }

export function openHoldImport(ctx, opts = {}) {
  C = { ...ctx, from: opts.from };
  mode = opts.mode || 'csv';
  toFire = opts.from !== 'div' || !!ctx.hasFire; toDiv = opts.from !== 'fire' || !!ctx.hasDiv; replaceAll = false;
  findFor = null; results = [];
  let el = document.getElementById('hi-sheet');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hi-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    document.body.appendChild(el);
  }
  el.setAttribute('aria-label', L('보유 종목 한 번에 넣기', 'Import holdings'));
  el.hidden = false;
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  paint();
}
