// 증권 앱(도미노 등) '거래' 화면 캡처 → 매수·매도 기록. 글자 읽기(OCR)는 이 기기에서 하고, 사진은 서버로 보내지 않는다.
// 화면 한 건 = 두 줄:  "5. 27.  (+) 매수   $164.15"  /  "+7주 · $23.45   -30.23%"
//  - (+)/(—) 아이콘으로 매수/매도, 첫 줄 끝 $ = 거래 금액, 둘째 줄 첫 $ = 1주 가격
//  - '주' 글자는 영어 OCR이 숫자·기호로 잘못 읽어서(+7주 → +72), 수량은 금액 ÷ 가격으로 계산하고 읽은 숫자는 확인용으로만 쓴다
// window.__tradeOcr = { parseText, mergeShots, assignYears }
(() => {
  'use strict';
  const num = (s) => parseFloat(String(s).replace(/,/g, ''));
  const ROW2 = /^[+\-−–]?\s?\d[\d,]*\S*\s+[-+·•]\s+\$/; // "+72 - $23.45" 같은 둘째 줄
  const ROW1 = /^(.*?)\s*([+—–\-−])\s+.*?\$\s?([\d,]+\.\d{2})\s*$/; // 날짜 · 아이콘 · … · $금액

  function parseText(text) {
    const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const rows = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i], b = lines[i + 1];
      if (/\$\s?[\d,]+\.\d{2}\s+[+\-−–]?\d+(\.\d+)?%/.test(a) || ROW2.test(a)) continue; // 둘째 줄(가격 뒤 수익률 %)은 첫 줄로 보지 않는다
      const ma = a.match(ROW1), mb = b.match(/\$\s?([\d,]+\.\d{2})/);
      if (!ma || !mb) continue;
      const amount = num(ma[3]), price = num(mb[1]);
      if (!(amount > 0 && price > 0)) continue;
      const dm = ma[1].match(/(\d{1,2})\s*\.\s*(\d{1,2})/);
      const md = dm && +dm[1] >= 1 && +dm[1] <= 12 && +dm[2] >= 1 && +dm[2] <= 31 ? [+dm[1], +dm[2]] : null;
      const raw = amount / price, whole = Math.round(raw);
      const exact = whole > 0 && Math.abs(raw - whole) < 0.02;
      const q = b.match(/^[+\-−–]?\s*(\d[\d,]*)/);
      const sh = exact ? whole : Math.round(raw * 10000) / 10000; // 소수점 주식이면 그대로
      rows.push({ side: ma[2] === '+' ? 'buy' : 'sell', md, amount, price, sh, ok: exact && !!md, qtyMatch: !!q && q[1].replace(/,/g, '').startsWith(String(whole)) });
      i++;
    }
    return rows;
  }

  // 여러 장: 앞 장의 끝과 뒷 장의 시작이 겹치면(같은 줄이 두 번 찍힘) 한 번만 남긴다. 같은 날 같은 거래가 실제로 여러 번 있을 수 있어 '연속된 겹침'만 지운다.
  const same = (x, y) => x.side === y.side && x.amount === y.amount && x.price === y.price && String(x.md) === String(y.md);
  const ord = (r) => (r.md ? r.md[0] * 100 + r.md[1] : null);
  function mergeShots(shots) {
    // 최근 화면이 먼저 오게(첫 줄 날짜가 늦은 순). 날짜를 못 읽은 장은 원래 순서 유지
    const list = shots.filter((s) => s.length).map((s, i) => ({ s, i, k: ord(s.find((r) => r.md) || {}) ?? -1 }));
    list.sort((a, b) => b.k - a.k || a.i - b.i);
    const out = [];
    for (const { s } of list) {
      let k = Math.min(out.length, s.length);
      for (; k > 0; k--) {
        let m = true;
        for (let j = 0; j < k; j++) if (!same(out[out.length - k + j], s[j])) { m = false; break; }
        if (m) break;
      }
      out.push(...s.slice(k));
    }
    return out;
  }

  // 연도: 연도를 고르면(newestYear) 모든 줄을 그 해로 넣는다.
  // 자동이면 맨 위(가장 최근)가 오늘 이후 날짜면 작년, 아니면 올해. 아래로 내려가며 날짜가 한 달 넘게 커지면(12월 → 1월을 거꾸로 넘음) 한 해 전으로.
  // 하루이틀 순서가 뒤바뀐 건 글자를 잘못 읽은 것일 수 있어 해를 넘기지 않는다.
  const doy = (md) => (md[0] - 1) * 31 + md[1];
  function assignYears(rows, newestYear) {
    const today = new Date(), tOrd = (today.getMonth() + 1) * 100 + today.getDate();
    const fixed = Number.isInteger(newestYear) && newestYear > 1900;
    let year = fixed ? newestYear : null, prev = null;
    for (const r of rows) {
      const o = ord(r);
      if (o == null) { r.d = ''; continue; }
      if (!fixed) {
        if (year == null) year = o > tOrd ? today.getFullYear() - 1 : today.getFullYear();
        if (prev != null && doy(r.md) - prev > 31) year--;
        prev = doy(r.md);
      }
      r.d = `${year}-${String(r.md[0]).padStart(2, '0')}-${String(r.md[1]).padStart(2, '0')}`;
    }
    return rows;
  }

  // 사진 → 흑백 반전(어두운 화면 글자를 검은 글자로) — 캔버스로
  async function prepImage(file) {
    const bmp = await createImageBitmap(file);
    const scale = bmp.width < 900 ? 2 : 1;
    const c = document.createElement('canvas');
    c.width = bmp.width * scale; c.height = bmp.height * scale;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4 * 97) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    const dark = sum / (d.length / (4 * 97)) < 128; // 어두운 화면이면 뒤집는다
    for (let i = 0; i < d.length; i += 4) {
      let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (dark) v = 255 - v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  let workerP = null;
  function getWorker(onProgress) {
    if (!workerP) {
      workerP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'assets/ocr/tesseract.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('OCR 엔진을 불러오지 못했어요'));
        document.head.appendChild(s);
      }).then(() => window.Tesseract.createWorker('eng', 1, {
        workerPath: 'assets/ocr/worker.min.js', corePath: 'assets/ocr/core', langPath: 'assets/ocr/lang', workerBlobURL: false, gzip: true,
        logger: (m) => onProgress?.(m),
      }));
      workerP.catch(() => { workerP = null; });
    }
    return workerP;
  }
  async function readShots(files, onProgress) {
    const w = await getWorker(onProgress);
    const shots = [];
    for (const [i, f] of [...files].entries()) {
      onProgress?.({ status: 'image', progress: i / files.length });
      const { data } = await w.recognize(await prepImage(f));
      shots.push(parseText(data.text));
    }
    return mergeShots(shots);
  }

  const api = { parseText, mergeShots, assignYears, readShots };
  if (typeof window !== 'undefined') window.__tradeOcr = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
