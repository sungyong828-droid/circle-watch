"""검색·공유용 소개 페이지(정적 HTML) 만들기 — build.py가 dist에 생성한다.

자바스크립트 없이도 읽히는 글이라 구글·네이버 검색에 잘 잡힌다.
주소: /about · /crcl · /joby · /spcx · /tem · /dividend(배당금 계산기) · /fire(퇴사 계산기) · /en(영어 소개)  (Cloudflare Pages가 .html을 빼고 연결)
"""
import html
import json
import os

SITE = 'https://my-fire-portfolio.pages.dev/'
VER = '7'

COMMON_FEATURES = [
    ('실시간 주가 · 캔들 차트', '1일·1주·1개월·3개월·1년 캔들 차트에 이동평균선(5·20·60·120일)과 거래량. 캔들/라인 전환.'),
    ('뉴스 AI 한 줄 요약', '국내·해외 뉴스와 회사 공식 발표, SEC 공시를 모아 한 줄로 요약.'),
    ('실적', '분기 매출·이익·EPS와 시장 예상 비교, 다음 실적 발표 예정일. 발표 전날부터는 실적 당일 모드.'),
    ('공매도 · 기관 · 내부자', 'FINRA 공매도 비율, 13F 기관 보유 순위, 임원·대주주 내부자 매매.'),
    ('애널리스트 · 옵션', '증권사별 투자 의견과 목표가, 옵션 시장의 콜/풋 비율과 미결제약정이 몰린 가격.'),
]

STOCKS = {
    'crcl': {
        'sym': 'CRCL', 'name': '서클 인터넷 그룹', 'short': '서클', 'logo': 'assets/logos/CRCL.svg',
        'title': '서클(CRCL) 주가 실시간 · USDC 유통량 · 실적 대시보드',
        'desc': '서클(CRCL) 주가를 바이낸스 24시간 주식 선물 기준으로 주말·야간에도 실시간 확인. USDC 유통량·준비금, Arc 체인 지표, 실적·공매도·기관 보유·애널리스트 목표가를 휴대폰 한 화면에.',
        'lead': '스테이블코인 USDC를 발행하는 서클(Circle Internet Group, 뉴욕증권거래소 CRCL)의 주가와 사업 지표를 한 화면에 모았어요. 미국 장이 닫힌 주말·야간에도 바이낸스에서 24시간 거래되는 주식 선물 가격으로 움직임을 볼 수 있어요.',
        'features': [
            ('24시간 실시간 주가', '바이낸스 TradFi 주식 선물(CRCLUSDT) 체결가로 주말·야간에도 실시간. 캔들 차트·이동평균·거래량.'),
            ('USDC 유통량 · 준비금', 'USDC 발행량 변화, 체인별 분포, 준비금 구성과 준비금 이자 추정. 서클 공식 API·DefiLlama 기준.'),
            ('Arc 네트워크', '서클이 만든 블록체인 Arc의 거래·활동 지표.'),
            ('CRCA (2배 레버리지 ETF)', 'CRCL 하루 수익률의 2배를 따르는 ProShares CRCA 시세.'),
        ],
        'faq': [
            ('서클 주가는 주말에도 볼 수 있나요?', '네. 바이낸스에 24시간 거래되는 서클 주식 선물이 있어 미국 장이 닫혀도 가격이 움직여요. 다만 실제 미국 장 개장가와는 차이가 날 수 있어요.'),
            ('USDC 유통량은 어디서 가져오나요?', '서클 공식 API와 DefiLlama 스테이블코인 데이터를 써요. 서클 매출의 대부분이 USDC 준비금 이자라 유통량이 핵심 지표예요.'),
            ('서클 실적 발표일도 나오나요?', '네. Earnings 탭에 분기 실적과 시장 예상, 다음 발표 예정일이 나오고, 발표 전날부터는 실적 당일 모드 카드가 떠요.'),
        ],
    },
    'joby': {
        'sym': 'JOBY', 'name': '조비 에비에이션', 'short': '조비', 'logo': 'assets/logos/JOBY.png',
        'title': '조비(JOBY) 주가 실시간 · FAA 형식 인증 진행률 대시보드',
        'desc': '조비 에비에이션(JOBY) 실시간 주가와 캔들 차트, FAA 형식 인증 5단계 진행률(주주서한 자동 반영), 아처(ACHR) 비교, 실적·공매도·기관 보유·애널리스트 목표가를 휴대폰 한 화면에.',
        'lead': '전기 수직이착륙 에어택시(eVTOL)를 만드는 조비 에비에이션(NYSE JOBY)의 주가와 FAA 형식 인증 진행 상황을 한 화면에 모았어요.',
        'features': [
            ('FAA 형식 인증 진행률', '인증 5단계별 조비·FAA 완료율. 조비가 분기마다 SEC에 내는 주주서한의 그래프를 자동으로 읽어 반영해요.'),
            ('실시간 체결가', '장전·정규장·장후 실시간 체결가와 캔들 차트.'),
            ('경쟁사 비교', '같은 eVTOL 업체 아처 에비에이션(ACHR)과 주가 비교.'),
            ('FAA 관련 뉴스 모아 보기', '뉴스 탭에서 FAA 인증 관련 기사만 따로 걸러 볼 수 있어요.'),
        ],
        'faq': [
            ('FAA 인증 진행률은 어떻게 갱신되나요?', '조비가 분기 실적 때 내는 주주서한(SEC 8-K 첨부)에 단계별 진행 그래프가 실리는데, 새 서한이 나오면 자동으로 읽어 반영해요.'),
            ('조비 주가는 실시간인가요?', '네. 장전·장중·장후 실시간 체결가를 받아 표시해요.'),
        ],
    },
    'spcx': {
        'sym': 'SPCX', 'name': '스페이스X', 'short': '스페이스X', 'logo': 'assets/logos/SPCX.png',
        'title': '스페이스X(SPCX) 주가 실시간 · 보호예수(락업) 해제 일정 대시보드',
        'desc': '스페이스X(SPCX) 주가를 바이낸스 24시간 주식 선물 기준으로 실시간 확인. 보호예수(락업) 해제 일정과 물량, 로켓랩(RKLB) 비교, 실적·공매도·기관 보유·애널리스트 의견을 휴대폰 한 화면에.',
        'lead': '2026년 6월 12일 공모가 $135로 상장한 스페이스X(SPCX)의 주가와 보호예수 해제 일정을 한 화면에 모았어요. 바이낸스 24시간 주식 선물 가격으로 주말·야간 움직임도 볼 수 있어요.',
        'features': [
            ('보호예수(락업) 해제 일정', '투자설명서(424B4) 기준 해제 날짜와 물량, 지난 해제·다가오는 해제 표시. 조기 해제·추가 매도 공시가 나오면 알려 줘요.'),
            ('24시간 실시간 주가', '바이낸스 TradFi 주식 선물(SPCXUSDT) 체결가로 주말·야간에도 실시간.'),
            ('경쟁사 비교', '상장된 우주 발사체 업체 로켓랩(RKLB)과 주가 비교.'),
        ],
        'faq': [
            ('스페이스X 보호예수 해제일은 언제인가요?', '여러 차례에 나눠 풀려요. 날짜별 해제 물량과 남은 일정을 화면에서 바로 볼 수 있어요(공식 투자설명서 기준).'),
            ('스페이스X 공모가는 얼마였나요?', '공모가는 주당 $135, 상장일은 2026년 6월 12일이에요.'),
        ],
    },
    'tem': {
        'sym': 'TEM', 'name': '템퍼스 AI', 'short': '템퍼스', 'logo': 'assets/logos/TEM.png',
        'title': '템퍼스 AI(TEM) 주가 실시간 · 실적 · 애널리스트 목표가 대시보드',
        'desc': '템퍼스 AI(TEM) 주가를 바이낸스 24시간 주식 선물 기준으로 실시간 확인. 가던트헬스(GH) 비교, 실적·공매도·기관 보유·증권사별 목표가·옵션 심리, 뉴스 AI 요약을 휴대폰 한 화면에.',
        'lead': 'AI 기반 정밀의료·유전체 검사 기업 템퍼스 AI(나스닥 TEM)의 주가와 실적, 시장 심리를 한 화면에 모았어요.',
        'features': [
            ('24시간 실시간 주가', '바이낸스 TradFi 주식 선물(TEMUSDT) 체결가로 주말·야간에도 실시간.'),
            ('경쟁사 비교', '액체생검·암 유전체 검사 업체 가던트헬스(GH)와 주가 비교.'),
        ],
        'faq': [
            ('템퍼스 AI 애널리스트 목표가는 어디서 보나요?', '종목 화면의 애널리스트 카드에서 평균 목표가와 증권사별 의견·목표가를 볼 수 있어요.'),
        ],
    },
}


def esc(s):
    return html.escape(str(s), quote=True)


def page(slug, title, desc, body, ld, lang='ko', alt=None, og='og.png?v=3', noindex=False, script=''):
    url = SITE + slug
    en = lang == 'en'
    # 같은 내용의 다른 언어 페이지(about ↔ en)
    hl = ''.join(f'\n<link rel="alternate" hreflang="{l}" href="{SITE + s}">' for l, s in (alt or {}).items())
    return f'''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d1015">
<title>{esc(title)} | Fire Portfolio</title>
<meta name="description" content="{esc(desc)}">{'\n<meta name="robots" content="noindex">' if noindex else ''}
<link rel="canonical" href="{url}">{hl}
<link rel="alternate" type="application/rss+xml" title="Fire Portfolio 업데이트 소식" href="{SITE}rss.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fire Portfolio">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}assets/{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="{'en_US' if en else 'ko_KR'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="assets/favicon.png?v=2">
<link rel="apple-touch-icon" href="assets/icon.png?v=2">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" integrity="sha384-GIdEBaqGN9mNkDkMkzMHW8EKUqtpPIe/sLj1X7DIrnc9uPtLROJgmuDlh+3rBw0j" crossorigin="anonymous">
<link rel="stylesheet" href="assets/style.css?v=64">
<link rel="stylesheet" href="assets/landing.css?v={VER}2">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body class="lp">
<header class="lp-top"><a class="lp-brand" href="./"><img src="assets/app-icon.png?v=2" alt="" width="34" height="34"><span>Fire Portfolio</span></a><a class="lp-open" href="./?ref=page-{slug}{'&lang=en' if en else ''}">{'Open dashboard' if en else '대시보드 열기'}</a></header>
<main>
{body}
</main>
<footer class="lp-foot">
  {FOOT_EN if en else FOOT_KO}
</footer>
<script src="assets/landing.js?v={VER}"></script>{f'\n<script src="assets/{script}"></script>' if script else ''}
</body>
</html>
'''


FOOT_KO = '''<nav aria-label="소개 페이지"><a href="https://blog.naver.com/ky828" target="_blank" rel="noopener" referrerpolicy="origin">📝 돼용 블로그</a><a href="about">사이트 소개</a><a href="stablecoin">스테이블코인 한눈에</a><a href="daily">오늘의 스테이블코인</a><a href="dividend">배당금 계산기</a><a href="portfolio">배당 포트폴리오 계산기</a><a href="bonus">성과급 계산기</a><a href="fire">퇴사 계산기</a><a href="crcl">서클(CRCL)</a><a href="joby">조비(JOBY)</a><a href="spcx">스페이스X(SPCX)</a><a href="tem">템퍼스 AI(TEM)</a><a href="updates">업데이트 소식</a><a href="en" hreflang="en">English</a><a href="feedback">💬 문의·개선 제안</a></nav>
  <p>투자 조언이 아닌 개인 모니터링 도구예요. 데이터는 공개 출처(Nasdaq·SEC·Yahoo Finance·Binance·FINRA·CBOE 등)에서 가져오며 지연·오류가 있을 수 있어요.</p>'''
FOOT_EN = '''<nav aria-label="Pages"><a href="about" hreflang="ko">한국어</a><a href="en">About</a><a href="./?lang=en&ref=page-en#dividend">Dividend tracker</a><a href="./?lang=en&ref=page-en#quit">FIRE calculator</a><a href="feedback?lang=en">💬 Feedback</a></nav>
  <p>A personal monitoring tool, not investment advice. Data comes from public sources (Nasdaq, SEC, Yahoo Finance, Binance, FINRA, CBOE and others) and may be delayed or wrong.</p>'''


def feat_list(items):
    return '<ul class="lp-feats">' + ''.join(f'<li><b>{esc(t)}</b><span>{esc(d)}</span></li>' for t, d in items) + '</ul>'


def faq_html(faq, head='자주 묻는 질문'):
    return f'<section class="lp-sec"><h2>{head}</h2>' + ''.join(f'<details class="lp-faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in faq) + '</section>'


def stock_page(slug, S):
    open_url = f'./?s={S["sym"]}&ref=page-{slug}'
    body = f'''<section class="lp-hero">
  <img class="lp-logo" src="{S['logo']}" alt="" width="44" height="44">
  <h1>{esc(S['short'])}({S['sym']}) 주가 실시간 대시보드</h1>
  <p class="lp-lead">{esc(S['lead'])}</p>
  <a class="lp-cta" href="{open_url}">{esc(S['short'])} 실시간으로 보기 →</a>
  <p class="lp-sub">무료 · 회원가입 없음 · 휴대폰 최적화</p>
</section>
<section class="lp-sec"><h2>{esc(S['short'])} 화면에서 볼 수 있는 것</h2>{feat_list(S['features'])}</section>
<section class="lp-sec"><h2>모든 종목 공통</h2>{feat_list(COMMON_FEATURES)}</section>
{faq_html(S['faq'] + [('무료인가요? 가입해야 하나요?', '무료이고 가입도 필요 없어요. 휴대폰 브라우저에서 열고 홈 화면에 추가해 두면 앱처럼 쓸 수 있어요.'), ('다른 종목도 볼 수 있나요?', "네. 대시보드의 '+ 추가·편집'에서 아무 미국 주식 티커나 추가하면 같은 화면(주가·실적·뉴스·공매도·기관·애널리스트·옵션)으로 볼 수 있어요.")])}
<section class="lp-sec lp-end"><a class="lp-cta" href="{open_url}">{esc(S['short'])}({S['sym']}) 대시보드 열기 →</a></section>'''
    ld = [
        {'@context': 'https://schema.org', '@type': 'WebPage', 'name': S['title'], 'description': S['desc'], 'url': SITE + slug, 'inLanguage': 'ko',
         'about': {'@type': 'Corporation', 'name': S['name'], 'tickerSymbol': S['sym']}},
        {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in S['faq']]},
    ]
    return page(slug, S['title'], S['desc'], body, ld)


def about_page():
    title = '퇴사를 위한 미국 주식 실시간 대시보드 소개 — 서클·조비·스페이스X·템퍼스'
    desc = "Fire Portfolio는 서클(CRCL)·조비(JOBY)·스페이스X(SPCX)·템퍼스 AI(TEM) 실시간 주가·캔들 차트, 뉴스 AI 한 줄 요약, 시장 개요, 키워드 속보, 공매도·기관·애널리스트·옵션을 휴대폰 한 화면에 모은 무료 대시보드예요."
    cards = ''.join(f'<a class="lp-stock" href="{slug}"><img src="{S["logo"]}" alt="" width="28" height="28"><b>{esc(S["short"])}</b><small>{S["sym"]}</small></a>' for slug, S in STOCKS.items())
    body = f'''<section class="lp-hero">
  <h1>퇴사(FIRE)를 향한 포트폴리오,<br>앱 여러 개 열지 말고 한 화면에서</h1>
  <p class="lp-lead">주가는 증권사 앱, 뉴스는 포털, 공시는 SEC, 공매도는 또 다른 사이트… 보유 종목 하나 확인하려고 여러 곳을 돌아다니다 지쳐서 직접 만든 대시보드예요. 다른 분들도 쓸 수 있게 무료로 공개했어요.</p>
  <a class="lp-cta" href="./?ref=page-about">대시보드 열기 →</a>
  <p class="lp-sub">무료 · 회원가입 없음 · 휴대폰 최적화</p>
</section>
<section class="lp-sec"><h2>기본 종목</h2><div class="lp-stocks">{cards}</div><p class="lp-note">+ 추가·편집으로 아무 미국 주식이나 내 종목에 넣을 수 있어요.</p></section>
<section class="lp-sec"><h2>주요 기능</h2>{feat_list([
        ('시장 개요', 'S&P 500·나스닥·다우·러셀·VIX·미국 10년물 금리·달러 지수·비트코인, 장전·정규장·장후 상태와 지수 선물.'),
        ('키워드 속보', 'FOMC·CPI·관세처럼 등록한 단어가 들어간 시장·종목 기사만 모아 보기.'),
    ] + COMMON_FEATURES + [
        ('🔥 퇴사까지 (Fire)', '보유 수량·평균 단가를 넣으면 실시간 주가·환율로 목표 금액까지 몇 %인지 계산. 입력값은 내 기기에만 저장돼요.'),
        ('💰 배당금 계산기', '매수일·수량을 넣으면 배당락일 기준으로 지금까지 실제로 받은 배당금, 원금 회수율, 월별 배당, 다음 배당 예정일까지. 증권 앱 거래 화면 캡처로 거래 내역을 한 번에 넣을 수 있어요.'),
    ])}<p class="lp-note"><a href="dividend">배당금 계산기 자세히 →</a> · <a href="fire">퇴사(FIRE) 계산기 자세히 →</a></p></section>
<section class="lp-sec"><h2>쓰는 방법</h2><ol class="lp-steps">
  <li>휴대폰 브라우저에서 <b>my-fire-portfolio.pages.dev</b>를 열어요.</li>
  <li>공유 메뉴에서 <b>홈 화면에 추가</b>를 누르면 앱처럼 바로 열려요.</li>
  <li>위쪽 종목 칩으로 종목을 바꾸고, 아래 탭으로 차트·실적·뉴스를 넘겨 봐요. 카드의 ⓘ를 누르면 지표 설명이 나와요.</li>
</ol></section>
<section class="lp-sec"><h2>만든 사람</h2><a class="blog-card" href="https://blog.naver.com/ky828" target="_blank" rel="noopener" referrerpolicy="origin"><span class="bc-ic" aria-hidden="true">📝</span><span class="bc-t"><b>돼용 블로그</b><small><span>미국 주식 투자 기록과 대시보드 소식을 올려요</span><span>네이버 블로그</span></small></span><span class="bc-go" aria-hidden="true">→</span></a></section>
<section class="lp-sec"><h2>개인 정보</h2><p>회원가입·로그인이 없고, 보유 정보와 관심 종목은 각자 기기의 브라우저에만 저장돼요. 사이트는 방문 수를 세려고 익명 기기 ID와 유입 경로를, 인기 종목 순위를 위해 새로 추가한 티커 이름만 익명으로 기록해요(수량·금액은 보내지 않아요).</p></section>
{faq_html([
        ('어떤 데이터를 쓰나요?', 'Nasdaq(시세·실적·기관 보유·애널리스트), SEC(공시·재무제표), Yahoo Finance(실시간 체결·차트), Binance(24시간 주식 선물), FINRA(공매도), CBOE(옵션), 서클 공식 API·DefiLlama(USDC), 뉴스 RSS를 써요.'),
        ('얼마나 자주 업데이트되나요?', '주가는 실시간, 나머지 데이터는 5분마다 자동으로 새로 받아요. 오른쪽 위 새로고침으로 바로 갱신할 수도 있어요.'),
        ('투자 추천을 해 주나요?', '아니요. 공개된 데이터를 모아 보여주는 모니터링 도구이고 투자 조언이 아니에요.'),
    ])}'''
    ld = {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': "Fire Portfolio", 'url': SITE, 'applicationCategory': 'FinanceApplication',
          'operatingSystem': 'Web', 'inLanguage': 'ko', 'description': desc, 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'KRW'}}
    return page('about', title, desc, body, ld, alt={'ko': 'about', 'en': 'en', 'x-default': 'about'})


DIV_FAQ = [
    ('실제로 받은 배당금은 어떻게 계산하나요?', '종목마다 과거 배당 기록(배당락일·주당 배당금, 주식 분할 반영)을 받아, 배당락일 전날까지 보유한 수량 × 주당 배당금으로 더해요. 매수 전 배당은 빼고, 중간에 팔았다면 그 뒤 배당도 줄여서 계산해요.'),
    ('세금도 빼고 보여 주나요?', '네. 미국 주식 배당은 미국에서 15%를 먼저 떼고 들어오므로 기본은 세후(실제 입금액)로 보여 줘요. 세전으로 바꿔 볼 수도 있어요.'),
    ('MSTY처럼 매주·매달 주는 ETF도 되나요?', '네. 주배당·월배당·분기·반기·연배당을 모두 구분해서 회차별로 계산해요. 지급일이 발표되지 않은 회차는 종목의 평소 간격으로 추정해 표시해요.'),
    ('거래 내역을 하나씩 넣어야 하나요?', '아니요. 증권 앱(예: 도미노)의 거래 화면을 캡처해서 고르면 매수·매도 기록을 자동으로 읽어 넣어요. 사진은 서버로 보내지 않고 이 기기 안에서만 읽어요.'),
    ('입력한 보유 정보는 어디에 저장되나요?', '회원가입이 없고, 입력값은 각자 휴대폰·PC의 브라우저에만 저장돼요. 서버로 보내지 않아요.'),
]
FIRE_FAQ = [
    ('퇴사(FIRE) 계산기는 무엇을 계산하나요?', '보유 종목의 수량·평균 단가를 넣으면 실시간 주가와 원·달러 환율로 지금 평가액을 원화로 계산하고, 내가 정한 목표 금액까지 몇 % 왔는지 보여 줘요.'),
    ('주가가 바뀌면 바로 반영되나요?', '네. 실시간 주가로 계속 다시 계산하고, 주가가 몇 % 오르면 목표에 닿는지도 시뮬레이션해 볼 수 있어요.'),
    ('세금도 고려하나요?', '선택하면 해외주식 양도소득세(연 250만원 공제 후 22%)를 뺀 금액으로 계산해요.'),
    ('어떤 종목을 넣을 수 있나요?', '서클·조비·스페이스X·템퍼스 기본 종목과, 관심 종목에 추가한 미국 주식, 삼성전자·국내 ETF 같은 한국 주식(원화로 환산)까지 모두 넣을 수 있어요.'),
]


def app_ld(name, slug, desc, lang='ko', cur='KRW'):
    return {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': name, 'url': SITE + slug, 'applicationCategory': 'FinanceApplication',
            'operatingSystem': 'Web', 'inLanguage': lang, 'description': desc, 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': cur}}


def faq_ld(faq):
    return {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faq]}


def dividend_page():
    title = '미국 주식 배당금 계산기 — 실제 받은 배당금 · 월배당·주배당 ETF(MSTY·SCHD·JEPI) · 원금 회수율'
    desc = '매수일·수량만 넣으면 배당락일 기준으로 지금까지 실제로 받은 미국 주식 배당금(세후 15%), 원금 회수율, 월별·연도별 배당, 다음 배당일을 계산해요. 증권 앱 거래 화면 캡처로 매수 기록 자동 입력. 무료·가입 없음.'
    go = './?ref=page-dividend#dividend'
    body = f'''<section class="lp-hero">
  <h1>미국 주식 배당금 계산기<br>지금까지 받은 배당, 정확하게</h1>
  <p class="lp-lead">"이 종목으로 배당을 얼마나 받았지?" 증권 앱 입금 내역을 하나하나 더하지 않아도 돼요. 언제 몇 주를 샀는지만 넣으면 배당락일 기준으로 실제 받은 배당금과 원금 회수율, 다음 배당일까지 계산해요.</p>
  <a class="lp-cta" href="{go}">배당금 계산하기 →</a>
  <p class="lp-sub">무료 · 회원가입 없음 · 입력값은 내 기기에만 저장</p>
</section>
<section class="lp-sec"><h2>계산해 주는 것</h2>{feat_list([
        ('지금까지 받은 배당금', '배당락일 전날까지 보유한 수량으로 회차마다 계산해서 더해요. 매수·매도가 섞여 있어도 그때그때 수량으로.'),
        ('원금 회수율 · YOC', '받은 배당이 투자 원금의 몇 %인지, 매수가 기준 배당 수익률(YOC)은 얼마인지.'),
        ('월별 · 연도별 배당', '언제 얼마가 들어왔는지 월별 막대와 연도별 합계. 앞으로 1년 예상 배당도.'),
        ('다음 배당일', '발표된 다음 배당락일·지급일, 발표 전이면 평소 간격으로 추정.'),
        ('📷 거래 내역 사진으로 넣기', '증권 앱 거래 화면을 캡처해 고르면 매수·매도 기록을 자동으로 읽어요. 여러 장을 한 번에, 겹친 부분은 한 번만.'),
        ('세후 · 세전', '미국 원천징수 15%를 뺀 실제 입금액 기준이 기본.'),
    ])}</section>
<section class="lp-sec"><h2>이런 종목에 잘 맞아요</h2><p>매주 배당하는 <b>MSTY</b> 같은 커버드콜 ETF, 월배당 <b>JEPI·JEPQ·O(리얼티인컴)</b>, 분기 배당 <b>SCHD·KO·AAPL</b> 등 미국 상장 주식·ETF는 물론, <b>삼성전자</b>·<b>TIGER 미국배당다우존스</b>·<b>국내 커버드콜 ETF</b> 같은 한국 종목도 계산할 수 있어요(국내 배당소득세 15.4%). 앞으로 살 종목은 <a href="portfolio">배당 포트폴리오 계산기</a>로 미리 계산해 보세요.</p></section>
<section class="lp-sec"><h2>쓰는 방법</h2><ol class="lp-steps">
  <li>대시보드에서 🔥 <b>Fire → 💰 배당금</b>을 열어요.</li>
  <li>종목마다 티커·수량·평단을 넣고, 여러 번 나눠 샀다면 <b>📅 거래 내역</b>에서 사진이나 캘린더로 넣어요.</li>
  <li>저장하면 받은 배당금·원금 회수율·월별 배당이 바로 나와요.</li>
</ol></section>
{faq_html(DIV_FAQ)}
<section class="lp-sec lp-end"><a class="lp-cta" href="{go}">💰 배당금 계산기 열기 →</a></section>'''
    return page('dividend', title, desc, body, [app_ld('Fire Portfolio 배당금 계산기', 'dividend', desc), faq_ld(DIV_FAQ)], og='og-dividend.png?v=1')


def fire_page():
    title = '퇴사(FIRE) 계산기 — 미국 주식 실시간 평가액으로 목표 금액까지 몇 %'
    desc = '파이어족을 위한 퇴사 계산기. 보유 미국 주식 수량·평균 단가를 넣으면 실시간 주가와 원·달러 환율로 원화 평가액과 목표 금액 달성률, 주가가 몇 % 오르면 목표에 닿는지 계산해요. 무료·가입 없음.'
    go = './?ref=page-fire#quit'
    body = f'''<section class="lp-hero">
  <h1>퇴사까지 얼마나 남았을까?<br>실시간 퇴사(FIRE) 계산기</h1>
  <p class="lp-lead">경제적 자유(FIRE)를 목표로 미국 주식을 모으고 있다면, 목표 금액까지 몇 % 왔는지 매일 궁금하죠. 보유 종목과 목표 금액을 한 번 넣어 두면 실시간 주가와 환율로 계속 다시 계산해요.</p>
  <a class="lp-cta" href="{go}">퇴사까지 계산하기 →</a>
  <p class="lp-sub">무료 · 회원가입 없음 · 입력값은 내 기기에만 저장</p>
</section>
<section class="lp-sec"><h2>계산해 주는 것</h2>{feat_list([
        ('목표 달성률', '원화 평가액이 목표 금액의 몇 %인지, 남은 금액은 얼마인지.'),
        ('실시간 평가액', '미국 주식 실시간 주가 × 원·달러 환율. 장전·장후와 주말 24시간 선물 가격도 반영.'),
        ('주가 시뮬레이션', '보유 종목이 몇 % 오르면 목표에 닿는지 슬라이더로.'),
        ('세후 계산', '해외주식 양도소득세(250만원 공제 후 22%)를 뺀 금액으로도.'),
        ('배당금까지', '💰 배당금 탭에서 지금까지 받은 배당과 원금 회수율도 함께.'),
    ])}<p class="lp-note"><a href="dividend">배당금 계산기 자세히 →</a></p></section>
{faq_html(FIRE_FAQ)}
<section class="lp-sec lp-end"><a class="lp-cta" href="{go}">🔥 퇴사 계산기 열기 →</a></section>'''
    return page('fire', title, desc, body, [app_ld('Fire Portfolio 퇴사 계산기', 'fire', desc), faq_ld(FIRE_FAQ)])


EN_FAQ = [
    ('Is it free? Do I need an account?', 'Free, no sign-up. Your holdings are stored only in your own browser and never sent to a server.'),
    ('How is "dividends received" calculated?', 'For every past payment it takes the shares you held the day before the ex-dividend date times the split-adjusted amount per share. Buys and sells in between are handled, and the 15% US withholding tax can be deducted.'),
    ('Can I track any US stock?', 'Yes. Add any US ticker to your watchlist and get the same live price, chart, earnings, news and options screens.'),
]


def en_page():
    title = 'Free US stock dashboard with dividend tracker and FIRE calculator'
    desc = 'Fire Portfolio is a free, mobile-first US stock dashboard: live prices and candle charts, AI one-line news summaries, earnings, short interest, institutional holders and options, plus a dividend tracker (dividends actually received, payback, monthly income) and a FIRE goal calculator. No sign-up.'
    go = './?lang=en&ref=page-en'
    body = f'''<section class="lp-hero">
  <h1>Your portfolio toward FIRE,<br>on one phone screen</h1>
  <p class="lp-lead">Prices in one app, news in another, filings on SEC, short data somewhere else… Fire Portfolio puts it all on one screen, and tells you how close you are to quitting your job and how much your dividends have really paid you.</p>
  <a class="lp-cta" href="{go}">Open the dashboard →</a>
  <p class="lp-sub">Free · no sign-up · made for phones</p>
</section>
<section class="lp-sec"><h2>What you get</h2>{feat_list([
        ('Live prices & charts', 'Real-time quotes (pre-market, regular, after-hours, and 24/7 futures for some names), candles with moving averages and volume.'),
        ('💰 Dividend tracker', 'Dividends actually received since you bought, principal payback, yield on cost, monthly and yearly income, and the next ex-date. Weekly payers like MSTY included.'),
        ('📷 Import trades from screenshots', 'Pick screenshots of your broker app’s trade list and the buys and sells are read on your device.'),
        ('🔥 FIRE calculator', 'Live portfolio value against your goal, with a “what if it rises x%” slider.'),
        ('News with AI one-liners', 'Company releases, SEC filings and headlines, each summarized in one line.'),
        ('Earnings, short interest, holders, analysts, options', 'Quarterly results vs estimates, FINRA short volume, 13F holders, insider trades, price targets, put/call ratio and open interest.'),
    ])}</section>
<section class="lp-sec"><h2>Start</h2><ol class="lp-steps">
  <li>Open <b>my-fire-portfolio.pages.dev</b> on your phone.</li>
  <li>Tap 🔥 <b>Fire</b> → <b>💰 Dividends</b> and add your tickers, shares and average cost.</li>
  <li>Use your browser’s <b>Add to Home Screen</b> to open it like an app.</li>
</ol></section>
{faq_html(EN_FAQ, 'FAQ')}
<section class="lp-sec lp-end"><a class="lp-cta" href="{go}">Open Fire Portfolio →</a></section>'''
    return page('en', title, desc, body, app_ld('Fire Portfolio', 'en', desc, 'en', 'USD'), lang='en', alt={'ko': 'about', 'en': 'en', 'x-default': 'about'})


def feedback_page():
    title = '문의 · 개선 제안'
    desc = 'Fire Portfolio를 쓰면서 불편한 점, 있었으면 하는 기능, 잘못된 숫자를 알려 주세요.'
    body = '''<section class="lp-hero fb-hero">
  <h1 data-en="Questions &amp; suggestions">문의 · 개선 제안</h1>
  <p class="lp-lead" data-en="Tell us what’s confusing, what you’d like to see, or any number that looks wrong. Every message is read and used to improve the dashboard.">쓰면서 불편했던 점, 있었으면 하는 기능, 이상해 보이는 숫자를 알려 주세요. 보내 주신 글은 하나하나 읽고 대시보드를 고치는 데 써요.</p>
</section>
<form class="fb-form" id="fb-form" autocomplete="off" novalidate>
  <fieldset class="fb-kinds">
    <legend data-en="Type">종류</legend>
    <label><input type="radio" name="kind" value="idea" checked><span data-en="💡 Idea">💡 개선 제안</span></label>
    <label><input type="radio" name="kind" value="bug"><span data-en="🐞 Bug / wrong number">🐞 오류·숫자 이상</span></label>
    <label><input type="radio" name="kind" value="question"><span data-en="❓ Question">❓ 질문</span></label>
    <label><input type="radio" name="kind" value="etc"><span data-en="💬 Other">💬 기타</span></label>
  </fieldset>
  <label class="fb-f"><span data-en="Message">내용</span>
    <textarea id="fb-msg" name="msg" rows="7" maxlength="1000" required placeholder="예: 배당금 화면에서 ○○ 종목 배당이 실제보다 적게 나와요 / ○○ 지표도 보고 싶어요" data-en-ph="e.g. The dividend for XYZ looks lower than what I received / I’d love to see ○○"></textarea>
    <small class="fb-count"><b id="fb-n">0</b> / 1000</small>
  </label>
  <label class="fb-f"><span data-en="Contact (optional)">연락받을 곳 (선택)</span>
    <input id="fb-contact" name="contact" maxlength="100" placeholder="답장을 원하면 이메일이나 블로그 아이디" data-en-ph="Email or handle if you’d like a reply">
    <small data-en="Only the site owner can see this. Leave it empty to stay anonymous.">사이트 운영자만 볼 수 있어요. 비워 두면 익명으로 보내져요.</small>
  </label>
  <label class="fb-hp" aria-hidden="true">웹사이트<input name="website" tabindex="-1" autocomplete="off"></label>
  <button type="submit" class="lp-cta fb-send" id="fb-send" data-en="Send">보내기</button>
  <p class="fb-status" id="fb-status" role="status" aria-live="polite"></p>
</form>
<section class="lp-sec"><p class="lp-note" data-en="Please don’t include personal or account details. Messages are rate-limited to stop spam (a few per 10 minutes).">개인 정보나 증권 계좌 정보는 적지 말아 주세요. 도배를 막기 위해 10분에 몇 건까지만 보낼 수 있어요.</p>
<p class="lp-note"><a href="./?ref=page-feedback" data-en="← Back to the dashboard">← 대시보드로 돌아가기</a></p></section>'''
    return page('feedback', title, desc, body, {'@context': 'https://schema.org', '@type': 'ContactPage', 'name': title, 'url': SITE + 'feedback', 'inLanguage': 'ko'},
                noindex=True, script='feedback.js?v=1')



# ---------------------------------------------------------------- 업데이트 소식(CHANGELOG.md)
import hashlib
import re as _re
import re

CHANGELOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'CHANGELOG.md')
NEXT_H = '## 다음 배포'
PUBLIC_FROM = 'v2026.10.05-1'  # 공개 '업데이트 소식'에 보여 줄 첫 버전


def _md_inline(t):
    t = esc(t)
    t = _re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = _re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', t)
    t = _re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    return t


def changelog_sections():
    """[(제목, 본문)] — '## ' 단위. 다음 배포 칸 포함"""
    if not os.path.exists(CHANGELOG):
        return []
    text = open(CHANGELOG, encoding='utf-8').read()
    parts = _re.split(r'(?m)^## ', text)[1:]
    return [(p.split('\n', 1)[0].strip(), p.split('\n', 1)[1] if '\n' in p else '') for p in parts]


def _ver(t):
    return re.match(r'(v(\d{4})\.(\d{2})\.(\d{2})-\d+)', t)


def _parse_body(body):
    """버전 본문 → ([(소제목, [항목...])...], EN 항목들) — 내부용 줄·주석은 뺀다"""
    en_m = _re.search(r'<!--\s*EN\s*(.*?)-->', body, _re.S)
    en = [l.strip()[2:].strip() for l in (en_m.group(1).splitlines() if en_m else []) if l.strip().startswith('- ')]
    body = '\n'.join(l for l in body.splitlines() if '<!-- internal -->' not in l)
    groups, head = [], ''
    for line in _re.sub(r'<!--.*?-->', '', body, flags=_re.S).splitlines():
        t = line.strip()
        if not t or t.startswith('[이 버전 보기]') or t.startswith('커밋 ') or t == '---':
            continue
        if t.startswith('**') and t.endswith('**') and not t.startswith('- '):
            head = t.strip('*').strip()
            continue
        if t.startswith('- '):
            if not groups or groups[-1][0] != head:
                groups.append((head, []))
            groups[-1][1].append(t[2:].strip())
    return groups, en


def _merge(parsed):
    """여러 버전의 [(소제목, 항목)]을 소제목별로 합친다(최신 버전 항목이 먼저)"""
    out = {}
    for groups in parsed:
        for head, items in groups:
            out.setdefault(head, []).extend(items)
    return list(out.items())


def day_groups():
    """공개 업데이트를 날짜별로 묶는다: [(YYYY-MM-DD, [버전...], [(소제목, 항목)], EN 항목)] — 최신 날짜 먼저"""
    days = {}
    for t, body in changelog_sections():
        m = _ver(t)
        if not m or m.group(1) < PUBLIC_FROM:
            continue
        groups, en = _parse_body(body)
        if not any(items for _, items in groups):
            continue
        d = f'{m.group(2)}-{m.group(3)}-{m.group(4)}'
        g = days.setdefault(d, {'vers': [], 'parsed': [], 'en': []})
        g['vers'].append(m.group(1)); g['parsed'].append(groups); g['en'] += en
    return [(d, g['vers'], _merge(g['parsed']), g['en']) for d, g in sorted(days.items(), reverse=True)]


def whatsnew():
    """앱의 '새로 업데이트됐어요' 카드: 다음 배포 칸(있으면) + 가장 최근 날짜의 버전들을 합쳐서"""
    secs = changelog_sections()
    pend = next((b for t, b in secs if t == NEXT_H[3:]), '')
    pgroups, pen = _parse_body(pend) if pend else ([], [])
    days = day_groups()
    import datetime as _dt
    today = (_dt.datetime.utcnow() + _dt.timedelta(hours=9)).date().isoformat()
    if any(items for _, items in pgroups):
        # 테스트 환경(배포 전): 다음 배포 칸 + 오늘 이미 나간 버전
        same = [g for g in days if g[0] == today]
        groups = _merge([pgroups] + [[(h, it) for h, it in same[0][2]]] if same else [pgroups])
        en = pen + (same[0][3] if same else [])
        ver = ''
    elif days:
        d, vers, groups, en = days[0]
        ver = vers[-1] if len(vers) == 1 else f'{d[:4]}.{d[5:7]}.{d[8:]} 업데이트'
    else:
        return None
    items = [_md_inline(x) for _, its in groups for x in its]
    en = [_md_inline(x) for x in en]
    nid = hashlib.md5('\n'.join(items).encode('utf-8')).hexdigest()[:10]
    return {'id': nid, 'ver': ver, 'items': items, 'en': en}


def updates_page():
    title = '업데이트 소식 — 새로 생긴 기능과 바뀐 점'
    desc = 'Fire Portfolio(퇴사를 위한 주식 대시보드)에 새로 생긴 기능과 바뀐 점을 날짜별로 모았어요.'
    out = []
    # 공개 페이지: 이름을 Fire Portfolio로 바꾼 뒤 사용자에게 보이는 변화만, 같은 날 여러 번 배포한 것은 하루로 합쳐서
    for d, vers, groups, _ in day_groups():
        head = f'{d[:4]}.{d[5:7]}.{d[8:]} 업데이트 <small>{" · ".join(reversed(vers))}</small>'
        html_lines = []
        for h, items in groups:
            if h:
                html_lines.append(f'<h3>{_md_inline(h)}</h3>')
            html_lines.append('<ul class="lp-upd">' + ''.join(f'<li>{_md_inline(x)}</li>' for x in items) + '</ul>')
        anchors = ''.join(f'<span id="{v}"></span>' for v in vers)
        out.append(f'<section class="lp-sec upd" id="u{d}">{anchors}<h2>{head}</h2>{"".join(html_lines)}</section>')
    body = f"""<section class="lp-hero">
  <h1>업데이트 소식</h1>
  <p class="lp-lead">쓰면서 불편했던 점과 보내 주신 의견으로 계속 고치고 있어요. 새로 생긴 기능과 바뀐 점을 날짜별로 모았어요.</p>
  <a class="lp-cta" href="./?ref=page-updates">대시보드 열기 →</a>
</section>
{''.join(out)}
<section class="lp-sec lp-end"><a class="lp-cta" href="feedback?from=updates">💬 의견 보내기</a></section>"""
    ld = {'@context': 'https://schema.org', '@type': 'WebPage', 'name': title, 'description': desc, 'url': SITE + 'updates', 'inLanguage': 'ko'}
    return page('updates', title, desc, body, ld)


BONUS_FAQ = [
    ('삼성전자 성과급(OPI·TAI)은 어떻게 계산하나요?', 'OPI(초과이익성과급)는 연봉 × 지급률(최대 50%), TAI(목표달성장려금)는 상·하반기 월 기본급 × 지급률(최대 100%)로 계산해요. DS 부문 특별 성과급처럼 금액으로 공지되는 것은 금액을 그대로 넣으면 돼요.'),
    ('SK하이닉스 성과급(PS·PI)은요?', 'PS(초과이익분배금)는 월 기본급 × 지급률, PI(생산성 격려금)는 상·하반기 월 기본급 × 지급률로 계산해요. 월 기본급을 모르면 연봉 ÷ 20으로 어림하고, 급여명세서의 기본급을 넣으면 더 정확해요. 일부를 자사주로 받는 비율도 넣을 수 있어요.'),
    ('세금은 얼마나 떼나요?', '성과급 때문에 늘어나는 1년 소득세(근로소득공제·세액공제 반영)에 지방소득세 10%를 더하고, 건강보험·장기요양보험·고용보험을 빼서 실수령액을 추정해요. 국민연금은 보통 상한에 걸려 추가로 빠지지 않아 제외했어요.'),
    ('계산 결과가 실제와 같나요?', '공개된 계산 방식으로 추정한 값이에요. 회사 세부 규정, 비과세 항목, 부양가족·공제 상황에 따라 실제 입금액은 달라질 수 있어요.'),
    ('성과급으로 배당주를 사면 얼마나 받을 수 있나요?', '계산 결과 아래 "이 돈으로 배당 포트폴리오 짜보기"를 누르면 실수령액이 투자금으로 들어가, SCHD·JEPI·국내 커버드콜 ETF 등을 몇 주 살 수 있고 매달 배당이 얼마인지 바로 계산해요.'),
]
SIM_FAQ = [
    ('배당 포트폴리오 계산기는 무엇을 계산하나요?', '투자금과 종목·비중을 넣으면 지금 주가로 종목마다 몇 주를 살 수 있는지, 최근 1년 배당 기준으로 1년·한 달에 배당을 얼마 받는지(세후), 포트폴리오 배당률과 남는 돈을 계산해요.'),
    ('어떤 종목을 넣을 수 있나요?', 'SCHD·JEPI·JEPQ·O 같은 미국 배당주·ETF와 삼성전자, TIGER 미국배당다우존스, KODEX 커버드콜 같은 국내 주식·ETF를 모두 섞어 넣을 수 있어요. 티커나 종목명으로 검색해 고르면 돼요.'),
    ('종목을 잘 몰라도 쓸 수 있나요?', '월배당·고배당 ETF·커버드콜·국내 배당 ETF·국내 커버드콜·국내 배당주 분류마다 대표 종목을 무엇을 따라가는지 설명과 최근 1년 배당률을 붙여 보여줘요. 눌러서 바로 넣으면 돼요.'),
    ('세금은 어떻게 반영하나요?', '미국 종목은 원천징수 15%, 국내 종목은 배당소득세 15.4%를 뺀 금액으로 보여줘요. 연 배당이 2,000만원을 넘으면 금융소득종합과세 대상이 될 수 있다는 안내도 해요.'),
    ('비중 합계가 100%가 아니면요?', '입력할 때마다 합계를 바로 알려 주고, 계산할 때는 넣은 비율대로 100%에 맞춰서(1% 단위) 계산해요.'),
]


def bonus_page():
    title = '성과급 계산기 — 삼성전자 OPI·TAI · SK하이닉스 PS·PI 세후 실수령액'
    desc = '연봉과 지급률만 넣으면 삼성전자 OPI·TAI·DS 특별 성과급, SK하이닉스 PS·PI 성과급의 세금·4대보험을 뗀 실수령액을 계산해요. 그 돈으로 배당주를 사면 매달 배당이 얼마인지까지. 무료·가입 없음.'
    go = './?ref=page-bonus#bonus'
    body = f"""<section class="lp-hero">
  <h1>성과급 계산기<br>통장에 실제로 얼마 들어올까?</h1>
  <p class="lp-lead">성과급 공지가 뜨면 기준 금액이 연봉인지 월 기본급인지, 세금은 얼마나 떼는지 헷갈리죠. 삼성전자·SK하이닉스 방식대로 세전 금액부터 세금·4대보험, 실수령액까지 한 번에 계산해요.</p>
  <a class="lp-cta" href="{go}">💼 성과급 계산하기 →</a>
  <p class="lp-sub">무료 · 회원가입 없음 · 입력값은 내 기기에만 저장</p>
</section>
<section class="lp-sec"><h2>계산해 주는 것</h2>{feat_list([
        ('삼성전자 OPI', '연봉 × OPI 지급률(최대 50%). 사업부별로 공지된 지급률을 넣으면 돼요.'),
        ('삼성전자 TAI · DS 특별', '상·하반기 월 기본급 × TAI 지급률, 금액으로 공지되는 특별 성과급까지.'),
        ('SK하이닉스 PS · PI', 'PS는 월 기본급 × 지급률, PI는 상·하반기 월 기본급 × 지급률. 자사주로 받는 비율도.'),
        ('세금 · 4대보험', '성과급으로 늘어나는 연간 소득세 + 지방소득세, 건강·장기요양·고용보험을 뺀 실수령액.'),
        ('🧮 배당 포트폴리오로 연결', '실수령액으로 SCHD·JEPI·국내 커버드콜 ETF를 사면 몇 주, 매달 배당 얼마인지.'),
    ])}</section>
<section class="lp-sec"><h2>쓰는 방법</h2><ol class="lp-steps">
  <li>대시보드에서 <b>🔥 Fire → 💼 성과급</b>을 열어요(홈 맨 위 '성과급' 칸을 눌러도 돼요).</li>
  <li>회사(삼성전자·SK하이닉스·직접 입력)를 고르고 연봉과 지급률을 넣어요.</li>
  <li>세전 금액 → 세금·4대보험 → 예상 실수령액이 바로 나와요.</li>
</ol></section>
{faq_html(BONUS_FAQ)}
<section class="lp-sec lp-end"><a class="lp-cta" href="{go}">💼 성과급 계산기 열기 →</a><p class="lp-note"><a href="portfolio">배당 포트폴리오 계산기 →</a></p></section>"""
    return page('bonus', title, desc, body, [app_ld('Fire Portfolio 성과급 계산기', 'bonus', desc), faq_ld(BONUS_FAQ)])


def portfolio_page():
    title = '배당 포트폴리오 계산기 — SCHD·JEPI·월배당·커버드콜 ETF, 이 돈이면 한 달 배당 얼마?'
    desc = '투자금(예: 1억·4억)과 종목·비중을 넣으면 지금 주가로 몇 주를 살 수 있는지, 1년·한 달 배당금(세후)과 배당률을 계산해요. SCHD·JEPI·O 같은 미국 배당주와 국내 커버드콜·배당 ETF, 삼성전자까지. 무료·가입 없음.'
    go = './?ref=page-portfolio#portfolio'
    body = f"""<section class="lp-hero">
  <h1>배당 포트폴리오 계산기<br>이 돈이면 한 달 배당 얼마?</h1>
  <p class="lp-lead">"4억을 SCHD·JEPI·리얼티인컴에 나눠 넣으면 매달 얼마 받을까?" 투자금과 종목·비중만 넣으면 지금 주가로 몇 주를 살 수 있고, 1년·한 달에 배당을 얼마 받는지 계산해요.</p>
  <a class="lp-cta" href="{go}">🧮 배당 포트폴리오 짜보기 →</a>
  <p class="lp-sub">무료 · 회원가입 없음 · 입력값은 내 기기에만 저장</p>
</section>
<section class="lp-sec"><h2>계산해 주는 것</h2>{feat_list([
        ('살 수 있는 주식 수', '투자금 × 비중을 지금 주가로 나눠 종목마다 최대 몇 주인지, 다 사고 남는 돈까지.'),
        ('1년 · 한 달 배당(세후)', '최근 1년 실제 배당 기준. 미국 15%, 국내 15.4% 세금을 뺀 금액.'),
        ('포트폴리오 배당률 · 월별 막대', '전체 배당률과 어느 달에 배당이 들어오는지.'),
        ('🔍 종목 검색', '티커(SCHD)나 종목명(삼성전자·커버드콜)으로 찾아 바로 추가.'),
        ('대표 배당 종목 목록', '월배당·고배당 ETF·커버드콜·국내 배당 ETF 등 분류별 대표 종목에 설명과 최근 1년 배당률.'),
        ('비중 자동 맞춤', '비중 합계가 100%가 아니면 바로 알려 주고, 계산할 때 비율대로 맞춰요.'),
    ])}</section>
<section class="lp-sec"><h2>이런 조합을 계산해 보세요</h2><p>미국 배당 성장 <b>SCHD</b> + 월배당 커버드콜 <b>JEPI·JEPQ</b> + 월배당 리츠 <b>O(리얼티인컴)</b>, 국내 상장 <b>TIGER·SOL 미국배당다우존스</b>, <b>KODEX 200타겟위클리커버드콜</b>, <b>TIGER 미국나스닥100타겟데일리커버드콜</b>, 은행 지주 배당주까지 섞어서 넣을 수 있어요.</p></section>
{faq_html(SIM_FAQ)}
<section class="lp-sec lp-end"><a class="lp-cta" href="{go}">🧮 배당 포트폴리오 짜보기 →</a><p class="lp-note"><a href="dividend">지금 받는 배당금 계산기 →</a> · <a href="bonus">성과급 계산기 →</a></p></section>"""
    return page('portfolio', title, desc, body, [app_ld('Fire Portfolio 배당 포트폴리오 계산기', 'portfolio', desc), faq_ld(SIM_FAQ)], og='og-dividend.png?v=1')


def rss():
    """업데이트 소식 RSS 2.0(네이버 서치어드바이저 RSS 제출용) — 날짜별 한 항목"""
    import email.utils, datetime as _dt
    kst = _dt.timezone(_dt.timedelta(hours=9))
    items, newest = [], None
    for d, vers, groups, _ in day_groups():
        lis = [x for _, its in groups for x in its]
        plain = [_re.sub(r'\*\*(.+?)\*\*', r'\1', x) for x in lis]
        first = _re.sub(r'^[^\w가-힣]+', '', plain[0].split(':')[0]).strip()
        when = _dt.datetime(int(d[:4]), int(d[5:7]), int(d[8:]), 9, 0, tzinfo=kst)
        newest = newest or when
        title = f'{d[:4]}.{d[5:7]}.{d[8:]} 업데이트 — {first}' + (f' 외 {len(lis) - 1}건' if len(lis) > 1 else '')
        html_body = ''.join((f'<h3>{_md_inline(h)}</h3>' if h else '') + '<ul>' + ''.join(f'<li>{_md_inline(x)}</li>' for x in its) + '</ul>' for h, its in groups)
        items.append(f"""  <item>
    <title>{esc(title)}</title>
    <link>{SITE}updates#u{d}</link>
    <guid isPermaLink="false">fire-portfolio-update-{d}</guid>
    <pubDate>{email.utils.format_datetime(when)}</pubDate>
    <description><![CDATA[{html_body}]]></description>
  </item>""")
    built = email.utils.format_datetime(newest or _dt.datetime.now(kst))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Fire Portfolio 업데이트 소식</title>
  <link>{SITE}updates</link>
  <atom:link href="{SITE}rss.xml" rel="self" type="application/rss+xml"/>
  <description>퇴사를 위한 주식 대시보드 Fire Portfolio에 새로 생긴 기능과 바뀐 점</description>
  <language>ko</language>
  <lastBuildDate>{built}</lastBuildDate>
{chr(10).join(items)}
</channel>
</rss>
"""



def daily_template():
    """/daily 서버 페이지(functions/daily)가 채워 쓰는 틀 — 소개 페이지와 같은 머리·바닥글. %%TITLE%% 등은 함수가 바꾼다."""
    t = page('daily', '%%TITLE%%', '%%DESC%%', '%%BODY%%', {'x': 1})
    t = t.replace(f'{SITE}daily"', '%%CANON%%"')
    t = _re.sub(r'<script type="application/ld\+json">.*?</script>', '%%LD%%', t, flags=_re.S)
    # /daily/날짜 처럼 한 단계 안쪽 주소에서도 맞게 내부 링크를 모두 절대 경로로(보안 정책 base-uri 'none' 이라 <base> 태그는 못 씀)
    t = _re.sub(r'(href|src)="\./', r'\1="/', t)
    t = _re.sub(r'(href|src)="(?!https?:|/|#|mailto:|data:|%%)', r'\1="/', t)
    return t


def build(dist):
    out = {'about': about_page(), 'dividend': dividend_page(), 'fire': fire_page(), 'bonus': bonus_page(), 'portfolio': portfolio_page(), 'en': en_page(), 'feedback': feedback_page(), 'updates': updates_page(), **{slug: stock_page(slug, S) for slug, S in STOCKS.items()}}
    for slug, text in out.items():
        with open(os.path.join(dist, slug + '.html'), 'w', encoding='utf-8') as f:
            f.write(text)
    with open(os.path.join(dist, 'rss.xml'), 'w', encoding='utf-8') as f:
        f.write(rss())
    return list(out)
