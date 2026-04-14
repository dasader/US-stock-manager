# PL Followup Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코드 리뷰 후속 7개 개선 항목(I1~I7)을 순서대로 반영하여 코드 품질과 안정성을 높인다.

**Architecture:** price_aggregator.py에 방어 코드(assert + warning log)를 추가하고, dashboard.py의 KRW 계산을 직접화하며, analysis.py의 cost guard 스타일을 통일하고 누락 계정 경고 로그를 추가한다. I7(컬럼명 불일치)은 대규모 rename 대신 CLAUDE.md 문서를 업데이트하여 실제 동작을 명확히 기록한다.

**Tech Stack:** Python, FastAPI, pytest

---

## 파일 변경 맵

| 파일 | 작업 |
|------|------|
| `backend/app/tests/test_price_aggregator_multicurrency.py` | I1: 빈 포지션 테스트 추가 |
| `backend/app/services/price_aggregator.py` | I2: target_currency assert / I3: warning 로그 |
| `backend/app/api/dashboard.py` | I4: KRW 직접 계산 (전역 요약 + _get_account_summary) |
| `backend/app/api/analysis.py` | I5: cost guard 통일 / I6: 누락 계정 warning 로그 |
| `backend/app/CLAUDE.md` → `CLAUDE.md` (루트) | I7: price_usd 컬럼 관례 문서화 |

---

## Task 1: I1 — 빈 포지션 테스트 추가

**Files:**
- Modify: `backend/app/tests/test_price_aggregator_multicurrency.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`test_price_aggregator_multicurrency.py` 파일 맨 끝에 아래 테스트를 추가한다.

```python
# --------------------------------------------------------------------------
# 빈 포지션 (경계값)
# --------------------------------------------------------------------------

def test_empty_positions_returns_all_zeros():
    """빈 포지션 리스트 → 모든 집계값이 0.0이어야 한다"""
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency([], {}, {}, 1400.0, "USD")
    assert result["total_market_value"] == 0.0
    assert result["total_unrealized_pl"] == 0.0
    assert result["total_cost"] == 0.0
    assert result["native_usd_market_value"] == 0.0
    assert result["native_krw_market_value"] == 0.0
    assert result["native_usd_unrealized_pl"] == 0.0
    assert result["native_krw_unrealized_pl"] == 0.0
```

- [ ] **Step 2: 테스트 실행 — PASS 확인 (로직은 이미 올바름)**

```bash
cd backend
python -m pytest app/tests/test_price_aggregator_multicurrency.py::test_empty_positions_returns_all_zeros -v
```
Expected: `PASSED`

- [ ] **Step 3: 커밋**

```bash
git add backend/app/tests/test_price_aggregator_multicurrency.py
git commit -m "test(aggregator): 빈 포지션 경계값 테스트 추가 (I1)"
```

---

## Task 2: I2 — 미지원 target_currency assert 추가

**Files:**
- Modify: `backend/app/services/price_aggregator.py`

- [ ] **Step 1: 실패하는 테스트 먼저 작성**

`test_price_aggregator_multicurrency.py`에 아래 테스트를 추가한다.

```python
def test_unsupported_target_currency_raises():
    """지원하지 않는 target_currency('JPY') → AssertionError 발생"""
    agg = PriceAggregator()
    with pytest.raises(AssertionError, match="지원하지 않는 target_currency"):
        agg.calculate_position_metrics_multicurrency([], {}, {}, 1400.0, "JPY")
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd backend
python -m pytest app/tests/test_price_aggregator_multicurrency.py::test_unsupported_target_currency_raises -v
```
Expected: `FAILED` (AssertionError가 아직 발생하지 않음)

- [ ] **Step 3: price_aggregator.py에 assert 추가**

`calculate_position_metrics_multicurrency` 메서드 시작 부분(변수 초기화 직전)에 추가:

```python
    @staticmethod
    def calculate_position_metrics_multicurrency(
        positions: List[Dict],
        price_data: Dict[str, Dict],
        accounts_map: Dict,
        fx_rate: float,
        target_currency: str,
    ) -> Dict:
        assert target_currency in ("USD", "KRW"), f"지원하지 않는 target_currency: {target_currency}"

        total_market_value = 0.0
        # ... 이하 기존 코드 유지
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
cd backend
python -m pytest app/tests/test_price_aggregator_multicurrency.py -v
```
Expected: 전체 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/price_aggregator.py backend/app/tests/test_price_aggregator_multicurrency.py
git commit -m "feat(aggregator): 미지원 target_currency에 대한 assert 추가 (I2)"
```

---

## Task 3: I3 — price_aggregator warning 로그 추가

**Files:**
- Modify: `backend/app/services/price_aggregator.py`

- [ ] **Step 1: logger 임포트 확인 및 추가**

`price_aggregator.py` 상단에 아래 임포트가 없으면 추가한다.

```python
import logging
logger = logging.getLogger(__name__)
```

- [ ] **Step 2: fx_rate=0 경고 로그 추가**

`calculate_position_metrics_multicurrency` 내부에서 `fx_rate`가 0인 경우(KRW→USD 나눗셈 전)에 경고를 추가한다.

현재 코드 (line ~152):
```python
            elif base_currency == "KRW" and target_currency == "USD":
                converted_market_value = native_market_value / fx_rate if fx_rate else 0.0
                converted_unrealized_pl = native_unrealized_pl / fx_rate if fx_rate else 0.0
                converted_cost = native_cost / fx_rate if fx_rate else 0.0
```

변경 후:
```python
            elif base_currency == "KRW" and target_currency == "USD":
                if not fx_rate:
                    logger.warning("[AGGREGATOR] fx_rate=0 → KRW→USD 변환 불가, 0.0으로 처리")
                converted_market_value = native_market_value / fx_rate if fx_rate else 0.0
                converted_unrealized_pl = native_unrealized_pl / fx_rate if fx_rate else 0.0
                converted_cost = native_cost / fx_rate if fx_rate else 0.0
```

- [ ] **Step 3: 누락 계정 경고 로그 추가**

동일 메서드 내 포지션 루프에서 account가 None인데 account_id가 있는 경우에 경고 추가.

현재 코드 (line ~119):
```python
        account_id = position.get("account_id")
        account = accounts_map.get(account_id) if account_id is not None else None
        base_currency = getattr(account, "base_currency", "USD") if account else "USD"
```

변경 후:
```python
        account_id = position.get("account_id")
        account = accounts_map.get(account_id) if account_id is not None else None
        if account is None and account_id is not None:
            logger.warning(
                f"[AGGREGATOR] account_id={account_id} 계정 없음 → USD 기본값 사용 "
                f"(ticker={position.get('ticker')})"
            )
        base_currency = getattr(account, "base_currency", "USD") if account else "USD"
```

- [ ] **Step 4: 전체 테스트 실행 — 이상 없음 확인**

```bash
cd backend
python -m pytest app/tests/test_price_aggregator_multicurrency.py -v
```
Expected: 전체 PASSED

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/price_aggregator.py
git commit -m "feat(aggregator): fx_rate=0 및 누락 계정 warning 로그 추가 (I3)"
```

---

## Task 4: I4 — dashboard.py KRW 직접 계산으로 변경

**Files:**
- Modify: `backend/app/api/dashboard.py`

두 곳(전역 요약 `get_dashboard_summary`, 계정 요약 `_get_account_summary`)에서
`total_market_value_krw = total_market_value_usd * fx_rate` 를
`native_usd * fx_rate + native_krw` 로 직접 계산하도록 변경한다.

- [ ] **Step 1: 전역 요약 (`get_dashboard_summary`) 수정**

현재 코드 (line ~219):
```python
    return schemas.DashboardSummary(
        total_market_value_usd=total_market_value_usd,
        total_market_value_krw=total_market_value_usd * fx_rate,
        total_unrealized_pl_usd=total_unrealized_pl_usd,
        total_unrealized_pl_krw=total_unrealized_pl_usd * fx_rate,
        ...
        total_realized_pl_krw=total_realized_pl_usd * fx_rate,
        total_pl_usd=total_pl_usd,
        total_pl_krw=total_pl_usd * fx_rate,
        ...
        total_cash_krw=total_cash_usd * fx_rate,
        total_deposits_krw=total_deposits_usd * fx_rate,
        total_withdrawals_krw=total_withdrawals_usd * fx_rate,
        net_investment_krw=net_investment_usd * fx_rate,
```

변경 후 (포트폴리오 KRW 값만 직접 계산, 나머지 USD 단일항목은 기존 유지):
```python
    return schemas.DashboardSummary(
        total_market_value_usd=total_market_value_usd,
        total_market_value_krw=mc_metrics["native_usd_market_value"] * fx_rate + mc_metrics["native_krw_market_value"],
        total_unrealized_pl_usd=total_unrealized_pl_usd,
        total_unrealized_pl_krw=mc_metrics["native_usd_unrealized_pl"] * fx_rate + mc_metrics["native_krw_unrealized_pl"],
        ...
        total_realized_pl_krw=total_realized_pl_usd * fx_rate,
        total_pl_usd=total_pl_usd,
        total_pl_krw=total_pl_usd * fx_rate,
        ...
        total_cash_krw=total_cash_usd * fx_rate,
        total_deposits_krw=total_deposits_usd * fx_rate,
        total_withdrawals_krw=total_withdrawals_usd * fx_rate,
        net_investment_krw=net_investment_usd * fx_rate,
```

> **참고:** `total_realized_pl`, `total_pl`, `total_cash`, `total_deposits`, `total_withdrawals`, `net_investment`는 USD 단일 출처이므로 `* fx_rate` 그대로 유지.

- [ ] **Step 2: `_get_account_summary` 동일 패턴 적용**

`_get_account_summary` 함수의 `return schemas.DashboardSummary(...)` 블록에서도 동일하게:

```python
        total_market_value_krw=mc_metrics["native_usd_market_value"] * fx_rate + mc_metrics["native_krw_market_value"],
        total_unrealized_pl_krw=mc_metrics["native_usd_unrealized_pl"] * fx_rate + mc_metrics["native_krw_unrealized_pl"],
```

- [ ] **Step 3: 서버 기동 확인 (lint 수준)**

```bash
cd backend
python -m py_compile app/api/dashboard.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 4: 커밋**

```bash
git add backend/app/api/dashboard.py
git commit -m "refactor(dashboard): total_market_value_krw 직접 계산으로 변경 (I4)"
```

---

## Task 5: I5 — analysis.py cost guard 스타일 통일

**Files:**
- Modify: `backend/app/api/analysis.py`

- [ ] **Step 1: 변경 대상 확인**

`analysis.py` line 158 근처:
```python
        cost = raw_cost / fx_rate if base_currency == 'KRW' and fx_rate else raw_cost
```

`fx_rate`는 line 36 `fx_rate = fx_data['rate'] if fx_data else 1350.0`로 항상 양수가 보장된다.
`and fx_rate` 가드는 불필요하다.

- [ ] **Step 2: 코드 수정**

```python
        cost = raw_cost / fx_rate if base_currency == 'KRW' else raw_cost
```

`sector_data`와 `industry_data` 집계에 각각 한 번씩 쓰이는 `cost` 변수는 동일한 줄이므로 한 번만 수정하면 된다.

- [ ] **Step 3: 문법 확인**

```bash
cd backend
python -m py_compile app/api/analysis.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 4: 커밋**

```bash
git add backend/app/api/analysis.py
git commit -m "refactor(analysis): cost guard에서 불필요한 fx_rate 조건 제거 (I5)"
```

---

## Task 6: I6 — analysis.py 누락 계정 warning 로그 추가

**Files:**
- Modify: `backend/app/api/analysis.py`

- [ ] **Step 1: 변경 대상 확인**

`analysis.py`의 포지션 루프(line ~106):
```python
        account_id_pos = position.get('account_id')
        account = accounts_map.get(account_id_pos) if account_id_pos else None
        base_currency = getattr(account, 'base_currency', 'USD') if account else 'USD'
```

- [ ] **Step 2: 코드 수정**

```python
        account_id_pos = position.get('account_id')
        account = accounts_map.get(account_id_pos) if account_id_pos else None
        if account is None and account_id_pos:
            logger.warning(
                f"[ANALYSIS] account_id={account_id_pos} 계정 없음 → USD 기본값 사용 "
                f"(ticker={ticker})"
            )
        base_currency = getattr(account, 'base_currency', 'USD') if account else 'USD'
```

- [ ] **Step 3: 문법 확인**

```bash
cd backend
python -m py_compile app/api/analysis.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 4: 커밋**

```bash
git add backend/app/api/analysis.py
git commit -m "feat(analysis): 누락 계정 warning 로그 추가 (I6)"
```

---

## Task 7: I7 — CLAUDE.md price_usd 컬럼 관례 문서화

**Files:**
- Modify: `CLAUDE.md` (프로젝트 루트 `backend/app/` 기준 상위 — `04_US-stock-manager/CLAUDE.md`)

> **결정 근거:** `price_usd`가 20개 파일 138곳에서 사용 중이라 컬럼 rename은 대규모 마이그레이션을 수반한다.
> 단기에는 CLAUDE.md 규칙을 현실에 맞게 업데이트하고, 장기 rename 계획을 별도 TODO로 남긴다.

- [ ] **Step 1: CLAUDE.md Key Conventions 섹션 수정**

현재 (`CLAUDE.md` → Key Conventions):
```
- **모든 금액**: USD 기준으로 DB 저장, FX 서비스로 KRW 변환하여 표시
```

변경 후:
```
- **모든 금액**: USD 기준으로 DB 저장, FX 서비스로 KRW 변환하여 표시.
  단, KRW 계정(`base_currency="KRW"`)의 거래/가격 데이터는 `price_usd` 컬럼명에도 불구하고
  KRW native 금액을 그대로 저장한다 (컬럼명은 역사적 이유로 유지; 향후 `price_native`로
  rename 예정 — TODO). 실제 통화 판별은 항상 `accounts.base_currency`를 참조할 것.
```

- [ ] **Step 2: TODO 항목 추가 (CLAUDE.md 하단 또는 별도 섹션)**

```markdown
## Known Technical Debt

- **price_usd 컬럼명 불일치**: `Trade.price_usd`, `PriceCache.price_usd` 등은 KRW 계정에서
  KRW 금액을 저장함. 장기적으로 `price_native`로 rename 필요.
  영향 범위: `models.py`, `crud.py`, `schemas.py`, 관련 API 20개 파일.
```

- [ ] **Step 3: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): price_usd 컬럼 실제 저장 관례 및 technical debt 문서화 (I7)"
```

---

## 최종 검증

- [ ] **전체 테스트 실행**

```bash
cd backend
python -m pytest app/tests/test_price_aggregator_multicurrency.py app/tests/test_position_engine.py app/tests/test_position_engine_multicurrency.py -v
```
Expected: 전체 PASSED

- [ ] **문법 검사**

```bash
cd backend
python -m py_compile app/services/price_aggregator.py app/api/dashboard.py app/api/analysis.py && echo "All OK"
```
Expected: `All OK`
