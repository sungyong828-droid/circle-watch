// 화면 테마(다크·라이트) — 스타일보다 먼저 읽어 처음 그릴 때부터 고른 테마로 보이게 한다(깜빡임 방지).
// 고른 값은 이 기기에만 저장(cw.theme). 기본은 다크. 바꾸는 버튼은 app.js(#theme-btn)에 있다.
(function () {
  var t = 'dark';
  try {
    var q = (location.search.match(/[?&]theme=(light|dark)\b/) || [])[1]; // ?theme=light 링크로도 고를 수 있게
    if (q) localStorage.setItem('cw.theme', q);
    if (localStorage.getItem('cw.theme') === 'light') t = 'light';
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'light' ? '#f3f5f8' : '#0d1015');
})();
