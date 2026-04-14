# Multi-Currency P&L Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KRW/USD 혼합 포트폴리오에서 전역 KPI(미실현/실현/총손익)와 섹터 차트가 통화를 정확히 구분하여 집계되도록 수정한다.

**Architecture:** PositionEngine이 반환하는 포지션 dict에 `account_id`를 포함시키고, PriceAggregator에 통화 인식 집계 메서드를 추가한다. Dashboard/Analysis API가 이 메서드를 사용해 native 통화별로 먼저 집계한 뒤 `display_currency`로 환산하여 반환한다.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0, SQLite, pytest

---

## 파일 변경 목록

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `backend/app/services/position_engine.py` | 수정 | Position에 account_id 추가 |
| `backend/app/services/price_aggregator.py` | 수정 | 통화 인식 집계 메서드 추가 |
| `backend/app/api/dashboard.py` | 수정 | 전역 집계에 새 aggregator 사용 |
| `backend/app/api/analysis.py` | 수정 | 섹터/수익기여도 집계 통화 인식 |
| `backend/app/schemas.py` | 수정 | DashboardSummary에 native breakdown 필드 추가 |
| `frontend/src/types/index.ts` | 수정 | DashboardSummary 타입 필드 추가 |
| `backend/app/tests/test_price_aggregator_multicurrency.py` | 신규 | aggregator 통화 인식 테스트 |

---

## Task 1: Position 클래스에 account_id 추가

**Files:**
- Modify: `backend/app/services/position_engine.py`
- Test: `backend/app/tests/test_position_engine_multicurrency.py`

현재 `Position.__init__`에 `account_id`가 없고 `to_dict()`도 반환하지 않는다.
`crud.get_all_trades_for_calculation()`은 이미 각 trade에 `account_id`를 포함한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/app/tests/test_position_engine_multicurrency.py` 파일 하단에 아래 테스트 추가:

```python
def test_get_all_positions_includes_account_id():
    """get_all_positions()가 account_id 필드를 포함해야 한다."""
    trades = [
        {
            "id": 1,
            "account_id": 42,
            "ticker": "AAPL",
            "side": "BUY",
            "shares": 10,
            "price_usd": 150.0,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        }
    ]
    engine = PositionEngine()
    engine.process_trades(trades)
    positions = engine.get_all_positions()
    assert len(positions) == 1
    assert positions[0]["account_id"] == 42, (
        f"account_id가 42여야 합니다, 실제: {positions[0].get('account_id')}"
    )


def test_get_all_positions_account_id_uses_first_trade():
    """동일 ticker 복수 매수 시 첫 trade의 account_id를 사용한다."""
    trades = [
        {
            "id": 1,
            "account_id": 7,
            "ticker": "AAPL",
            "side": "BUY",
            "shares": 5,
            "price_usd": 150.0,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
        {
            "id": 2,
            "account_id": 7,
            "ticker": "AAPL",
            "side": "BUY",
            "shares": 5,
            "price_usd": 160.0,
            "fee_usd": 0,
            "trade_date": date(2024, 2, 1),
        },
    ]
    engine = PositionEngine()
    engine.process_trades(trades)
    positions = engine.get_all_positions()
    assert positions[0]["account_id"] == 7
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && python -m pytest app/tests/test_position_engine_multicurrency.py::test_get_all_positions_includes_account_id -v
```

Expected: FAILED — `KeyError: 'account_id'` 또는 AssertionError

- [ ] **Step 3: Position 클래스에 account_id 추가**

`backend/app/services/position_engine.py` 수정:

```python
class Position:
    """단일 종목의 포지션"""
    def __init__(self, ticker: str, account_id: Optional[int] = None):
        self.ticker = ticker
        self.account_id = account_id          # ← 추가
        self.lots: deque[Lot] = deque()
        self.total_shares = 0.0
        self.total_cost = 0.0
        self.realized_pl = 0.0
        self.realized_history = []
        self.first_buy_date: Optional[date] = None
```

`to_dict()` 반환 dict에 추가:

```python
    def to_dict(self, current_price: Optional[float] = None, as_of_date: Optional[date] = None) -> Dict:
        """포지션 정보를 딕셔너리로 변환"""
        unrealized_pl, unrealized_pl_percent = self.get_unrealized_pl(current_price) if current_price else (None, None)
        market_value = self.total_shares * current_price if current_price else None

        return {
            "account_id": self.account_id,     # ← 추가
            "ticker": self.ticker,
            "shares": self.total_shares,
            "avg_cost_usd": self.get_avg_cost(),
            "total_cost_usd": self.total_cost,
            "market_price_usd": current_price,
            "market_value_usd": market_value,
            "unrealized_pl_usd": unrealized_pl,
            "unrealized_pl_percent": unrealized_pl_percent,
            "is_closed": self.is_closed(),
            "lot_count": len(self.lots),
            "first_buy_date": self.first_buy_date.isoformat() if self.first_buy_date else None,
            "holding_days": self.get_holding_days(as_of_date),
            "realized_pl_usd": self.realized_pl
        }
```

`PositionEngine.process_trades()` — Position 생성 시 account_id 전달:

```python
    def process_trades(self, trades: List[Dict]) -> None:
        self.positions = {}
        self.all_realized_pl = []

        sorted_trades = sorted(trades, key=lambda x: (x['trade_date'], x['id']))

        for trade in sorted_trades:
            ticker = trade['ticker'].upper()

            if ticker not in self.positions:
                self.positions[ticker] = Position(
                    ticker,
                    account_id=trade.get('account_id')   # ← 추가
                )

            position = self.positions[ticker]
            # ... 이하 기존 코드 유지 ...
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && python -m pytest app/tests/test_position_engine_multicurrency.py -v
```

Expected: 기존 테스트 모두 PASS + 새 테스트 2개 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/position_engine.py backend/app/tests/test_position_engine_multicurrency.py
git commit -m "feat(engine): Position.to_dict()에 account_id 포함"
```

---

## Task 2: PriceAggregator에 통화 인식 집계 메서드 추가

**Files:**
- Modify: `backend/app/services/price_aggregator.py`
- Create: `backend/app/tests/test_price_aggregator_multicurrency.py`

- [ ] **Step 1: 실패하는 테스트 파일 작성**

`backend/app/tests/test_price_aggregator_multicurrency.py` 신규 생성:

```python
"""
PriceAggregator 통화 인식 집계 테스트

calculate_position_metrics_multicurrency()는
각 포지션의 account_id → base_currency를 읽어
native 통화 금액을 target_currency로 환산 후 합산한다.
"""
import pytest
from ..services.price_aggregator import PriceAggregator


# Fake Account 객체 (ORM 대신 간단한 네임스페이스)
class FakeAccount:
    def __init__(self, id: int, base_currency: str):
        self.id = id
        self.base_currency = base_currency


FX_RATE = 1400.0   # 1 USD = 1400 KRW (테스트용 고정값)


def _make_position(account_id, ticker, shares, avg_cost, market_price):
    """테스트용 포지션 dict 생성 헬퍼"""
    total_cost = shares * avg_cost
    market_value = shares * market_price
    unrealized_pl = market_value - total_cost
    return {
        "account_id": account_id,
        "ticker": ticker,
        "shares": shares,
        "avg_cost_usd": avg_cost,
        "total_cost_usd": total_cost,
        "market_price_usd": market_price,
        "market_value_usd": market_value,
        "unrealized_pl_usd": unrealized_pl,
    }


# --------------------------------------------------------------------------
# USD 단일 계정
# --------------------------------------------------------------------------

def test_single_usd_account_target_usd():
    """USD 계정, target_currency=USD → 변환 없이 그대로 합산"""
    accounts_map = {1: FakeAccount(1, "USD")}
    positions = [
        _make_position(1, "AAPL", shares=10, avg_cost=150.0, market_price=160.0),
    ]
    price_data = {"AAPL": {"price_usd": 160.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    # market_value = 10 * 160 = 1600 USD
    assert result["total_market_value"] == pytest.approx(1600.0)
    # unrealized_pl = (160-150)*10 = 100 USD
    assert result["total_unrealized_pl"] == pytest.approx(100.0)
    assert result["native_usd_market_value"] == pytest.approx(1600.0)
    assert result["native_krw_market_value"] == pytest.approx(0.0)


def test_single_usd_account_target_krw():
    """USD 계정, target_currency=KRW → USD 금액에 fx_rate 곱셈"""
    accounts_map = {1: FakeAccount(1, "USD")}
    positions = [
        _make_position(1, "AAPL", shares=10, avg_cost=150.0, market_price=160.0),
    ]
    price_data = {"AAPL": {"price_usd": 160.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "KRW"
    )
    # 1600 USD * 1400 = 2_240_000 KRW
    assert result["total_market_value"] == pytest.approx(1600.0 * FX_RATE)
    assert result["total_unrealized_pl"] == pytest.approx(100.0 * FX_RATE)


# --------------------------------------------------------------------------
# KRW 단일 계정
# --------------------------------------------------------------------------

def test_single_krw_account_target_krw():
    """KRW 계정, target_currency=KRW → 변환 없이 그대로 합산"""
    accounts_map = {2: FakeAccount(2, "KRW")}
    positions = [
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {"GOLD": {"price_usd": 226_170.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "KRW"
    )
    # market_value = 26 * 226170 = 5,880,420 KRW
    assert result["total_market_value"] == pytest.approx(26 * 226_170.0)
    # unrealized_pl = (226170-170000)*26 = 1,460,420 KRW
    assert result["total_unrealized_pl"] == pytest.approx((226_170.0 - 170_000.0) * 26)
    assert result["native_krw_market_value"] == pytest.approx(26 * 226_170.0)
    assert result["native_usd_market_value"] == pytest.approx(0.0)


def test_single_krw_account_target_usd():
    """KRW 계정, target_currency=USD → KRW 금액을 fx_rate로 나눔"""
    accounts_map = {2: FakeAccount(2, "KRW")}
    positions = [
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {"GOLD": {"price_usd": 226_170.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    krw_market_value = 26 * 226_170.0
    assert result["total_market_value"] == pytest.approx(krw_market_value / FX_RATE)


# --------------------------------------------------------------------------
# 혼합 계정 (핵심 시나리오)
# --------------------------------------------------------------------------

def test_mixed_accounts_target_usd():
    """USD + KRW 혼합, target_currency=USD → 각각 정확히 환산 후 합산"""
    accounts_map = {
        1: FakeAccount(1, "USD"),
        2: FakeAccount(2, "KRW"),
    }
    positions = [
        _make_position(1, "AAPL", shares=10, avg_cost=150.0, market_price=160.0),
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {
        "AAPL": {"price_usd": 160.0},
        "GOLD": {"price_usd": 226_170.0},
    }
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    usd_part = 10 * 160.0                              # 1600 USD
    krw_part = 26 * 226_170.0 / FX_RATE               # ~4200 USD
    assert result["total_market_value"] == pytest.approx(usd_part + krw_part, rel=1e-4)
    assert result["native_usd_market_value"] == pytest.approx(usd_part)
    assert result["native_krw_market_value"] == pytest.approx(26 * 226_170.0)


def test_mixed_accounts_no_double_fx():
    """KRW 포지션의 unrealized_pl이 USD로 double-converted되지 않는지 검증"""
    accounts_map = {
        2: FakeAccount(2, "KRW"),
    }
    positions = [
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {"GOLD": {"price_usd": 226_170.0}}
    agg = PriceAggregator()
    result_krw = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "KRW"
    )
    result_usd = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    # KRW 결과를 USD로 나누면 USD 결과와 일치해야 함
    assert result_krw["total_unrealized_pl"] / FX_RATE == pytest.approx(
        result_usd["total_unrealized_pl"], rel=1e-4
    )
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && python -m pytest app/tests/test_price_aggregator_multicurrency.py -v
```

Expected: FAILED — `AttributeError: 'PriceAggregator' object has no attribute 'calculate_position_metrics_multicurrency'`

- [ ] **Step 3: calculate_position_metrics_multicurrency 메서드 구현**

`backend/app/services/price_aggregator.py` 에 아래 메서드를 `PriceAggregator` 클래스 안에 추가 (`calculate_position_metrics` 다음):

```python
    @staticmethod
    def calculate_position_metrics_multicurrency(
        positions: List[Dict],
        price_data: Dict[str, Dict],
        accounts_map: Dict,          # int → Account (base_currency 속성 보유)
        fx_rate: float,
        target_currency: str,        # "USD" 또는 "KRW"
    ) -> Dict:
        """
        통화 인식 포지션 메트릭 계산.

        각 포지션의 account_id → accounts_map → base_currency를 확인하여
        native 금액을 target_currency로 환산한 뒤 합산한다.

        Returns:
            {
                "total_market_value": float,       # target_currency 기준 합계
                "total_unrealized_pl": float,      # target_currency 기준 합계
                "total_cost": float,               # target_currency 기준 합계
                "native_usd_market_value": float,  # USD 계정의 native 합계 (USD)
                "native_krw_market_value": float,  # KRW 계정의 native 합계 (KRW)
                "native_usd_unrealized_pl": float,
                "native_krw_unrealized_pl": float,
            }
        """
        total_market_value = 0.0
        total_unrealized_pl = 0.0
        total_cost = 0.0
        native_usd_market_value = 0.0
        native_krw_market_value = 0.0
        native_usd_unrealized_pl = 0.0
        native_krw_unrealized_pl = 0.0

        for position in positions:
            account_id = position.get("account_id")
            account = accounts_map.get(account_id) if account_id is not None else None
            base_currency = getattr(account, "base_currency", "USD") if account else "USD"

            ticker = position["ticker"]
            shares = position.get("shares", 0)

            # native 금액 (price_usd 컬럼은 base_currency 단위 금액을 담고 있음)
            price_info = price_data.get(ticker)
            if price_info and price_info.get("price_usd") is not None and shares > 0:
                native_market_value = shares * price_info["price_usd"]
                native_cost = position.get("total_cost_usd", 0.0)
                native_unrealized_pl = native_market_value - native_cost
            else:
                native_market_value = 0.0
                native_cost = position.get("total_cost_usd", 0.0)
                native_unrealized_pl = 0.0

            # native breakdown 누적
            if base_currency == "KRW":
                native_krw_market_value += native_market_value
                native_krw_unrealized_pl += native_unrealized_pl
            else:  # USD
                native_usd_market_value += native_market_value
                native_usd_unrealized_pl += native_unrealized_pl

            # target_currency로 환산
            if base_currency == target_currency:
                converted_market_value = native_market_value
                converted_unrealized_pl = native_unrealized_pl
                converted_cost = native_cost
            elif base_currency == "USD" and target_currency == "KRW":
                converted_market_value = native_market_value * fx_rate
                converted_unrealized_pl = native_unrealized_pl * fx_rate
                converted_cost = native_cost * fx_rate
            elif base_currency == "KRW" and target_currency == "USD":
                converted_market_value = native_market_value / fx_rate if fx_rate else 0.0
                converted_unrealized_pl = native_unrealized_pl / fx_rate if fx_rate else 0.0
                converted_cost = native_cost / fx_rate if fx_rate else 0.0
            else:
                converted_market_value = native_market_value
                converted_unrealized_pl = native_unrealized_pl
                converted_cost = native_cost

            total_market_value += converted_market_value
            total_unrealized_pl += converted_unrealized_pl
            total_cost += converted_cost

        return {
            "total_market_value": total_market_value,
            "total_unrealized_pl": total_unrealized_pl,
            "total_cost": total_cost,
            "native_usd_market_value": native_usd_market_value,
            "native_krw_market_value": native_krw_market_value,
            "native_usd_unrealized_pl": native_usd_unrealized_pl,
            "native_krw_unrealized_pl": native_krw_unrealized_pl,
        }
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && python -m pytest app/tests/test_price_aggregator_multicurrency.py -v
```

Expected: 6개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/price_aggregator.py backend/app/tests/test_price_aggregator_multicurrency.py
git commit -m "feat(aggregator): 통화 인식 집계 메서드 calculate_position_metrics_multicurrency 추가"
```

---

## Task 3: schemas.py — DashboardSummary native breakdown 필드 추가

**Files:**
- Modify: `backend/app/schemas.py:135-165`

- [ ] **Step 1: DashboardSummary에 필드 추가**

`backend/app/schemas.py` 의 `DashboardSummary` 클래스에서 `total_value_display: float = 0.0` 아래에 추가:

```python
    # Native currency breakdown (KRW/USD 계정 분리 합계)
    total_market_value_native_usd: float = 0.0   # USD 계정의 시장가치 합계 (USD)
    total_market_value_native_krw: float = 0.0   # KRW 계정의 시장가치 합계 (KRW)
    total_unrealized_pl_native_usd: float = 0.0  # USD 계정의 미실현손익 (USD)
    total_unrealized_pl_native_krw: float = 0.0  # KRW 계정의 미실현손익 (KRW)
```

- [ ] **Step 2: 서버 기동 확인 (스키마 파싱 오류 없음)**

```bash
cd backend && python -c "from app.schemas import DashboardSummary; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: frontend types/index.ts 업데이트**

`frontend/src/types/index.ts` 의 `DashboardSummary` 인터페이스에 추가:

```typescript
  total_market_value_native_usd?: number;
  total_market_value_native_krw?: number;
  total_unrealized_pl_native_usd?: number;
  total_unrealized_pl_native_krw?: number;
```

- [ ] **Step 4: 커밋**

```bash
git add backend/app/schemas.py frontend/src/types/index.ts
git commit -m "feat(schema): DashboardSummary에 native currency breakdown 필드 추가"
```

---

## Task 4: Dashboard API — 전역 집계 수정

**Files:**
- Modify: `backend/app/api/dashboard.py:44-242`

전역 요약(`account_id` 없이 전체 계정 집계)에서 `calculate_position_metrics_multicurrency()` 를 사용하도록 수정한다.

- [ ] **Step 1: accounts_map 로드 및 새 aggregator 호출로 교체**

`dashboard.py` 의 전역 집계 섹션(`# 전체 계정 조회` ~ `# 포지션에 가격 정보 적용` 구간)을 아래로 교체:

기존 코드 (약 line 44~70):
```python
    # 전체 계정 조회
    trades = crud.get_all_trades_for_calculation(db)

    # 포지션 엔진으로 계산
    engine = PositionEngine()
    engine.process_trades(trades)

    # 포지션 목록
    positions = engine.get_all_positions(include_closed=False)

    total_market_value_usd = 0.0
    total_unrealized_pl_usd = 0.0
    total_cost_usd = 0.0

    # TODO[multi-currency-pl]: ... (주석 전체)
    # 가격 데이터 조회 및 집계 (공통 서비스 사용)
    price_data = price_aggregator.get_prices_for_positions(positions)
    total_market_value_usd, total_unrealized_pl_usd, total_cost_usd = price_aggregator.calculate_position_metrics(positions, price_data)

    # 포지션에 가격 정보 적용 (previous_close 포함)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)

    # 통화 인식 총 시장가치 계산 (display_currency 기준)
    # 주의: ...
    if display_currency == "KRW":
        total_value_display = total_market_value_usd * fx_rate
    else:
        total_value_display = total_market_value_usd
```

수정 후:
```python
    # 전체 계정 조회
    trades = crud.get_all_trades_for_calculation(db)

    # 포지션 엔진으로 계산
    engine = PositionEngine()
    engine.process_trades(trades)

    # 포지션 목록 (account_id 포함)
    positions = engine.get_all_positions(include_closed=False)

    # 계정 맵 로드 (account_id → Account, base_currency 판별용)
    accounts_list = crud.get_accounts(db)
    accounts_map = {a.id: a for a in accounts_list}

    # 가격 데이터 조회
    price_data = price_aggregator.get_prices_for_positions(positions)

    # 통화 인식 집계
    mc_metrics = price_aggregator.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, fx_rate, "USD"
    )
    total_market_value_usd = mc_metrics["native_usd_market_value"]
    total_unrealized_pl_usd = mc_metrics["native_usd_unrealized_pl"]
    total_cost_usd = mc_metrics["total_cost"]  # display_currency=USD 기준

    # 포지션에 가격 정보 적용 (previous_close 포함)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)

    # display_currency 기준 총 시장가치
    mc_display = price_aggregator.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, fx_rate, display_currency
    )
    total_value_display = mc_display["total_market_value"]
```

- [ ] **Step 2: DashboardSummary 반환 시 native 필드 포함**

`dashboard.py` line ~212 의 `return schemas.DashboardSummary(...)` 에 아래 필드 추가:

기존 필드들 뒤에:
```python
        total_market_value_native_usd=mc_metrics["native_usd_market_value"],
        total_market_value_native_krw=mc_metrics["native_krw_market_value"],
        total_unrealized_pl_native_usd=mc_metrics["native_usd_unrealized_pl"],
        total_unrealized_pl_native_krw=mc_metrics["native_krw_unrealized_pl"],
```

기존 `total_market_value_usd`, `total_market_value_krw` 는 USD 계정 기여분 + KRW 계정 기여분(USD 환산) 합계로 재정의:

```python
        total_market_value_usd=mc_metrics["native_usd_market_value"] + mc_metrics["native_krw_market_value"] / fx_rate,
        total_market_value_krw=(mc_metrics["native_usd_market_value"] * fx_rate) + mc_metrics["native_krw_market_value"],
        total_unrealized_pl_usd=mc_metrics["native_usd_unrealized_pl"] + mc_metrics["native_krw_unrealized_pl"] / fx_rate,
        total_unrealized_pl_krw=(mc_metrics["native_usd_unrealized_pl"] * fx_rate) + mc_metrics["native_krw_unrealized_pl"],
```

- [ ] **Step 3: total_unrealized_pl_percent 재계산**

기존 코드:
```python
    total_unrealized_pl_percent = (total_unrealized_pl_usd / total_cost_usd * 100) if total_cost_usd > 0 else 0.0
```

`total_cost_usd`는 이제 USD 기준 합산이므로 그대로 유지. 단 분자도 같은 기준이어야 하므로:

```python
    total_unrealized_pl_usd_combined = mc_metrics["native_usd_unrealized_pl"] + mc_metrics["native_krw_unrealized_pl"] / fx_rate
    total_cost_usd_combined = mc_metrics["total_cost"]  # USD 기준 합산
    total_unrealized_pl_percent = (total_unrealized_pl_usd_combined / total_cost_usd_combined * 100) if total_cost_usd_combined > 0 else 0.0
```

그리고 `schemas.DashboardSummary` 의 `total_unrealized_pl_percent` 에 `total_unrealized_pl_percent` 사용.

- [ ] **Step 4: API 수동 검증**

Docker에서 서버 실행 후:
```bash
curl -s "http://localhost:8000/api/dashboard/summary/?display_currency=USD" | python -m json.tool | grep -E "native|total_market|total_unrealized"
```

- KRW 계정 포지션이 있다면 `total_market_value_native_krw > 0` 확인
- USD 계정 포지션이 있다면 `total_market_value_native_usd > 0` 확인
- `total_market_value_usd` 가 두 계정 합산인지 확인

- [ ] **Step 5: 커밋**

```bash
git add backend/app/api/dashboard.py
git commit -m "fix(dashboard): 전역 집계에 통화 인식 aggregator 적용 — KRW/USD 혼합 집계 버그 수정"
```

---

## Task 5: Analysis API — 섹터/수익기여도 집계 수정

**Files:**
- Modify: `backend/app/api/analysis.py`

`analyze_portfolio()`는 현재 sync 함수. fx_rate가 필요하므로 async로 전환한다.

- [ ] **Step 1: analyze_portfolio를 async로 전환하고 fx_rate 조회 추가**

`analysis.py` 상단 import에 fx_service 추가:

```python
from ..services.fx_service import fx_service
```

함수 시그니처를 async로 변경:

```python
@router.get("/portfolio/", response_model=schemas.PortfolioAnalysis)
async def analyze_portfolio(
    account_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
```

함수 시작 부분에 fx_rate 조회 추가:

```python
    # 환율 조회 (KRW 계정 포지션 환산용)
    fx_data = await fx_service.get_rate("USD", "KRW")
    fx_rate = fx_data['rate'] if fx_data else 1350.0
```

- [ ] **Step 2: 계정 맵 로드 및 포지션별 통화 인식 집계 적용**

기존 `for position in positions:` 루프 직전에 계정 맵 로드 추가:

```python
    # 계정 맵 로드 (포지션별 base_currency 판별용)
    accounts_list = crud.get_accounts(db)
    accounts_map = {a.id: a for a in accounts_list}
```

기존 루프 내부에서 `market_value`, `unrealized_pl` 를 계산하는 부분 수정.

기존 코드 (line ~99~102):
```python
    for position in positions:
        ticker = position['ticker']
        market_value = position.get('market_value_usd', 0) or 0
        unrealized_pl = position.get('unrealized_pl_usd', 0) or 0
```

수정 후 — market_value/unrealized_pl을 USD로 정규화:
```python
    for position in positions:
        ticker = position['ticker']
        account_id_pos = position.get('account_id')
        account = accounts_map.get(account_id_pos) if account_id_pos else None
        base_currency = getattr(account, 'base_currency', 'USD') if account else 'USD'

        raw_market_value = position.get('market_value_usd', 0) or 0
        raw_unrealized_pl = position.get('unrealized_pl_usd', 0) or 0

        # KRW 계정은 native 금액(KRW)을 USD로 환산
        if base_currency == 'KRW':
            market_value = raw_market_value / fx_rate if fx_rate else 0.0
            unrealized_pl = raw_unrealized_pl / fx_rate if fx_rate else 0.0
        else:
            market_value = raw_market_value
            unrealized_pl = raw_unrealized_pl
```

`positions_with_info.append(...)` 에서 `market_value_usd`, `unrealized_pl_usd` 에 환산된 값 사용:

```python
        positions_with_info.append({
            'ticker': ticker,
            'shares': position['shares'],
            'avg_cost_usd': position['avg_cost_usd'],
            'market_price_usd': position.get('market_price_usd'),
            'market_value_usd': market_value,       # USD 기준으로 정규화됨
            'unrealized_pl_usd': unrealized_pl,     # USD 기준으로 정규화됨
            'unrealized_pl_percent': position.get('unrealized_pl_percent', 0),
            'weight': 0.0,
            'sector': sector,
            'industry': industry,
            'longName': long_name,
            'yearly_dividend_usd': yearly_dividend
        })
```

섹터/산업 집계 시 `cost` 계산도 수정 (KRW → USD 환산):

```python
        # 투자 비용 USD 기준 정규화
        raw_cost = position['avg_cost_usd'] * position['shares']
        cost = raw_cost / fx_rate if base_currency == 'KRW' else raw_cost

        sector_data[sector]['total_cost_usd'] += cost
        industry_data[industry]['total_cost_usd'] += cost
```

- [ ] **Step 3: TODO 주석 제거**

`analysis.py` line ~96-98 의 `TODO[multi-currency-pl]` 주석 블록 삭제.

- [ ] **Step 4: API 수동 검증**

```bash
curl -s "http://localhost:8000/api/analysis/portfolio/" | python -m json.tool | grep -E "percentage|total_market_value"
```

- GOLD 같은 KRW 종목의 섹터 비중이 90%를 넘지 않는지 확인
- 섹터 비중 합계가 ~100%인지 확인

- [ ] **Step 5: 커밋**

```bash
git add backend/app/api/analysis.py
git commit -m "fix(analysis): 섹터/수익기여도 집계에 통화 인식 적용 — GOLD 왜곡 수정"
```

---

## Task 6: Frontend TODO 주석 제거

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx:378`
- Modify: `frontend/src/components/Portfolio.tsx:482`

Backend가 정확한 값을 반환하므로 frontend 로직 변경은 없음. 주석만 정리.

- [ ] **Step 1: Dashboard.tsx TODO 주석 제거**

`Dashboard.tsx` line 378 의 아래 주석 블록 삭제:
```tsx
{/* TODO[multi-currency-pl]: /docs/pl_todo.md 참조. 현재 backend에서 혼합 통화 집계값(USD) 그대로 사용. KRW 계정 혼재 시 합산 부정확. */}
```

- [ ] **Step 2: Portfolio.tsx TODO 주석 제거**

`Portfolio.tsx` line 482 의 TODO 주석 블록 삭제.

- [ ] **Step 3: lint 확인**

```bash
cd frontend && npm run lint
```

Expected: 0 errors

- [ ] **Step 4: pl_todo.md 상태 업데이트**

`docs/pl_todo.md` 의 `## 현재 상태` 섹션을 아래로 교체:

```markdown
## 현재 상태

- ✅ 계정별 요약(`_get_account_summary_data`)은 수정 완료
- ✅ 포지션별 (보유종목 테이블) 프론트 표시는 수정 완료
- ✅ 전역 KPI 카드(미실현/실현/총손익) — 수정 완료 (2026-04-14)
- ✅ 수익 기여도, 섹터 차트, 성과 비중 — 수정 완료 (2026-04-14)
- ✅ 대시보드 전역 합산 카드 — 수정 완료 (2026-04-14)
```

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/Dashboard.tsx frontend/src/components/Portfolio.tsx docs/pl_todo.md
git commit -m "chore: TODO[multi-currency-pl] 주석 및 pl_todo.md 완료 상태 업데이트"
```

---

## 검증 시나리오

모든 태스크 완료 후 pl_todo.md의 검증 절차 실행:

```bash
# 1. KRW 계정에 GOLD 26g @ 170,000 KRW 매수 입력
# 2. USD 계정에 AAPL 10주 @ 150 USD 매수 입력
# 3. dashboard/summary/ 호출
curl "http://localhost:8000/api/dashboard/summary/?display_currency=USD"
# 기대값:
#   total_unrealized_pl_native_krw: (현재가-170000)*26  KRW
#   total_unrealized_pl_native_usd: (현재가-150)*10    USD
#   total_market_value_usd: KRW계정+USD계정 합산 (정확한 환산)

# 4. analysis/portfolio/ 호출
curl "http://localhost:8000/api/analysis/portfolio/"
# 기대값: GOLD 비중이 포트폴리오 대비 합리적인 % (90% 이상 아님)
```

---

## 관련 문서

- `docs/pl_todo.md` — 배경 및 증상 상세
- `backend/app/tests/test_position_engine_multicurrency.py` — 포지션 엔진 테스트
- `backend/app/tests/test_price_aggregator_multicurrency.py` — 집계 서비스 테스트
