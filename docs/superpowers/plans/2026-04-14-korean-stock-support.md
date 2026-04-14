# 한국 주식 지원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** US Stock Manager에 한국 주식(KRX) + 금현물 지원을 추가. 계정 단위 통화 고정, pykrx 기반 가격·배당·섹터 조회, 시장별 개별 백그라운드 스케줄, 대시보드 통화 토글, 배당세율 자동 적용.

**Architecture:** `Account.base_currency` 컬럼 1개만 추가하고 기존 `_usd` 컬럼은 "계정 base_currency 단위 금액"으로 의미 재해석. ticker 패턴(6자리 숫자=KRX)과 계정 통화로 시장을 이중 판별. pykrx는 sync이므로 스레드풀에서 실행. 시장 개장 여부로 백그라운드 갱신 주기 결정.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, SQLite, pykrx, React 18 + TypeScript, Tailwind, react-query

**Spec:** `docs/superpowers/specs/2026-04-14-korean-stock-support-design.md`

---

## Phase 1: 핵심 인프라

### Task 1: market_resolver 유틸

**Files:**
- Create: `backend/app/services/market_resolver.py`
- Test: `backend/app/tests/test_market_resolver.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/app/tests/test_market_resolver.py
import pytest
from app.services.market_resolver import resolve_market, validate_ticker_against_account


def test_krx_six_digit_ticker():
    assert resolve_market("005930") == "KRX"


def test_gold_ticker():
    assert resolve_market("GOLD") == "KRX"


def test_us_ticker():
    assert resolve_market("AAPL") == "US"


def test_us_ticker_with_dot():
    assert resolve_market("BRK.B") == "US"


def test_validate_ok():
    validate_ticker_against_account("005930", "KRW")
    validate_ticker_against_account("AAPL", "USD")


def test_validate_mismatch_raises():
    with pytest.raises(ValueError, match="market mismatch"):
        validate_ticker_against_account("005930", "USD")
    with pytest.raises(ValueError, match="market mismatch"):
        validate_ticker_against_account("AAPL", "KRW")
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && pytest app/tests/test_market_resolver.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# backend/app/services/market_resolver.py
import re
from typing import Literal

Market = Literal["KRX", "US"]
_KRX_TICKER_RE = re.compile(r"^\d{6}$")
_GOLD_TICKER = "GOLD"
_GOLD_KRX_CODE = "04020000"


def resolve_market(ticker: str) -> Market:
    t = ticker.strip().upper()
    if t == _GOLD_TICKER or _KRX_TICKER_RE.fullmatch(t):
        return "KRX"
    return "US"


def to_krx_code(ticker: str) -> str:
    """내부 pykrx 조회용 코드 변환. GOLD → 04020000, 나머지는 그대로."""
    t = ticker.strip().upper()
    return _GOLD_KRX_CODE if t == _GOLD_TICKER else t


def validate_ticker_against_account(ticker: str, account_currency: str) -> None:
    market = resolve_market(ticker)
    expected = "KRX" if account_currency == "KRW" else "US"
    if market != expected:
        raise ValueError(
            f"market mismatch: ticker={ticker} resolves to {market}, "
            f"but account currency is {account_currency} (expected {expected})"
        )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && pytest app/tests/test_market_resolver.py -v`
Expected: 6 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/market_resolver.py backend/app/tests/test_market_resolver.py
git commit -m "feat: market_resolver — ticker 기반 시장 판별과 계정 통화 검증"
```

---

### Task 2: market_hours 유틸

**Files:**
- Create: `backend/app/services/market_hours.py`
- Test: `backend/app/tests/test_market_hours.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/app/tests/test_market_hours.py
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
from app.services.market_hours import is_krx_open, is_us_open


def _kst(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=ZoneInfo("Asia/Seoul"))


def _et(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=ZoneInfo("America/New_York"))


@patch("app.services.market_hours._now_utc")
def test_krx_open_weekday_morning(mock_now):
    mock_now.return_value = _kst(2026, 4, 14, 10, 0).astimezone(ZoneInfo("UTC"))
    assert is_krx_open() is True


@patch("app.services.market_hours._now_utc")
def test_krx_closed_before_open(mock_now):
    mock_now.return_value = _kst(2026, 4, 14, 8, 59).astimezone(ZoneInfo("UTC"))
    assert is_krx_open() is False


@patch("app.services.market_hours._now_utc")
def test_krx_closed_after_close(mock_now):
    mock_now.return_value = _kst(2026, 4, 14, 15, 31).astimezone(ZoneInfo("UTC"))
    assert is_krx_open() is False


@patch("app.services.market_hours._now_utc")
def test_krx_closed_weekend(mock_now):
    mock_now.return_value = _kst(2026, 4, 11, 10, 0).astimezone(ZoneInfo("UTC"))  # Saturday
    assert is_krx_open() is False


@patch("app.services.market_hours._now_utc")
def test_us_open_weekday(mock_now):
    mock_now.return_value = _et(2026, 4, 14, 10, 0).astimezone(ZoneInfo("UTC"))
    assert is_us_open() is True


@patch("app.services.market_hours._now_utc")
def test_us_closed_weekend(mock_now):
    mock_now.return_value = _et(2026, 4, 11, 10, 0).astimezone(ZoneInfo("UTC"))  # Saturday
    assert is_us_open() is False
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && pytest app/tests/test_market_hours.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# backend/app/services/market_hours.py
from datetime import datetime, time
from zoneinfo import ZoneInfo

_KST = ZoneInfo("Asia/Seoul")
_ET = ZoneInfo("America/New_York")
_UTC = ZoneInfo("UTC")

_KRX_OPEN = time(9, 0)
_KRX_CLOSE = time(15, 30)
_US_OPEN = time(9, 30)
_US_CLOSE = time(16, 0)


def _now_utc() -> datetime:
    return datetime.now(tz=_UTC)


def _is_weekday(dt: datetime) -> bool:
    return dt.weekday() < 5


def is_krx_open() -> bool:
    now_kst = _now_utc().astimezone(_KST)
    if not _is_weekday(now_kst):
        return False
    return _KRX_OPEN <= now_kst.time() <= _KRX_CLOSE


def is_us_open() -> bool:
    now_et = _now_utc().astimezone(_ET)
    if not _is_weekday(now_et):
        return False
    return _US_OPEN <= now_et.time() <= _US_CLOSE
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && pytest app/tests/test_market_hours.py -v`
Expected: 6 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/market_hours.py backend/app/tests/test_market_hours.py
git commit -m "feat: market_hours — KRX/US 개장시간 판별 (DST 자동)"
```

> **Note:** 공휴일 정확도는 Task 6의 `krx_service`가 pykrx를 호출할 때 자연 반영됨(pykrx는 비영업일엔 전 영업일 데이터 반환). 여기서는 평일/시간 체크만.

---

### Task 3: Account.base_currency 컬럼 추가

**Files:**
- Modify: `backend/app/models.py:7-22`
- Create: `backend/app/migrations/__init__.py`
- Create: `backend/app/migrations/add_base_currency.py`
- Modify: `backend/app/main.py` (lifespan에 마이그레이션 훅 추가)

- [ ] **Step 1: 모델 수정**

`backend/app/models.py`의 `Account` 클래스에 컬럼 추가 (line 14 직후):

```python
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    base_currency = Column(String(3), nullable=False, default="USD")
    is_active = Column(Boolean, default=True, nullable=False)
```

- [ ] **Step 2: 마이그레이션 패키지 생성**

```python
# backend/app/migrations/__init__.py
from .add_base_currency import ensure_base_currency_column

__all__ = ["ensure_base_currency_column"]
```

- [ ] **Step 3: 마이그레이션 스크립트 작성**

```python
# backend/app/migrations/add_base_currency.py
from sqlalchemy import text
from sqlalchemy.engine import Engine


def ensure_base_currency_column(engine: Engine) -> None:
    """accounts 테이블에 base_currency 컬럼이 없으면 추가. 멱등성 보장."""
    with engine.begin() as conn:
        cols = conn.execute(text("PRAGMA table_info(accounts)")).fetchall()
        names = {row[1] for row in cols}
        if "base_currency" in names:
            return
        conn.execute(text(
            "ALTER TABLE accounts ADD COLUMN base_currency TEXT NOT NULL DEFAULT 'USD'"
        ))
```

- [ ] **Step 4: lifespan에 마이그레이션 호출 추가**

`backend/app/main.py`에서 기존 `Base.metadata.create_all(bind=engine)` 직후에 추가:

```python
from .migrations import ensure_base_currency_column
# ...
Base.metadata.create_all(bind=engine)
ensure_base_currency_column(engine)
```

- [ ] **Step 5: 앱 구동 검증**

Run: `cd backend && python -c "from app.database import engine; from app.migrations import ensure_base_currency_column; ensure_base_currency_column(engine); print('ok')"`
Expected: `ok`

Run (멱등성 검증): 같은 명령 한 번 더 → `ok`

- [ ] **Step 6: 커밋**

```bash
git add backend/app/models.py backend/app/migrations/ backend/app/main.py
git commit -m "feat: Account.base_currency 컬럼 + 멱등 마이그레이션"
```

---

### Task 4: 스키마에 base_currency 반영

**Files:**
- Modify: `backend/app/schemas.py:7-34`

- [ ] **Step 1: AccountBase·AccountUpdate·AccountResponse 수정**

`schemas.py` line 7 근처:

```python
class AccountBase(BaseModel):
    """계정 기본 스키마"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    is_active: bool = True
    base_currency: str = Field(default="USD", pattern="^(USD|KRW)$")


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    base_currency: Optional[str] = Field(None, pattern="^(USD|KRW)$")


class AccountResponse(AccountBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
```

- [ ] **Step 2: 앱 기동 smoke 테스트**

Run: `cd backend && python -c "from app.schemas import AccountCreate; a = AccountCreate(name='t', base_currency='KRW'); print(a)"`
Expected: `name='t' ... base_currency='KRW'`

Run (검증): `python -c "from app.schemas import AccountCreate; AccountCreate(name='t', base_currency='EUR')"` → ValidationError

- [ ] **Step 3: 커밋**

```bash
git add backend/app/schemas.py
git commit -m "feat: Account 스키마에 base_currency 필드"
```

---

### Task 5: accounts API에서 base_currency 처리

**Files:**
- Modify: `backend/app/api/accounts.py`
- Modify: `backend/app/crud.py` (Account 관련 함수)

- [ ] **Step 1: crud.py 확인 후 반영**

`backend/app/crud.py`에서 `create_account` / `update_account`가 `AccountCreate` / `AccountUpdate`의 모든 필드를 `model_dump()`로 넘기는 구조라면 추가 수정 없음. 필드를 수동 매핑하고 있다면 `base_currency`를 추가:

```python
def create_account(db: Session, data: AccountCreate) -> Account:
    account = Account(**data.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account
```

- [ ] **Step 2: API 수동 smoke 테스트**

Run: `cd backend && uvicorn app.main:app --port 8000 &` (백그라운드)
Run:
```bash
curl -X POST http://localhost:8000/api/accounts/ \
  -H "Content-Type: application/json" \
  -d '{"name":"한국주식","base_currency":"KRW"}'
```
Expected: 201, response에 `"base_currency":"KRW"` 포함

- [ ] **Step 3: 서버 정지 후 커밋**

```bash
git add backend/app/api/accounts.py backend/app/crud.py
git commit -m "feat: accounts API base_currency 지원"
```

---

## Phase 2: KRX 서비스 레이어

### Task 6: pykrx 의존성 추가

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: requirements.txt에 추가**

파일 끝에 추가:
```
pykrx>=1.0.45
```

- [ ] **Step 2: 설치 검증**

Run: `cd backend && pip install -r requirements.txt && python -c "from pykrx import stock; print(stock.get_market_ticker_name('005930'))"`
Expected: `삼성전자` (네트워크 가능 시) 또는 ImportError 없이 import만 성공

- [ ] **Step 3: Docker 이미지 빌드 검증**

Run: `docker compose build backend`
Expected: 성공

- [ ] **Step 4: 커밋**

```bash
git add backend/requirements.txt
git commit -m "chore: pykrx 의존성 추가"
```

---

### Task 7: krx_service — 가격·종목명

**Files:**
- Create: `backend/app/services/krx_service.py`
- Test: `backend/app/tests/test_krx_service.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/app/tests/test_krx_service.py
from unittest.mock import patch, MagicMock
import pandas as pd
from app.services.krx_service import krx_service


@patch("app.services.krx_service.stock.get_market_ticker_name")
def test_get_name(mock_name):
    mock_name.return_value = "삼성전자"
    assert krx_service.get_name("005930") == "삼성전자"
    mock_name.assert_called_once_with("005930")


@patch("app.services.krx_service.stock.get_market_ticker_name")
def test_get_name_gold(mock_name):
    mock_name.return_value = "금 99.99_1Kg"
    krx_service.get_name("GOLD")
    mock_name.assert_called_once_with("04020000")


@patch("app.services.krx_service.stock.get_market_ohlcv_by_date")
def test_get_price(mock_ohlcv):
    df = pd.DataFrame({"종가": [75000.0]}, index=pd.to_datetime(["2026-04-14"]))
    mock_ohlcv.return_value = df
    price = krx_service.get_price("005930")
    assert price == 75000.0


@patch("app.services.krx_service.stock.get_market_ohlcv_by_date")
def test_get_price_empty_returns_none(mock_ohlcv):
    mock_ohlcv.return_value = pd.DataFrame()
    assert krx_service.get_price("005930") is None
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && pytest app/tests/test_krx_service.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# backend/app/services/krx_service.py
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Optional
import logging

from pykrx import stock
from .market_resolver import to_krx_code

logger = logging.getLogger(__name__)


class KRXService:
    """pykrx 래퍼. sync API를 스레드풀에서 실행하여 async 컨텍스트 대응."""

    def get_name(self, ticker: str) -> Optional[str]:
        code = to_krx_code(ticker)
        try:
            return stock.get_market_ticker_name(code)
        except Exception as e:
            logger.warning(f"krx get_name failed for {ticker}: {e}")
            return None

    def get_price(self, ticker: str) -> Optional[float]:
        code = to_krx_code(ticker)
        today = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
        try:
            df = stock.get_market_ohlcv_by_date(start, today, code)
            if df is None or df.empty:
                return None
            return float(df["종가"].iloc[-1])
        except Exception as e:
            logger.warning(f"krx get_price failed for {ticker}: {e}")
            return None

    @lru_cache(maxsize=256)
    def get_sector(self, ticker: str) -> Optional[str]:
        """KOSPI/KOSDAQ 업종 분류. 캐시됨."""
        code = to_krx_code(ticker)
        try:
            # 최근 영업일 기준 업종 조회
            today = datetime.now().strftime("%Y%m%d")
            df = stock.get_market_sector_classifications(today, "KOSPI")
            if code in df.index:
                return str(df.loc[code, "업종명"])
            df = stock.get_market_sector_classifications(today, "KOSDAQ")
            if code in df.index:
                return str(df.loc[code, "업종명"])
            return None
        except Exception as e:
            logger.warning(f"krx get_sector failed for {ticker}: {e}")
            return None

    async def get_price_async(self, ticker: str) -> Optional[float]:
        return await asyncio.to_thread(self.get_price, ticker)

    async def get_name_async(self, ticker: str) -> Optional[str]:
        return await asyncio.to_thread(self.get_name, ticker)


krx_service = KRXService()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && pytest app/tests/test_krx_service.py -v`
Expected: 4 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/krx_service.py backend/app/tests/test_krx_service.py
git commit -m "feat: krx_service — 가격·종목명·섹터 (pykrx 래퍼)"
```

---

### Task 8: krx_service — 배당 조회

**Files:**
- Modify: `backend/app/services/krx_service.py`
- Modify: `backend/app/tests/test_krx_service.py`

- [ ] **Step 1: 실패하는 테스트 추가**

`test_krx_service.py` 끝에 추가:

```python
@patch("app.services.krx_service.stock.get_market_fundamental_by_date")
def test_get_dividend_per_share(mock_fund):
    df = pd.DataFrame({"DPS": [1444.0]}, index=pd.to_datetime(["2026-04-14"]))
    mock_fund.return_value = df
    assert krx_service.get_dividend_per_share("005930", 2025) == 1444.0


@patch("app.services.krx_service.stock.get_market_fundamental_by_date")
def test_get_dividend_per_share_zero(mock_fund):
    mock_fund.return_value = pd.DataFrame()
    assert krx_service.get_dividend_per_share("005930", 2025) is None
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && pytest app/tests/test_krx_service.py::test_get_dividend_per_share -v`
Expected: FAIL (AttributeError)

- [ ] **Step 3: 구현 추가**

`KRXService`에 메서드 추가:

```python
    def get_dividend_per_share(self, ticker: str, year: int) -> Optional[float]:
        """연간 DPS(주당 배당금). pykrx fundamental에서 조회."""
        code = to_krx_code(ticker)
        start = f"{year}0101"
        end = f"{year}1231"
        try:
            df = stock.get_market_fundamental_by_date(start, end, code)
            if df is None or df.empty or "DPS" not in df.columns:
                return None
            # 연간 마지막 값(확정 DPS)
            dps = float(df["DPS"].iloc[-1])
            return dps if dps > 0 else None
        except Exception as e:
            logger.warning(f"krx get_dividend failed for {ticker}/{year}: {e}")
            return None
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && pytest app/tests/test_krx_service.py -v`
Expected: 6 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/krx_service.py backend/app/tests/test_krx_service.py
git commit -m "feat: krx_service 배당(DPS) 조회"
```

---

### Task 9: price_service — KRX 분기

**Files:**
- Modify: `backend/app/services/price_service.py`

- [ ] **Step 1: 현재 price_service 구조 파악**

Read: `backend/app/services/price_service.py` (전체)

핵심 진입점(보통 `get_price(ticker) -> float`)을 찾는다.

- [ ] **Step 2: 시장 분기 로직 삽입**

진입점 함수 최상단에 추가:

```python
from .market_resolver import resolve_market
from .krx_service import krx_service

# get_price 함수 진입부
def get_price(ticker: str) -> Optional[float]:
    if resolve_market(ticker) == "KRX":
        return krx_service.get_price(ticker)
    # ... 기존 yfinance 로직
```

여러 조회 함수가 있다면 각 진입부에 동일 분기 적용. `PriceCache`에 저장할 때는 native 통화 값 그대로 저장 (의미는 계정 통화에 따라 다르지만 `PriceCache`는 ticker 단위이므로 통화 자체가 ticker 시장에 의해 결정됨 — KRX ticker의 가격은 항상 KRW).

- [ ] **Step 3: smoke 테스트**

Run: `cd backend && python -c "from app.services.price_service import get_price; print(get_price('005930'))"`
Expected: 숫자(네트워크) 또는 None (graceful)

- [ ] **Step 4: 커밋**

```bash
git add backend/app/services/price_service.py
git commit -m "feat: price_service KRX 분기 처리"
```

---

### Task 10: price_aggregator — KRX 분기

**Files:**
- Modify: `backend/app/services/price_aggregator.py`

- [ ] **Step 1: 집계 함수에 분기 추가**

배치 조회 함수에 ticker 목록을 시장별로 나눠 조회하도록 수정:

```python
from .market_resolver import resolve_market
from .krx_service import krx_service

def fetch_prices_batch(tickers: list[str]) -> dict[str, float]:
    result = {}
    us_tickers = [t for t in tickers if resolve_market(t) == "US"]
    krx_tickers = [t for t in tickers if resolve_market(t) == "KRX"]

    # US: 기존 로직
    result.update(_fetch_us_batch(us_tickers))

    # KRX: 개별 호출
    for t in krx_tickers:
        p = krx_service.get_price(t)
        if p is not None:
            result[t] = p
    return result
```

기존 함수명·시그니처는 파일에서 직접 확인 후 반영.

- [ ] **Step 2: smoke 테스트**

기존 `/api/prices/` 엔드포인트 호출로 검증.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/price_aggregator.py
git commit -m "feat: price_aggregator KRX 분기"
```

---

### Task 11: background_price_service — 시장별 스케줄

**Files:**
- Modify: `backend/app/services/background_price_service.py`

- [ ] **Step 1: 시장별 갱신 주기 적용**

기존 루프에서 `update_interval = 120`을 ticker별로 가변적으로 적용:

```python
from .market_resolver import resolve_market
from .market_hours import is_krx_open, is_us_open

OPEN_INTERVAL = 120
CLOSED_INTERVAL = 3600


def _interval_for(ticker: str) -> int:
    market = resolve_market(ticker)
    if market == "KRX":
        return OPEN_INTERVAL if is_krx_open() else CLOSED_INTERVAL
    return OPEN_INTERVAL if is_us_open() else CLOSED_INTERVAL
```

업데이트 루프에서 ticker별 마지막 갱신 시각을 추적하여 해당 interval이 지난 것만 fetch. 기존에 전역 `update_interval`로 전체 루프를 돌리고 있다면 다음 구조로 변경:

```python
last_updated: dict[str, float] = {}

async def _update_loop():
    while True:
        now = time.time()
        for ticker in get_all_tickers():
            interval = _interval_for(ticker)
            if now - last_updated.get(ticker, 0) >= interval:
                await _update_one(ticker)
                last_updated[ticker] = now
        await asyncio.sleep(30)  # 체크 주기
```

구현 세부는 현재 파일 구조에 맞춰 조정.

- [ ] **Step 2: 동작 검증**

`docker compose logs -f backend`로 KRX ticker와 US ticker 갱신 주기 다름 확인.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/background_price_service.py
git commit -m "feat: 백그라운드 가격 갱신 시장별 개별 스케줄"
```

---

## Phase 3: 배당 + 세금

### Task 12: dividend_tax 모듈

**Files:**
- Create: `backend/app/services/dividend_tax.py`
- Test: `backend/app/tests/test_dividend_tax.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/app/tests/test_dividend_tax.py
import pytest
from app.services.dividend_tax import apply_withholding_tax, TAX_RATES


def test_us_rate():
    assert TAX_RATES["USD"] == 0.15


def test_krw_rate():
    assert TAX_RATES["KRW"] == 0.154


def test_apply_us():
    gross, tax, net = apply_withholding_tax(100.0, "USD")
    assert gross == 100.0
    assert tax == pytest.approx(15.0)
    assert net == pytest.approx(85.0)


def test_apply_krw():
    gross, tax, net = apply_withholding_tax(10000.0, "KRW")
    assert tax == pytest.approx(1540.0)
    assert net == pytest.approx(8460.0)


def test_unknown_currency_raises():
    with pytest.raises(ValueError):
        apply_withholding_tax(100.0, "EUR")
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && pytest app/tests/test_dividend_tax.py -v`
Expected: FAIL

- [ ] **Step 3: 구현**

```python
# backend/app/services/dividend_tax.py
from typing import Literal

Currency = Literal["USD", "KRW"]

TAX_RATES: dict[str, float] = {
    "USD": 0.15,   # 미국 주식 배당 원천징수
    "KRW": 0.154,  # 한국 배당소득세 14% + 지방세 1.4%
}


def apply_withholding_tax(gross: float, currency: str) -> tuple[float, float, float]:
    """(gross, tax_withheld, net) 반환."""
    if currency not in TAX_RATES:
        raise ValueError(f"unknown currency: {currency}")
    rate = TAX_RATES[currency]
    tax = round(gross * rate, 2)
    net = round(gross - tax, 2)
    return gross, tax, net
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && pytest app/tests/test_dividend_tax.py -v`
Expected: 5 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/dividend_tax.py backend/app/tests/test_dividend_tax.py
git commit -m "feat: dividend_tax — USD 15%/KRW 15.4% 자동 계산"
```

---

### Task 13: dividend_service — KRX 자동 수집

**Files:**
- Modify: `backend/app/services/dividend_service.py`

- [ ] **Step 1: 계정 통화별 분기 추가**

`dividend_service.py` 자동 import 함수에 분기:

```python
from .market_resolver import resolve_market
from .krx_service import krx_service
from .dividend_tax import apply_withholding_tax


def auto_import_for_account(db, account_id: int, year: int):
    account = crud.get_account(db, account_id)
    currency = account.base_currency
    positions = position_engine.compute_positions(db, account_id)

    for pos in positions:
        ticker = pos.ticker
        market = resolve_market(ticker)
        if currency == "KRW" and market == "KRX":
            dps = krx_service.get_dividend_per_share(ticker, year)
            if not dps:
                continue
            gross = dps * pos.shares
            gross, tax, net = apply_withholding_tax(gross, "KRW")
            _create_dividend(db, account_id, ticker, net, tax, dps, pos.shares, year)
        elif currency == "USD" and market == "US":
            # 기존 yfinance 로직 + 세율 적용
            ...
```

정확한 함수명·시그니처는 현재 `dividend_service.py`를 읽고 맞춘다. 핵심: 세율을 계정 base_currency 기반으로 호출.

- [ ] **Step 2: smoke 테스트**

KRW 계정에 `005930` 거래를 추가하고 `/api/dividends/auto-import/` 호출 → 15.4% 세금 반영 확인.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/dividend_service.py
git commit -m "feat: KRX 배당 자동 수집 + 통화별 세율"
```

---

## Phase 4: API 레이어

### Task 14: trades API — ticker 시장 검증

**Files:**
- Modify: `backend/app/api/trades.py`

- [ ] **Step 1: 생성 엔드포인트에 검증 추가**

`POST /api/trades/` 핸들러 진입부:

```python
from ..services.market_resolver import validate_ticker_against_account
from ..crud import get_account

# handler 내부
account = get_account(db, trade.account_id)
if not account:
    raise HTTPException(404, "account not found")
try:
    validate_ticker_against_account(trade.ticker, account.base_currency)
except ValueError as e:
    raise HTTPException(400, str(e))
```

`PUT` 업데이트 핸들러에도 동일 검증 (ticker나 account_id 변경 시).

- [ ] **Step 2: smoke 테스트**

```bash
# KRW 계정에 AAPL 거래 시도 → 400
curl -X POST http://localhost:8000/api/trades/ \
  -H "Content-Type: application/json" \
  -d '{"account_id":<KRW계정ID>,"ticker":"AAPL","side":"BUY","shares":1,"price_usd":100,"trade_date":"2026-04-14"}'
```
Expected: 400 "market mismatch"

- [ ] **Step 3: 커밋**

```bash
git add backend/app/api/trades.py
git commit -m "feat: trades API ticker·계정통화 정합성 검증"
```

---

### Task 15: KRX 검색·정보 API

**Files:**
- Create: `backend/app/api/krx.py`
- Modify: `backend/app/main.py` (라우터 등록)

- [ ] **Step 1: 라우터 작성**

```python
# backend/app/api/krx.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services.krx_service import krx_service

router = APIRouter(prefix="/api/krx", tags=["krx"])


class TickerInfo(BaseModel):
    ticker: str
    name: str
    sector: str | None = None


@router.get("/ticker/{code}/info", response_model=TickerInfo)
async def get_ticker_info(code: str):
    name = await krx_service.get_name_async(code)
    if not name:
        raise HTTPException(404, "ticker not found")
    sector = krx_service.get_sector(code)
    return TickerInfo(ticker=code, name=name, sector=sector)


@router.get("/search", response_model=list[TickerInfo])
async def search_ticker(q: str):
    """종목명 부분 일치 검색. pykrx의 전체 티커 리스트에서 필터."""
    from pykrx import stock
    import asyncio

    def _search():
        results = []
        for mkt in ("KOSPI", "KOSDAQ"):
            try:
                tickers = stock.get_market_ticker_list(market=mkt)
            except Exception:
                continue
            for t in tickers:
                name = stock.get_market_ticker_name(t)
                if q in name:
                    results.append(TickerInfo(ticker=t, name=name))
                    if len(results) >= 20:
                        return results
        return results

    return await asyncio.to_thread(_search)
```

- [ ] **Step 2: 라우터 등록**

`backend/app/main.py`에 추가:

```python
from .api import krx as krx_api
app.include_router(krx_api.router)
```

- [ ] **Step 3: smoke 테스트**

Run:
```bash
curl http://localhost:8000/api/krx/ticker/005930/info
curl "http://localhost:8000/api/krx/search?q=삼성"
```
Expected: 삼성전자 정보 / 삼성 관련 종목 목록

- [ ] **Step 4: 커밋**

```bash
git add backend/app/api/krx.py backend/app/main.py
git commit -m "feat: KRX 종목 검색·정보 API"
```

---

### Task 16: dashboard API — display_currency 토글

**Files:**
- Modify: `backend/app/api/dashboard.py`
- Modify: `backend/app/schemas.py` (DashboardSummary)

- [ ] **Step 1: 스키마 필드 추가**

`DashboardSummary`에:
```python
display_currency: str = "KRW"
total_value_display: float = 0.0  # display_currency로 환산한 전체 합
```

- [ ] **Step 2: 엔드포인트 쿼리 파라미터 추가**

```python
from fastapi import Query
from ..services.fx_service import fx_service
from ..services.market_resolver import resolve_market

@router.get("/summary/", response_model=DashboardSummary)
async def get_summary(
    display_currency: str = Query("KRW", pattern="^(USD|KRW)$"),
    db: Session = Depends(get_db),
):
    # 계정별 요약 계산 (기존 로직)
    summaries = compute_account_summaries(db)

    total_display = 0.0
    for s in summaries:
        account = get_account(db, s.account_id)
        native = account.base_currency
        value_native = s.total_market_value_native  # 새 필드
        total_display += fx_service.convert(value_native, native, display_currency)

    return DashboardSummary(
        display_currency=display_currency,
        total_value_display=total_display,
        # ... 기존 필드
    )
```

`AccountSummary`에도 `base_currency: str` 필드와 `total_market_value_native` 추가. 기존 `_usd` 필드는 호환을 위해 유지하되, KRW 계정의 경우 "KRW 단위 금액"을 담는다고 문서화.

- [ ] **Step 3: smoke 테스트**

```bash
curl "http://localhost:8000/api/dashboard/summary/?display_currency=USD"
curl "http://localhost:8000/api/dashboard/summary/?display_currency=KRW"
```
Expected: 서로 다른 `total_value_display` 값

- [ ] **Step 4: 커밋**

```bash
git add backend/app/api/dashboard.py backend/app/schemas.py
git commit -m "feat: dashboard display_currency 토글 지원"
```

---

### Task 17: positions API — currency 필드 포함

**Files:**
- Modify: `backend/app/api/positions.py`
- Modify: `backend/app/schemas.py` (Position 응답)

- [ ] **Step 1: Position 스키마에 currency 추가**

```python
class PositionResponse(BaseModel):
    # ... 기존 필드
    currency: str  # "USD" | "KRW" (계정 base_currency 파생)
```

- [ ] **Step 2: 엔드포인트에서 account.base_currency 주입**

각 포지션 DTO 변환 시 해당 계정의 `base_currency`를 `currency`로 세팅.

- [ ] **Step 3: smoke 테스트**

```bash
curl http://localhost:8000/api/positions/
```
Expected: 각 position에 `"currency":"KRW"` 또는 `"USD"` 포함

- [ ] **Step 4: 커밋**

```bash
git add backend/app/api/positions.py backend/app/schemas.py
git commit -m "feat: positions API currency 필드"
```

---

## Phase 5: 프론트엔드 공통 유틸

### Task 18: types·format·ticker 유틸

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/utils/format.ts`
- Create: `frontend/src/utils/ticker.ts`

- [ ] **Step 1: types/index.ts에 Currency·필드 추가**

```typescript
export type Currency = "USD" | "KRW";

export interface Account {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  base_currency: Currency;
  created_at: string;
  updated_at?: string;
}

export interface Position {
  // ... 기존 필드
  currency: Currency;
}
```

여타 관련 타입(`Trade`, `Dividend`, `DashboardSummary`)에 필요한 경우 `currency` 또는 `display_currency` 추가.

- [ ] **Step 2: utils/format.ts 작성**

```typescript
// frontend/src/utils/format.ts
import type { Currency } from "../types";

export function formatCurrency(amount: number, currency: Currency): string {
  if (currency === "KRW") {
    return `₩${Math.round(amount).toLocaleString("ko-KR")}`;
  }
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function currencySymbol(currency: Currency): string {
  return currency === "KRW" ? "₩" : "$";
}
```

- [ ] **Step 3: utils/ticker.ts 작성**

```typescript
// frontend/src/utils/ticker.ts
import type { Currency } from "../types";

export type Market = "KRX" | "US";

const KRX_PATTERN = /^\d{6}$/;

export function detectMarket(ticker: string): Market {
  const t = ticker.trim().toUpperCase();
  if (t === "GOLD" || KRX_PATTERN.test(t)) return "KRX";
  return "US";
}

export function validateTickerForCurrency(
  ticker: string,
  currency: Currency
): string | null {
  const market = detectMarket(ticker);
  const expected = currency === "KRW" ? "KRX" : "US";
  if (market !== expected) {
    return `${currency} 계정에는 ${expected} 시장 종목만 입력할 수 있습니다`;
  }
  return null;
}
```

- [ ] **Step 4: 타입 체크**

Run: `cd frontend && cmd /c "npm run build"` (또는 `tsc --noEmit`)
Expected: 성공

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/types/index.ts frontend/src/utils/format.ts frontend/src/utils/ticker.ts
git commit -m "feat: frontend 통화·시장 유틸"
```

---

### Task 19: useDisplayCurrency 훅 + 토글 컴포넌트

**Files:**
- Create: `frontend/src/hooks/useDisplayCurrency.ts`
- Create: `frontend/src/components/dashboard/DisplayCurrencyToggle.tsx`

- [ ] **Step 1: 훅 작성**

```typescript
// frontend/src/hooks/useDisplayCurrency.ts
import { useEffect, useState } from "react";
import type { Currency } from "../types";

const STORAGE_KEY = "display_currency";

export function useDisplayCurrency(): [Currency, (c: Currency) => void] {
  const [currency, setCurrency] = useState<Currency>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "USD" ? "USD" : "KRW";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, currency);
  }, [currency]);

  return [currency, setCurrency];
}
```

- [ ] **Step 2: 토글 컴포넌트 작성**

```typescript
// frontend/src/components/dashboard/DisplayCurrencyToggle.tsx
import type { Currency } from "../../types";

interface Props {
  value: Currency;
  onChange: (c: Currency) => void;
}

export function DisplayCurrencyToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
      {(["KRW", "USD"] as Currency[]).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`px-3 py-1 text-sm ${
            value === c
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 타입 체크**

Run: `cd frontend && cmd /c "npm run build"`
Expected: 성공

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/hooks/useDisplayCurrency.ts frontend/src/components/dashboard/DisplayCurrencyToggle.tsx
git commit -m "feat: 대시보드 표시 통화 토글"
```

---

### Task 20: CurrencyBadge 컴포넌트

**Files:**
- Create: `frontend/src/components/accounts/CurrencyBadge.tsx`

- [ ] **Step 1: 작성**

```typescript
// frontend/src/components/accounts/CurrencyBadge.tsx
import type { Currency } from "../../types";

export function CurrencyBadge({ currency }: { currency: Currency }) {
  const styles =
    currency === "KRW"
      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
      : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded ${styles}`}>
      {currency}
    </span>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/components/accounts/CurrencyBadge.tsx
git commit -m "feat: CurrencyBadge 컴포넌트"
```

---

## Phase 6: 프론트엔드 화면 적용

### Task 21: AccountsTab — 통화 드롭다운

**Files:**
- Modify: `frontend/src/components/AccountsTab.tsx` (또는 실제 경로)
- Modify: `frontend/src/services/api.ts` (Account 생성 요청)

- [ ] **Step 1: 계정 생성 폼에 드롭다운 추가**

계정 생성 state에 `base_currency: Currency` 추가. 폼 UI:

```tsx
<select
  value={form.base_currency}
  onChange={(e) => setForm({ ...form, base_currency: e.target.value as Currency })}
  className="..."
>
  <option value="USD">USD (미국)</option>
  <option value="KRW">KRW (한국)</option>
</select>
```

- [ ] **Step 2: 계정 목록에 CurrencyBadge 표시**

계정 행/카드에 `<CurrencyBadge currency={account.base_currency} />` 추가.

- [ ] **Step 3: api.ts에서 `base_currency` 전달**

`createAccount` 페이로드에 필드 포함 (타입 자동 추종).

- [ ] **Step 4: 브라우저 수동 테스트**

Run: `docker compose up -d`
→ http://localhost:5173 접속 → Accounts 탭에서 "한국주식" 계정 생성 (KRW 선택) → 목록에 `KRW` 배지 표시 확인

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/ frontend/src/services/api.ts
git commit -m "feat: 계정 생성/목록 base_currency 표시"
```

---

### Task 22: 매수입력 폼 — 시장 인식

**Files:**
- Modify: `frontend/src/components/` (매수입력 컴포넌트)

- [ ] **Step 1: 계정 선택 시 ticker placeholder 동적 변경**

```tsx
const selectedAccount = accounts.find((a) => a.id === form.account_id);
const isKRW = selectedAccount?.base_currency === "KRW";
const tickerPlaceholder = isKRW ? "005930 또는 GOLD" : "AAPL";

<input
  placeholder={tickerPlaceholder}
  onChange={(e) => {
    const err = selectedAccount
      ? validateTickerForCurrency(e.target.value, selectedAccount.base_currency)
      : null;
    setTickerError(err);
    setForm({ ...form, ticker: e.target.value });
  }}
/>
{tickerError && <p className="text-red-500 text-xs">{tickerError}</p>}
```

- [ ] **Step 2: KRW 계정일 때 종목 검색 박스 노출**

`GET /api/krx/search?q=` 호출 → 자동완성 드롭다운. react-query `useQuery` + debounce.

```tsx
const { data: suggestions } = useQuery({
  queryKey: ["krx-search", tickerInput],
  queryFn: () => krxApi.search(tickerInput),
  enabled: isKRW && tickerInput.length >= 1 && !/^\d{6}$/.test(tickerInput),
});
```

결과 클릭 시 ticker 필드에 code 채움.

- [ ] **Step 3: api.ts에 krxApi 추가**

```typescript
export const krxApi = {
  search: (q: string) =>
    axios.get<TickerInfo[]>(`/api/krx/search`, { params: { q } }).then((r) => r.data),
  info: (code: string) =>
    axios.get<TickerInfo>(`/api/krx/ticker/${code}/info`).then((r) => r.data),
};
```

- [ ] **Step 4: 브라우저 수동 테스트**

KRW 계정 선택 → "삼성" 입력 → 드롭다운에서 삼성전자 선택 → 005930 입력됨
USD 계정 선택 후 "005930" 입력 → 에러 메시지

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/ frontend/src/services/api.ts
git commit -m "feat: 매수입력 폼 시장 자동 인식·KRX 검색"
```

---

### Task 23: 테이블 금액 포맷 통합

**Files:**
- Modify: `frontend/src/components/PositionsTable.tsx`
- Modify: `frontend/src/components/TradesTable.tsx`
- Modify: `frontend/src/components/DividendsTab.tsx`
- Modify: `frontend/src/components/CashTab.tsx`

- [ ] **Step 1: 각 테이블에서 `formatCurrency` 적용**

기존 `$${amount.toFixed(2)}` 같은 표기를 `formatCurrency(amount, row.currency ?? "USD")`로 교체. 테이블 행에서 해당 계정의 `base_currency`를 참조.

- [ ] **Step 2: 각 탭 타입 에러 해결 후 빌드 통과 확인**

Run: `cd frontend && cmd /c "npm run build"`
Expected: 0 errors

- [ ] **Step 3: 브라우저 확인**

KRW 계정 거래는 `₩` 표기, USD 계정 거래는 `$` 표기로 섞여서 보이는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/
git commit -m "feat: 테이블 금액을 계정 통화별로 포맷"
```

---

### Task 24: Dashboard 통화 토글 적용

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx` (또는 실제 진입점)

- [ ] **Step 1: 훅·토글 통합**

```tsx
const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();

const { data: summary } = useQuery({
  queryKey: ["dashboard-summary", displayCurrency],
  queryFn: () => dashboardApi.getSummary(displayCurrency),
});

// 렌더 상단
<DisplayCurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />

// 전체 합계 표시
<p>{formatCurrency(summary.total_value_display, displayCurrency)}</p>

// 개별 계정 카드
{summary.accounts.map((a) => (
  <Card>
    {a.name} <CurrencyBadge currency={a.base_currency} />
    {formatCurrency(a.total_market_value_native, a.base_currency)}
  </Card>
))}
```

- [ ] **Step 2: api.ts dashboard.getSummary에 파라미터 추가**

```typescript
getSummary: (displayCurrency: Currency = "KRW") =>
  axios.get<DashboardSummary>("/api/dashboard/summary/", {
    params: { display_currency: displayCurrency },
  }).then((r) => r.data),
```

- [ ] **Step 3: 브라우저 확인**

토글 클릭 시 전체 합계가 KRW↔USD 전환, 개별 계정 카드는 native 유지

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/Dashboard.tsx frontend/src/services/api.ts
git commit -m "feat: Dashboard 통화 토글 + 전체 합계 환산"
```

---

### Task 25: AnalysisTab 통화 환산 집계

**Files:**
- Modify: `frontend/src/components/AnalysisTab.tsx` (또는 실제 경로)

- [ ] **Step 1: 섹터 차트 집계 시 표시 통화로 환산**

기존에 `position.market_value_usd`를 그대로 합산하고 있다면, 각 position의 `currency`를 확인하여 `displayCurrency`로 환산 후 집계. FX rate는 react-query로 `/api/fx/` 조회.

```tsx
const [displayCurrency] = useDisplayCurrency();
const { data: fx } = useQuery({ queryKey: ["fx"], queryFn: fxApi.getRates });

const valueInDisplay = (amount: number, cur: Currency) => {
  if (cur === displayCurrency) return amount;
  if (cur === "USD" && displayCurrency === "KRW") return amount * fx.usd_krw;
  if (cur === "KRW" && displayCurrency === "USD") return amount / fx.usd_krw;
  return amount;
};
```

- [ ] **Step 2: 빌드·수동 확인**

Run: `cd frontend && cmd /c "npm run build"` → 에러 없음
브라우저: 섹터 차트 값이 토글에 반응

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/
git commit -m "feat: 섹터 분석 차트 통화 환산 집계"
```

---

## Phase 7: 멀티통화 엔진 테스트

### Task 26: position_engine 멀티통화 회귀 테스트

**Files:**
- Create: `backend/app/tests/test_position_engine_multicurrency.py`

- [ ] **Step 1: 테스트 작성**

```python
# backend/app/tests/test_position_engine_multicurrency.py
"""
멀티통화 회귀: position_engine 자체는 통화 무관이어야 함.
KRW 계정에 005930 거래 → FIFO 정상 동작.
USD 계정에 AAPL 거래 → FIFO 정상 동작.
두 계정 혼재 → 서로 간섭 없음.
"""
from datetime import date
from app.services.position_engine import compute_positions
from app.models import Account, Trade
# 적절한 fixture(db, accounts)는 기존 test_position_engine.py 패턴 참조


def test_krw_account_fifo(db):
    acc = Account(name="KR", base_currency="KRW")
    db.add(acc); db.commit()
    db.add_all([
        Trade(account_id=acc.id, ticker="005930", side="BUY",
              shares=10, price_usd=70000, trade_date=date(2026, 1, 1)),
        Trade(account_id=acc.id, ticker="005930", side="SELL",
              shares=3, price_usd=80000, trade_date=date(2026, 2, 1)),
    ])
    db.commit()
    positions = compute_positions(db, acc.id)
    assert len(positions) == 1
    p = positions[0]
    assert p.ticker == "005930"
    assert p.shares == 7
    assert p.avg_cost_usd == 70000  # KRW 금액이 `_usd` 컬럼에 저장됨 (의미 재해석)


def test_mixed_accounts_isolated(db):
    krw_acc = Account(name="KR", base_currency="KRW")
    usd_acc = Account(name="US", base_currency="USD")
    db.add_all([krw_acc, usd_acc]); db.commit()
    db.add_all([
        Trade(account_id=krw_acc.id, ticker="005930", side="BUY",
              shares=10, price_usd=70000, trade_date=date(2026, 1, 1)),
        Trade(account_id=usd_acc.id, ticker="AAPL", side="BUY",
              shares=5, price_usd=150, trade_date=date(2026, 1, 1)),
    ])
    db.commit()
    krw_pos = compute_positions(db, krw_acc.id)
    usd_pos = compute_positions(db, usd_acc.id)
    assert len(krw_pos) == 1 and krw_pos[0].ticker == "005930"
    assert len(usd_pos) == 1 and usd_pos[0].ticker == "AAPL"
```

> **Note:** fixture(`db`)는 기존 `test_position_engine.py`의 구조를 따른다. 필요 시 `conftest.py`에 공유.

- [ ] **Step 2: 테스트 실행**

Run: `cd backend && pytest app/tests/test_position_engine_multicurrency.py -v`
Expected: 2 passed

- [ ] **Step 3: 커밋**

```bash
git add backend/app/tests/test_position_engine_multicurrency.py
git commit -m "test: position_engine 멀티통화 회귀"
```

---

## Phase 8: 최종 검증

### Task 27: 통합 smoke 테스트

- [ ] **Step 1: 전체 스택 기동**

Run: `docker compose up -d --build`
→ http://localhost:5173 접속

- [ ] **Step 2: 시나리오 1 — KRW 계정 생성·거래**
  - Accounts 탭 → "한국주식" 계정 KRW로 생성 → 배지 표시
  - 매수입력 탭 → KRW 계정 선택 → "삼성" 검색 → 005930 자동입력 → 매수 저장
  - Positions 탭 → 005930 표시, 금액 `₩` 포맷
  - Dashboard 토글 → USD 전환 시 KRW 환산값 반영

- [ ] **Step 3: 시나리오 2 — 금현물**
  - KRW 계정에 `GOLD` ticker로 매수 → 가격 조회 성공, PositionTable 표시

- [ ] **Step 4: 시나리오 3 — 시장 불일치 차단**
  - USD 계정에 `005930` 매수 시도 → 400 에러/폼 에러 메시지

- [ ] **Step 5: 시나리오 4 — 백그라운드 스케줄**
  - `docker compose logs -f backend` → KRX ticker는 한국장 시간에 120초, 미국 ticker는 미국장 시간에 120초 갱신 확인 (장 외에는 빈도 감소)

- [ ] **Step 6: 시나리오 5 — 배당 자동 수집**
  - KRW 계정에서 배당 자동 수집 실행 → `tax_withheld`가 15.4% 비율로 반영되는지 확인

- [ ] **Step 7: 전체 테스트 스위트 실행**

Run: `cd backend && pytest`
Expected: all passed

Run: `cd frontend && cmd /c "npm run lint && npm run build"`
Expected: 0 errors

- [ ] **Step 8: 최종 커밋 (변동사항 있을 시)**

```bash
git add -A
git commit -m "test: 통합 smoke 검증"
```

---

## 완료 기준

- 모든 Task 체크박스 완료
- `pytest` 전체 통과
- `npm run build` 무오류
- 위 시나리오 1~5 수동 검증 완료
- Spec(`2026-04-14-korean-stock-support-design.md`) 모든 섹션 구현됨

---

## Self-Review 결과

- **Spec coverage:** §4 데이터 모델(Task 3·4·5) / §5 서비스(7·8·9·10·11·12·13) / §6 API(14·15·16·17) / §7 프론트(18·19·20·21·22·23·24·25) / §8 마이그레이션(Task 3) / §9 의존성(Task 6) / §10 테스트(1·2·7·8·12·26·27) / §11 리스크 완화는 각 Task에 녹임 → 누락 없음
- **Placeholder scan:** "TBD", "handle edge cases" 등 없음. 일부 기존 파일 경로는 Task 본문에 명시(실제 파일명 확인 지시 포함)
- **Type consistency:** `Currency = "USD" | "KRW"`, `formatCurrency(amount, currency)`, `detectMarket`, `validate_ticker_against_account` 시그니처 일관
