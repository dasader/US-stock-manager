# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

US Stock Manager — 미국 주식 포트폴리오 관리 앱 (풀스택, 한국어 UI)

- **Backend**: FastAPI + SQLAlchemy 2.0 + SQLite
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Recharts
- **Deployment**: Docker Compose

## Development Commands

### Docker (권장)

```bash
docker compose up -d --build   # 빌드 후 실행
docker compose up -d           # 재빌드 없이 실행
docker compose down            # 중지
docker compose logs -f         # 로그 확인
```

접속: Frontend `http://localhost:5173` | Backend API `http://localhost:8000` | API Docs `http://localhost:8000/docs`

### 로컬 개발

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev          # Docker 내부 proxy (http://backend:8000)
npm run dev:local    # 로컬 백엔드 (http://localhost:8000)
npm run build
npm run lint
```

### 테스트

```bash
# Backend (pytest)
cd backend
pytest app/tests/test_position_engine.py

# Frontend lint
cd frontend
npm run lint
```

## Architecture

### Backend (`backend/app/`)

```
main.py          → FastAPI 앱 진입점, lifespan으로 서비스 시작/종료
models.py        → SQLAlchemy ORM 모델
schemas.py       → Pydantic 스키마
crud.py          → DB CRUD 연산
database.py      → SQLite 연결 (WAL 모드 활성화)
api/             → FastAPI 라우터 (features별로 분리)
services/        → 비즈니스 로직
core/exceptions.py
```

**핵심 서비스:**
- `services/position_engine.py` — FIFO 매칭으로 실현/미실현 손익 계산. 가장 핵심 로직.
- `services/price_service.py` / `price_aggregator.py` — yfinance 기반 가격 조회 및 집계
- `services/fx_service.py` — USD→KRW 환율 변환
- `services/stock_info_service.py` — 섹터/산업군 분류 (yfinance 기반)
- `services/scheduler_service.py` — APScheduler로 일별 스냅샷 생성
- `services/background_price_service.py` — 비동기 가격 업데이트

**API 라우터 (모두 `/api/` prefix):** `accounts`, `trades`, `positions`, `prices`, `fx`, `dashboard`, `cash`, `dividends`, `analysis`, `backup`, `snapshots`, `splits`, `simulation`

### Frontend (`frontend/src/`)

```
App.tsx          → 탭 기반 라우팅 (10개 탭)
services/api.ts  → Axios HTTP 클라이언트
types/index.ts   → TypeScript 인터페이스
components/      → 탭별 주요 컴포넌트
components/ui/   → 공통 UI 컴포넌트 (Radix UI 기반)
design-system/tokens.ts → 디자인 토큰
hooks/           → 커스텀 React Hooks
```

**상태 관리:** `@tanstack/react-query`로 서버 상태 캐싱/동기화

**탭 구성:** Dashboard → Positions → 매수입력 → Trades → Cash → Dividends → Analysis → Splits → Accounts → Backup

**키보드 단축키:** `Alt+[1-9]` 탭 전환, `Alt+D` 다크모드, `Alt+R` 새로고침, `Alt+H` 도움말

### Data Flow

```
Dashboard 요약:
GET /api/dashboard/summary/ → Position Engine (FIFO) → Price Service → FX Service → 응답

거래 추가:
POST /api/trades/ → DB 저장 → Position Engine 재계산

분석:
GET /api/analysis/sectors/ → 포지션 로드 → yfinance 섹터 분류 → 집계 반환
```

## Environment Setup

`.env.example`을 `.env`로 복사 후 수정:

```
FINNHUB_API_KEY=    # Finnhub 실시간 주식 데이터 (필수)
CORS_ORIGINS=       # 허용 CORS 오리진 (콤마 구분)
DATABASE_URL=       # 기본값: sqlite:////data/stock_manager.db
TZ=Asia/Seoul
```

## Key Conventions

- **모든 금액**: USD 기준으로 DB 저장, FX 서비스로 KRW 변환하여 표시.
  단, KRW 계정(`base_currency="KRW"`)의 거래/가격 데이터는 `price_usd` 컬럼명에도 불구하고
  KRW native 금액을 그대로 저장한다 (컬럼명은 역사적 이유로 유지; 향후 `price_native`로 rename 예정).
  실제 통화 판별은 항상 `accounts.base_currency`를 참조할 것.
- **포지션 계산**: DB에 직접 저장하지 않고 항상 PositionEngine으로 동적 계산
- **가격 캐시**: `PriceCache` 테이블에 캐싱, 만료 시 API 재조회
- **API 엔드포인트**: trailing slash 필수 (`/api/trades/` O, `/api/trades` X)
- **Docker 볼륨**: `./data` → `/data` (SQLite DB 영속화)

## Known Technical Debt

- **`price_usd` 컬럼명 불일치**: `Trade.price_usd`, `PriceCache.price_usd` 등의 컬럼은
  KRW 계정에서 KRW native 금액을 저장한다. 장기적으로 `price_native`로 rename 필요.
  영향 범위: `models.py`, `crud.py`, `schemas.py`, 관련 API — 20개 파일 138곳.
