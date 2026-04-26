# 코드 리팩터링 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** docs/code-refactoring.md에 정의된 P1/P2 개선 항목을 코드에 반영하여 백엔드 쿼리 성능, 가격 조회 병렬성, 프론트엔드 코드 재활용성을 향상한다.

**Architecture:** 백엔드는 SQLAlchemy 2.0 + SQLite, 프론트엔드는 React 18 + TanStack React Query + TypeScript. 성능 최적화(Group A), 인프라 개선(Group B), 프론트엔드 훅 추출(Group C) 3개 그룹은 서로 독립적으로 실행 가능하다.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, yfinance, React 18, TypeScript, TanStack React Query v5, Tailwind CSS

---

## 파일 변경 맵

### 생성 파일
| 경로 | 역할 |
|------|------|
| `backend/app/migrations.py` | `add_composite_indexes()` 함수 추가 |
| `frontend/src/constants/queryConfig.ts` | React Query staleTime/refetchInterval 상수 |
| `frontend/src/hooks/useCurrencyConversion.ts` | 통화 변환 공통 Hook |
| `frontend/src/hooks/useAccountCurrencyMap.ts` | 계정-통화 매핑 공통 Hook |
| `frontend/src/hooks/useMutationWithToast.ts` | mutation + toast 공통 Hook |
| `frontend/src/hooks/useInvalidateQueries.ts` | React Query 캐시 무효화 공통 Hook |

### 수정 파일
| 경로 | 변경 내용 |
|------|----------|
| `backend/app/crud.py` | `get_existing_trade_hashes` 컬럼 선택 최적화 |
| `backend/app/services/scheduler_service.py` | 계정별 N+1 쿼리 제거 |
| `backend/app/services/price_service.py` | `get_multiple_prices` ThreadPoolExecutor 병렬화 |
| `backend/app/models.py` | `__table_args__` 복합 인덱스 선언 추가 |
| `backend/app/migrations.py` | `add_composite_indexes()` 함수 추가 + `main.py` 호출 |
| `backend/app/main.py` | `add_composite_indexes(engine)` 호출 추가 |
| `backend/app/services/background_price_service.py` | `print()` → `logger` 전환 |
| `frontend/src/components/Dashboard.tsx` | `queryConfig` 상수 + `useAccountCurrencyMap`, `useCurrencyConversion` 적용 |

---

## Group A — 백엔드 성능 (독립 실행 가능)

### Task 1: get_existing_trade_hashes 컬럼 선택 최적화

**Files:**
- Modify: `backend/app/crud.py:399-408`
- Test: `backend/app/tests/test_crud_optimizations.py` (신규)

- [ ] **Step 1: 테스트 파일 생성**

파일 `backend/app/tests/test_crud_optimizations.py` 생성:

```python
"""crud.py 최적화 항목 유닛 테스트"""
import pytest
from unittest.mock import MagicMock, patch
from sqlalchemy.orm import Session
from datetime import date

from ..crud import get_existing_trade_hashes
from .. import models


def _make_trade_row(account_id, ticker, side, shares, price_usd, trade_date):
    """Row 튜플 생성 헬퍼"""
    row = MagicMock()
    row.account_id = account_id
    row.ticker = ticker
    row.side = side
    row.shares = shares
    row.price_usd = price_usd
    row.trade_date = trade_date
    return row


def test_get_existing_trade_hashes_returns_set_of_strings():
    db = MagicMock(spec=Session)
    row = _make_trade_row(1, "AAPL", "BUY", 10.0, 150.0, date(2024, 1, 15))
    db.query.return_value.all.return_value = [row]

    result = get_existing_trade_hashes(db)

    assert isinstance(result, set)
    assert len(result) == 1
    assert "1_AAPL_BUY_10.0_150.0_2024-01-15" in result


def test_get_existing_trade_hashes_empty():
    db = MagicMock(spec=Session)
    db.query.return_value.all.return_value = []

    result = get_existing_trade_hashes(db)

    assert result == set()


def test_get_existing_trade_hashes_no_full_objects_loaded():
    """db.query() 에 Trade 전체가 아닌 컬럼만 전달되는지 확인"""
    db = MagicMock(spec=Session)
    db.query.return_value.all.return_value = []

    get_existing_trade_hashes(db)

    # db.query()의 첫 번째 인수가 모델 클래스 전체(Trade)가 아니어야 함
    call_args = db.query.call_args[0]
    assert models.Trade not in call_args, (
        "get_existing_trade_hashes should query specific columns, not the full Trade model"
    )
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend && python -m pytest app/tests/test_crud_optimizations.py -v
```

예상 출력: `test_get_existing_trade_hashes_no_full_objects_loaded FAILED` (현재 `models.Trade` 전체를 query 중)

- [ ] **Step 3: crud.py:399-408 수정**

`backend/app/crud.py` 의 `get_existing_trade_hashes` 함수를 아래로 교체:

```python
def get_existing_trade_hashes(db: Session) -> set:
    """기존 거래의 해시셋을 반환 (중복 확인용) — 필요한 컬럼만 SELECT"""
    rows = db.query(
        models.Trade.account_id,
        models.Trade.ticker,
        models.Trade.side,
        models.Trade.shares,
        models.Trade.price_usd,
        models.Trade.trade_date,
    ).all()
    return {
        f"{r.account_id}_{r.ticker}_{r.side}_{r.shares}_{r.price_usd}_{r.trade_date.isoformat()}"
        for r in rows
    }
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
cd backend && python -m pytest app/tests/test_crud_optimizations.py -v
```

예상 출력: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud.py backend/app/tests/test_crud_optimizations.py
git commit -m "perf(crud): get_existing_trade_hashes 컬럼 선택 최적화 — 전체 로드 제거"
```

---

### Task 2: N+1 쿼리 제거 (scheduler_service.py)

**Files:**
- Modify: `backend/app/services/scheduler_service.py:248-305`
- Test: `backend/app/tests/test_crud_optimizations.py` (기존 파일에 추가)

- [ ] **Step 1: 테스트 추가 (`test_crud_optimizations.py` 하단에 append)**

```python
from ..services.scheduler_service import _group_trades_by_account


def test_group_trades_by_account_empty():
    assert _group_trades_by_account([]) == {}


def test_group_trades_by_account_single():
    trades = [{"account_id": 1, "ticker": "AAPL", "shares": 10}]
    result = _group_trades_by_account(trades)
    assert result == {1: [{"account_id": 1, "ticker": "AAPL", "shares": 10}]}


def test_group_trades_by_account_multiple_accounts():
    trades = [
        {"account_id": 1, "ticker": "AAPL", "shares": 10},
        {"account_id": 2, "ticker": "MSFT", "shares": 5},
        {"account_id": 1, "ticker": "GOOG", "shares": 3},
    ]
    result = _group_trades_by_account(trades)
    assert len(result[1]) == 2
    assert len(result[2]) == 1
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend && python -m pytest app/tests/test_crud_optimizations.py::test_group_trades_by_account_empty -v
```

예상 출력: `ImportError: cannot import name '_group_trades_by_account'`

- [ ] **Step 3: scheduler_service.py 수정**

`backend/app/services/scheduler_service.py` 상단 import 블록(라인 1-17) 다음에 헬퍼 함수 추가:

```python
def _group_trades_by_account(trades: list) -> dict:
    """거래 목록을 account_id 기준으로 분리 (N+1 쿼리 방지용)"""
    grouped: dict = {}
    for trade in trades:
        acc_id = trade["account_id"]
        if acc_id not in grouped:
            grouped[acc_id] = []
        grouped[acc_id].append(trade)
    return grouped
```

그리고 `create_daily_snapshot_job` 함수 내 계정별 루프(라인 248-305)를 아래와 같이 교체:

기존:
```python
        # 계정별 스냅샷 생성
        accounts = crud.get_accounts(db, is_active=True)
        for account in accounts:
            account_trades = crud.get_all_trades_for_calculation(db, account.id)
            engine_account = PositionEngine()
            engine_account.process_trades(account_trades)
```

교체:
```python
        # 계정별 스냅샷 생성 — all_trades 재사용으로 N+1 제거
        accounts = crud.get_accounts(db, is_active=True)
        trades_by_account = _group_trades_by_account(all_trades)
        for account in accounts:
            account_trades = trades_by_account.get(account.id, [])
            engine_account = PositionEngine()
            engine_account.process_trades(account_trades)
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
cd backend && python -m pytest app/tests/test_crud_optimizations.py -v
```

예상 출력: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scheduler_service.py backend/app/tests/test_crud_optimizations.py
git commit -m "perf(scheduler): 계정별 스냅샷 N+1 쿼리 제거 — all_trades 재사용"
```

---

### Task 3: get_multiple_prices ThreadPoolExecutor 병렬화

**Files:**
- Modify: `backend/app/services/price_service.py:159-165`
- Test: `backend/app/tests/test_crud_optimizations.py` (추가)

- [ ] **Step 1: 테스트 추가**

`test_crud_optimizations.py` 하단에 추가:

```python
from unittest.mock import patch as mock_patch
from ..services.price_service import PriceService


def test_get_multiple_prices_returns_all_tickers():
    svc = PriceService.__new__(PriceService)
    svc.cache = {}
    svc.cache_duration = 300
    svc.validation_cache = {}
    svc.validation_cache_duration = 3600

    with mock_patch.object(svc, "get_price", side_effect=lambda t: {"price_usd": 100.0, "ticker": t}):
        result = svc.get_multiple_prices(["AAPL", "MSFT", "GOOG"])

    assert set(result.keys()) == {"AAPL", "MSFT", "GOOG"}
    assert result["AAPL"]["price_usd"] == 100.0


def test_get_multiple_prices_empty():
    svc = PriceService.__new__(PriceService)
    result = svc.get_multiple_prices([])
    assert result == {}


def test_get_multiple_prices_handles_individual_failure():
    svc = PriceService.__new__(PriceService)
    svc.cache = {}
    svc.cache_duration = 300
    svc.validation_cache = {}
    svc.validation_cache_duration = 3600

    def side_effect(ticker):
        if ticker == "FAIL":
            raise RuntimeError("network error")
        return {"price_usd": 50.0}

    with mock_patch.object(svc, "get_price", side_effect=side_effect):
        result = svc.get_multiple_prices(["AAPL", "FAIL"])

    assert "AAPL" in result
    assert result["FAIL"] is None  # 실패한 티커는 None 반환
```

- [ ] **Step 2: 테스트 실행 — 일부 FAIL 확인**

```bash
cd backend && python -m pytest app/tests/test_crud_optimizations.py::test_get_multiple_prices_handles_individual_failure -v
```

예상 출력: FAIL (현재 예외가 전파되므로)

- [ ] **Step 3: price_service.py 수정**

`backend/app/services/price_service.py` 상단 import 블록에 추가 (기존 import들 다음):
```python
from concurrent.futures import ThreadPoolExecutor, as_completed
```

`get_multiple_prices` 메서드(라인 159-165)를 교체:

```python
    def get_multiple_prices(self, tickers: list) -> Dict[str, Optional[Dict]]:
        """여러 티커의 가격을 ThreadPoolExecutor로 병렬 조회"""
        if not tickers:
            return {}

        results: Dict[str, Optional[Dict]] = {}
        max_workers = min(len(tickers), 8)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_ticker = {
                executor.submit(self.get_price, ticker): ticker
                for ticker in tickers
            }
            for future in as_completed(future_to_ticker):
                ticker = future_to_ticker[future]
                try:
                    results[ticker] = future.result()
                except Exception:
                    results[ticker] = None

        return results
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
cd backend && python -m pytest app/tests/test_crud_optimizations.py -v
```

예상 출력: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/price_service.py backend/app/tests/test_crud_optimizations.py
git commit -m "perf(price-service): get_multiple_prices ThreadPoolExecutor 병렬 조회"
```

---

## Group B — 백엔드 인프라 (독립 실행 가능)

### Task 4: DB 복합 인덱스 추가

SQLite에서 `CREATE INDEX`는 DDL이므로, 기존 DB에도 적용하려면 `migrations.py`에 함수를 추가하고 `main.py`에서 호출한다. SQLAlchemy `__table_args__`에도 선언해 새 DB에서 `create_all()`이 인덱스를 생성하게 한다.

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/migrations.py`
- Modify: `backend/app/main.py:57-59`

- [ ] **Step 1: models.py — __table_args__ 추가**

`backend/app/models.py`에서 각 모델에 `__table_args__` 추가:

```python
from sqlalchemy import Index

class Trade(Base):
    __tablename__ = "trades"
    # ... 기존 컬럼 변경 없음 ...

    __table_args__ = (
        Index("idx_trade_account_ticker", "account_id", "ticker"),
        Index("idx_trade_account_date",   "account_id", "trade_date"),
    )


class Cash(Base):
    __tablename__ = "cash"
    # ... 기존 컬럼 변경 없음 ...

    __table_args__ = (
        Index("idx_cash_account_date", "account_id", "transaction_date"),
    )


class DailySnapshot(Base):
    __tablename__ = "daily_snapshots"
    # ... 기존 컬럼 변경 없음 ...

    __table_args__ = (
        Index("idx_snapshot_account_date", "account_id", "snapshot_date"),
    )
```

- [ ] **Step 2: migrations.py — add_composite_indexes 함수 추가**

`backend/app/migrations.py` 파일을 열어 파일 끝에 다음 함수를 추가:

```python
def add_composite_indexes(engine) -> None:
    """복합 인덱스 생성 (기존 DB 대응)"""
    ddl_statements = [
        "CREATE INDEX IF NOT EXISTS idx_trade_account_ticker   ON trades(account_id, ticker)",
        "CREATE INDEX IF NOT EXISTS idx_trade_account_date     ON trades(account_id, trade_date)",
        "CREATE INDEX IF NOT EXISTS idx_cash_account_date      ON cash(account_id, transaction_date)",
        "CREATE INDEX IF NOT EXISTS idx_snapshot_account_date  ON daily_snapshots(account_id, snapshot_date)",
    ]
    with engine.connect() as conn:
        for stmt in ddl_statements:
            conn.execute(text(stmt))
        conn.commit()
```

그리고 파일 상단에 `text` import가 없으면 추가:
```python
from sqlalchemy import text
```

- [ ] **Step 3: main.py — add_composite_indexes 호출 추가**

`backend/app/main.py` 라인 34 (migrations import 줄)를 수정:

기존:
```python
from .migrations import ensure_base_currency_column
```

교체:
```python
from .migrations import ensure_base_currency_column, add_composite_indexes
```

그리고 `lifespan` 함수 내 라인 58-59 (기존 마이그레이션 실행 다음) 바로 아래에 추가:

```python
    logger.info("DB 마이그레이션 실행 중...")
    ensure_base_currency_column(engine)
    add_composite_indexes(engine)
    logger.info("DB 마이그레이션 완료")
```

- [ ] **Step 4: 애플리케이션 기동 확인**

```bash
cd backend && python -c "
from app.database import engine
from app.migrations import add_composite_indexes
add_composite_indexes(engine)
print('인덱스 생성 완료')
"
```

예상 출력: `인덱스 생성 완료` (이미 존재해도 오류 없이 통과)

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/migrations.py backend/app/main.py
git commit -m "perf(db): Trade/Cash/DailySnapshot 복합 인덱스 4개 추가"
```

---

### Task 5: background_price_service print() → logger 전환

**Files:**
- Modify: `backend/app/services/background_price_service.py`

- [ ] **Step 1: 파일 상단에 logger 선언 확인 및 추가**

`backend/app/services/background_price_service.py` 파일 상단에 다음이 없으면 추가:

```python
import logging
logger = logging.getLogger(__name__)
```

- [ ] **Step 2: 모든 print() 호출 교체**

파일 내 9곳의 `print()` 호출을 아래 기준으로 교체:

| 원본 | 교체 |
|------|------|
| `print("Background price loading started")` | `logger.info("Background price loading started")` |
| `print("Background price loading stopped")` | `logger.info("Background price loading stopped")` |
| `print(f"Background price loading error: {e}")` | `logger.error("Background price loading error: %s", e)` |
| `print(f"Background loading prices for {len(...)} unique tickers: ...")` | `logger.info("Background loading prices for %d unique tickers: %s", len(active_tickers), ', '.join(active_tickers))` |
| `print(f"[BG] 갱신 대상 {len(tickers_to_update)}/{len(active_tickers)} 종목")` | `logger.debug("[BG] 갱신 대상 %d/%d 종목", len(tickers_to_update), len(active_tickers))` |
| `print(f"Failed to load price for {ticker}: {e}")` | `logger.warning("Failed to load price for %s: %s", ticker, e)` |
| `print(f"Background price loading completed: ...")` | `logger.info("Background price loading completed: %d/%d", ...)` |
| `print(f"Error in background price loading: {e}")` | `logger.error("Error in background price loading: %s", e)` |
| `print(f"Callback error: {e}")` | `logger.warning("Callback error: %s", e)` |

- [ ] **Step 3: grep으로 print() 잔존 여부 확인**

```bash
grep -n "print(" backend/app/services/background_price_service.py
```

예상 출력: (빈 출력 — print 없음)

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/background_price_service.py
git commit -m "refactor(bg-service): print() 전부 logger로 교체"
```

---

## Group C — 프론트엔드 훅 추출 (독립 실행 가능)

### Task 6: React Query queryConfig.ts 상수화

**Files:**
- Create: `frontend/src/constants/queryConfig.ts`
- Modify: `frontend/src/components/Dashboard.tsx` (refetchInterval 교체 시연)

- [ ] **Step 1: constants 디렉터리 및 파일 생성**

`frontend/src/constants/queryConfig.ts` 생성:

```typescript
/**
 * React Query staleTime / refetchInterval 공통 상수
 *
 * REALTIME : 백그라운드 로딩 상태 등 2초 갱신
 * MEDIUM   : 대시보드, 포지션, 시세 60초 갱신
 * LONG     : 계정 목록, 설정 등 5분 갱신
 * STATIC   : 환율 기준값 등 자동 갱신 없음
 */
export const QUERY_CONFIG = {
  REALTIME: { staleTime: 2_000,   refetchInterval: 2_000   },
  MEDIUM:   { staleTime: 60_000,  refetchInterval: 60_000  },
  LONG:     { staleTime: 300_000, refetchInterval: 300_000 },
  STATIC:   { staleTime: 60_000 },
} as const;
```

- [ ] **Step 2: Dashboard.tsx의 하드코딩 값 교체**

`frontend/src/components/Dashboard.tsx` 라인 1 import에 추가:
```typescript
import { QUERY_CONFIG } from '@/constants/queryConfig';
```

그리고 다음 4곳의 하드코딩 값을 교체:

```typescript
// 라인 46-59: dashboard summary 쿼리
  const { data: summary, ... } = useQuery({
    queryKey: ['dashboard-summary', accountId, displayCurrency],
    queryFn: () => dashboardApi.getSummary({...}).then((res) => res.data),
    ...QUERY_CONFIG.MEDIUM,   // refetchInterval: 60000 → MEDIUM
    retry: 3,
    retryDelay: 1000,
  });

// 라인 62-70: positions 쿼리
  const { data: positions } = useQuery({
    queryKey: ['positions-dashboard', accountId],
    queryFn: () => positionsApi.getAll({...}).then((res) => res.data),
    ...QUERY_CONFIG.MEDIUM,   // refetchInterval: 60000 → MEDIUM
    retry: 2,
  });

// 라인 73-78: nasdaq 쿼리
  const { data: nasdaqData } = useQuery({
    queryKey: ['nasdaq-index'],
    queryFn: () => marketApi.getNasdaqIndex().then((r) => r.data),
    ...QUERY_CONFIG.MEDIUM,   // refetchInterval: 60000 → MEDIUM
    retry: 1,
  });

// 라인 92-96: fx 쿼리
  const { data: fxData } = useQuery({
    queryKey: ['fx-rate', 'USD', 'KRW'],
    queryFn: () => fxApi.getUSDKRW().then((r) => r.data),
    ...QUERY_CONFIG.STATIC,   // staleTime: 60_000, 자동 refetch 없음
  });

// 라인 110-114: background loading status 쿼리
  const { data: bgStatus } = useQuery({
    queryKey: ['background-loading-status'],
    queryFn: () => backgroundApi.getPriceLoadingStatus().then((res) => res.data),
    ...QUERY_CONFIG.REALTIME, // refetchInterval: 2000 → REALTIME
  });

// 라인 81-84: accounts 쿼리
  const { data: allAccounts } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => (await accountsApi.getAll()).data,
    ...QUERY_CONFIG.LONG,     // 계정 목록은 5분 캐시
  });
```

- [ ] **Step 3: TypeScript 빌드 확인**

```bash
cd frontend && npx tsc --noEmit
```

예상 출력: (오류 없음)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/constants/queryConfig.ts frontend/src/components/Dashboard.tsx
git commit -m "refactor(frontend): React Query 상수 queryConfig.ts 추출 + Dashboard 적용"
```

---

### Task 7: useCurrencyConversion Hook 추출

**Files:**
- Create: `frontend/src/hooks/useCurrencyConversion.ts`
- Modify: `frontend/src/components/Dashboard.tsx` (toDisplay 제거 → hook 사용)

- [ ] **Step 1: hook 파일 생성**

`frontend/src/hooks/useCurrencyConversion.ts` 생성:

```typescript
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fxApi } from '@/services/api';
import { useDisplayCurrency } from './useDisplayCurrency';
import { QUERY_CONFIG } from '@/constants/queryConfig';
import type { Currency } from '@/types';

interface UseCurrencyConversionReturn {
  toDisplay: (amount: number, sourceCurrency: Currency) => number;
  fxRate: number | undefined;
  displayCurrency: Currency;
}

export function useCurrencyConversion(): UseCurrencyConversionReturn {
  const [displayCurrency] = useDisplayCurrency();

  const { data: fxData } = useQuery({
    queryKey: ['fx-rate', 'USD', 'KRW'],
    queryFn: () => fxApi.getUSDKRW().then((r) => r.data),
    ...QUERY_CONFIG.STATIC,
  });

  const fxRate = fxData?.rate;

  const toDisplay = useCallback(
    (amount: number, sourceCurrency: Currency): number => {
      if (sourceCurrency === displayCurrency) return amount;
      const rate = fxRate ?? 1350;
      if (sourceCurrency === 'USD' && displayCurrency === 'KRW') return amount * rate;
      if (sourceCurrency === 'KRW' && displayCurrency === 'USD') return rate > 0 ? amount / rate : 0;
      return amount;
    },
    [displayCurrency, fxRate]
  );

  return { toDisplay, fxRate, displayCurrency };
}
```

- [ ] **Step 2: Dashboard.tsx에서 hook 사용**

`frontend/src/components/Dashboard.tsx`에서:

1. import 추가:
```typescript
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
```

2. 기존 코드 교체:

기존 (라인 44, 92-104):
```typescript
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();
  // ...
  const { data: fxData } = useQuery({
    queryKey: ['fx-rate', 'USD', 'KRW'],
    queryFn: () => fxApi.getUSDKRW().then((r) => r.data),
    ...QUERY_CONFIG.STATIC,
  });
  const fxUsdKrw = fxData?.rate ?? summary?.fx_rate_usd_krw ?? 1350;

  const toDisplay = (amount: number, cur: Currency): number => {
    if (cur === displayCurrency) return amount;
    if (cur === 'USD' && displayCurrency === 'KRW') return amount * fxUsdKrw;
    if (cur === 'KRW' && displayCurrency === 'USD') return fxUsdKrw > 0 ? amount / fxUsdKrw : 0;
    return amount;
  };
```

교체:
```typescript
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();
  const { toDisplay, fxRate } = useCurrencyConversion();
  const fxUsdKrw = fxRate ?? summary?.fx_rate_usd_krw ?? 1350;
```

3. `fxApi` import가 더 이상 필요 없으면 제거 (다른 곳에서 사용하지 않는 경우에만):
   - `backgroundApi, positionsApi, marketApi, accountsApi, fxApi` 중 `fxApi`만 제거

- [ ] **Step 3: TypeScript 빌드 확인**

```bash
cd frontend && npx tsc --noEmit
```

예상 출력: (오류 없음)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useCurrencyConversion.ts frontend/src/components/Dashboard.tsx
git commit -m "refactor(frontend): useCurrencyConversion hook 추출 + Dashboard 적용"
```

---

### Task 8: useAccountCurrencyMap Hook 추출

**Files:**
- Create: `frontend/src/hooks/useAccountCurrencyMap.ts`
- Modify: `frontend/src/components/Dashboard.tsx` (accountCurrencyMap useMemo 교체)

- [ ] **Step 1: hook 파일 생성**

`frontend/src/hooks/useAccountCurrencyMap.ts` 생성:

```typescript
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountsApi } from '@/services/api';
import { QUERY_CONFIG } from '@/constants/queryConfig';
import type { Currency } from '@/types';

/**
 * 계정 ID → 통화 코드 매핑 Map 반환.
 * 4곳에서 반복되던 useMemo 패턴을 중앙화.
 */
export function useAccountCurrencyMap(): Map<number, Currency> {
  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => (await accountsApi.getAll()).data,
    ...QUERY_CONFIG.LONG,
  });

  return useMemo(
    () =>
      new Map(
        (accounts ?? []).map((a) => [a.id, (a.base_currency ?? 'USD') as Currency])
      ),
    [accounts]
  );
}
```

- [ ] **Step 2: Dashboard.tsx 교체**

`frontend/src/components/Dashboard.tsx`에서:

1. import 추가:
```typescript
import { useAccountCurrencyMap } from '@/hooks/useAccountCurrencyMap';
```

2. 기존 코드 교체:

기존 (라인 81-89):
```typescript
  const { data: allAccounts } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => (await accountsApi.getAll()).data,
    ...QUERY_CONFIG.LONG,
  });
  const accountCurrencyMap = useMemo(() => {
    const m = new Map<number, Currency>();
    (allAccounts ?? []).forEach((a: any) => m.set(a.id, (a.base_currency ?? 'USD') as Currency));
    return m;
  }, [allAccounts]);
```

교체:
```typescript
  const accountCurrencyMap = useAccountCurrencyMap();
```

3. `accountsApi` import가 더 이상 필요 없으면 제거:
   - Dashboard.tsx imports에서 `accountsApi` 제거

- [ ] **Step 3: TypeScript 빌드 확인**

```bash
cd frontend && npx tsc --noEmit
```

예상 출력: (오류 없음)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useAccountCurrencyMap.ts frontend/src/components/Dashboard.tsx
git commit -m "refactor(frontend): useAccountCurrencyMap hook 추출 + Dashboard 적용"
```

---

### Task 9: useMutationWithToast Hook 추출

**Files:**
- Create: `frontend/src/hooks/useMutationWithToast.ts`

- [ ] **Step 1: hook 파일 생성**

`frontend/src/hooks/useMutationWithToast.ts` 생성:

```typescript
import { useMutation } from '@tanstack/react-query';
import type {
  UseMutationOptions,
  UseMutationResult,
  MutationFunction,
} from '@tanstack/react-query';
import { useToast } from './useToast';
import type { ApiError } from '@/services/api';

interface MutationWithToastOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn' | 'onError'> {
  successMessage?: string;
  errorMessage?: string;
  onError?: (error: ApiError, variables: TVariables, context: unknown) => void;
}

/**
 * useMutation + 자동 toast 래퍼.
 * 8개 이상 컴포넌트에서 반복되던 onError toast 패턴을 중앙화.
 *
 * @example
 * const mutation = useMutationWithToast(tradesApi.create, {
 *   successMessage: '거래가 추가되었습니다.',
 *   errorMessage: '거래 추가 중 오류가 발생했습니다.',
 *   onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trades'] }),
 * });
 */
export function useMutationWithToast<TData, TVariables>(
  mutationFn: MutationFunction<TData, TVariables>,
  options: MutationWithToastOptions<TData, TVariables> = {}
): UseMutationResult<TData, ApiError, TVariables> {
  const { toast } = useToast();
  const { successMessage, errorMessage, onError, onSuccess, ...rest } = options;

  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    onSuccess: (data, variables, context) => {
      if (successMessage) {
        toast({ title: successMessage });
      }
      onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      toast({
        title: errorMessage ?? '오류가 발생했습니다.',
        description: error.message,
        variant: 'destructive',
      });
      onError?.(error, variables, context);
    },
    ...rest,
  });
}
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
cd frontend && npx tsc --noEmit
```

예상 출력: (오류 없음)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useMutationWithToast.ts
git commit -m "refactor(frontend): useMutationWithToast hook 추출 — onError toast 패턴 중앙화"
```

---

### Task 10: useInvalidateQueries Hook 추출

**Files:**
- Create: `frontend/src/hooks/useInvalidateQueries.ts`

- [ ] **Step 1: hook 파일 생성**

`frontend/src/hooks/useInvalidateQueries.ts` 생성:

```typescript
import { useQueryClient } from '@tanstack/react-query';

/**
 * React Query 캐시 무효화 키 중앙 관리.
 * Trades / CsvManagementModal / Settings 등에서 반복되던 invalidateQueries 패턴을 통합.
 */
export const QUERY_KEYS = {
  trades:      ['trades']      as const,
  positions:   ['positions']   as const,
  dashboard:   ['dashboard-summary'] as const,
  cash:        ['cash']        as const,
  dividends:   ['dividends']   as const,
  accounts:    ['accounts', 'all'] as const,
  snapshots:   ['snapshots']   as const,
  splits:      ['splits']      as const,
} as const;

export function useInvalidateQueries() {
  const queryClient = useQueryClient();

  return {
    /** 거래 추가/수정/삭제 후 — positions, dashboard도 함께 갱신 */
    afterTradeChange: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trades }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
      ]),

    /** 현금 거래 변경 후 */
    afterCashChange: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cash }),

    /** 배당 변경 후 */
    afterDividendChange: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dividends }),

    /** 계정 변경 후 — accounts + positions + dashboard 갱신 */
    afterAccountChange: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accounts }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
      ]),

    /** 스플릿 적용 후 — 전체 갱신 */
    afterSplitApplied: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trades }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.splits }),
      ]),
  };
}
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
cd frontend && npx tsc --noEmit
```

예상 출력: (오류 없음)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useInvalidateQueries.ts
git commit -m "refactor(frontend): useInvalidateQueries hook 추출 — 캐시 키 중앙 관리"
```

---

### Task 11: buildQueryString API 헬퍼 추출

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: buildQueryString 함수 추가**

`frontend/src/services/api.ts`의 interceptors 블록(라인 85) 바로 아래에 추가:

```typescript
// Query string 빌더 — undefined/null 값 자동 제외
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      qs.append(key, String(value));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
cd frontend && npx tsc --noEmit
```

예상 출력: (오류 없음)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "refactor(frontend): buildQueryString 헬퍼 추출 — URLSearchParams 패턴 중앙화"
```

---

## 완료 후 확인

- [ ] **백엔드 전체 테스트 실행**

```bash
cd backend && python -m pytest app/tests/ -v --tb=short
```

예상 출력: 기존 테스트 전부 pass, 신규 9개 테스트 pass

- [ ] **프론트엔드 빌드 확인**

```bash
cd frontend && npm run build
```

예상 출력: (오류 없음)

- [ ] **Docker로 통합 확인**

```bash
docker compose up -d --build
```

`http://localhost:5173` 접속해 Dashboard, Positions 탭이 정상 렌더링되는지 확인.

---

## 범위 외 항목 (별도 작업 필요)

| 항목 | 이유 |
|------|------|
| PositionEngine 결과 캐싱 | 무효화 전략 설계 필요 (거래 updated_at 비교 로직) |
| crud.py 서비스 계층 분리 | generate_dividend_preview (80줄), apply_stock_split (110줄) 추출 시 광범위한 import 변경 |
| background_price_service asyncio 전환 | threading → asyncio 전면 리라이트 필요, 별도 세션 권장 |
| 에러 처리 통일 (16개 API 파일) | 각 파일 패턴 분석 후 일괄 적용 필요 |
| 컴포넌트 분해 (Portfolio.tsx 등) | 컴포넌트 내 상태 흐름 분석 후 단계적 적용 권장 |
