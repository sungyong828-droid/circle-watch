// Circle / Arc 대시보드 데이터 수집기
// GitHub Actions에서 15분마다 실행되어 data/latest.json(화면용)과 data/state.json(누적 상태)을 만든다.
// 외부 의존성 없음 (Node 20+ 내장 fetch 사용).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

const ADDR = {
  arcUsdc: '0x3600000000000000000000000000000000000000',
  arcEurc: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
  arcCirbtc: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0',
  ethCirbtc: '0x72dfb2e44f59c5ad2bafe84314e5b99a7cd5075e',
  tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
};

// CCTP V2 이벤트 topic0 (Arc 온체인 로그에서 확인)
const TOPIC = {
  depositForBurn: '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5',
  mintAndWithdraw: '0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63',
  messageReceived: '0xff48c13eda96b1cceacc6b9edeedc9e9db9d6226afbc30146b720c19d3addb1c',
};

const RPC = {
  arc: ['https://rpc.mainnet.arc.io', 'https://rpc.blockdaemon.mainnet.arc.io', 'https://rpc.quicknode.mainnet.arc.io'],
  arcLogs: [
    { url: 'https://rpc.blockdaemon.mainnet.arc.io', span: 45000 },
    { url: 'https://rpc.mainnet.arc.io', span: 4900 },
  ],
  eth: ['https://eth.drpc.org', 'https://ethereum-rpc.publicnode.com'],
};

const STABLE_ROWS = [
  { id: '1', sym: 'USDT', issuer: 'Tether · 1위' },
  { id: '2', sym: 'USDC', issuer: 'Circle', circle: true },
  { id: '209', sym: 'USDS', issuer: 'Sky(구 Maker)' },
  { id: '146', sym: 'USDe', issuer: 'Ethena · 합성 달러' },
  { id: '5', sym: 'DAI', issuer: 'Sky(구 Maker)' },
  { id: '262', sym: 'USD1', issuer: 'World Liberty Financial' },
  { id: '286', sym: 'USDG', issuer: 'Paxos · Global Dollar Network' },
  { id: '120', sym: 'PYUSD', issuer: 'PayPal' },
  { id: '250', sym: 'RLUSD', issuer: 'Ripple' },
  { id: '119', sym: 'FDUSD', issuer: 'First Digital' },
  { id: '343', sym: 'USAT', issuer: 'Tether 미국용' },
];
const PRODUCT_ROWS = [
  { id: '237', sym: 'USYC', issuer: 'Circle 토큰화 MMF', circle: true },
  { id: '50', sym: 'EURC', issuer: 'Circle 유로 코인', circle: true, cur: 'EUR' },
  { id: '173', sym: 'BUIDL', issuer: 'BlackRock 토큰화 MMF' },
];

const DOMAINS = {
  0: 'Ethereum', 1: 'Avalanche', 2: 'OP Mainnet', 3: 'Arbitrum', 4: 'Noble', 5: 'Solana', 6: 'Base',
  7: 'Polygon PoS', 8: 'Sui', 9: 'Aptos', 10: 'Unichain', 11: 'Linea', 12: 'Codex', 13: 'Sonic',
  14: 'World Chain', 15: 'Monad', 16: 'Sei', 17: 'BNB Chain', 18: 'XDC', 19: 'HyperEVM', 21: 'Ink',
  22: 'Plume', 25: 'Starknet', 26: 'Arc', 27: 'Stellar', 28: 'EDGE', 29: 'Injective', 30: 'Morph',
  31: 'Pharos', 32: 'Cronos', 33: 'Plasma', 37: 'X Layer',
};

const DAY = 86400;
const HISTORY_START = Date.UTC(2025, 5, 1) / 1000; // 2025-06-01 (공급량 추이 시작)
const ONCHAIN_START = Date.UTC(2026, 5, 1) / 1000; // 2026-06-01 (cirBTC·Arc 공급 일별 백필 시작)
const MAX_SNAPSHOTS = 800; // 15분 간격이면 약 8일

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayStart = (ts) => Math.floor(ts / DAY) * DAY;
const isoDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const hex = (n) => '0x' + n.toString(16);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(url, { timeout = 60000, retries = 2 } = {}) {
  let err;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'circle-dashboard-collector' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      err = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw err;
}

async function rpcCall(url, method, params, timeout = 30000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${url} ${method}: ${j.error.message}`);
  return j.result;
}

async function rpc(urls, method, params) {
  let err;
  for (const u of urls) {
    for (let i = 0; i < 2; i++) {
      try { return await rpcCall(u, method, params); } catch (e) { err = e; await sleep(800); }
    }
  }
  throw err;
}

async function totalSupply(urls, token, decimals, block = 'latest') {
  const r = await rpc(urls, 'eth_call', [{ to: token, data: '0x18160ddd' }, block]);
  if (!r || r === '0x') return 0; // 해당 블록에 컨트랙트 없음
  return Number(BigInt(r)) / 10 ** decimals;
}

async function blockAt(chain, ts) {
  const j = await getJSON(`https://coins.llama.fi/block/${chain}/${ts}`, { retries: 3 });
  return j.height;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function loadState() {
  if (SITE_URL) {
    try {
      const s = await getJSON(`${SITE_URL}/data/state.json?t=${Date.now()}`, { retries: 1 });
      log('state: 배포된 사이트에서 이전 상태 불러옴');
      return s;
    } catch (e) { log('state: 사이트에서 못 불러옴 →', e.message); }
  }
  return (await readJSON(path.join(DATA_DIR, 'state.json'))) || {};
}

async function loadPrevLatest() {
  if (SITE_URL) {
    try { return await getJSON(`${SITE_URL}/data/latest.json?t=${Date.now()}`, { retries: 1 }); } catch {}
  }
  return readJSON(path.join(DATA_DIR, 'latest.json'));
}

// ---------- sections ----------

async function collectStables() {
  const d = await getJSON('https://stablecoins.llama.fi/stablecoins?includePrices=true');
  const byId = Object.fromEntries(d.peggedAssets.map((a) => [a.id, a]));
  const val = (o) => (o ? Object.values(o)[0] || 0 : 0);
  const totalUsd = d.peggedAssets.reduce((s, a) => s + (a.circulating?.peggedUSD || 0), 0);
  const row = (r) => {
    const a = byId[r.id];
    if (!a) return null;
    const cur = val(a.circulating);
    const w = val(a.circulatingPrevWeek), m = val(a.circulatingPrevMonth), dd = val(a.circulatingPrevDay);
    return {
      sym: r.sym, issuer: r.issuer, circle: !!r.circle, cur: r.cur || 'USD',
      supply: cur,
      share: r.cur ? null : cur / totalUsd,
      ch1: dd ? cur / dd - 1 : null,
      ch7: w ? cur / w - 1 : null,
      ch30: m ? cur / m - 1 : null,
    };
  };
  const rows = STABLE_ROWS.map(row).filter(Boolean);
  const products = PRODUCT_ROWS.map(row).filter(Boolean);
  const usdc = rows.find((r) => r.sym === 'USDC');
  return { totalUsd, usdcShare: usdc.share, rows, products };
}

async function collectCircleOfficial() {
  const d = await getJSON('https://api.circle.com/v1/stablecoins');
  const pick = (sym) => d.data.find((x) => x.symbol === sym);
  const usdc = pick('USDC'), eurc = pick('EURC');
  const chain = (c, name) => Number(c.chains.find((x) => x.chain === name)?.amount || 0);
  const chains = (c) => c.chains.map((x) => ({ chain: x.chain, amount: Number(x.amount) })).sort((a, b) => b.amount - a.amount);
  return {
    at: usdc.chains[0]?.updateDate || new Date().toISOString(),
    usdcTotal: Number(usdc.totalAmount),
    eurcTotal: Number(eurc.totalAmount),
    arcUsdc: chain(usdc, 'ARC'),
    arcEurc: chain(eurc, 'ARC'),
    usdcChains: chains(usdc).slice(0, 12),
    eurcChains: chains(eurc),
  };
}

async function stableSeries(id, field = 'totalCirculating') {
  const d = await getJSON(`https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${id}`);
  return d
    .map((p) => [Number(p.date), Object.values(p[field] || {})[0] || 0])
    .filter(([t]) => t >= HISTORY_START);
}

async function collectSeries() {
  const [usdc, eurc, usyc] = await Promise.all([stableSeries('2'), stableSeries('50'), stableSeries('237')]);
  return { usdc, eurc, usyc };
}

async function collectArcDex() {
  const d = await getJSON('https://api.llama.fi/overview/dexs/Arc?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true');
  const today = dayStart(Date.now() / 1000);
  const daily = d.totalDataChart.filter(([t]) => t < today).slice(-30);
  const top = (d.protocols || [])
    .filter((p) => p.total24h > 0)
    .sort((a, b) => b.total24h - a.total24h)
    .slice(0, 6)
    .map((p) => ({ name: p.displayName || p.name, v: p.total24h }));
  return { total24h: d.total24h, total7d: d.total7d, total30d: d.total30d, change1d: d.change_1d, daily, top };
}

async function collectArcTvl() {
  const [hist, chains] = await Promise.all([
    getJSON('https://api.llama.fi/v2/historicalChainTvl/Arc'),
    getJSON('https://api.llama.fi/v2/chains'),
  ]);
  const now = chains.find((c) => c.name === 'Arc')?.tvl ?? hist.at(-1).tvl;
  const firstNonZero = hist.findIndex((p) => p.tvl > 1e5);
  const daily = hist.slice(Math.max(0, firstNonZero - 1)).map((p) => [p.date, p.tvl]);
  return { now, daily };
}

async function collectLending() {
  const protos = [
    { slug: 'morpho-blue', key: 'morpho', name: 'Morpho Blue' },
    { slug: 'aave-v4', key: 'aave', name: 'Aave V4' },
  ];
  const days = {};
  const now = {};
  for (const p of protos) {
    const d = await getJSON(`https://api.llama.fi/protocol/${p.slug}`, { timeout: 120000 });
    const ct = d.chainTvls || {};
    for (const [series, suffix] of [['Arc', 'T'], ['Arc-borrowed', 'B']]) {
      const pts = ct[series]?.tvl || [];
      for (const pt of pts) {
        const k = dayStart(pt.date);
        (days[k] ||= { d: k })[p.key + suffix] = pt.totalLiquidityUSD; // 하루의 마지막 값이 남는다
      }
      if (pts.length) now[p.key + suffix] = pts.at(-1).totalLiquidityUSD;
    }
  }
  const list = Object.values(days)
    .map((r) => {
      const borrow = (r.morphoB || 0) + (r.aaveB || 0);
      const tvl = (r.morphoT || 0) + (r.aaveT || 0);
      return { ...r, borrow, tvl, util: borrow + tvl > 0 ? borrow / (borrow + tvl) : 0 };
    })
    .filter((r) => r.borrow > 0 || r.tvl > 0)
    .sort((a, b) => a.d - b.d);
  // 마일스톤: 차입 합계가 처음으로 넘어선 날
  const steps = [1e6, 1e7, 5e7, 1e8, 5e8, 1e9, 5e9];
  const milestones = steps.map((v) => {
    const hit = list.find((r) => r.borrow >= v);
    return { v, day: hit ? hit.d : null };
  });
  return { protocols: protos.map(({ key, name }) => ({ key, name })), days: list, milestones };
}

async function collectAccounts() {
  const base = 'https://explorer.arc.io/stats-service/api/v1/lines';
  const [a, n, aw, nw, counters] = await Promise.all([
    getJSON(`${base}/activeAccounts?resolution=DAY`),
    getJSON(`${base}/newAccounts?resolution=DAY`),
    getJSON(`${base}/activeAccounts?resolution=WEEK`),
    getJSON(`${base}/newAccounts?resolution=WEEK`),
    getJSON('https://explorer.arc.io/stats-service/api/v1/counters').catch(() => null),
  ]);
  const newMap = Object.fromEntries(n.chart.map((p) => [p.date, Number(p.value)]));
  const daily = a.chart.map((p) => {
    const act = Number(p.value), nw_ = newMap[p.date] ?? 0;
    return { d: p.date, active: act, new: Math.min(nw_, act), ret: Math.max(act - nw_, 0), approx: !!p.is_approximate };
  });
  const newW = Object.fromEntries(nw.chart.map((p) => [p.date, Number(p.value)]));
  const weeks = aw.chart.map((p) => {
    const act = Number(p.value), nn = newW[p.date] ?? 0;
    return { d: p.date, active: act, new: nn, retRatio: act ? Math.max(act - nn, 0) / act : 0, approx: !!p.is_approximate };
  });
  const c = Object.fromEntries((counters?.counters || []).map((x) => [x.id, Number(x.value)]));
  return {
    daily,
    weeks: weeks.slice(-8),
    totals: { accounts: c.totalAccounts, txns: c.totalTxns, blockTime: c.averageBlockTime },
  };
}

// 일별(UTC 하루 끝 시점) 온체인 공급량: cirBTC(Arc·Ethereum), Arc 위 USDC·EURC
async function collectOnchainDaily(state) {
  const store = (state.onchainDaily ||= {});
  const today = dayStart(Date.now() / 1000);
  const todo = [];
  for (let d = ONCHAIN_START; d < today; d += DAY) if (!store[isoDay(d)]) todo.push(d);
  if (todo.length) log(`onchain 일별 백필 ${todo.length}일`);
  await pool(todo, 3, async (d) => {
    const end = d + DAY - 1;
    const row = {};
    try {
      const b = await blockAt('arc', end);
      const blk = hex(b);
      const [c, u, e] = await Promise.all([
        totalSupply(RPC.arc, ADDR.arcCirbtc, 8, blk),
        totalSupply(RPC.arc, ADDR.arcUsdc, 6, blk),
        totalSupply(RPC.arc, ADDR.arcEurc, 6, blk),
      ]);
      Object.assign(row, { arcBtc: c, arcUsdc: u, arcEurc: e });
    } catch (e) {
      if (/block|No block|404/i.test(e.message)) Object.assign(row, { arcBtc: 0, arcUsdc: 0, arcEurc: 0 });
      else { log('arc 백필 실패', isoDay(d), e.message); return; }
    }
    try {
      const b = await blockAt('ethereum', end);
      row.ethBtc = await totalSupply(RPC.eth, ADDR.ethCirbtc, 8, hex(b));
    } catch (e) { log('eth 백필 실패', isoDay(d), e.message); return; }
    store[isoDay(d)] = row;
  });
  const [arcBtc, ethBtc, arcUsdc, arcEurc] = await Promise.all([
    totalSupply(RPC.arc, ADDR.arcCirbtc, 8),
    totalSupply(RPC.eth, ADDR.ethCirbtc, 8),
    totalSupply(RPC.arc, ADDR.arcUsdc, 6),
    totalSupply(RPC.arc, ADDR.arcEurc, 6),
  ]);
  const days = Object.entries(store)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, r]) => ({ d, ...r }));
  return { now: { arcBtc, ethBtc, arcUsdc, arcEurc }, days };
}

// CCTP: 최근 24시간 Arc ↔ 타 체인 USDC 흐름 (Arc 온체인 이벤트 집계)
async function collectCctp(state) {
  const st = (state.cctp ||= { lastBlock: 0, events: [] });
  const latest = Number(await rpc(RPC.arc, 'eth_blockNumber', []));
  const nowTs = Math.floor(Date.now() / 1000);
  let startBlock;
  try { startBlock = await blockAt('arc', nowTs - DAY); } catch { startBlock = latest - Math.round(DAY / 0.55); }
  let from = Math.max(st.lastBlock + 1, startBlock);
  log(`cctp: ${latest - from + 1} 블록 스캔`);

  const topics = [[TOPIC.depositForBurn, TOPIC.mintAndWithdraw, TOPIC.messageReceived]];
  const address = [ADDR.tokenMessenger, ADDR.messageTransmitter];
  const newEvents = [];
  while (from <= latest) {
    let ok = false;
    for (const { url, span } of RPC.arcLogs) {
      const to = Math.min(from + span - 1, latest);
      try {
        const logs = await rpcCall(url, 'eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(to), address, topics }], 60000);
        newEvents.push(...parseCctp(logs));
        from = to + 1;
        ok = true;
        break;
      } catch (e) { log('cctp getLogs 실패', url, e.message); }
    }
    if (!ok) throw new Error('cctp 로그 수집 실패');
  }
  st.events = st.events.concat(newEvents).filter((e) => e[0] >= startBlock);
  st.lastBlock = latest;

  const by = {};
  for (const [, dir, dom, amt] of st.events) {
    const r = (by[dom] ||= { domain: dom, name: DOMAINS[dom] || `도메인 ${dom}`, in: 0, out: 0, nIn: 0, nOut: 0 });
    if (dir === 0) { r.in += amt; r.nIn++; } else { r.out += amt; r.nOut++; }
  }
  const rows = Object.values(by).sort((a, b) => b.in + b.out - (a.in + a.out));
  const tIn = rows.reduce((s, r) => s + r.in, 0), tOut = rows.reduce((s, r) => s + r.out, 0);
  return { fromBlock: startBlock, toBlock: latest, totalIn: tIn, totalOut: tOut, net: tIn - tOut, rows };
}

function parseCctp(logs) {
  const word = (data, i) => '0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64);
  const usdc = ADDR.arcUsdc.slice(2).toLowerCase();
  const out = [];
  // tx별로 묶어 MintAndWithdraw와 짝을 이루는 MessageReceived에서 출발 도메인을 찾는다
  // (MintAndWithdraw가 먼저 찍히고 MessageReceived가 바로 뒤따른다)
  const byTx = {};
  for (const l of logs) (byTx[l.transactionHash] ||= []).push(l);
  for (const list of Object.values(byTx)) {
    list.sort((a, b) => parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
    const srcAfter = (i) => {
      for (let j = i + 1; j < list.length; j++) if (list[j].topics[0] === TOPIC.messageReceived) return Number(BigInt(word(list[j].data, 0)));
      for (let j = i - 1; j >= 0; j--) if (list[j].topics[0] === TOPIC.messageReceived) return Number(BigInt(word(list[j].data, 0)));
      return -1;
    };
    list.forEach((l, i) => {
      const t0 = l.topics[0];
      const block = parseInt(l.blockNumber, 16);
      if (t0 === TOPIC.depositForBurn) {
        if (!l.topics[1]?.toLowerCase().endsWith(usdc)) return;
        const amt = Number(BigInt(word(l.data, 0))) / 1e6;
        const dest = Number(BigInt(word(l.data, 2)));
        out.push([block, 1, dest, amt]);
      } else if (t0 === TOPIC.mintAndWithdraw) {
        if (!l.topics[2]?.toLowerCase().endsWith(usdc)) return;
        const amt = (Number(BigInt(word(l.data, 0))) + Number(BigInt(word(l.data, 1)))) / 1e6;
        out.push([block, 0, srcAfter(i), amt]);
      }
    });
  }
  return out;
}

// CRCL 공매도: FINRA 일별 공매도 거래량(Reg SHO) + 반월별 공매도 잔고
async function collectShort(state) {
  const store = (state.shortDaily ||= {});
  const now = Date.now() / 1000;
  const from = dayStart(now) - 45 * DAY;
  // 45일 넘은 캐시는 정리
  for (const k of Object.keys(store)) if (k < isoDay(from).replaceAll('-', '')) delete store[k];

  const todo = [];
  for (let d = from; d <= dayStart(now); d += DAY) {
    const wd = new Date(d * 1000).getUTCDay();
    const key = isoDay(d).replaceAll('-', '');
    if (wd === 0 || wd === 6) continue;
    // 확정된 날(값 있음, 또는 3일 넘게 파일이 없던 휴장일)은 다시 받지 않는다
    if (store[key] && (store[key].t || now - d > 3 * DAY)) continue;
    todo.push({ d, key });
  }
  await pool(todo, 4, async ({ d, key }) => {
    try {
      const res = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${key}.txt`, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) { if (now - d > 3 * DAY) store[key] = { none: true }; return; }
      const line = (await res.text()).split('\n').find((l) => l.split('|')[1] === 'CRCL');
      if (!line) return;
      const [, , sv, sev, tv] = line.split('|');
      store[key] = { s: Number(sv), se: Number(sev), t: Number(tv) };
    } catch (e) { log('finra 일별 실패', key, e.message); }
  });
  const daily = Object.entries(store)
    .filter(([, r]) => r.t)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, r]) => ({ d: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`, short: r.s, exempt: r.se, total: r.t, ratio: r.s / r.t }))
    .filter((r) => isoToTs(r.d) >= now - 31 * DAY);

  let interest = [];
  try {
    const res = await fetch('https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        limit: 50,
        compareFilters: [{ compareType: 'EQUAL', fieldName: 'symbolCode', fieldValue: 'CRCL' }],
        dateRangeFilters: [{ fieldName: 'settlementDate', startDate: isoDay(now - 120 * DAY), endDate: isoDay(now) }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json();
    if (Array.isArray(j)) {
      interest = j
        .map((r) => ({ d: r.settlementDate, qty: r.currentShortPositionQuantity, prev: r.previousShortPositionQuantity, chg: r.changePercent, dtc: r.daysToCoverQuantity, adv: r.averageDailyVolumeQuantity }))
        .sort((a, b) => a.d.localeCompare(b.d));
    }
  } catch (e) { log('finra 잔고 실패', e.message); }

  if (!daily.length) throw new Error('FINRA 일별 공매도 데이터 없음');
  const sumS = daily.reduce((s, r) => s + r.short, 0), sumT = daily.reduce((s, r) => s + r.total, 0);
  return { daily, avgRatio: sumS / sumT, interest };
}

const isoToTs = (s) => Date.parse(s + 'T00:00:00Z') / 1000;

// ---------- main ----------
async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const state = await loadState();
  const prev = (await loadPrevLatest()) || {};
  const out = { updatedAt: new Date().toISOString(), errors: {} };

  const sections = {
    stables: () => collectStables(),
    circle: () => collectCircleOfficial(),
    series: () => collectSeries(),
    arcDex: () => collectArcDex(),
    arcTvl: () => collectArcTvl(),
    lending: () => collectLending(),
    accounts: () => collectAccounts(),
    onchain: () => collectOnchainDaily(state),
    cctp: () => collectCctp(state),
    short: () => collectShort(state),
  };
  for (const [k, fn] of Object.entries(sections)) {
    const t = Date.now();
    try {
      out[k] = await fn();
      log(`✓ ${k} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    } catch (e) {
      out.errors[k] = e.message;
      out[k] = prev[k] ?? null; // 실패하면 직전 값 유지
      log(`✗ ${k}: ${e.message}`);
    }
  }

  // 수집 시점 스냅샷 (직전/24시간 전 대비 계산용)
  const lastLend = out.lending?.days?.at(-1);
  const snap = {
    t: out.updatedAt,
    usdcShare: out.stables?.usdcShare,
    usdcTotal: out.circle?.usdcTotal,
    eurcTotal: out.circle?.eurcTotal,
    arcUsdc: out.onchain?.now?.arcUsdc ?? out.circle?.arcUsdc,
    arcEurc: out.onchain?.now?.arcEurc ?? out.circle?.arcEurc,
    usycSupply: out.stables?.products?.find((p) => p.sym === 'USYC')?.supply,
    dex24h: out.arcDex?.total24h,
    tvl: out.arcTvl?.now,
    borrow: lastLend?.borrow,
    lendTvl: lastLend?.tvl,
    util: lastLend?.util,
    cirbtc: out.onchain ? out.onchain.now.arcBtc + out.onchain.now.ethBtc : undefined,
    cirbtcArc: out.onchain?.now?.arcBtc,
    cirbtcEth: out.onchain?.now?.ethBtc,
    cctpNet: out.cctp?.net,
    retRatio: out.accounts?.weeks?.filter((w) => !w.approx).at(-1)?.retRatio,
    shortRatio: out.short?.daily?.at(-1)?.ratio,
  };
  state.snapshots = (state.snapshots || []).concat(snap).slice(-MAX_SNAPSHOTS);
  out.snapshots = state.snapshots;

  await fs.writeFile(path.join(DATA_DIR, 'latest.json'), JSON.stringify(out));
  await fs.writeFile(path.join(DATA_DIR, 'state.json'), JSON.stringify(state));
  const failed = Object.keys(out.errors);
  log(failed.length ? `완료 (실패: ${failed.join(', ')})` : '완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
