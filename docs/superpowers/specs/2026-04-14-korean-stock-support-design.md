# 한국 주식 지원 설계 (Korean Stock Support)

- 작성일: 2026-04-14
- 대상: `04_US-stock-manager`
- 상태: 설계 확정

## 1. 배경

현 서비스는 미국 주식 전용 포트폴리오 관리 앱으로, 모든 금액이 USD로 DB에 저장되고 FX 서비스로 KRW 환산 표시된다. 한국 주식(KRX)과 KRX 금현물까지 동일한 앱에서 관리하고자 한다.

## 2. 요구사항

- pykrx(https://github.com/sharebook-kr/pykrx) 기반 한국 주식 가격/기본정보 조회
- 한국 주식의 매수·매도 기능(기존 Trade 플로우 재사용)
- KRW·USD 혼재, 대시보드 등 UI는 기존 로직을 통해 동일하게 계산
- 한국장/미국장 개장시간 차이를 반영한 백그라운드 가격 수집
- 한국 KRX 금현물 가격 확보(필수)
- 한국 배당 세율(15.4%) 자동 적용

## 3. 핵심 설계 결정

| 주제 | 결정 |
|---|---|
| 다중 통화 처리 | **계정 단위 통화 고정** — `Account.base_currency` 추가, 한 계정 내 거래는 단일 통화 |
| 금현물 취급 | 일반 종목으로 (ticker `GOLD` 내부 매핑 `04020000`) |
| 시장 판별 | 계정 base_currency 1차 + ticker 패턴(6자리 숫자=KRX) 2차 검증 |
| 가격 수집 스케줄 | 시장별 개별 — 개장 중 120초, 장 외 3600초 |
| 대시보드 표시 | 통화 토글(KRW/USD), 개별 카드는 native, 합계만 환산 |
| 부가기능 | 배당·섹터·종목명 자동(pykrx), 주식분할은 수동 입력 |
| 배당세율 | USD 15% / KRW 15.4% 자동 적용 |

## 4. 데이터 모델 변경

### 4.1 Account

```python
base_currency = Column(String(3), nullable=False, default="USD")  # "USD" | "KRW"
```

- 마이그레이션: 기존 행은 `'USD'`로 채움 (default가 자동 처리)

### 4.2 Trade / Cash / Dividend / RealizedPL / PriceCache / DailySnapshot

- 컬럼명(`price_usd`, `amount_usd`, `pl_usd` 등) 유지
- 의미 재해석: **"해당 계정의 base_currency 단위 금액"**
- 컬럼 리네임은 ROI 낮아 보류. 주석과 헬퍼(`services/currency.py`)로 의미 고정

### 4.3 신규 유틸: `services/market_resolver.py`

```python
def resolve_market(ticker: str) -> Literal["KRX", "US"]:
    if ticker == "GOLD" or re.fullmatch(r"\d{6}", ticker):
        return "KRX"
    return "US"

def validate_ticker_against_account(ticker: str, account_currency: str) -> None:
    market = resolve_market(ticker)
    expected = "KRX" if account_currency == "KRW" else "US"
    if market != expected:
        raise ValueError(...)
```

## 5. 서비스 레이어

### 5.1 `services/krx_service.py` (신규)

- `get_price(ticker)` — pykrx `get_market_ohlcv_by_date`(최근 영업일), `04020000`은 금현물
- `get_name(ticker)` — `get_market_ticker_name`
- `get_dividend(ticker, year)` — `get_market_fundamental` 기반 DPS × 보유수량
- `get_sector(ticker)` — KOSPI/KOSDAQ 업종분류 (메모리 캐싱)
- 모든 호출은 스레드풀 실행(pykrx가 sync이므로 FastAPI async 컨텍스트에서 offload)
- timeout + retry, 실패 시 PriceCache 폴백

### 5.2 `services/price_service.py` / `price_aggregator.py` (변경)

- ticker → `market_resolver.resolve_market()` 분기
- KRX → `krx_service`, US → 기존 yfinance
- PriceCache는 native currency 기준으로 저장

### 5.3 `services/market_hours.py` (신규)

- `is_krx_open()` — 09:00–15:30 KST, 주말/공휴일 제외 (pykrx `get_previous_business_day` 활용)
- `is_us_open()` — 09:30–16:00 ET, DST 자동 처리 (`zoneinfo.ZoneInfo("America/New_York")`)
- 한국 공휴일 하드코딩 금지 — pykrx에 위임

### 5.4 `services/scheduler_service.py` + `background_price_service.py` (변경)

- 종목별로 해당 시장 상태 조회
- 개장 중: 120초 주기 갱신
- 장 외: 3600초 간격 1회 fetch 후 PriceCache 유지

### 5.5 `services/position_engine.py` (변경 최소)

- FIFO 로직 자체는 통화 무관 — 변경 없음
- 집계 결과에 `currency` 메타 포함하여 반환

### 5.6 `services/fx_service.py` (변경)

- 기존 KRW↔USD 로직 유지
- `convert(amount, from_cur, to_cur)` 공용 헬퍼 추가 (대시보드 합계 환산용)

### 5.7 `services/dividend_tax.py` (신규)

- 계정 base_currency 기준 세율 테이블: `{"USD": 0.15, "KRW": 0.154}`
- 배당 자동 수집 시 `tax_withheld` 계산 후 `amount_usd`(=세후)에 반영

## 6. API 레이어

### 6.1 신규

- `GET /api/krx/search?q=<keyword>` — 한글 종목명 검색 → ticker 반환
- `GET /api/krx/ticker/{code}/info` — 종목명·업종

### 6.2 변경

- `POST /api/accounts/` — `base_currency` 필드 수신 (default: "USD")
- `POST /api/trades/` — ticker·계정 통화 정합성 검증, 불일치 시 400
- `GET /api/dashboard/summary/?display_currency=KRW|USD` — 쿼리 파라미터로 합계 환산
- `GET /api/positions/` — 각 position에 `currency` 필드 포함
- `GET /api/dividends/auto-import/` — 계정 통화에 따라 yfinance/pykrx 분기 + 세율 자동

### 6.3 Pydantic 스키마

- `Account`: `base_currency: str` 추가
- `Position` / `Trade` / `Dividend`: `currency: str` 파생 필드 (계정에서 조회)
- `DashboardSummary`: `display_currency`, `total_value_native`, `total_value_display`

## 7. 프론트엔드

### 7.1 신규

- `components/accounts/CurrencyBadge.tsx`
- `components/dashboard/DisplayCurrencyToggle.tsx` — localStorage 저장
- `hooks/useDisplayCurrency.ts`
- `utils/format.ts`: `formatCurrency(amount, currency)` — KRW=정수·₩, USD=소수2자리·$
- `utils/ticker.ts`: `detectMarket(ticker)` — 프론트 미러

### 7.2 변경

- `AccountsTab`: 통화 선택 드롭다운(USD/KRW)
- `TradeInputForm`: 계정 선택 시 base_currency 감지 → placeholder/validation 동적, KRX 계정에서 종목 검색 자동완성
- `PositionsTable`, `TradesTable`, `DividendsTab`, `CashTab`: 금액에 native 통화 포맷
- `Dashboard`: 상단 통화 토글, 개별 카드 native, 전체 합계만 토글 기준 환산
- `AnalysisTab`: 섹터 차트는 표시 통화 기준 환산 집계

## 8. 마이그레이션

`backend/app/migrations/add_krw_support.py` — 앱 lifespan 시작 시 1회 실행:

- `PRAGMA table_info(accounts)`로 `base_currency` 존재 확인
- 없으면 `ALTER TABLE accounts ADD COLUMN base_currency TEXT DEFAULT 'USD' NOT NULL`
- 멱등성 보장

## 9. 의존성

- `backend/requirements.txt`: `pykrx>=1.0.45` 추가
- Docker 이미지 빌드 이슈 발생 시 `lxml` 빌드 의존성 확인

## 10. 테스트

- `tests/test_market_resolver.py` — ticker 패턴, 통화 불일치 검증
- `tests/test_krx_service.py` — pykrx mock, 금현물 코드
- `tests/test_market_hours.py` — KRX/US 개장, DST, 주말·공휴일
- `tests/test_position_engine_multicurrency.py` — KRW/USD 계정 분리 FIFO
- `tests/test_dividend_tax.py` — 15% vs 15.4%

## 11. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| pykrx 호출 실패·타임아웃 | timeout+retry, PriceCache 폴백 |
| 한국 공휴일 | pykrx `get_previous_business_day` |
| 금현물 ticker 관례 부재 | `GOLD` 고정 표기, 내부 `04020000` 매핑 |
| FX 환율 stale | 기존 TTL 유지, 토글 시 refresh 옵션 |
| USD 전용 분기 누락 | `_usd` 사용처 전수 조사 + 테스트 커버리지 |
| 시장 판별 충돌 | 계정 base_currency 1차, ticker 패턴 2차 검증 |

## 12. YAGNI (이번 스코프 제외)

- 한국 주식분할 자동 감지 (수동 입력만)
- ADR·ETF 교차 상장 처리
- 양도소득세·종합과세 계산
- 계정 간 통화 혼재(한 계정에 KRW+USD)
