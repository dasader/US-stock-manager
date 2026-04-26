"""
자동 스냅샷 스케줄러 서비스
미국 주식 시장 개장일에만 스냅샷을 자동 생성합니다.
"""
import logging
from datetime import date, datetime, timedelta
from typing import Optional
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.executors.pool import ThreadPoolExecutor
import pytz

from .. import crud, schemas
from ..services.position_engine import PositionEngine
from ..services.price_aggregator import price_aggregator

logger = logging.getLogger(__name__)


def _group_trades_by_account(trades: list) -> dict:
    """거래 목록을 account_id 기준으로 분리 (N+1 쿼리 방지)"""
    grouped: dict = {}
    for trade in trades:
        acc_id = trade["account_id"]
        if acc_id not in grouped:
            grouped[acc_id] = []
        grouped[acc_id].append(trade)
    return grouped


class SnapshotScheduler:
    """스냅샷 자동 생성 스케줄러"""
    
    def __init__(self):
        # 스케줄러 설정 (영구 볼륨 경로에 저장)
        jobstores = {
            'default': SQLAlchemyJobStore(url='sqlite:////data/scheduler.db')
        }
        executors = {
            'default': ThreadPoolExecutor(20),
        }
        job_defaults = {
            'coalesce': False,
            'max_instances': 1
        }
        
        self.scheduler = BackgroundScheduler(
            jobstores=jobstores,
            executors=executors,
            job_defaults=job_defaults,
            timezone=pytz.timezone('Asia/Seoul')  # 한국 시간대
        )
        
        self.is_running = False
        logger.info(f"스케줄러 초기화 완료: 시간대=Asia/Seoul, jobstore=sqlite:////data/scheduler.db")
    
    def start(self):
        """스케줄러 시작"""
        if not self.is_running:
            # 매일 한국시간 오전 6시에 실행 (화~토, 미국 월~금 장 마감 후)
            trigger = CronTrigger(hour=6, minute=0, day_of_week='tue-sat', timezone=pytz.timezone('Asia/Seoul'))
            self.scheduler.add_job(
                func=create_daily_snapshot_job,  # 모듈 레벨 함수 사용
                trigger=trigger,
                id='daily_snapshot',
                name='Daily Portfolio Snapshot',
                replace_existing=True
            )
            
            self.scheduler.start()
            self.is_running = True
            
            # 현재 시간 및 다음 실행 시간 로깅
            now = datetime.now(pytz.timezone('Asia/Seoul'))
            jobs = self.scheduler.get_jobs()
            next_run = jobs[0].next_run_time if jobs else None
            logger.info(f"스냅샷 스케줄러가 시작되었습니다.")
            logger.info(f"  - 현재 시간: {now.strftime('%Y-%m-%d %H:%M:%S %Z')}")
            logger.info(f"  - 스케줄: 매일 오전 6시 (화~토, 미국 월~금 장 마감 후)")
            logger.info(f"  - 다음 실행: {next_run.strftime('%Y-%m-%d %H:%M:%S %Z') if next_run else 'N/A'}")
            logger.info(f"  - 참고: 미국 공휴일에도 스냅샷 생성됨 (전날 데이터 유지)")
    
    def stop(self):
        """스케줄러 중지"""
        if self.is_running:
            self.scheduler.shutdown()
            self.is_running = False
            logger.info("스냅샷 스케줄러가 중지되었습니다.")
    
    def get_status(self) -> dict:
        """스케줄러 상태 조회"""
        if not self.is_running:
            return {
                "running": False,
                "next_run": None,
                "jobs": []
            }
        
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run": job.next_run_time.isoformat() if job.next_run_time else None
            })
        
        return {
            "running": self.is_running,
            "next_run": jobs[0]["next_run"] if jobs else None,
            "jobs": jobs
        }
    
    def trigger_manual_snapshot(self) -> dict:
        """수동으로 스냅샷 생성"""
        try:
            result = create_daily_snapshot_job()
            return {
                "success": True,
                "message": "수동 스냅샷 생성이 완료되었습니다.",
                "result": result
            }
        except Exception as e:
            logger.error(f"수동 스냅샷 생성 실패: {e}")
            return {
                "success": False,
                "message": f"수동 스냅샷 생성 실패: {str(e)}"
            }
    
def create_daily_snapshot_job() -> dict:
    """일일 스냅샷 생성 (스케줄러용 모듈 레벨 함수)
    한국시간 화~토 06:00에 실행되어 미국 월~금 종가 기준 데이터를 기록합니다.

    시차 고려:
    - 미국 월요일 장 마감 → 한국 화요일 오전
    - 미국 화요일 장 마감 → 한국 수요일 오전
    - 미국 수요일 장 마감 → 한국 목요일 오전
    - 미국 목요일 장 마감 → 한국 금요일 오전
    - 미국 금요일 장 마감 → 한국 토요일 오전
    """
    import asyncio
    import pytz
    now_kst = datetime.now(pytz.timezone('Asia/Seoul'))
    today = date.today()

    logger.info("=" * 80)
    logger.info(f"[스냅샷 생성] 시작 - 현재 시간: {now_kst.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    logger.info(f"[스냅샷 생성] 대상 날짜: {today}")

    # 요일 확인 (일요일, 월요일만 차단)
    weekday = today.weekday()
    weekday_names = ['월', '화', '수', '목', '금', '토', '일']
    logger.info(f"[스냅샷 생성] 요일 확인: {weekday_names[weekday]}요일 (weekday={weekday})")

    # 일요일(6), 월요일(0)만 차단 - 화~토(1~5) 실행
    if weekday in [6, 0]:
        day_name = '일요일' if weekday == 6 else '월요일'
        logger.info(f"[스냅샷 생성] ❌ {day_name}이므로 스냅샷 생성을 건너뜁니다")
        logger.info(f"[스냅샷 생성] (미국 월~금 장 마감 후 → 한국 화~토 오전에 스냅샷 생성)")
        return {
            "skipped": True,
            "reason": f"{day_name} (미국 시장 데이터 없음)",
            "date": today.isoformat()
        }

    logger.info(f"[스냅샷 생성] ✅ 정상 영업일 ({weekday_names[weekday]}요일), 스냅샷 생성 진행")
    logger.info(f"[스냅샷 생성] (미국 {'월화수목금'[weekday-1]}요일 장 마감 데이터 기록)")

    # 3. 스냅샷 생성
    logger.info("[스냅샷 생성] 실제 스냅샷 생성 작업 시작")
    db = None
    try:
        # 데이터베이스 세션 생성 (의존성 주입 없이 직접 생성)
        from ..database import SessionLocal
        from ..services.fx_service import fx_service
        db = SessionLocal()

        # 환율 조회 (KRW 계정 USD 환산에 필요, 스케줄러 스레드에서 asyncio.run 사용)
        try:
            fx_data = asyncio.run(fx_service.get_rate("USD", "KRW"))
            fx_rate = fx_data['rate'] if fx_data else 1350.0
        except Exception as fx_err:
            logger.warning(f"[스냅샷 생성] 환율 조회 실패, 기본값 1350 사용: {fx_err}")
            fx_rate = 1350.0
        logger.info(f"[스냅샷 생성] 적용 환율: 1 USD = {fx_rate:.2f} KRW")

        # 기존 스냅샷 삭제
        deleted_count = crud.delete_snapshots_by_date(db, today)
        logger.info(f"[스냅샷 생성] 기존 스냅샷 {deleted_count}개 삭제 완료")

        created_count = 0

        # 계정 맵 로드 (통화 판별용)
        all_accounts = crud.get_accounts(db)
        accounts_map = {a.id: a for a in all_accounts}

        # 전체 계정 스냅샷
        all_trades = crud.get_all_trades_for_calculation(db)
        engine_all = PositionEngine()
        engine_all.process_trades(all_trades)
        positions_all = engine_all.get_all_positions(include_closed=False)

        # 가격 데이터 조회
        price_data = price_aggregator.get_prices_for_positions(positions_all)
        # 통화 인식 집계: KRW 계정의 native KRW 금액을 USD로 환산하여 합산
        mc_metrics = price_aggregator.calculate_position_metrics_multicurrency(
            positions_all, price_data, accounts_map, fx_rate, "USD"
        )
        total_market_value_usd = (
            mc_metrics["native_usd_market_value"]
            + mc_metrics["native_krw_market_value"] / fx_rate
        )
        total_unrealized_pl_usd = (
            mc_metrics["native_usd_unrealized_pl"]
            + mc_metrics["native_krw_unrealized_pl"] / fx_rate
        )
        total_realized_pl_usd = sum(
            pos.realized_pl / fx_rate
            if getattr(accounts_map.get(pos.account_id), 'base_currency', 'USD') == 'KRW'
            else pos.realized_pl
            for pos in engine_all.positions.values()
        )
        total_pl_usd = total_unrealized_pl_usd + total_realized_pl_usd

        # 전체 요약 스냅샷 생성
        snapshot_summary = schemas.DailySnapshotCreate(
            snapshot_date=today,
            account_id=None,
            ticker=None,
            total_market_value_usd=total_market_value_usd,
            total_unrealized_pl_usd=total_unrealized_pl_usd,
            total_realized_pl_usd=total_realized_pl_usd,
            total_pl_usd=total_pl_usd
        )
        crud.create_snapshot(db, snapshot_summary)
        created_count += 1

        # 각 포지션별 스냅샷 생성
        for position in positions_all:
            if position['shares'] > 0:  # 보유 중인 포지션만
                ticker = position['ticker']
                price = price_data.get(ticker, {}).get('price_usd')

                if price:
                    snapshot_position = schemas.DailySnapshotCreate(
                        snapshot_date=today,
                        account_id=None,  # 전체 계정
                        ticker=ticker,
                        shares=position['shares'],
                        avg_cost_usd=position['avg_cost_usd'],
                        market_price_usd=price,
                        market_value_usd=position['shares'] * price,
                        unrealized_pl_usd=position.get('unrealized_pl_usd'),
                        unrealized_pl_percent=position.get('unrealized_pl_percent')
                    )
                    crud.create_snapshot(db, snapshot_position)
                    created_count += 1

        # 계정별 스냅샷 생성 — all_trades 재사용으로 N+1 제거
        accounts = crud.get_accounts(db, is_active=True)
        trades_by_account = _group_trades_by_account(all_trades)
        for account in accounts:
            account_trades = trades_by_account.get(account.id, [])
            engine_account = PositionEngine()
            engine_account.process_trades(account_trades)
            positions_account = engine_account.get_all_positions(include_closed=False)

            # 계정별 가격 데이터 조회 (통화 인식 집계)
            price_data_account = price_aggregator.get_prices_for_positions(positions_account)
            mc_account = price_aggregator.calculate_position_metrics_multicurrency(
                positions_account, price_data_account, accounts_map, fx_rate, "USD"
            )
            account_market_value = (
                mc_account["native_usd_market_value"]
                + mc_account["native_krw_market_value"] / fx_rate
            )
            account_unrealized_pl = (
                mc_account["native_usd_unrealized_pl"]
                + mc_account["native_krw_unrealized_pl"] / fx_rate
            )
            account_base_cur = getattr(account, 'base_currency', 'USD') or 'USD'
            raw_account_realized = engine_account.get_total_realized_pl()
            account_realized_pl = raw_account_realized / fx_rate if account_base_cur == 'KRW' else raw_account_realized
            account_total_pl = account_unrealized_pl + account_realized_pl
            
            # 계정별 요약 스냅샷
            snapshot_account_summary = schemas.DailySnapshotCreate(
                snapshot_date=today,
                account_id=account.id,
                ticker=None,
                total_market_value_usd=account_market_value,
                total_unrealized_pl_usd=account_unrealized_pl,
                total_realized_pl_usd=account_realized_pl,
                total_pl_usd=account_total_pl
            )
            crud.create_snapshot(db, snapshot_account_summary)
            created_count += 1
            
            # 계정별 포지션 스냅샷
            for position in positions_account:
                if position['shares'] > 0:
                    ticker = position['ticker']
                    price = price_data_account.get(ticker, {}).get('price_usd')
                    
                    if price:
                        snapshot_account_position = schemas.DailySnapshotCreate(
                            snapshot_date=today,
                            account_id=account.id,
                            ticker=ticker,
                            shares=position['shares'],
                            avg_cost_usd=position['avg_cost_usd'],
                            market_price_usd=price,
                            market_value_usd=position['shares'] * price,
                            unrealized_pl_usd=position.get('unrealized_pl_usd'),
                            unrealized_pl_percent=position.get('unrealized_pl_percent')
                        )
                        crud.create_snapshot(db, snapshot_account_position)
                        created_count += 1
        
        db.commit()
        
        logger.info(f"[스냅샷 생성] ✅ 완료!")
        logger.info(f"[스냅샷 생성]   - 날짜: {today}")
        logger.info(f"[스냅샷 생성]   - 생성된 스냅샷 수: {created_count}")
        logger.info(f"[스냅샷 생성]   - 총 평가액: ${total_market_value_usd:,.2f}")
        logger.info(f"[스냅샷 생성]   - 총 손익: ${total_pl_usd:,.2f}")
        logger.info("=" * 80)
        
        return {
            "success": True,
            "date": today.isoformat(),
            "created_count": created_count,
            "total_market_value_usd": total_market_value_usd,
            "total_pl_usd": total_pl_usd
        }
        
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        if db:
            db.rollback()
        logger.error(f"[스냅샷 생성] ❌ 실패!")
        logger.error(f"[스냅샷 생성] 에러: {e}")
        logger.error(f"[스냅샷 생성] 상세:\n{error_detail}")
        logger.info("=" * 80)
        return {
            "success": False,
            "error": str(e),
            "date": today.isoformat()
        }
    finally:
        if db:
            db.close()


# 전역 스케줄러 인스턴스
snapshot_scheduler = SnapshotScheduler()
