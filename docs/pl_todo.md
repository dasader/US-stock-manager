# TODO[multi-currency-pl] — 혼합 통화 P&L 집계 리팩토링

작성: 2026-04-14
브랜치: `feature/korean-stock-support`
grep 태그: `TODO[multi-currency-pl]`

---

## 배경

KRW 계정 지원 추가 시 DB 컬럼명(`price_usd`, `amount_usd` 등)은 그대로 두고 "해당 계정의 base_currency 단위 금액"으로 의미를 재해석하는 방식으로 확장했다. 계정 단위에서는 문제없지만, 여러 계정/포지션을 **전역 합산**할 때 native 통화가 USD/KRW 혼재되는데 코드가 구분 없이 단순 합산하여 아래 문제가 발생한다:

- KRW 금액(예: 5,880,420원)을 USD로 착각하여 `$5,880,420`로 표시
- `total_xxx_krw` 파생 값은 이미 KRW인 금액에 다시 환율을 곱해 **수십억 단위의 오류값** 생성
- 수익 기여도/섹터 비중 같은 **상대 비중** 계산이 왜곡 (GOLD 한 종목이 92% 차지 등)

**근본 원인:** `PositionEngine.get_all_positions()`이 반환하는 포지션 dict에 `account_id` 필드가 없어 하류에서 통화별 분리 집계가 불가능함.

---

## 영향 범위

### 백엔드

| 파일 | 라인 | 증상 |
|---|---|---|
| `backend/app/api/dashboard.py` | ~58 (메인 집계부) | `price_aggregator.calculate_position_metrics`가 통화 구분 없이 단순 합산. 전역 요약의 `total_market_value_usd`, `total_unrealized_pl_usd`, `total_realized_pl_usd`, `total_pl_usd`, `day_change_pl_usd`가 부정확 |
| `backend/app/api/analysis.py` | ~96-134, 261 등 | 섹터/산업/수익기여도 집계 시 `market_value_usd` / `unrealized_pl_usd`를 통화 구분 없이 합산. GOLD $1,460,420 잘못 표시 사례 |
| `backend/app/services/price_aggregator.py` | `calculate_position_metrics`, `apply_prices_to_positions` | 통화 무관 집계 함수. 여기가 궁극적 수정 지점 |

### 프론트엔드

| 파일 | 라인 | 증상 |
|---|---|---|
| `frontend/src/components/Dashboard.tsx` | 378 | 주 KPI 카드가 backend의 혼합 통화 집계값을 그대로 사용 |
| `frontend/src/components/Portfolio.tsx` | ~482 | 미실현손익 / 실현손익 / 총손익 KPI 카드 |
| `frontend/src/components/PortfolioAnalysis.tsx` | 전반 | 섹터 차트, 수익 기여도 등 |

### 계정별 요약(이미 수정 완료)

`backend/app/api/dashboard.py::_get_account_summary_data` — 각 계정의 `base_currency`에 따라 native/environment 변환. 커밋 `24b24d5`에서 처리됨. 계정별 요약은 이 패턴으로 수정했지만 전역 집계는 같은 방식으로 확장 불가(포지션별 account_id 필요).

---

## 해결 순서

다음 4단계로 진행해야 완결된다. 1→2→3→4 순서.

### Step 1 — PositionEngine에 account_id 포함

**파일:** `backend/app/services/position_engine.py`

`Position.to_dict()`이 반환하는 dict에 `account_id`가 누락되어 있다. Trade에는 `account_id`가 있으므로 Position 생성 시 소유 계정 ID를 함께 추적하도록 수정.

검증: `GET /api/positions/`에서 이미 `account_id` 필드를 반환 중이므로 그 로직을 `get_all_positions`까지 확장.

### Step 2 — Aggregator 통화 인식

**파일:** `backend/app/services/price_aggregator.py`

`calculate_position_metrics`에 `accounts_map: dict[int, Account]`와 `target_currency` 파라미터 추가. 각 포지션별 native currency를 읽어 FX 변환 후 합산하는 새 메서드 `calculate_position_metrics_in_currency` 작성. 기존 메서드는 호환을 위해 유지하되 deprecated 표시.

### Step 3 — Dashboard/Analysis API 재작성

**파일:** `backend/app/api/dashboard.py`, `backend/app/api/analysis.py`

- `display_currency` 쿼리 파라미터에 맞춰 새 aggregator 사용
- `DashboardSummary` 스키마에 per-currency breakdown 필드 추가 (`total_unrealized_pl_native_usd`, `total_unrealized_pl_native_krw`)
- 기존 `total_xxx_usd` / `total_xxx_krw` 필드는 display_currency 기준으로 재정의(의미 변경). 프론트 호환 검증 필요.

### Step 4 — 프론트엔드 KPI 카드 단순화

**파일:** `Dashboard.tsx`, `Portfolio.tsx`, `PortfolioAnalysis.tsx`

`summary.total_xxx` 필드가 display_currency 기준으로 정확해지므로 기존 `toDisplay` 변환 로직과 중복되는 부분 제거. `TODO[multi-currency-pl]` 주석 삭제.

---

## 현재 상태

- ✅ 계정별 요약(`_get_account_summary_data`)은 수정 완료 — 계정 단위 통화 인식으로 정확
- ✅ 포지션별 (보유종목 테이블) 프론트 표시는 수정 완료 — `pos.currency` 필드와 `toDisplay` 사용
- ✅ 전역 KPI 카드(미실현/실현/총손익) — 수정 완료 (2026-04-14)
- ✅ 수익 기여도, 섹터 차트, 성과 비중 — 수정 완료 (2026-04-14)
- ✅ 대시보드 전역 합산 카드 — 수정 완료 (2026-04-14)

---

## 검증 방법

리팩토링 완료 후:

```bash
# 1. KRW 포지션만 있는 계정과 USD 포지션만 있는 계정 각각 생성
# 2. GOLD 26g @ 170,000원 매수, AAPL 10주 @ $150 매수
# 3. /api/dashboard/summary/?display_currency=USD 호출
#    → total_unrealized_pl_native_krw: (226170-170000)*26 = 1,460,420 KRW
#    → total_unrealized_pl_native_usd: (시세차-150)*10
#    → total_value_display: 위 두 값을 USD로 환산한 합계
# 4. ?display_currency=KRW도 동일 검증
```

---

## 관련 커밋

- `a6afa90` — 초기 TODO 주석 추가
- `24b24d5` — 계정별 요약 서브셋 수정 (완료)
- `12bd823` — KRX 종목 정보 yfinance 우회 (완료, 별도 이슈)

---

## 향후 작업 추정

- Step 1 (PositionEngine): 1~2시간
- Step 2 (Aggregator): 2~3시간 + 테스트
- Step 3 (Dashboard/Analysis API): 3~4시간 + E2E 테스트
- Step 4 (Frontend cleanup): 1시간

총 7~10시간 추정. 별도 브랜치에서 진행 권장.
