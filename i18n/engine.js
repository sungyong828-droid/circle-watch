// 영어 보기: 화면에 나타나는 한국어 문구를 사전(window.__I18N_EN)으로 바꾼다.
// 1) 문구 전체가 사전에 있으면 그대로 2) 날짜·시간·단위 규칙 3) 문구 안의 아는 조각을 바꾸고 남은 조사를 정리.
// 뉴스 제목(.nt)·키워드 칩처럼 원문을 그대로 둬야 하는 곳은 건너뛴다.
(() => {
  'use strict';
  const D = window.__I18N_EN || {};
  const HAN = /[가-힣]/;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const exact = new Map();
  for (const [k, v] of Object.entries(D)) exact.set(norm(k), v);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PUNC = /^[\s·:,;)(\-–—→←•]+|[\s·:,;(\-–—→←•]+$/g;
  const sub = new Map();
  for (const [k, v] of exact) {
    const ks = k.replace(PUNC, '');
    if (ks.length < 2 || !HAN.test(ks) || sub.has(ks)) continue;
    sub.set(ks, ks === k ? v : v.replace(PUNC, ''));
  }
  // 숫자로 시작하는 조각('1주'·'30일')은 앞에 숫자가 붙어 있으면 맞추지 않는다('21주'를 '2'+'1W'로 바꾸지 않게)
  const subKeys = [...sub.keys()].sort((a, b) => b.length - a.length);
  const subRe = subKeys.length ? new RegExp(subKeys.map((k) => (/^\d/.test(k) ? '(?<![\\d.,])' : '') + reEsc(k)).join('|'), 'g') : null;
  const subRep = (m, off, str) => {
    let v = sub.get(m) ?? m;
    if (/^[A-Za-z(#~$]/.test(v) && /[A-Za-z0-9%)$\uE001]/.test(str[off - 1] || '')) v = ' ' + v; // 'K계약' → 'K contracts'
    if (/[A-Za-z)]$/.test(v) && /[A-Za-z0-9$(\uE000]/.test(str[off + m.length] || '')) v += ' ';
    return v;
  };
  const WD = { 일: 'Sun', 월: 'Mon', 화: 'Tue', 수: 'Wed', 목: 'Thu', 금: 'Fri', 토: 'Sat' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = (m) => MON[(+m - 1 + 12) % 12];
  // 조각 바꾸기 전에 적용(날짜·시간처럼 숫자와 붙은 말)
  const RULES_A = [
    [/(\d{4})년 (\d{1,2})월 (\d{1,2})일/g, (_, y, m, d) => `${mon(m)} ${d}, ${y}`],
    [/(\d{1,2})월 (\d{1,2})일 ?\(([일월화수목금토])\)/g, (_, m, d, w) => `${WD[w]}, ${mon(m)} ${d}`],
    [/(\d{1,2})월 (\d{1,2})일/g, (_, m, d) => `${mon(m)} ${d}`],
    [/(\d{1,2})~(\d{1,2})월/g, (_, a, b) => `${mon(a)}–${mon(b)}`],
    [/(\d+)시간 (\d+)분 후/g, 'in $1h $2m'],
    [/(\d+)시간 후/g, 'in $1h'],
    [/(\d+) ?분 후/g, 'in $1m'],
    [/(\d+)시간 (\d+)분 전/g, '$1h $2m ago'],
    [/(\d+) ?분 전/g, '$1m ago'],
    [/(\d+) ?시간 전/g, '$1h ago'],
    [/(\d+) ?일 전/g, '$1d ago'],
    [/(\d+)시간 (\d+)분/g, '$1h $2m'],
    [/(\d+) ?분 남음/g, '$1m left'],
    [/(\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}) 기준/g, 'as of $1'],
    [/오전 (\d{1,2}):(\d{2})/g, '$1:$2 AM'],
    [/오후 (\d{1,2}):(\d{2})/g, '$1:$2 PM'],
  ];
  // 조각 바꾼 뒤 남은 숫자+단위
  const RULES_B = [
    // 원화 금액: 1,537조 5,713억 → ₩1,537.6T · 5,713억 → ₩571.3B · 86,052원 → ₩86,052
    [/(?<![\d.,₩])(\d[\d,]*(?:\.\d+)?)조(?: (\d[\d,]*)억)?/g, (_, a, b) => `₩${(+a.replace(/,/g, '') + (b ? +b.replace(/,/g, '') / 1e4 : 0)).toLocaleString('en-US', { maximumFractionDigits: 1 })}T`],
    [/(?<![\d.,₩])(\d[\d,]*(?:\.\d+)?)억(?!원)/g, (_, a) => `₩${(+a.replace(/,/g, '') / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`],
    [/([+-]?)(?<![\d.,])(\d[\d,]*(?:\.\d+)?)원(?![가-힣])/g, '$1₩$2'],
    [/(\d{4})년 (\d{1,2})분기/g, (_, y, q) => `Q${q} ${y}`],
    [/(\d{4})년 (\d{1,2})월/g, (_, y, m) => `${mon(m)} ${y}`],
    [/(\d{4})년/g, '$1'],
    [/(\d)분기/g, 'Q$1'],
    [/(\d+) ?개월/g, '$1mo'],
    [/(\d+) ?거래일/g, '$1 trading days'],
    [/(\d+) ?영업일/g, '$1 business days'],
    [/(\d[\d,.]*[KMBT]?) ?계약/g, '$1 contracts'],
    [/(\d[\d,.]*[KMBT]?) ?주(?![가-힣])/g, '$1 sh'],
    [/(\d+) ?위(?![가-힣])/g, '#$1'],
    [/(^|\s)약$/g, '$1~'],
    [/약 ?(?=[$\d])/g, '~'],
    [/(^|[\s(·])콜(?=\s|$)/g, '$1Call'],
    [/(^|[\s(·])풋(?=\s|$)/g, '$1Put'],
    [/(\d+) ?일(?![가-힣])/g, '$1d'],
    [/(\d+) ?시간(?![가-힣])/g, '$1h'],
    [/(\d+) ?분(?![가-힣])/g, '$1m'],
    [/(\d+) ?[개건명회](?![가-힣])/g, '$1'],
    [/(\d+) ?곳(?![가-힣])/g, '$1 firms'],
    [/(\d+) ?배(?![가-힣])/g, '$1x'],
    [/(\d+) ?년(?![가-힣])/g, '$1y'],
    [/\(([일월화수목금토])\)/g, (_, w) => `(${WD[w]})`],
  ];
  // 영어로 바뀐 말 뒤에 남은 한국어 조사·어미 정리
  const PART = /([A-Za-z0-9)%$\]’'\uE001])(?:으로는|으로|에서|에게|이며|이고|이에요|예요|입니다|은|는|이|가|을|를|의|에|로|와|과|도|만)(?=[\s,.:;·)!?]|$)/g;
  const cache = new Map();
  // 한국 종목 이름(삼성전자·TIGER 미국배당다우존스 등)은 조각 번역으로 망가지지 않게 그대로 둔다 — app.js가 이름을 등록
  const KEEP = (window.__i18nKeepSet ||= new Set());
  let keepN = 0, keepRe = null;
  const syncKeep = () => {
    if (KEEP.size === keepN) return;
    keepN = KEEP.size; cache.clear();
    keepRe = new RegExp([...KEEP].sort((a, b) => b.length - a.length).map(reEsc).join('|'), 'g');
  };
  function tr(s) {
    if (typeof s !== 'string' || !HAN.test(s)) return s;
    syncKeep();
    if (cache.has(s)) return cache.get(s);
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    let t = norm(s);
    const kept = [];
    if (!exact.has(t) && keepRe) t = t.replace(keepRe, (m) => `\uE000${kept.push(m) - 1}\uE001`);
    if (exact.has(t)) t = exact.get(t);
    else if (!HAN.test(t)) {} // 이름만 남음
    else {
      for (const [re, rep] of RULES_A) t = t.replace(re, rep);
      if (HAN.test(t) && exact.has(t)) t = exact.get(t);
      else if (HAN.test(t) && subRe) t = t.replace(subRe, subRep);
      if (HAN.test(t)) for (const [re, rep] of RULES_B) t = t.replace(re, rep);
      if (HAN.test(t)) t = t.replace(PART, '$1');
      t = t.replace(/([\w%)])· /g, '$1 · ').replace(/ {2,}/g, ' ').replace(/ ([,.)])/g, '$1').replace(/\( /g, '(');
    }
    if (kept.length) t = t.replace(/\uE000(\d+)\uE001/g, (_, i) => kept[i]);
    const out = lead + t + trail;
    if (cache.size > 8000) cache.clear();
    cache.set(s, out);
    return out;
  }
  window.__tr = tr;

  const SKIP = 'script,style,textarea,code,.nt,.nsum,.kw-chip,[data-noi18n]';
  const ATTRS = ['aria-label', 'title', 'placeholder'];
  const done = new WeakMap();
  function trText(n) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const v = n.nodeValue;
    if (done.get(n) === v || !HAN.test(v)) return;
    // 뉴스 출처 줄(매체 · 해외 · 시각)은 고유명사가 섞여 있어 '·'로 나눈 조각을 통째 일치로만 바꾼다
    const o = p.closest('.nm') ? v.split(' · ').map((x) => exact.get(x.trim()) ?? x).join(' · ') : tr(v);
    done.set(n, o);
    if (o !== v) n.nodeValue = o;
  }
  function trAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && HAN.test(v)) { const o = tr(v); if (o !== v) el.setAttribute(a, o); } // 같은 값을 다시 넣으면 변경 알림이 끝없이 돈다
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { trText(root); return; }
    if (root.nodeType !== 1) return;
    trAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) trText(n); else trAttrs(n); }
  }
  function start() {
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') trText(m.target);
        else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v && HAN.test(v)) { const o = tr(v); if (o !== v) m.target.setAttribute(m.attributeName, o); } }
        else for (const n of m.addedNodes) walk(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    document.documentElement.classList.remove('i18n-wait');
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
