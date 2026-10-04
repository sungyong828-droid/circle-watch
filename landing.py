"""검색·공유용 소개 페이지(정적 HTML) 만들기 — build.py가 dist에 생성한다.

자바스크립트 없이도 읽히는 글이라 구글·네이버 검색에 잘 잡힌다.
주소: /about · /crcl · /joby · /spcx · /tem  (Cloudflare Pages가 .html을 빼고 연결)
"""
import html
import json
import os

SITE = 'https://yongs-portfolio.pages.dev/'
VER = '1'

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


def page(slug, title, desc, body, ld):
    url = SITE + slug
    return f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d1015">
<title>{esc(title)} | Yong's Portfolio</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Yong's Portfolio">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}assets/og.png">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="assets/favicon.png">
<link rel="apple-touch-icon" href="assets/icon.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" integrity="sha384-GIdEBaqGN9mNkDkMkzMHW8EKUqtpPIe/sLj1X7DIrnc9uPtLROJgmuDlh+3rBw0j" crossorigin="anonymous">
<link rel="stylesheet" href="assets/style.css?v=53">
<link rel="stylesheet" href="assets/landing.css?v={VER}">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body class="lp">
<header class="lp-top"><a class="lp-brand" href="./"><img src="assets/app-icon.png" alt="" width="34" height="34"><span>Yong's Portfolio</span></a><a class="lp-open" href="./?ref=page-{slug}">대시보드 열기</a></header>
<main>
{body}
</main>
<footer class="lp-foot">
  <nav aria-label="소개 페이지"><a href="https://blog.naver.com/ky828" target="_blank" rel="noopener" referrerpolicy="origin">📝 돼용 블로그</a><a href="about">사이트 소개</a><a href="crcl">서클(CRCL)</a><a href="joby">조비(JOBY)</a><a href="spcx">스페이스X(SPCX)</a><a href="tem">템퍼스 AI(TEM)</a></nav>
  <p>투자 조언이 아닌 개인 모니터링 도구예요. 데이터는 공개 출처(Nasdaq·SEC·Yahoo Finance·Binance·FINRA·CBOE 등)에서 가져오며 지연·오류가 있을 수 있어요.</p>
</footer>
<script src="assets/landing.js?v={VER}"></script>
</body>
</html>
'''


def feat_list(items):
    return '<ul class="lp-feats">' + ''.join(f'<li><b>{esc(t)}</b><span>{esc(d)}</span></li>' for t, d in items) + '</ul>'


def faq_html(faq):
    return '<section class="lp-sec"><h2>자주 묻는 질문</h2>' + ''.join(f'<details class="lp-faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in faq) + '</section>'


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
    title = '미국 주식 실시간 대시보드 소개 — 서클·조비·스페이스X·템퍼스'
    desc = "Yong's Portfolio는 서클(CRCL)·조비(JOBY)·스페이스X(SPCX)·템퍼스 AI(TEM) 실시간 주가·캔들 차트, 뉴스 AI 한 줄 요약, 시장 개요, 키워드 속보, 공매도·기관·애널리스트·옵션을 휴대폰 한 화면에 모은 무료 대시보드예요."
    cards = ''.join(f'<a class="lp-stock" href="{slug}"><img src="{S["logo"]}" alt="" width="28" height="28"><b>{esc(S["short"])}</b><small>{S["sym"]}</small></a>' for slug, S in STOCKS.items())
    body = f'''<section class="lp-hero">
  <h1>미국 주식, 앱 여러 개 열지 말고 한 화면에서</h1>
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
    ])}</section>
<section class="lp-sec"><h2>쓰는 방법</h2><ol class="lp-steps">
  <li>휴대폰 브라우저에서 <b>yongs-portfolio.pages.dev</b>를 열어요.</li>
  <li>공유 메뉴에서 <b>홈 화면에 추가</b>를 누르면 앱처럼 바로 열려요.</li>
  <li>위쪽 종목 칩으로 종목을 바꾸고, 아래 탭으로 차트·실적·뉴스를 넘겨 봐요. 카드의 ⓘ를 누르면 지표 설명이 나와요.</li>
</ol></section>
<section class="lp-sec"><h2>만든 사람</h2><a class="blog-card" href="https://blog.naver.com/ky828" target="_blank" rel="noopener" referrerpolicy="origin"><span class="bc-ic" aria-hidden="true">📝</span><span class="bc-t"><b>돼용 블로그</b><small>미국 주식 투자 기록과 이 대시보드 업데이트 소식을 올려요 · 네이버 블로그</small></span><span class="bc-go" aria-hidden="true">→</span></a></section>
<section class="lp-sec"><h2>개인 정보</h2><p>회원가입·로그인이 없고, 보유 정보와 관심 종목은 각자 기기의 브라우저에만 저장돼요. 사이트는 방문 수를 세려고 익명 기기 ID와 유입 경로만 기록해요.</p></section>
{faq_html([
        ('어떤 데이터를 쓰나요?', 'Nasdaq(시세·실적·기관 보유·애널리스트), SEC(공시·재무제표), Yahoo Finance(실시간 체결·차트), Binance(24시간 주식 선물), FINRA(공매도), CBOE(옵션), 서클 공식 API·DefiLlama(USDC), 뉴스 RSS를 써요.'),
        ('얼마나 자주 업데이트되나요?', '주가는 실시간, 나머지 데이터는 5분마다 자동으로 새로 받아요. 오른쪽 위 새로고침으로 바로 갱신할 수도 있어요.'),
        ('투자 추천을 해 주나요?', '아니요. 공개된 데이터를 모아 보여주는 모니터링 도구이고 투자 조언이 아니에요.'),
    ])}'''
    ld = {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': "Yong's Portfolio", 'url': SITE, 'applicationCategory': 'FinanceApplication',
          'operatingSystem': 'Web', 'inLanguage': 'ko', 'description': desc, 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'KRW'}}
    return page('about', title, desc, body, ld)


def build(dist):
    out = {'about': about_page(), **{slug: stock_page(slug, S) for slug, S in STOCKS.items()}}
    for slug, text in out.items():
        with open(os.path.join(dist, slug + '.html'), 'w', encoding='utf-8') as f:
            f.write(text)
    return list(out)
