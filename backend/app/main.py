"""
FastAPI 메인 애플리케이션
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging
import sys

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

from .database import init_db, engine
from .migrations import ensure_base_currency_column
from .api import trades, positions, prices, fx, dashboard, health, background, cash, accounts, snapshots, dividends, analysis, backup, splits, market, krx as krx_api
from .services.background_price_service import background_price_service
from .services.scheduler_service import snapshot_scheduler

# 데이터베이스 초기화
init_db()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 라이프사이클 관리 (FastAPI 최신 방식)"""
    # 시작 시
    logger.info("=" * 80)
    logger.info("애플리케이션 시작 중...")
    logger.info(f"시간대: {os.getenv('TZ', 'Not set')}")
    
    import datetime
    import pytz
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    now_kst = datetime.datetime.now(pytz.timezone('Asia/Seoul'))
    logger.info(f"현재 시간 (UTC): {now_utc.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    logger.info(f"현재 시간 (KST): {now_kst.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    
    logger.info("DB 마이그레이션 실행 중...")
    ensure_base_currency_column(engine)
    logger.info("DB 마이그레이션 완료")

    logger.info("백그라운드 가격 서비스 시작 중...")
    background_price_service.start_background_loading()
    
    logger.info("스냅샷 스케줄러 시작 중...")
    snapshot_scheduler.start()
    
    logger.info("애플리케이션 시작 완료!")
    logger.info("=" * 80)
    
    yield
    
    # 종료 시
    logger.info("애플리케이션 종료 중...")
    background_price_service.stop_background_loading()
    snapshot_scheduler.stop()
    logger.info("애플리케이션 종료 완료")


app = FastAPI(
    title="미국 주식 자산관리 API",
    description="미국 주식 거래 및 포지션 관리를 위한 REST API",
    version="1.1.0",
    lifespan=lifespan
)

# CORS 설정
# docker-compose.yml의 CORS_ORIGINS 환경변수에서 값을 읽음
# 형식: "http://localhost:5173,http://localhost:3000,https://mem.photos"
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
# 공백 제거 (환경변수 파싱 시 공백이 포함될 수 있음)
origins = [origin.strip() for origin in origins]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(accounts.router)
app.include_router(trades.router)
app.include_router(positions.router)
app.include_router(prices.router)
app.include_router(fx.router)
app.include_router(dashboard.router)
app.include_router(health.router)
app.include_router(background.router)
app.include_router(cash.router)
app.include_router(snapshots.router)
app.include_router(dividends.router)
app.include_router(analysis.router)
app.include_router(backup.router)
app.include_router(splits.router)
app.include_router(market.router)
app.include_router(krx_api.router)


@app.get("/")
def root():
    """루트 엔드포인트"""
    return {
        "message": "미국 주식 자산관리 API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
def health_check():
    """헬스 체크"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

