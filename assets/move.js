// 다른 기기로 옮기기 — 이 기기의 보유 정보·관심 종목·설정을 짧은 코드(또는 QR)로 새 기기에 옮긴다
// 버튼을 누를 때만 받는 모듈. 코드로 암호화(AES-GCM)해서 서버에는 암호문과 '코드의 해시'만 10분 동안 두고, 받으면 바로 지운다.
// 서버는 코드를 모르니 내용을 열어 볼 수 없다.
// ctx(app.js가 넘김): { EN, esc, toast, api, keys, summary(data) → ['보유 종목 5개', …], loadQr(), done() }

const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 헷갈리는 글자(0·O·1·I·L) 뺌
const enc = new TextEncoder(), dec = new TextDecoder();
let C = null, tab = 'send', sent = null, got = null, timer = null;
const L = (ko, en) => (C?.EN ? en : ko);

function newCode() {
  const out = [];
  while (out.length < 10) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    for (const x of b) if (x < 248 && out.length < 10) out.push(ABC[x % 31]); // 248 = 31 × 8 (치우침 없이)
  }
  return out.join('');
}
const clean = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const pretty = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function keysOf(code) {
  const id = [...await sha('fp-move-id|' + code)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', await sha('fp-move-key|' + code), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { id, key };
}
async function pipe(u8, Stream) {
  if (typeof Stream !== 'function') return u8;
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer());
}
const gz = typeof CompressionStream === 'function';

function collect() {
  const data = {};
  for (const k of C.keys) { try { const v = localStorage.getItem(k); if (v != null) data[k] = v; } catch {} }
  return data;
}
async function send() {
  const data = collect();
  if (!Object.keys(data).length) { C.toast(L('옮길 정보가 아직 없어요', 'Nothing to move yet'), true); return; }
  const code = newCode(), { id, key } = await keysOf(code);
  let body = enc.encode(JSON.stringify({ v: 1, at: Date.now(), data }));
  if (gz) body = await pipe(body, CompressionStream);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
  const pack = new Uint8Array(1 + 12 + ct.length);
  pack[0] = gz ? 1 : 0; pack.set(iv, 1); pack.set(ct, 13);
  const r = await fetch(`${C.api}/move`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, d: b64(pack) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error === 'too many' ? L('잠시 뒤 다시 해 주세요', 'Try again in a few minutes') : L('코드를 만들지 못했어요', 'Could not create a code'));
  sent = { code, exp: j.exp || Date.now() + 600000, url: `${location.origin}/#move=${pretty(code)}`, qr: null };
  try { const qrcode = await C.loadQr(); const q = qrcode(0, 'M'); q.addData(sent.url); q.make(); sent.qr = q.createDataURL(5, 8); } catch {}
}
async function receive(raw) {
  const code = clean(raw);
  if (code.length !== 10) throw new Error(L('코드 10자리를 확인해 주세요', 'Check the 10-character code'));
  const { id, key } = await keysOf(code);
  const r = await fetch(`${C.api}/move?id=${id}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.d) throw new Error(L('코드가 맞지 않거나 10분이 지났어요. 보내는 기기에서 새 코드를 만들어 주세요.', 'Wrong code or it expired after 10 minutes. Make a new code on the other device.'));
  const pack = unb64(j.d);
  let body;
  try { body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: pack.subarray(1, 13) }, key, pack.subarray(13))); }
  catch { throw new Error(L('내용을 열지 못했어요. 코드를 다시 확인해 주세요.', 'Could not open it — check the code.')); }
  if (pack[0] === 1) body = await pipe(body, typeof DecompressionStream === 'function' ? DecompressionStream : null);
  const P = JSON.parse(dec.decode(body));
  const data = Object.fromEntries(Object.entries(P.data || {}).filter(([k, v]) => C.keys.includes(k) && typeof v === 'string'));
  got = { at: P.at, data };
}
function apply() {
  if (!got) return;
  for (const [k, v] of Object.entries(got.data)) { try { localStorage.setItem(k, v); } catch {} }
  C.toast(L('✓ 이 기기에 옮겼어요 · 새로 불러오는 중', '✓ Moved to this device · reloading'));
  close();
  C.done?.();
}

function mm(ms) { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function bodyHtml() {
  const { esc } = C;
  if (tab === 'send') {
    if (sent) {
      const left = sent.exp - Date.now();
      if (left <= 0) return `<p class="note">${L('코드 유효 시간(10분)이 지났어요. 새 코드를 만들어 주세요.', 'The code expired. Make a new one.')}</p><button type="button" class="btn-primary oc-add" data-mvmake="1">${L('새 코드 만들기', 'New code')}</button>`;
      return `<div class="mv-code"><small>${L('새 기기에서 넣을 코드', 'Code for the new device')}</small><b>${esc(pretty(sent.code))}</b><span id="mv-left">${L('남은 시간', 'Expires in')} ${mm(left)}</span></div>
        ${sent.qr ? `<div class="mv-qr"><img src="${sent.qr}" alt="${L('옮기기 QR 코드', 'Move QR code')}" width="200" height="200"><small>${L('새 휴대폰 카메라로 찍으면 바로 열려요', 'Scan with the new phone’s camera')}</small></div>` : ''}
        <ol class="mv-steps"><li>${L('새 기기에서 <b>my-fire-portfolio.pages.dev</b>를 열어요', 'Open <b>my-fire-portfolio.pages.dev</b> on the new device')}</li><li>${L('맨 아래 <b>🔄 다른 기기로 옮기기 → 받기</b>에 코드를 넣어요', 'Tap <b>🔄 Move to another device → Receive</b> at the bottom and enter the code')}</li></ol>
        <p class="note">${L('코드는 한 번만 쓸 수 있고 10분 뒤 사라져요. 내용은 코드로 암호화돼서 서버도 볼 수 없어요.', 'One-time code, gone after 10 minutes. Encrypted with the code, so the server can’t read it.')}</p>`;
    }
    const sum = C.summary(collect());
    return `<p class="note">${L('이 기기에 저장된 정보를 새 기기(폰·PC)로 옮겨요. 옮긴 뒤에도 이 기기의 정보는 그대로 있어요.', 'Copy what’s saved on this device to a new phone or PC. Nothing is removed here.')}</p>
      ${sum.length ? `<ul class="mv-sum">${sum.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="note">${L('아직 옮길 정보가 없어요.', 'Nothing saved yet.')}</p>`}
      <button type="button" class="btn-primary oc-add" data-mvmake="1" ${sum.length ? '' : 'disabled'}>${L('옮기기 코드 만들기', 'Make a move code')}</button>
      <p class="note">🔒 ${L('코드로 암호화한 뒤 10분만 보관하고, 새 기기가 받으면 바로 지워요.', 'Encrypted with the code, kept 10 minutes, deleted once received.')}</p>`;
  }
  if (got) {
    const sum = C.summary(got.data);
    return `<p class="note">${L(`${new Date(got.at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 보낸 정보예요.`, `Sent ${new Date(got.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`)}</p>
      <ul class="mv-sum">${sum.map((x) => `<li>${esc(x)}</li>`).join('') || `<li>${L('설정', 'Settings')}</li>`}</ul>
      <p class="note warn">⚠ ${L('이 기기에 이미 있던 같은 정보(보유 종목·관심 종목 등)는 받은 내용으로 바뀌어요.', 'Matching info already on this device will be replaced.')}</p>
      <button type="button" class="btn-primary oc-add" data-mvapply="1">${L('이 기기에 넣기', 'Put it on this device')}</button>`;
  }
  return `<p class="note">${L('보내는 기기에서 만든 <b>코드 10자리</b>를 넣어 주세요. 대소문자·하이픈(-)은 상관없어요.', 'Enter the <b>10-character code</b> from the other device. Case and dashes don’t matter.')}</p>
    <div class="mv-in"><input id="mv-code" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14" placeholder="ABCDE-FGHJK" aria-label="${L('옮기기 코드', 'Move code')}"><button type="button" class="btn-primary" data-mvget="1">${L('받기', 'Receive')}</button></div>
    <p class="oc-status" id="mv-status"></p>`;
}
function paint() {
  const el = document.getElementById('mv-sheet');
  if (!el) return;
  el.innerHTML = `<div class="sheet-bg" data-mvclose="1"></div><div class="sheet-panel oc-panel mv-panel">
    <div class="sheet-h"><b>🔄 ${L('다른 기기로 옮기기', 'Move to another device')}</b><button type="button" class="ws-btn" data-mvclose="1">${L('닫기', 'Close')}</button></div>
    <div class="div-tabs mv-tabs" role="tablist">${[['send', L('📤 이 기기에서 보내기', '📤 Send from here')], ['recv', L('📥 새 기기에서 받기', '📥 Receive here')]].map(([k, l]) => `<button type="button" role="tab" data-mvtab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
    <section class="tx-box">${bodyHtml()}</section>
  </div>`;
}
function tick() {
  clearInterval(timer);
  timer = setInterval(() => {
    const el = document.getElementById('mv-left');
    if (!sent || !el) return;
    const left = sent.exp - Date.now();
    if (left <= 0) { paint(); clearInterval(timer); return; }
    el.textContent = `${L('남은 시간', 'Expires in')} ${mm(left)}`;
  }, 1000);
}
async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = '…'; }
  try { await fn(); } finally { if (btn?.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.t; } }
}
function onClick(ev) {
  const t = ev.target;
  if (t.closest('[data-mvclose]')) { close(); return; }
  const tb = t.closest('[data-mvtab]');
  if (tb) { tab = tb.dataset.mvtab; paint(); if (tab === 'recv') document.getElementById('mv-code')?.focus(); return; }
  const mk = t.closest('[data-mvmake]');
  if (mk) { busy(mk, async () => { try { await send(); paint(); tick(); } catch (e) { C.toast(e.message || String(e), true); } }); return; }
  const gt = t.closest('[data-mvget]');
  if (gt) { getCode(gt); return; }
  if (t.closest('[data-mvapply]')) { apply(); return; }
}
function getCode(btn) {
  const v = document.getElementById('mv-code')?.value || '', st = document.getElementById('mv-status');
  busy(btn, async () => {
    try { if (st) st.textContent = L('받는 중…', 'Receiving…'); await receive(v); paint(); }
    catch (e) { if (st) st.innerHTML = `<span class="warn">${C.esc(e.message || String(e))}</span>`; }
  });
}
const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target?.id === 'mv-code') getCode(document.querySelector('[data-mvget]')); };
export function close() {
  const el = document.getElementById('mv-sheet');
  if (el) el.hidden = true;
  clearInterval(timer);
  document.body.classList.remove('sheet-open');
  document.removeEventListener('keydown', onKey);
}
export function openMove(ctx, opts = {}) {
  C = ctx;
  tab = opts.tab === 'recv' ? 'recv' : 'send';
  if (sent && sent.exp < Date.now()) sent = null;
  got = null;
  let el = document.getElementById('mv-sheet');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mv-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
  }
  el.setAttribute('aria-label', L('다른 기기로 옮기기', 'Move to another device'));
  el.hidden = false;
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  paint();
  if (sent) tick();
  if (tab === 'recv' && opts.code) {
    const i = document.getElementById('mv-code');
    if (i) { i.value = opts.code; getCode(document.querySelector('[data-mvget]')); }
  }
}
