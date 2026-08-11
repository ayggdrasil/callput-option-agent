# Callput × Bankr 가이드 페이지 디자인 — 국문 번역본

날짜: 2026-08-09
상태: 승인된 영문 제품 스펙의 검토용 국문 번역본, 구현 미시작
제품 canonical 경로: `https://mcp.callput.app/bankr`

> 이 문서는 설계 검토를 위한 한국어 번역본이다. 실제 제품은 영문 단일 페이지 `/bankr`만 제공한다. `/bankr/ko` 경로, 언어 전환 기능, 한국어 제품 페이지는 구현 범위가 아니다. 구현 기준은 영문 원문 `2026-08-09-bankr-guide-page-design.md`이다.

## 1. 요약

`mcp.callput.app`의 기존 오퍼레이터 콘솔 디자인과 시각적으로 연결되는 공개 Bankr 온보딩 페이지를 `/bankr`에 만든다. 개발자보다 일반 Bankr 트레이더를 우선한다.

페이지의 최우선 전환 목표는 `Open Callput in Bankr` CTA를 통해 사용자를 공개 Callput Bankr App으로 보내는 것이다. 제품의 역할을 설명하고, 손실이 제한된 샘플 거래를 시연하며, 서명 경계를 명확하게 보여준다. MCP 설치 안내는 일반 사용자 온보딩 흐름보다 아래에 배치한다.

페이지는 정적 가이드이자 인터랙티브 시뮬레이션이다. 지갑을 연결하거나, calldata를 만들거나, 거래를 서명·브로드캐스트하지 않는다. 거래가 제출되었다고 오인하게 만들지도 않는다.

## 2. 확정된 결정

- 주요 독자: 일반 Bankr 트레이더
- 보조 독자: Bankr 에이전트 운영자와 빌더
- 제품 언어: 영어 전용
- 최우선 KPI: `Open Callput in Bankr` 클릭
- Hero 시연: 인터랙티브하고 결정론적이며 시뮬레이션임을 명시
- 시각 방향: Conversion Console
- 제품 경로: `/bankr`
- 범위: 정적 가이드 자산, Vercel 라우팅, sitemap 메타데이터, 기존 루트 내비게이션의 `Bankr` 링크 1개
- 제외 범위: MCP 도구, Bankr API, 온체인 컨트랙트, Bankr App 거래 로직 변경

## 3. 목표

1. 처음 방문한 Bankr 사용자가 10초 안에 제품 가치를 이해한다.
2. 안전 정보를 숨기지 않으면서 앱 열기 CTA를 가장 강하게 강조한다.
3. 옵션 지식이 없어도 `Scan → Review → Approve` 흐름을 이해한다.
4. Bankr 채팅 핸드오프가 서명·브로드캐스트·제출을 의미하지 않음을 명시한다.
5. 두 번째 거래 화면을 만들지 않고 제품 가치를 시연한다.
6. 에이전트와 검색 시스템이 안정적이고 의미론적인 구조로 통합 내용을 읽을 수 있게 한다.
7. 기존 사이트의 시각 정체성과 정적 배포 방식을 유지한다.

## 4. 비목표

- `/bankr`에서 지갑을 연결하지 않는다.
- 실시간 Callput 시장, RPC, Bankr, 포트폴리오 요청을 보내지 않는다.
- 거래 준비, calldata, 승인 요청, 서명, 브로드캐스트를 하지 않는다.
- 사용자 계정별 상태를 사용하지 않는다.
- 공개 Bankr App과 경쟁하는 두 번째 거래 UI를 만들지 않는다.
- 첫 릴리스에서 제품 페이지 현지화를 제공하지 않는다.
- 기존 루트 페이지를 재설계하지 않는다. 가이드 발견성을 위해 상단 내비게이션에 `Bankr` 링크 하나만 추가한다.

## 5. 포지셔닝과 콘텐츠 원칙

### 5.1 핵심 약속

다음 제품 문구를 사용한다.

> Defined-risk options, directly inside Bankr.

보조 문구:

> Scan synthetic stock, ETF, and crypto option spreads. See the maximum loss before anything reaches your wallet—then review and approve in Bankr chat.

### 5.2 필수 신뢰 문구

첫 화면 안에 아래 세 문장을 이미지가 아닌 실제 HTML 텍스트로 제공한다.

- `No private keys` — Callput이 거래를 준비하고 Bankr 지갑이 서명한다.
- `Not auto-submitted` — Bankr 채팅에서 사용자가 직접 전송하고 승인해야 한다.
- `Synthetic on-chain` — 주식·ETF 상품은 증권사 상장 옵션, 주식 또는 증권 소유권이 아니다.

### 5.3 표준 명칭

화면 문구, 메타데이터, 구조화 데이터, 테스트, 문서에서 다음 명칭을 일관되게 사용한다.

- 제품명: `Callput × Bankr`
- Bankr App CTA: `Open Callput in Bankr`
- MCP 서버 ID: `callput-lite-agent-mcp`
- MCP URL: `https://mcp.callput.app/api/mcp`
- Transport: `HTTP`
- Authentication: `None`
- 네트워크: `Base mainnet (8453)`
- Skill URL: `https://github.com/ayggdrasil/callput-option-agent/tree/v0.4.3/callput`
- Bankr App URL: `https://bankr.bot/apps/callput-options`

## 6. 시각 시스템

새 Bankr 전용 브랜드를 만들지 않고 현재 `frontend-v1`의 시각 언어를 계승한다.

### 6.1 색상 토큰

- 배경: `#10110e`
- 기본 패널: `#171914`
- 상승 패널: `#20241d`
- 기본 텍스트: `#f4efe2`
- 보조 텍스트: `#b8ad9b`
- 약한 텍스트: `#7f7668`
- 금색 강조: `#d8b86d`
- 성공 녹색: `#93b878`
- 경고 황색: `#d8a34d`
- 오류 적색: `#d8786d`
- 기본 테두리: `rgba(218, 201, 164, 0.18)`
- 강한 테두리: `rgba(214, 178, 102, 0.42)`
- 모서리 반경: 6–9px. 큰 pill 형태 카드는 피한다.

### 6.2 타이포그래피

- 제목과 본문: IBM Plex Sans 및 시스템 대체 글꼴
- 식별자, 상태, 지표, 버튼, 코드: IBM Plex Mono 및 monospace 대체 글꼴
- 큰 제목: 데스크톱 43–66px, 태블릿 38–48px, 모바일 34–40px
- 본문: 15–17px, 줄간격 1.55–1.7
- 유틸리티 라벨: 9–12px 영문 대문자 monospace

### 6.3 분위기

- 기존의 따뜻한 어두운 오퍼레이터 콘솔 배경을 유지한다.
- 미세한 수평 그리드와 제품 데모 뒤의 절제된 금색 방사광을 사용한다.
- 장식적인 일러스트보다 가는 테두리, 강한 정렬, 실제 데이터 필드를 우선한다.
- 모션은 스캔 진행, 결과 노출, 복사 피드백에만 사용한다.
- 패럴랙스, 지속적인 빛 효과, 파티클 효과는 사용하지 않는다.

## 7. 페이지 구조

### 7.1 고정 내비게이션

왼쪽:

- Callput 콘솔 마크 `>_`
- `Callput × Bankr`

오른쪽:

- 공개 앱 live 상태
- `How it works`
- `Markets`
- `Safety`
- `For agents`
- `FAQ`
- 작은 `Open Bankr` CTA

모바일에서는 브랜드와 작은 CTA만 보여준다. 섹션 링크를 작고 접근 가능한 메뉴로 만들 수 있을 때만 메뉴를 추가하며, 그렇지 않으면 생략한다.

### 7.2 Hero

데스크톱은 44/56 비율의 2열 레이아웃을 사용한다. 모바일은 문구 다음에 데모가 오는 단일 열이다.

왼쪽 열:

1. Eyebrow: `Built for Bankr · Base · 24/7`
2. H1: `Defined-risk options, directly inside Bankr.`
3. 5.1절의 보조 문구
4. 주 CTA: `Open Callput in Bankr ↗`
5. 보조 앵커: `Try the 30-second demo ↓`
6. 5.2절의 신뢰 문구 3개

오른쪽 열:

- 테두리가 있는 앱 창 형태의 인터랙티브 데모
- 헤더: `Interactive trade preview`, `Simulation · no wallet`
- 실제 제품 UI처럼 인식되지만, 연결된 실거래 지갑 화면처럼 보이면 안 된다.

### 7.3 Bankr 거래 방법

데스크톱에서는 동일한 크기의 카드 3개, 모바일에서는 세로 순서를 사용한다.

1. `Scan` — 자산, 시장 전망, 수량을 선택하면 Callput이 유효한 스프레드를 정렬한다.
2. `Review` — 행사가, 만기, 최소 체결 비율, 네트워크 수수료, 최대 USDC 위험을 확인한다.
3. `Approve` — Bankr 채팅에서 정확한 거래를 열고 사용자가 직접 전송·승인한다.

각 카드의 하단 상태:

- `No wallet action`
- `Unsigned tx only`
- `User controlled`

### 7.4 지원 시장

지원 심볼을 텍스트로 렌더링하고 가능하면 자산 유형별로 묶는다.

- 암호화폐: BTC, ETH
- 주식: TSLA, NVDA, COIN, SPCX, MU, SKHY
- ETF: QQQ, SPY, EWY

다음 고지를 화면에 표시한다.

> Synthetic on-chain options. Stock and ETF products are not broker-listed contracts, securities ownership, or shares. Candidate availability depends on the live feed.

실제 후보 제공 여부는 바뀔 수 있으므로 각 심볼에 항상 녹색 `live` 배지를 붙이지 않는다.

### 7.5 서명 경계

다음 3개 노드의 의미론적 다이어그램을 사용한다.

`Callput App → Bankr Chat → User Wallet`

- Callput App: 시장 탐색, 구조 검증, 정확한 Base calldata 준비
- Bankr Chat: 거래 내용 표시, 사용자의 명시적 행동 대기
- User Wallet: 사용자가 전송·승인한 뒤 서명·브로드캐스트

CSS 없이도 순서가 있는 텍스트로 이해되어야 한다.

### 7.6 Bankr 에이전트와 빌더

일반 사용자 흐름 아래에 보조 전환 블록으로 배치한다.

복사 가능한 설정:

```text
Name: callput-lite-agent-mcp
URL: https://mcp.callput.app/api/mcp
Transport: HTTP
Authentication: None
```

v0.4.3 Skill URL과 읽기 전용 검증 프롬프트를 제공한다.

```text
List the Callput MCP tools, then scan one BTC bullish spread.
Do not prepare, sign, or submit a transaction.
```

공개 MCP는 Callput 도구 10개와 unsigned transaction을 제공한다고 설명한다. MCP 연결이 서명 권한을 부여한다고 표현하면 안 된다.

### 7.7 FAQ

네이티브 `details` 요소 또는 항상 보이는 카드로 답변을 제공한다.

필수 질문:

1. Bankr 검토 화면을 열면 거래가 제출되는가?
2. 어떤 자산이 필요한가?
3. Callput이 개인키를 받거나 저장하는가?
4. 증권사 상장 주식·ETF 옵션인가?
5. 스프레드 후보가 나타나지 않을 수 있는 이유는 무엇인가?
6. Bankr 에이전트는 Callput에 어떻게 연결하는가?

화면 답변과 JSON-LD의 내용은 실질적으로 일치해야 한다.

### 7.8 마지막 CTA

행동 하나만 반복한다.

> Ready to scan your first spread?

CTA: `Open Callput in Bankr ↗`

GitHub, MCP, 문서 CTA를 이 버튼 옆에 배치하지 않는다.

## 8. 인터랙티브 데모

### 8.1 목적

페이지를 떠나기 전에 실제 상호작용 방식을 이해시키는 교육용 결정론적 데모다. 실시간 호가나 거래 생성기가 아니다.

### 8.2 입력

- 자산: BTC, TSLA, SPY, NVDA, ETH
- 시장 전망: bullish, bearish, neutral-bearish, neutral-bullish
- 위험 예산: 1, 5, 25, 100 USDC 미만
- 수량: 고정된 데모 값만 선택할 수 있는 select 또는 stepper

모든 컨트롤은 네이티브 의미론과 키보드 조작을 지원한다.

### 8.3 상태 머신

1. `Choose`
   - 초기 컨트롤만 표시한다.
   - 결과가 존재한다고 암시하지 않는다.
2. `Scanning`
   - 400–700ms 진행 전환을 사용한다.
   - `aria-live="polite"`로 상태를 알린다.
   - `prefers-reduced-motion: reduce`에서는 애니메이션을 건너뛴다.
3. `Risk preview`
   - 전략, 행사가, 만기, 최소 체결 비율, 최대 위험을 보여준다.
   - `Trade ready` 대신 `Valid structure`를 사용한다.
4. `Bankr handoff`
   - 실제 Bankr App이 열릴 것임을 설명한다.
   - 새 탭으로 열며 `noopener noreferrer`를 적용한다.

### 8.4 샘플 데이터

페이지 스크립트에 명확히 표시된 고정 데이터셋을 사용한다.

BTC 예시:

- 전략: BuyCallSpread
- 행사가: 65,000 / 67,000
- 만기: 1일
- 수량: 0.001
- 최소 체결: 78%
- 최대 위험: 0.20 USDC

이는 현재 호가가 아닌 예시다. `Simulation · no wallet` 문구를 표시한다. `live price`, `order submitted`, `confirmed`, `transaction hash`, `position opened` 같은 표현은 사용하지 않는다.

## 9. 구성요소와 분리

권장 정적 자산:

- `bankr/index.html` — 의미론적 콘텐츠, 메타데이터, 구조화 데이터, 섹션 구성
- `bankr/styles.css` — 토큰, 반응형 레이아웃, 포커스, 모션 축소 규칙
- `bankr/app.js` — 결정론적 데모 상태, 복사 버튼, 익명 퍼널 이벤트
- `bankr/og-callput-bankr.png` — 1200×630 전용 소셜 카드

개념적 책임:

- `BankrHero` — 가치 제안, 신뢰 문구, 주 CTA
- `TradePreviewDemo` — 결정론적 상태 머신만 담당
- `QuickstartSteps` — Scan → Review → Approve
- `MarketCoverage` — 지원 심볼과 합성상품 고지
- `SigningBoundary` — 거래 통제권 설명
- `AgentSetup` — MCP와 Skill 설정
- `BankrFaq` — 반론 처리와 schema 일치 답변
- `FinalCta` — 마지막 주 CTA

구현은 정적 HTML 섹션으로 하며 컴포넌트 프레임워크를 추가하지 않는다.

## 10. 데이터 흐름

### 10.1 데모

`로컬 고정 입력 → 로컬 샘플 조회 → 로컬 위험 미리보기 렌더링 → 외부 Bankr App 링크`

데모에는 네트워크 의존성이 없다.

### 10.2 페이지가 설명하는 실제 거래

`Bankr 사용자 → 공개 Callput Bankr App → Callput Bankr API → unsigned Base transaction → Bankr 채팅 → 사용자 지갑 → Base`

가이드 페이지는 이 흐름을 설명할 뿐 참여하지 않는다.

### 10.3 에이전트 설정

`Bankr 에이전트 설정 → 공개 Streamable HTTP MCP → Callput 도구 → unsigned transaction → Bankr 서명 경계`

## 11. 오류와 빈 상태

### 11.1 데모 후보 없음

- `No matching demo spread for this combination.`을 표시한다.
- 다른 자산 또는 더 넓은 위험 예산을 제안한다.
- `No wallet action occurred.`를 명시한다.
- 주 CTA는 계속 노출한다.

### 11.2 Bankr 링크 열기 실패

- 공개 앱 URL을 선택 가능한 텍스트로 유지한다.
- `Copy app URL`, `Try again`을 제공한다.
- 페이지 안에 거래 대체 경로를 만들지 않는다.

### 11.3 JavaScript 비활성화

- Hero, 신뢰 문구, 사용법, 시장, 서명 경계, MCP 설정, FAQ, CTA는 계속 보인다.
- 인터랙티브 결과 대신 정적 예시와 `Demo requires JavaScript`를 표시한다.

### 11.4 클립보드 사용 불가

- 버튼 피드백을 `Select text`로 바꾼다.
- MCP 설정과 프롬프트 원문은 선택 가능해야 한다.

## 12. AI 가독성과 검색 계약

### 12.1 의미론적 HTML

- `h1`은 하나만 사용한다.
- 순차적인 `h2` 구조를 사용한다.
- 네이티브 `a`, `button`, `ol`, `ul`, `code`, `pre`, `details`를 사용한다.
- `Click here` 같은 모호한 링크 라벨을 사용하지 않는다.
- 핵심 주장은 canvas나 이미지에만 넣지 않는다.
- 장식 그래픽을 쓰더라도 모든 값과 결론을 텍스트로 제공한다.

### 12.2 메타데이터

- Title: `Callput for Bankr | 24/7 Defined-Risk On-Chain Options`
- Description: `Open Callput in Bankr to scan synthetic stock, ETF, and crypto option spreads, review maximum risk, and approve Base transactions in Bankr chat.`
- Canonical: `https://mcp.callput.app/bankr`
- Open Graph/Twitter 제목, 설명, URL, 이미지, 대체 텍스트 제공
- `/bankr`를 `sitemap.xml`에 추가
- `robots.txt`에서 색인 허용

### 12.3 구조화 데이터

하나의 JSON-LD 그래프에 다음을 포함한다.

- `WebPage`
- `SoftwareApplication`
- `HowTo`
- `FAQPage`

요구사항:

- 화면 콘텐츠와 JSON-LD가 실질적으로 일치해야 한다.
- `HowTo`는 Scan → Review → Approve를 설명한다.
- 앱 설명에는 unsigned 준비와 외부 서명을 명시한다.
- 오래된 하드코딩 버전이 아니라 현재 릴리스 버전을 사용한다.
- 수익률, 수익 보장, 유동성 보장 표현을 사용하지 않는다.

## 13. 분석과 개인정보

최우선 이벤트는 `bankr_app_open`이다.

허용 이벤트:

- `bankr_guide_view`
- `demo_scan`
- `demo_risk_view`
- `bankr_app_open`
- `mcp_config_copy`
- `skill_link_open`
- `read_only_prompt_copy`

허용 속성:

- CTA 위치: hero, demo, sticky navigation, body, footer
- 데모 자산 유형과 시장 전망 유형
- viewport 유형

수집 금지:

- 지갑 주소 또는 지갑 해시
- 프롬프트 내용
- 개인키 또는 인증 정보
- calldata, 거래 payload, 거래 해시, request key
- 고정된 데모 카테고리 외 사용자가 입력한 금융 금액

분석 서비스가 없어도 페이지는 정상 동작하고 사용자에게 오류를 보이지 않는다.

## 14. 접근성과 반응형

- WCAG AA 대비를 충족한다.
- 터치 화면의 상호작용 대상은 최소 44×44 CSS px이다.
- 금색 계열의 명확한 포커스 링을 사용한다.
- Hero CTA부터 데모와 각 섹션까지 논리적인 키보드 순서를 유지한다.
- 데모 진행과 결과를 polite live region으로 알린다.
- `prefers-reduced-motion`을 존중한다.
- 색상만으로 상태나 유효성을 표현하지 않는다.
- 약 950px 아래에서 Hero 문구와 데모를 세로로 쌓는다.
- 약 820px 아래에서 카드 그리드와 서명 다이어그램을 세로로 바꾼다.
- 320px 화면에서 가로 스크롤이 없어야 한다.

## 15. 성능

- 정적 HTML, CSS, vanilla JavaScript만 사용한다.
- 애플리케이션 프레임워크를 추가하지 않는다.
- 기존 Google Fonts 연결 또는 시스템 대체 글꼴을 사용한다.
- 대형 사진 없이 최적화된 전용 소셜 이미지를 사용한다.
- 실시간 시장 라이브러리, 지갑 SDK, 차트 라이브러리, Bankr SDK를 로드하지 않는다.
- JavaScript가 없어도 문서 전체를 읽을 수 있어야 한다.

## 16. 라우팅과 배포

- `/bankr`와 `/bankr/`를 영문 Bankr 가이드 문서로 연결한다.
- 기존 API, 루트, frontend-v1, sitemap, robots, 보안 헤더 라우트를 유지한다.
- `X-Frame-Options: SAMEORIGIN`, HSTS, referrer policy, permissions policy, content-type 보호를 변경하지 않는다.
- Vercel Preview에서 검증한 뒤 Production에 배포한다.
- Production에서 `/bankr`가 HTTP 200인지 확인하고 `/api/version`, `/api/mcp`가 그대로 동작하는지 확인한다.

## 17. 테스트와 검증

### 17.1 콘텐츠

- canonical URL과 메타데이터
- 정확한 Bankr App, MCP, Skill, GitHub URL
- 지원 심볼 목록
- 주 CTA 라벨
- 필수 안전 문구
- FAQ 질문과 답변
- 구조화 데이터와 Skill 링크의 현재 릴리스 버전

### 17.2 상호작용

- 모든 데모 입력을 키보드로 조작할 수 있다.
- Choose, Scanning, Risk preview, Handoff 상태가 순서대로 동작한다.
- 모션 축소 모드에서 불필요한 전환을 건너뛴다.
- 주 CTA가 올바른 Bankr App URL을 안전하게 연다.
- 복사 버튼이 성공과 실패 피드백을 표시한다.
- 데모가 네트워크·지갑·거래 요청을 보내지 않는다.

### 17.3 접근성

- H1 하나와 올바른 제목 순서
- 논리적 탭 순서와 보이는 포커스
- live region 알림
- 소셜 이미지와 정보 그래픽의 대체 텍스트
- WCAG AA 대비
- 320px에서 가로 overflow 없음

### 17.4 Production

- `/bankr`, `/bankr/`가 200을 반환한다.
- `/api/version`이 배포 버전과 커밋을 반환한다.
- MCP 초기화와 도구 목록이 성공한다.
- 기존 보안 헤더가 유지된다.
- canonical, Open Graph, Twitter, JSON-LD가 유효하다.
- 데스크톱·모바일 시각 회귀 스냅샷이 승인 디자인과 일치한다.

## 18. 완료 조건

1. 첫 화면에서 Callput, Bankr, Base, 상품 유형, 서명 경계를 식별할 수 있다.
2. Hero에는 가장 강한 Bankr App CTA 하나와 그보다 약한 데모 CTA가 있다.
3. 결정론적 데모는 네트워크나 지갑 없이 동작한다.
4. 사용자 흐름은 Scan → Review → Approve로 표현된다.
5. 지원 심볼과 합성상품 고지가 텍스트로 제공된다.
6. 공개 MCP 설정과 v0.4.3 Skill 링크를 복사할 수 있다.
7. 어떤 페이지 상호작용도 거래를 준비·서명·브로드캐스트할 수 없다.
8. JavaScript가 없어도 페이지가 유용하다.
9. 구조화 데이터가 화면 콘텐츠와 일치한다.
10. 접근성, 반응형, 콘텐츠, production route, MCP 회귀 검사를 통과한다.
11. 배포된 `/bankr`가 200을 반환하고 주 CTA가 공개 Bankr App에 연결된다.

