# multi-currency-pl 리팩토링 후속 작업

작성: 2026-04-14
관련 브랜치: `feature/multi-currency-pl` (머지 완료)

코드 리뷰에서 발견됐으나 머지를 막지 않는(블로커 아님) 개선 항목들.

---

## Task 2 — PriceAggregator

### I1. 빈 포지션 리스트 테스트 누락
`calculate_position_metrics_multicurrency([], {}, {}, fx_rate, "USD")`가 모든 값 0으로 반환되는지 명시적 테스트 없음.

```python
def test_empty_positions():
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency([], {}, {}, 1400.0, "USD")
    assert result["total_market_value"] == 0.0
    assert result["native_usd_market_value"] == 0.0
    assert result["native_krw_market_value"] == 0.0
```

**파일:** `backend/app/tests/test_price_aggregator_multicurrency.py`

---

### I2. 알 수 없는 target_currency 처리
`target_currency="JPY"` 등 미지원 통화 전달 시 `else` 분기로 조용히 통과됨. 버그 은닉 위험.

추가 방안:
```python
# price_aggregator.py calculate_position_metrics_multicurrency 시작 부분
assert target_currency in ("USD", "KRW"), f"지원하지 않는 target_currency: {target_currency}"
```

**파일:** `backend/app/services/price_aggregator.py`

---

### I3. fx_rate=0 / 누락 account 시 warning 로그 없음
- `fx_rate`가 0일 때 division-by-zero를 조용히 `0.0`으로 처리 (line 152-154)
- `account_id`가 있지만 `accounts_map`에 없는 경우(삭제된 계정 등) USD로 묵시적 처리

```python
# 두 케이스 모두 logger.warning 추가 권장
if account is None and account_id_pos:
    logger.warning(f"[AGGREGATOR] account_id={account_id_pos} 계정 없음 → USD 기본값 사용")
```

**파일:** `backend/app/services/price_aggregator.py`

---

## Task 4 / Task 5 — Dashboard & Analysis API

### I4. `total_market_value_krw` / `total_unrealized_pl_krw` 개념적 중복 변환
현재 계산:
```
total_market_value_usd = native_usd + native_krw / fx_rate
total_market_value_krw = total_market_value_usd * fx_rate
                       = native_usd * fx_rate + native_krw   ← 수학적으로는 올바름
```
수치는 맞지만 "KRW 계정의 가치를 USD로 바꿨다가 다시 KRW로 돌림"이라는 개념적 불필요함이 있음. 추후 `native_usd_market_value * fx_rate + native_krw_market_value` 형태로 직접 계산하는 것을 고려.

**파일:** `backend/app/api/dashboard.py` (전역 요약 + `_get_account_summary`)

---

### I5. analysis.py — cost guard 스타일 불일치
`market_value`/`unrealized_pl` 분기와 `cost` 분기의 zero-guard 패턴이 다름.

```python
# 현재 (불일치)
market_value = raw_market_value / fx_rate if fx_rate else 0.0          # line 116
cost = raw_cost / fx_rate if base_currency == 'KRW' and fx_rate else raw_cost  # line 158

# 통일 권장
cost = raw_cost / fx_rate if base_currency == 'KRW' else raw_cost  # fx_rate는 1350 fallback 보장됨
```

**파일:** `backend/app/api/analysis.py`

---

### I6. analysis.py — 누락 account warning 로그
`account is None and account_id_pos` 케이스에서 로그 없이 USD 기본값 사용.

**파일:** `backend/app/api/analysis.py`

---

## Task 5 — Analysis API 스키마 규칙

### I7. `*_usd` 컬럼명과 KRW native 금액 저장의 불일치
프로젝트 규칙("모든 금액 USD 기준으로 DB 저장")과 KRW 계정의 실제 저장 방식(`price_usd` 컬럼에 KRW 금액 저장)이 충돌.
장기적으로 컬럼명을 `price_native`로 변경하거나 CLAUDE.md 규칙을 업데이트하는 것을 고려.

**영향 범위:** `models.py`, `crud.py`, `schemas.py`, 관련 API 전반

---

## 우선순위 제안

| 항목 | 우선순위 | 예상 작업량 |
|------|---------|-----------|
| I1 (빈 포지션 테스트) | Low | 10분 |
| I2 (target_currency 검증) | Medium | 10분 |
| I3 (warning 로그) | Low | 20분 |
| I4 (krw 계산 직접화) | Low | 30분 |
| I5 (cost guard 통일) | Low | 10분 |
| I6 (analysis warning 로그) | Low | 10분 |
| I7 (컬럼명 불일치) | High | 대규모 리팩토링 |
