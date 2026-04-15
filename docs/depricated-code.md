# Deprecated / Unused Code

> 작성일: 2026-04-15
> 분석 대상: `frontend/src/`, `backend/app/`

---

## 프론트엔드

### 미사용 컴포넌트 (9개)

현재 `App.tsx` 및 다른 컴포넌트에서 import되지 않는 컴포넌트 파일.

| 파일 | 비고 |
|------|------|
| `frontend/src/components/AccountManager.tsx` | 계좌 관리 UI — 미사용 |
| `frontend/src/components/BackupManager.tsx` | 백업 관리 UI — 미사용 |
| `frontend/src/components/CashManager.tsx` | 현금 관리 UI — 미사용 |
| `frontend/src/components/DividendManager.tsx` | 배당 관리 UI — 미사용 |
| `frontend/src/components/PositionsTable.tsx` | 보유종목 테이블 (구버전) — 미사용 |
| `frontend/src/components/RestoreModal.tsx` | 복원 모달 — 미사용 |
| `frontend/src/components/StockSplitManager.tsx` | 주식 분할 관리 UI — 미사용 |
| `frontend/src/components/TradeForm.tsx` | 거래 입력 폼 (독립 컴포넌트) — 미사용 |
| `frontend/src/components/TradesTable.tsx` | 거래 테이블 (구버전) — 미사용 |

---

### 미사용 훅

**`frontend/src/hooks/useScrollAnimation.ts`**
- Line 50: `useStaggeredScrollAnimation()` — export되어 있으나 어디서도 import 없음

---

### 미사용 유틸리티 파일

#### `frontend/src/utils/format.ts` — 파일 전체 미사용
- `formatCurrency()` (line 3) — `frontend/src/lib/utils.ts`에 동일 함수 존재, 이쪽은 import 없음
- `currencySymbol()` (line 13) — 정의만 있고 호출처 없음

#### `frontend/src/lib/a11y-utils.tsx` — 파일 전체 미사용
- `VisuallyHidden` 컴포넌트 (line 30) — import 없음
- `SkipLink` 컴포넌트 (line 37) — import 없음
- `checkColorContrast()` (line 50) — import 없음
- `keyboard` 객체 (line 59) — import 없음
- `a11yProps` 객체 — import 없음

#### `frontend/src/lib/icon-utils.tsx`
- `Icon` 컴포넌트 (line 41) — export되어 있으나 사용처 없음 (각 컴포넌트에서 lucide-react 직접 import)
- `IconButton` 컴포넌트 (line 67) — export되어 있으나 사용처 없음

---

### 미사용 디자인 시스템

**`frontend/src/design-system/tokens.ts`**
- `designTokens` 객체 (line 1) 및 default export (line 33) — 어디서도 import 없음

---

## 백엔드

### 미사용 CRUD 함수 (`backend/app/crud.py`)

| 함수 | 라인 | 비고 |
|------|------|------|
| `get_price_cache()` | 289 | 호출처 없음 |
| `get_latest_fx_cache()` | 262 | 호출처 없음 |
| `get_setting()` | 294 | 호출처 없음 |
| `set_setting()` | 300 | 호출처 없음 |
| `get_stock_split()` | 845 | 호출처 없음 (`get_stock_splits()`, `get_stock_split_by_ticker_and_date()`는 사용 중) |

---

## 요약

| 분류 | 항목 수 |
|------|---------|
| 미사용 컴포넌트 파일 | 9 |
| 미사용 훅 함수 | 1 |
| 미사용 유틸 파일/함수 | 7 |
| 미사용 디자인 토큰 | 1 |
| 미사용 백엔드 CRUD 함수 | 5 |
| **합계** | **23** |
