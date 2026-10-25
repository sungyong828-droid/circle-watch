// 화면에 보이는 글자 중 '단어 가운데에서 줄이 바뀐 곳'을 찾는다(한글·영문·숫자 사이에서 줄이 바뀌면 문제)
(() => {
  const W = /[\p{L}\p{N}]/u, out = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  const rng = document.createRange();
  while ((n = walker.nextNode())) {
    const t = n.nodeValue;
    if (!t || t.trim().length < 2) continue;
    const p = n.parentElement;
    if (!p || p.closest('script,style,svg,canvas,input,textarea,select,option,[hidden],.sheet[hidden]') || !visible(p)) continue;
    let prevTop = null, prevCh = '';
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === ' ' || ch === '\n') { prevCh = ' '; continue; }
      rng.setStart(n, i); rng.setEnd(n, i + 1);
      const rs = rng.getClientRects();
      if (!rs.length) continue;
      const top = Math.round(rs[0].top);
      if (prevTop != null && top > prevTop + 3 && W.test(ch) && W.test(prevCh)) {
        const el = p.closest('[id]');
        out.push(`${el ? '#' + el.id : p.tagName}.${p.className || ''} | "${t.slice(Math.max(0, i - 8), i)}⏎${t.slice(i, i + 8)}"`);
        break;
      }
      prevTop = top; prevCh = ch;
    }
  }
  return [...new Set(out)].slice(0, 60);
})();
