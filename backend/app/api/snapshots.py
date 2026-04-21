"""
스냅샷 관련 API 엔드포인트
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import date, timedelta

from .. import crud, schemas
from ..database import get_db
from ..services.position_engine import PositionEngine
from ..services.price_aggregator import price_aggregator
from ..services.fx_service import fx_service

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


@router.post("/create", response_model=dict, include_in_schema=True)
@router.post("/create/", response_model=dict, include_in_schema=False)
async def create_daily_snapshots(
    snapshot_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    """일일 스냅샷 생성 (전체 및 개별 포지션)"""
    if snapshot_date is None:
        snapshot_date = date.today()

    # 환율 조회 (KRW 계정 USD 환산에 필요)
    fx_data = await fx_service.get_rate("USD", "KRW")
    fx_rate = fx_data['rate'] if fx_data else 1350.0

    # 기존 스냅샷 삭제
    crud.delete_snapshots_by_date(db, snapshot_date)

    created_count = 0

    # 계정 맵 로드 (통화 판별용)
    all_accounts = crud.get_accounts(db)
    accounts_map = {a.id: a for a in all_accounts}

    # 전체 계정 스냅샷
    all_trades = crud.get_all_trades_for_calculation(db)
    engine_all = PositionEngine()
    engine_all.process_trades(all_trades)
    positions_all = engine_all.get_all_positions(include_closed=False)

    # 가격 데이터 조회 (통화 인식 집계)
    price_data = price_aggregator.get_prices_for_positions(positions_all)
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
        snapshot_date=snapshot_date,
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
                    snapshot_date=snapshot_date,
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

    # 계정별 스냅샷 생성
    accounts = crud.get_accounts(db, is_active=True)
    for account in accounts:
        account_trades = crud.get_all_trades_for_calculation(db, account.id)
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
            snapshot_date=snapshot_date,
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
                        snapshot_date=snapshot_date,
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
    
    return {
        "message": f"{snapshot_date} 스냅샷이 생성되었습니다.",
        "snapshot_date": snapshot_date,
        "created_count": created_count
    }


@router.get("/latest", response_model=List[schemas.DailySnapshotResponse])
def get_latest_snapshots(
    account_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """최신 스냅샷 조회"""
    # 최신 스냅샷 날짜 찾기
    latest = crud.get_latest_snapshot(db, account_id=account_id, ticker=None)
    
    if not latest:
        return []
    
    # 해당 날짜의 모든 스냅샷 반환
    return crud.get_snapshots_by_date(db, latest.snapshot_date)


@router.get("/date/{snapshot_date}", response_model=List[schemas.DailySnapshotResponse], include_in_schema=True)
@router.get("/date/{snapshot_date}/", response_model=List[schemas.DailySnapshotResponse], include_in_schema=False)
def get_snapshots_by_date(
    snapshot_date: date,
    db: Session = Depends(get_db)
):
    """특정 날짜의 스냅샷 조회"""
    return crud.get_snapshots_by_date(db, snapshot_date)


@router.delete("/date/{snapshot_date}", include_in_schema=True)
@router.delete("/date/{snapshot_date}/", include_in_schema=False)
def delete_snapshots(
    snapshot_date: date,
    db: Session = Depends(get_db)
):
    """특정 날짜의 스냅샷 삭제"""
    deleted = crud.delete_snapshots_by_date(db, snapshot_date)
    return {
        "message": f"{snapshot_date}의 스냅샷이 삭제되었습니다.",
        "deleted_count": deleted
    }


@router.get("/range/", response_model=List[schemas.DailySnapshotResponse])
def get_snapshots_by_range(
    start_date: date,
    end_date: date,
    account_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """날짜 범위의 스냅샷 조회 (그래프용)"""
    return crud.get_snapshots_by_date_range(db, start_date, end_date, account_id)


@router.get("/scheduler/status", response_model=dict, include_in_schema=True)
@router.get("/scheduler/status/", response_model=dict, include_in_schema=False)
def get_scheduler_status():
    """스케줄러 상태 조회"""
    from ..services.scheduler_service import snapshot_scheduler
    return snapshot_scheduler.get_status()


@router.post("/scheduler/trigger", response_model=dict, include_in_schema=True)
@router.post("/scheduler/trigger/", response_model=dict, include_in_schema=False)
def trigger_manual_snapshot():
    """수동으로 스냅샷 생성"""
    from ..services.scheduler_service import snapshot_scheduler
    return snapshot_scheduler.trigger_manual_snapshot()


@router.get("/diagnose", response_model=dict, include_in_schema=True)
@router.get("/diagnose/", response_model=dict, include_in_schema=False)
def diagnose_snapshots(
    account_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """스냅샷 데이터 진단 - 티커별 스냅샷 존재 여부 확인"""
    # 현재 보유 중인 포지션 조회
    trades = crud.get_all_trades_for_calculation(db, account_id)
    
    from ..services.position_engine import PositionEngine
    engine = PositionEngine()
    engine.process_trades(trades)
    positions = engine.get_all_positions(include_closed=False)
    
    # 각 티커별 스냅샷 확인
    diagnosis = {
        "account_id": account_id,
        "total_positions": len(positions),
        "positions_with_snapshot": 0,
        "positions_without_snapshot": 0,
        "details": []
    }
    
    for position in positions:
        ticker = position['ticker']
        snapshot = crud.get_latest_snapshot(db, account_id=account_id, ticker=ticker)
        
        detail = {
            "ticker": ticker,
            "shares": position['shares'],
            "has_snapshot": snapshot is not None
        }
        
        if snapshot:
            detail["snapshot_date"] = snapshot.snapshot_date
            detail["snapshot_unrealized_pl_usd"] = snapshot.unrealized_pl_usd
            diagnosis["positions_with_snapshot"] += 1
        else:
            detail["snapshot_date"] = None
            detail["snapshot_unrealized_pl_usd"] = None
            diagnosis["positions_without_snapshot"] += 1
        
        diagnosis["details"].append(detail)
    
    # 전체 요약 스냅샷 확인
    summary_snapshot = crud.get_latest_snapshot(db, account_id=account_id, ticker=None)
    diagnosis["summary_snapshot"] = {
        "exists": summary_snapshot is not None,
        "snapshot_date": summary_snapshot.snapshot_date if summary_snapshot else None,
        "total_pl_usd": summary_snapshot.total_pl_usd if summary_snapshot else None
    }
    
    return diagnosis
