# 코드 리팩터링 분석 보고서

> 분석일: 2026-04-26  
> 분석 범위: 백엔드 효율성 / 프론트엔드 코드 재활용 / 전체 아키텍처  
> 제외 범위: 백엔드 보안 (추후 별도 개선 예정)

---

## 목차

1. [즉시 수정 필요 (Critical / High)](#1-즉시-수정-필요)
2. [주요 개선 사항 (Medium)](#2-주요-개선-사항)
3. [권장 개선 사항 (Low)](#3-권장-개선-사항)
4. [우선순위 요약](#4-우선순위-요약)
5. [세부 분석 — 백엔드 효율성](#5-세부-분석--백엔드-효율성)
6. [세부 분석 — 프론트엔드 코드 재활용](#6-세부-분석--프론트엔드-코드-재활용)
7. [세부 분석 — 아키텍처 및 API 설계](#7-세부-분석--아키텍처-및-api-설계)

---

## 1. 즉시 수정 필요

### 1-1. 성능 (Critical)

| 위치 | 문제 | 심각도 | 예상 영향 |
|------|------|--------|----------|
| `positions.py:21-36`, `dashboard.py`, `analysis.py`, `snapshots.py` | **매 API 요청마다 PositionEngine FIFO 전체 재계산** — 거래 1,000건 기준 일일 100회 요청 시 100,000회 연산 | Critical | 응답 지연 누적 |
| `price_service.py:159-164` | **yfinance 순차 단건 호출** — 10개 티커 = 10회 HTTP 요청, `yf.download()` 배치 미사용 | High | 가격 조회 10× 느림 |
| `snapshots.py:104-105` | **계정별 N+1 쿼리** — 계정 K개 시 `get_all_trades_for_calculation()` K번 + PositionEngine K번 인스턴스화 | High | 계정 수 증가에 비례 |
| `crud.py:399-408` | **전체 거래를 `.all()`로 메모리 로드 후 Python 필터링** (`get_existing_trade_hashes`) — 거래 수 증가에 비례해 메모리 폭증 | High | 장기 사용 시 OOM 위험 |

**yfinance 배치 처리 수정 (`price_service.py:159`):**
```python
# 변경 전: 티커 수만큼 HTTP 요청
def get_multiple_prices(self, tickers: list[str]) -> dict:
    results = {}
    for ticker in tickers:
        results[ticker] = self.get_price(ticker)
    return results

# 변경 후: 단일 배치 요청
def get_multiple_prices(self, tickers: list[str]) -> dict:
    if not tickers:
        return {}
    symbols = " ".join(tickers)
    raw = yf.download(symbols, period="2d", group_by="ticker", threads=True, progress=False)
    results = {}
    for ticker in tickers:
        try:
            close = raw[ticker]["Close"].dropna().iloc[-1] if ticker in raw else None
            results[ticker] = {"price": float(close)} if close else {}
        except Exception:
            results[ticker] = {}
    return results
```

**N+1 쿼리 수정 (`snapshots.py:103-139`):**
```python
# 변경 전: 계정별로 DB 반복 조회
for account in accounts:
    trades = crud.get_all_trades_for_calculation(db, account.id)  # K번 호출
    engine = PositionEngine(trades)

# 변경 후: 전체 거래 한 번 로드 후 Python에서 분리
from itertools import groupby

all_trades = crud.get_all_trades_for_calculation(db)  # 1번 호출
trades_by_account = {
    account_id: list(trades)
    for account_id, trades in groupby(
        sorted(all_trades, key=lambda t: t.account_id),
        key=lambda t: t.account_id,
    )
}
for account in accounts:
    engine = PositionEngine(trades_by_account.get(account.id, []))
```

**메모리 필터링 수정 (`crud.py:399-408`):**
```python
# 변경 전: 전체 로드 후 Python 필터
def get_existing_trade_hashes(db, account_id):
    trades = db.query(Trade).filter(Trade.account_id == account_id).all()
    return {(t.ticker, t.trade_date, t.quantity, t.price_usd) for t in trades}

# 변경 후: SQL에서 필요한 컬럼만 선택
def get_existing_trade_hashes(db, account_id):
    rows = (
        db.query(Trade.ticker, Trade.trade_date, Trade.quantity, Trade.price_usd)
        .filter(Trade.account_id == account_id)
        .all()
    )
    return set(rows)
```

---

## 2. 주요 개선 사항

### 2-1. 아키텍처

| 위치 | 문제 | 개선 방향 | 예상 작업량 |
|------|------|----------|------------|
| `models.py` — Trade / Cash / Dividend / DailySnapshot | **복합 인덱스 누락** — `(account_id, ticker)`, `(account_id, trade_date)` 없어 계정별 조회마다 풀 스캔 | `Index(...)` 4개 추가 | 1~2시간 |
| `crud.py` (1,046줄) | **단일 파일에 비즈니스 로직 혼재** — `generate_dividend_preview()` (704줄), `apply_stock_split()` (930줄) 등이 CRUD 계층에 존재 | `DividendImportService`, `StockSplitService` 분리 | 반나절 |
| `main.py:62,65` | **BackgroundPriceService + SnapshotScheduler 동시 실행** — SQLite WAL 모드에서도 쓰기 잠금 충돌 위험, 동일 티커 가격 중복 조회 | 단일 통합 스케줄러로 합치기 | 2~3시간 |
| `api/*.py` | **에러 처리 불일치** — `core/exceptions.py` 헬퍼(`validation_exception`, `not_found_exception`)가 이미 구현되어 있으나 일부 라우터에서 `HTTPException`을 직접 사용 | 전 라우터에서 헬퍼 함수로 통일 | 2~3시간 |
| `background_price_service.py:61-70` | **백그라운드 워커가 `time.sleep()` 루프 + 동기 호출** — 이벤트 루프 블로킹 및 종료 신호 처리 불안정 | `asyncio` 태스크 또는 `ThreadPoolExecutor` 전환 | 반나절 |

**복합 인덱스 추가 예시 (`models.py`):**
```python
from sqlalchemy import Index

class Trade(Base):
    __tablename__ = "trades"
    # ...기존 컬럼...

    __table_args__ = (
        Index("idx_trade_account_ticker",   "account_id", "ticker"),
        Index("idx_trade_account_date",     "account_id", "trade_date"),
    )

class Cash(Base):
    __tablename__ = "cash_transactions"

    __table_args__ = (
        Index("idx_cash_account_date", "account_id", "transaction_date"),
    )

class DailySnapshot(Base):
    __tablename__ = "daily_snapshots"

    __table_args__ = (
        Index("idx_snapshot_account_date", "account_id", "snapshot_date"),
    )
```

**백그라운드 워커 개선 (`background_price_service.py:61-70`):**
```python
# 변경 전: 동기 sleep + while 루프
def _background_worker(self):
    while self._running:
        try:
            self._load_all_prices()
        except Exception as e:
            time.sleep(60)
        time.sleep(self.check_interval)

# 변경 후: asyncio 태스크
async def _background_worker(self):
    while self._running:
        try:
            await asyncio.to_thread(self._load_all_prices)
            await asyncio.sleep(self.check_interval)
        except Exception:
            logger.exception("Background price loading error")
            await asyncio.sleep(60)
```

---

### 2-2. 프론트엔드 코드 재활용

| 위치 | 문제 | 개선 방향 | 예상 작업량 |
|------|------|----------|------------|
| `Portfolio.tsx` (1,192줄), `Trades.tsx` (880줄), `Settings.tsx` (939줄), `CashFlow.tsx` (997줄), `PortfolioAnalysis.tsx` (852줄) | **파일 5개가 850~1,200줄** — 렌더 로직·상태 관리·API 호출이 한 파일에 혼재 | 기능 단위 하위 컴포넌트로 분해 | 파일당 2~4시간 |
| `Dashboard.tsx:99`, `PortfolioAnalysis.tsx:90`, `CashFlow.tsx:109` | **`toDisplay()` 통화 변환 함수 3곳에 동일하게 정의** | `hooks/useCurrencyConversion.ts` 추출 | 1~2시간 |
| `Portfolio.tsx`, `PortfolioAnalysis.tsx` | **`SECTOR_COLORS` 객체 2곳에 동일하게 하드코딩** | `design-system/tokens.ts`로 이동 | 30분 |
| 8개 이상 컴포넌트 | **React Query `staleTime` / `refetchInterval` 값 제각각** (30,000 / 60,000 / 300,000 / `5*60*1000` 혼재) — 실수로 다른 값을 쓰면 UI 일관성 깨짐 | `constants/queryConfig.ts`로 통일 | 반나절 |
| `Dashboard.tsx:81-89`, `Portfolio.tsx`, `Trades.tsx`, `CashFlow.tsx` | **계정-통화 매핑 `useMemo` 로직 4곳 반복** | `hooks/useAccountCurrencyMap.ts` 추출 | 1~2시간 |

**컴포넌트 분해 방향 (`Portfolio.tsx`):**
```
components/
  portfolio/
    index.tsx                  ← 탭 라우팅, 전역 상태만 담당 (목표: 100줄 이하)
    PortfolioSummary.tsx        ← 계정별 요약 카드
    PortfolioHoldings.tsx       ← 보유 종목 테이블 + 정렬/필터
    PortfolioPositionRow.tsx    ← 단일 종목 행 (매도 시뮬레이션 포함)
    PortfolioAnalysisTab.tsx    ← 섹터/분석 차트
```

**React Query 상수화 (`constants/queryConfig.ts`):**
```typescript
export const QUERY_CONFIG = {
  REALTIME: { staleTime: 10_000,  refetchInterval: 10_000  },  // 10초 — 가격
  SHORT:    { staleTime: 30_000,  refetchInterval: 30_000  },  // 30초 — 포지션
  MEDIUM:   { staleTime: 60_000,  refetchInterval: 60_000  },  // 1분  — 대시보드
  LONG:     { staleTime: 300_000, refetchInterval: 300_000 },  // 5분  — 계정/설정
} as const;

// 사용 예시
useQuery({
  queryKey: ['positions'],
  queryFn: positionApi.getAll,
  ...QUERY_CONFIG.SHORT,
})
```

**공통 Hook 추출 (`hooks/useCurrencyConversion.ts`):**
```typescript
export function useCurrencyConversion() {
  const [displayCurrency] = useDisplayCurrency();
  const { data: fx } = useQuery({
    queryKey: ['fx'],
    queryFn: fxApi.getRate,
    ...QUERY_CONFIG.LONG,
  });

  const toDisplay = useCallback(
    (amount: number, sourceCurrency: 'USD' | 'KRW'): number => {
      if (sourceCurrency === displayCurrency) return amount;
      const rate = fx?.rate ?? 1;
      if (sourceCurrency === 'USD' && displayCurrency === 'KRW') return amount * rate;
      if (sourceCurrency === 'KRW' && displayCurrency === 'USD') return rate > 0 ? amount / rate : 0;
      return amount;
    },
    [displayCurrency, fx]
  );

  return { toDisplay, fxRate: fx?.rate, displayCurrency };
}
```

---

## 3. 권장 개선 사항

### 3-1. 백엔드

| 위치 | 문제 | 개선 방향 |
|------|------|----------|
| `schemas.py` `DashboardSummary` | Request / Response 분리 미흡 — 24개 필드가 전부 `Optional`, 필수값 구분 불명확 | `DashboardSummaryCreate` / `DashboardSummaryResponse` 분리 |
| `price_service.py` | yfinance `.info` 동일 티커에 2회 중복 호출 (현재 가격 + 전일 종가) | 단일 호출로 통합 후 두 값 추출 |
| `dividend_service.py:49` 등 | 멀티 티커 배당 조회 순차 실행 — 병렬화 없음 | `asyncio.gather()` 또는 `ThreadPoolExecutor.map()` 적용 |
| `background_price_service.py` (9곳) | `print()` 로그 — 타임스탬프·레벨 없음, 프로덕션 필터링 불가 | `logging.getLogger(__name__)` 전환 |
| 각 서비스 상수 | `cache_duration = 300`, `update_interval = 120` 등 매직 넘버 하드코딩 | `core/config.py`에 `CacheConfig`, `SchedulerConfig` 클래스로 외부화 |

**배당 병렬 조회 예시 (`dividend_service.py`):**
```python
# 변경 전: 순차 실행
def fetch_dividends(tickers: list[str]) -> dict:
    return {ticker: yf.Ticker(ticker).dividends for ticker in tickers}

# 변경 후: 스레드 풀 병렬 실행
from concurrent.futures import ThreadPoolExecutor, as_completed

def fetch_dividends(tickers: list[str]) -> dict:
    def _fetch(ticker: str):
        return ticker, yf.Ticker(ticker).dividends

    results = {}
    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        futures = {pool.submit(_fetch, t): t for t in tickers}
        for future in as_completed(futures):
            ticker, data = future.result()
            results[ticker] = data
    return results
```

**설정값 외부화 예시 (`core/config.py`):**
```python
from pydantic_settings import BaseSettings

class CacheConfig(BaseSettings):
    price_cache_ttl: int = 300        # 초
    fx_cache_ttl: int = 3600
    validation_cache_ttl: int = 3600

class SchedulerConfig(BaseSettings):
    bg_price_update_interval: int = 120   # 초
    snapshot_schedule: str = "0 1 * * *"  # cron
```

---

### 3-2. 프론트엔드

| 위치 | 문제 | 개선 방향 |
|------|------|----------|
| `services/api.ts` | `URLSearchParams` 수동 구성 패턴 반복 (최소 5곳) | `buildQueryString()` 헬퍼 추출 |
| 각 컴포넌트 | `types/index.ts` 미등록 로컬 인터페이스 분산 (`LoadingStatus`, `UnifiedTimelineItem` 등) | 파일 상단 로컬 타입을 `types/index.ts`로 이동 |
| 각 컴포넌트 | `onError` toast 처리 패턴 반복 (useMutation 마다 동일 패턴) | `hooks/useMutationWithToast.ts` 추출 |
| `services/api.ts:134,325` | 인라인 `import()` 타입 사용 — IDE 자동완성 및 리팩터링 방해 | 파일 상단에 명시적 import로 변경 |

**`useMutationWithToast` 추출 예시:**
```typescript
// hooks/useMutationWithToast.ts
interface MutationOptions<TData, TVariables> extends
  Omit<UseMutationOptions<TData, Error, TVariables>, 'onError'> {
  successMessage?: string;
  errorMessage?: string;
}

export function useMutationWithToast<TData, TVariables>(
  mutationFn: MutationFunction<TData, TVariables>,
  options: MutationOptions<TData, TVariables> = {}
) {
  const { successMessage, errorMessage, ...rest } = options;

  return useMutation({
    mutationFn,
    onSuccess: (data, ...args) => {
      if (successMessage) toast.success(successMessage);
      rest.onSuccess?.(data, ...args);
    },
    onError: (error) => {
      toast.error(errorMessage ?? error.message ?? '오류가 발생했습니다.');
    },
    ...rest,
  });
}
```

---

### 3-3. 테스트 커버리지 누락

현재 `tests/`에 핵심 서비스 유닛 테스트는 있으나 아래 영역이 누락되어 있습니다.

| 누락 영역 | 위험도 | 근거 |
|----------|--------|------|
| API 엔드포인트 통합 테스트 (accounts POST / PUT / DELETE) | High | 엔드포인트별 검증 로직 누락 시 런타임까지 발견 불가 |
| CSV 임포트 3가지 모드 (append / replace / merge) + 롤백 시나리오 | High | 데이터 유실 위험, 수동 복원 비용 |
| 병렬 가격 조회 / 백그라운드 작업 동시성 | High | Race condition 발견 어려움 |
| `apply_stock_split()` 전체 시나리오 (1:2, 1:3, 역분할) | Medium | 포지션 왜곡 시 재현 어려움 |
| 입력 검증 예외 시나리오 (음수 수량, 미래 날짜 등) | Medium | 스키마 수정 시 회귀 방어 |

---

## 4. 우선순위 요약

| 우선순위 | 항목 | 예상 작업량 | 예상 효과 |
|---------|------|------------|----------|
| **P1 (즉시)** | PositionEngine 결과 캐싱 (거래 변경 시만 무효화) | 4~6시간 | API 응답 시간 60~80% 단축 |
| **P1** | yfinance 배치 처리 (`yf.download`) | 2시간 | 가격 조회 요청 수 10× 감소 |
| **P1** | N+1 쿼리 제거 (snapshots / crud) | 3~4시간 | 계정 증가에 따른 지연 해소 |
| **P2 (1~2주)** | DB 복합 인덱스 4개 추가 | 2~3시간 | 쿼리 응답 50~80% 개선 |
| **P2** | `crud.py` 비즈니스 로직 서비스 계층 분리 | 반나절 | 유지보수성·테스트 용이성 향상 |
| **P2** | 에러 처리 통일 (`core/exceptions.py` 헬퍼 적용) | 2~3시간 | 클라이언트 에러 메시지 일관성 |
| **P2** | 컴포넌트 분해 (850줄+ 파일 5개) | 파일당 2~4시간 | 코드 리뷰·수정 속도 향상 |
| **P2** | React Query 상수화 (`queryConfig.ts`) | 반나절 | 일관된 캐시 정책 |
| **P2** | 공통 Hook 추출 (5개) | 2~3시간 | 중복 제거, 테스트 대상 축소 |
| **P3 (여유 시)** | 스키마 Request/Response 분리 | 반나절 | API 계약 명확화 |
| **P3** | 설정값 외부화 (`config.py`) | 2~3시간 | 환경별 튜닝 용이 |
| **P3** | `print()` → `logger` 전환 | 1~2시간 | 로그 수준 제어 가능 |
| **P3** | 테스트 커버리지 확대 (5개 영역) | 1~2일 | 회귀 방어 |

### 빠른 성과 항목 (작업량 낮음 / 효과 높음)

1. **DB 복합 인덱스 추가** — 2~3시간, 코드 변경 없이 쿼리 성능 50~80% 개선
2. **React Query 상수화** — 반나절, 향후 캐시 정책 변경 시 1곳만 수정
3. **에러 처리 통일** — 2~3시간, `core/exceptions.py` 이미 구현됨, API 파일만 교체
4. **`print()` → `logger` 전환** — 1~2시간, 운영 로그 품질 즉시 개선

---

## 5. 세부 분석 — 백엔드 효율성

### N+1 쿼리 패턴

#### [1-1] 배당 미리보기: 루프 내 PositionEngine N번 호출

- **위치:** `crud.py:730-746`
- **원인:** 배당금 N건 각각에 대해 해당 날짜의 포지션이 필요 → PositionEngine 인스턴스를 N번 생성
- **시간 복잡도:** O(N × M) — N: 배당 건수, M: 전체 거래 수
- **개선:** 날짜 목록을 먼저 수집한 뒤 PositionEngine을 한 번만 계산해 날짜별 결과 캐싱

```python
# 개선 방향
def generate_dividend_preview(db, account_id):
    dividends = _get_pending_dividends(db, account_id)
    trades = crud.get_all_trades_for_calculation(db, account_id)
    engine = PositionEngine(trades)

    # 날짜 목록 수집 후 일괄 계산
    unique_dates = {d.ex_date for d in dividends}
    positions_by_date = {date: engine.calculate_at(date) for date in unique_dates}

    return [
        _build_preview(div, positions_by_date[div.ex_date])
        for div in dividends
    ]
```

#### [1-2] 계정별 스냅샷 생성 N+1 쿼리

- **위치:** `snapshots.py:104-105`
- **원인:** 계정 K개 → `get_all_trades_for_calculation()` K번 + PositionEngine K번 인스턴스화
- **개선:** 전체 거래를 한 번에 조회 후 `account_id`별로 Python에서 분리 (섹션 1-1 예시 참고)

#### [1-3] PriceCache 배치 처리 미사용

- **위치:** `crud.py:262-276`
- **원인:** 100개 티커 갱신 = 100번의 SELECT + UPSERT 순차 실행
- **개선:** `bulk_save_objects()` 또는 SQLAlchemy `insert().prefix_with("OR REPLACE")`

```python
# 변경 전: 100번의 DB 라운드트립
for ticker, price in price_data.items():
    crud.get_or_create_price_cache(db, ticker, price)

# 변경 후: 단일 배치 UPSERT
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

def bulk_upsert_price_cache(db: Session, price_map: dict[str, float]):
    if not price_map:
        return
    stmt = sqlite_insert(PriceCache).values([
        {"ticker": ticker, "price_usd": price, "updated_at": datetime.utcnow()}
        for ticker, price in price_map.items()
    ])
    stmt = stmt.on_conflict_do_update(
        index_elements=["ticker"],
        set_={"price_usd": stmt.excluded.price_usd, "updated_at": stmt.excluded.updated_at},
    )
    db.execute(stmt)
    db.commit()
```

---

### 불필요한 DB 라운드트립

#### [2-1] 전체 거래 메모리 로드 후 Python 필터링

- **위치:** `crud.py:399-408` (`get_existing_trade_hashes`)
- **원인:** `.all()`로 모든 컬럼 로드 후 Python에서 해시 생성
- **위험:** 거래 누적 시 메모리 사용량 선형 증가, GC 부하 증가
- **개선:** 섹션 1-1의 수정 예시 참고 — 필요한 4개 컬럼만 SELECT

#### [2-2] 배당 연도 조회의 이중 필터링

- **위치:** `crud.py:663-701`
- **원인:** SQL 집계 쿼리 실행 후 Python에서 날짜 범위 재필터링
- **개선:** SQL `WHERE trade_date BETWEEN :start_date AND :end_date` 조건으로 통합, 불필요한 로우 전송 제거

---

### 캐시 이중화 불일치

- **위치:** `price_service.py:15-18` (인메모리 5분 TTL) vs `PriceCache` DB 테이블
- **원인:** 백그라운드 서비스가 DB 캐시를 갱신해도 `price_service`의 인메모리 딕셔너리는 별도 주기로 만료 → 최대 5분간 오래된 가격 제공 가능
- **개선 옵션 A (단기):** 인메모리 캐시 TTL을 60초로 단축, DB 캐시 TTL 컬럼 추가
- **개선 옵션 B (장기):** Redis 도입 → 단일 캐시 계층, pub/sub 무효화 가능

---

### PositionEngine 재계산 비용

- **위치:** `positions.py:21-36`, `dashboard.py`, `analysis.py`, `snapshots.py`
- **원인:** 4개 엔드포인트 모두 요청마다 전체 거래 조회 + FIFO 재계산
- **개선 방향:**

```python
# 거래 변경 여부로 캐시 유효성 판단
class PositionCache:
    _cache: dict[int, tuple[datetime, list]] = {}  # account_id → (계산 시각, 결과)

    def get(self, account_id: int, last_trade_updated_at: datetime):
        if account_id in self._cache:
            cached_at, result = self._cache[account_id]
            if cached_at >= last_trade_updated_at:
                return result
        return None

    def set(self, account_id: int, result: list):
        self._cache[account_id] = (datetime.utcnow(), result)
```

---

## 6. 세부 분석 — 프론트엔드 코드 재활용

### 추출 가능한 공통 Hook 목록

| Hook 이름 | 현재 중복 위치 | 추출 후 효과 |
|-----------|--------------|-------------|
| `useCurrencyConversion` | Dashboard, PortfolioAnalysis, CashFlow (3곳) | 환율 로직 1곳 관리, FX 쿼리 중복 제거 |
| `useAccountCurrencyMap` | Dashboard, Portfolio, Trades, CashFlow (4곳) | 계정-통화 매핑 계산 중앙화 |
| `usePriceLoadingStatus` | Dashboard, Portfolio (2곳) | 배경 로딩 상태 조회 통일 |
| `useMutationWithToast` | mutation 전체 컴포넌트 (8곳 이상) | 에러/성공 toast 패턴 표준화 |
| `useInvalidateQueries` | Trades, CsvManagementModal, Settings (3곳) | 캐시 무효화 키 중앙 관리 |

### `useAccountCurrencyMap` 추출 예시

```typescript
// hooks/useAccountCurrencyMap.ts
export function useAccountCurrencyMap(): Map<number, 'USD' | 'KRW'> {
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountApi.getAll,
    ...QUERY_CONFIG.LONG,
  });

  return useMemo(
    () => new Map(accounts?.map(a => [a.id, a.base_currency as 'USD' | 'KRW']) ?? []),
    [accounts]
  );
}
```

### `useInvalidateQueries` 추출 예시

```typescript
// hooks/useInvalidateQueries.ts
const QUERY_KEYS = {
  trades:    ['trades'],
  positions: ['positions'],
  cash:      ['cash'],
  dashboard: ['dashboard'],
  dividends: ['dividends'],
} as const;

export function useInvalidateQueries() {
  const queryClient = useQueryClient();

  return {
    afterTradeChange: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trades }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
      ]),
    afterCashChange: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cash }),
  };
}
```

### API 헬퍼 추출

```typescript
// services/api.ts — 추가할 헬퍼
function buildQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      qs.append(key, String(value));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

// 사용 예시 (현재 반복 패턴 대체)
const url = `/api/trades/${buildQueryString({ account_id, from_date, to_date })}`;
```

---

## 7. 세부 분석 — 아키텍처 및 API 설계

### `crud.py` 분리 제안

현재 1,046줄의 단일 파일에 순수 CRUD와 비즈니스 로직이 혼재합니다.
서비스 계층이 이미 `services/` 디렉터리에 존재하므로 이관만 하면 됩니다.

```
현재: crud.py (1,046줄)

분리 후:
  crud/
    __init__.py          ← 하위 모듈 re-export (하위 호환성 유지)
    accounts.py          ← Account CRUD
    trades.py            ← Trade CRUD (get_existing_trade_hashes 포함)
    cash.py              ← Cash CRUD
    snapshots.py         ← Snapshot CRUD + get_or_create_price_cache
    dividends.py         ← Dividend CRUD + check_dividend_exists
  services/
    dividend_import_service.py   ← generate_dividend_preview() 이관
    stock_split_service.py       ← apply_stock_split() 이관
```

이관 순서: `apply_stock_split()` → `generate_dividend_preview()` 순으로 분리 (의존성이 적은 것부터).

---

### 서비스 의존성 주입 표준화

FastAPI `Depends`를 활용하면 테스트 시 서비스 모킹이 쉬워집니다.

```python
# 현재: 모듈 전역 싱글톤 직접 import
from ..services.price_service import price_service  # 테스트 시 교체 불가

# 개선: Depends로 주입
def get_price_service() -> PriceService:
    return price_service

@router.get("/{ticker}")
async def get_price(
    ticker: str,
    svc: PriceService = Depends(get_price_service),
):
    return await svc.get_price(ticker)

# 테스트에서 오버라이드
app.dependency_overrides[get_price_service] = lambda: MockPriceService()
```

---

### 트랜잭션 일관성 강화

거래 생성 시 현금 처리가 실패하면 거래 레코드만 남는 일관성 문제가 있습니다.

```python
# 현재: 부분 실패 시 거래만 DB에 남음
def create_trade_with_cash(db, trade_data):
    db_trade = crud.create_trade(db, trade_data, commit=False)
    # 아래 실패 시 db_trade는 commit되지 않았지만 세션에 남아 있음
    crud.create_cash_from_trade(db, db_trade, commit=False)
    db.commit()

# 개선: 명시적 트랜잭션 + rollback
def create_trade_with_cash(db, trade_data):
    try:
        db_trade = crud.create_trade(db, trade_data, commit=False)
        crud.create_cash_from_trade(db, db_trade, commit=False)
        db.commit()
        return db_trade
    except Exception:
        db.rollback()
        raise
```

같은 패턴이 `apply_stock_split()`에도 적용 필요: 분할 비율 업데이트 + 거래 수정 + 캐시 무효화를 단일 트랜잭션으로 묶어야 합니다.

---

### 스케줄러 통합

현재 `BackgroundPriceService`와 `SnapshotScheduler`가 독립적으로 실행되어 충돌 위험이 있습니다.

```python
# main.py lifespan 개선안
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = UnifiedScheduler()
    scheduler.add_job(background_price_service.run_once, "interval", seconds=120)
    scheduler.add_job(snapshot_service.create_daily, "cron", hour=1)
    scheduler.start()
    yield
    scheduler.shutdown()
```

단일 APScheduler 인스턴스로 합치면 잡 실행 순서 제어 및 중복 실행 방지가 가능합니다.
