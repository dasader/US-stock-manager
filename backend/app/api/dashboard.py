"""
대시보드 관련 API 엔드포인트
"""
import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, Dict
from datetime import date, timedelta

from .. import crud, schemas
from ..database import get_db
from ..services.position_engine import PositionEngine
from ..services.price_service import price_service
from ..services.fx_service import fx_service
from ..services.fear_greed_service import fear_greed_service
from ..services.background_price_service import background_price_service
from ..services.price_aggregator import price_aggregator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary/", response_model=schemas.DashboardSummary)
async def get_dashboard_summary(
    account_id: Optional[int] = None,
    include_account_summaries: bool = False,
    display_currency: str = Query("KRW", pattern="^(USD|KRW)$"),
    db: Session = Depends(get_db)
):
    """대시보드 요약 정보 (전체 또는 특정 계정)"""
    # 환율 조회 (실시간 API 호출)
    fx_data = await fx_service.get_rate("USD", "KRW")
    fx_rate = fx_data['rate'] if fx_data else 1350.0
    fx_as_of = fx_data['as_of'] if fx_data else None
    
    # Fear & Greed Index 조회
    fear_greed_data = await fear_greed_service.get_index()
    
    # 특정 계정만 조회하는 경우
    if account_id:
        return await _get_account_summary(db, account_id, fx_rate, fx_as_of, fear_greed_data, display_currency)
    
    # 전체 계정 조회
    trades = crud.get_all_trades_for_calculation(db)
    
    # 포지션 엔진으로 계산
    engine = PositionEngine()
    engine.process_trades(trades)
    
    # 포지션 목록
    positions = engine.get_all_positions(include_closed=False)

    # 계정 맵 로드 (account_id → Account, base_currency 판별용)
    accounts_list = crud.get_accounts(db)
    accounts_map = {a.id: a for a in accounts_list}

    # 가격 데이터 조회
    price_data = price_aggregator.get_prices_for_positions(positions)

    # 통화 인식 집계 (USD 기준 정규화)
    mc_metrics = price_aggregator.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, fx_rate, "USD"
    )

    # 포지션에 가격 정보 적용 (previous_close 포함)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)

    # display_currency 기준 총 시장가치
    mc_display = price_aggregator.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, fx_rate, display_currency
    )
    total_value_display = mc_display["total_market_value"]

    # USD 기준 집계값 (기존 변수명 유지 — 하류 코드와 호환)
    # USD 계정 native + KRW 계정 USD 환산 합계
    total_market_value_usd = (
        mc_metrics["native_usd_market_value"]
        + mc_metrics["native_krw_market_value"] / fx_rate
    )
    total_unrealized_pl_usd = (
        mc_metrics["native_usd_unrealized_pl"]
        + mc_metrics["native_krw_unrealized_pl"] / fx_rate
    )
    total_cost_usd = mc_metrics["total_cost"]

    # 각 포지션에 전일 대비 변화량 계산
    # 동일한 스냅샷 날짜를 기준으로 계산하기 위해 앵커 스냅샷 날짜를 먼저 결정 (전체 요약)
    anchor_summary_snapshot = crud.get_latest_snapshot(db, account_id=None, ticker=None)
    for position in positions:
        ticker = position['ticker']
        current_unrealized_pl = position.get('unrealized_pl_usd')
        previous_close = position.get('previous_close_price')
        current_price = position.get('market_price_usd')
        shares = position.get('shares', 0)
        avg_cost = position.get('avg_cost_usd', 0)
        
        day_change = None
        
        # 스냅샷 조회 (요약 스냅샷의 날짜를 앵커로 사용하여 동일한 날짜 스냅샷만 사용)
        yesterday_snapshot = None
        if anchor_summary_snapshot is not None:
            yesterday_snapshot = crud.get_snapshot_by_date(
                db,
                snapshot_date=anchor_summary_snapshot.snapshot_date,
                account_id=None,
                ticker=ticker
            )
        
        # 방법 1: 스냅샷 기반 (우선순위 높음, unrealized_pl_usd가 있어야 함)
        if yesterday_snapshot and yesterday_snapshot.unrealized_pl_usd is not None and current_unrealized_pl is not None:
            day_change = current_unrealized_pl - yesterday_snapshot.unrealized_pl_usd
            logger.debug(f"[DASHBOARD] {ticker}: SNAPSHOT (현재: ${current_unrealized_pl:.2f}, 스냅샷: ${yesterday_snapshot.unrealized_pl_usd:.2f}) = ${day_change:.2f}")
        
        # 방법 2: Quote API의 전일 종가 기반 (스냅샷 없거나 스냅샷의 unrealized_pl_usd가 없을 때)
        elif previous_close and current_price and shares > 0 and avg_cost > 0:
            # 어제 미실현 손익 = (전일 종가 - 평단가) × 보유수량
            yesterday_unrealized_pl = (previous_close - avg_cost) * shares
            
            # 오늘 미실현 손익 = (현재가 - 평단가) × 보유수량
            today_unrealized_pl = (current_price - avg_cost) * shares
            
            # 변화량
            day_change = today_unrealized_pl - yesterday_unrealized_pl
            logger.debug(f"[DASHBOARD] {ticker}: QUOTE API (어제: ${yesterday_unrealized_pl:.2f}, 오늘: ${today_unrealized_pl:.2f}) = ${day_change:.2f}")
        else:
            day_change = None
            # 상세 진단 로그
            snapshot_info = f"스냅샷({'O' if yesterday_snapshot else 'X'}"
            if yesterday_snapshot:
                snapshot_info += f", pl_usd: {yesterday_snapshot.unrealized_pl_usd})"
            else:
                snapshot_info += ")"
            quote_info = f"pc:{previous_close}, cp:{current_price}, s:{shares}, ac:{avg_cost}"
            logger.debug(f"[DASHBOARD] {ticker}: 계산불가 ({snapshot_info}, {quote_info})")
        
        position['day_change_pl_usd'] = day_change
    
    # 실현 손익
    total_realized_pl_usd = engine.get_total_realized_pl()
    
    # 총 손익
    total_pl_usd = total_unrealized_pl_usd + total_realized_pl_usd
    
    # 미실현 손익률
    total_unrealized_pl_percent = (total_unrealized_pl_usd / total_cost_usd * 100) if total_cost_usd > 0 else 0.0
    
    # 활성 포지션 수
    active_positions_count = len([p for p in positions if p['shares'] > 0])
    
    # 현금 잔액 (전체)
    total_cash_usd = crud.get_cash_balance(db, None)
    
    # 입금/출금 총액 계산 (순투자금액 계산용)
    deposits = crud.get_cash_list(db, None, transaction_type="DEPOSIT", limit=10000)
    withdrawals = crud.get_cash_list(db, None, transaction_type="WITHDRAW", limit=10000)
    total_deposits_usd = sum(t.amount_usd for t in deposits)
    total_withdrawals_usd = sum(t.amount_usd for t in withdrawals)
    net_investment_usd = total_deposits_usd - total_withdrawals_usd  # 순투자금액
    
    # 배당금 요약
    dividend_summary = crud.get_dividend_summary(db, None)
    total_dividends_usd = dividend_summary['total_dividends_usd']
    
    # 전일 대비 변화량 계산
    # 포지션별 미실현 손익 변화량 합산 (일관성 유지)
    total_position_day_change = 0.0
    for position in positions:
        if position.get('day_change_pl_usd') is not None:
            total_position_day_change += position['day_change_pl_usd']
    
    day_change_pl_usd = None
    yesterday_snapshot = anchor_summary_snapshot
    
    # 스냅샷이 있으면 실현손익 변화량도 계산하여 추가
    if yesterday_snapshot and yesterday_snapshot.total_pl_usd is not None:
        # 미실현 손익 변화량 (포지션별 합산)
        unrealized_day_change = total_position_day_change
        
        # 실현 손익 변화량 (스냅샷 기반)
        realized_day_change = total_realized_pl_usd - (yesterday_snapshot.total_realized_pl_usd or 0.0)
        
        # 총 변화량 = 미실현 변화 + 실현 변화
        day_change_pl_usd = unrealized_day_change + realized_day_change
        
        logger.debug(f"[DASHBOARD] Total P&L day_change: UNREALIZED=${unrealized_day_change:.2f}, REALIZED=${realized_day_change:.2f}, TOTAL=${day_change_pl_usd:.2f}")
        logger.debug(f"[DASHBOARD]   - 현재: 미실현=${total_unrealized_pl_usd:.2f}, 실현=${total_realized_pl_usd:.2f}, 총=${total_pl_usd:.2f}")
        logger.debug(f"[DASHBOARD]   - 어제: 미실현=${yesterday_snapshot.total_unrealized_pl_usd or 0:.2f}, 실현=${yesterday_snapshot.total_realized_pl_usd or 0:.2f}, 총=${yesterday_snapshot.total_pl_usd:.2f}")
    
    # 스냅샷 없거나 total_pl_usd가 없으면 포지션별 day_change 합산만 사용 (미실현 변화만)
    if day_change_pl_usd is None:
        if total_position_day_change != 0.0 or len([p for p in positions if p.get('day_change_pl_usd') is not None]) > 0:
            day_change_pl_usd = total_position_day_change
            logger.debug(f"[DASHBOARD] Total P&L day_change: POSITIONS SUM (미실현만) = ${day_change_pl_usd:.2f}")
    
    # 계정별 요약 정보 (요청 시)
    accounts_summary = None
    if include_account_summaries:
        accounts = crud.get_accounts(db, is_active=True)
        accounts_summary = []
        for account in accounts:
            account_summary = await _get_account_summary_data(db, account.id, account.name, fx_rate, fx_as_of)
            # 보유종목이 있는 계정만 포함 (active_positions_count > 0)
            if account_summary.active_positions_count > 0:
                accounts_summary.append(account_summary)
    
    # Fear & Greed Index 스키마 변환
    fear_greed_index_schema = None
    if fear_greed_data:
        fear_greed_index_schema = schemas.FearGreedIndexResponse(
            value=fear_greed_data['value'],
            classification=fear_greed_data['classification'],
            timestamp=fear_greed_data['timestamp'],
            as_of=fear_greed_data['as_of'],
            cached=fear_greed_data.get('cached', False)
        )
    
    return schemas.DashboardSummary(
        total_market_value_usd=total_market_value_usd,
        total_market_value_krw=total_market_value_usd * fx_rate,
        total_unrealized_pl_usd=total_unrealized_pl_usd,
        total_unrealized_pl_krw=total_unrealized_pl_usd * fx_rate,
        total_unrealized_pl_percent=total_unrealized_pl_percent,
        total_realized_pl_usd=total_realized_pl_usd,
        total_realized_pl_krw=total_realized_pl_usd * fx_rate,
        total_pl_usd=total_pl_usd,
        total_pl_krw=total_pl_usd * fx_rate,
        total_cost_usd=total_cost_usd,
        total_cash_usd=total_cash_usd,
        total_cash_krw=total_cash_usd * fx_rate,
        total_deposits_usd=total_deposits_usd,
        total_deposits_krw=total_deposits_usd * fx_rate,
        total_withdrawals_usd=total_withdrawals_usd,
        total_withdrawals_krw=total_withdrawals_usd * fx_rate,
        net_investment_usd=net_investment_usd,
        net_investment_krw=net_investment_usd * fx_rate,
        fx_rate_usd_krw=fx_rate,
        fx_rate_as_of=fx_as_of,
        positions_count=len(positions),
        active_positions_count=active_positions_count,
        accounts_summary=accounts_summary,
        day_change_pl_usd=day_change_pl_usd,
        total_dividends_usd=total_dividends_usd,
        total_dividends_krw=total_dividends_usd * fx_rate,
        fear_greed_index=fear_greed_index_schema,
        display_currency=display_currency,
        total_value_display=total_value_display,
        total_market_value_native_usd=mc_metrics["native_usd_market_value"],
        total_market_value_native_krw=mc_metrics["native_krw_market_value"],
        total_unrealized_pl_native_usd=mc_metrics["native_usd_unrealized_pl"],
        total_unrealized_pl_native_krw=mc_metrics["native_krw_unrealized_pl"],
    )


async def _get_account_summary(db: Session, account_id: int, fx_rate: float, fx_as_of, fear_greed_data: Optional[Dict] = None, display_currency: str = "KRW"):
    """특정 계정의 요약 정보"""
    # 계정 조회
    account = crud.get_account(db, account_id)
    if not account:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"계정 ID {account_id}를 찾을 수 없습니다.")
    
    # 거래 조회
    trades = crud.get_all_trades_for_calculation(db, account_id)
    
    # 포지션 엔진으로 계산
    engine = PositionEngine()
    engine.process_trades(trades)
    
    # 포지션 목록
    positions = engine.get_all_positions(include_closed=False)
    
    # 가격 데이터 조회 및 집계 (공통 서비스 사용)
    price_data = price_aggregator.get_prices_for_positions(positions)
    total_market_value_usd, total_unrealized_pl_usd, total_cost_usd = price_aggregator.calculate_position_metrics(positions, price_data)
    
    # 포지션에 가격 정보 적용 (previous_close 포함)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)

    # 통화 인식 총 시장가치 계산 (단일 계정 — 계정의 base_currency를 사용)
    account_base_currency = getattr(account, "base_currency", "USD")
    if account_base_currency == display_currency:
        total_value_display = total_market_value_usd
    elif account_base_currency == "USD" and display_currency == "KRW":
        total_value_display = total_market_value_usd * fx_rate
    elif account_base_currency == "KRW" and display_currency == "USD":
        total_value_display = total_market_value_usd / fx_rate if fx_rate > 0 else 0.0
    else:
        total_value_display = total_market_value_usd

    # 각 포지션에 전일 대비 변화량 계산
    # 동일한 스냅샷 날짜를 기준으로 계산하기 위해 앵커 스냅샷 날짜를 먼저 결정 (계정 요약)
    anchor_summary_snapshot = crud.get_latest_snapshot(db, account_id=account_id, ticker=None)
    for position in positions:
        ticker = position['ticker']
        current_unrealized_pl = position.get('unrealized_pl_usd')
        previous_close = position.get('previous_close_price')
        current_price = position.get('market_price_usd')
        shares = position.get('shares', 0)
        avg_cost = position.get('avg_cost_usd', 0)

        day_change = None

        # 스냅샷 조회 (요약 스냅샷의 날짜를 앵커로 사용하여 동일한 날짜 스냅샷만 사용)
        yesterday_snapshot = None
        if anchor_summary_snapshot is not None:
            yesterday_snapshot = crud.get_snapshot_by_date(
                db,
                snapshot_date=anchor_summary_snapshot.snapshot_date,
                account_id=account_id,
                ticker=ticker
            )

        # 방법 1: 스냅샷 기반 (우선순위 높음, unrealized_pl_usd가 있어야 함)
        if yesterday_snapshot and yesterday_snapshot.unrealized_pl_usd is not None and current_unrealized_pl is not None:
            day_change = current_unrealized_pl - yesterday_snapshot.unrealized_pl_usd
            logger.debug(f"[ACCOUNT] {ticker}: SNAPSHOT (현재: ${current_unrealized_pl:.2f}, 스냅샷: ${yesterday_snapshot.unrealized_pl_usd:.2f}) = ${day_change:.2f}")
        
        # 방법 2: Quote API의 전일 종가 기반 (스냅샷 없거나 스냅샷의 unrealized_pl_usd가 없을 때)
        elif previous_close and current_price and shares > 0 and avg_cost > 0:
            # 어제 미실현 손익 = (전일 종가 - 평단가) × 보유수량
            yesterday_unrealized_pl = (previous_close - avg_cost) * shares
            
            # 오늘 미실현 손익 = (현재가 - 평단가) × 보유수량
            today_unrealized_pl = (current_price - avg_cost) * shares
            
            # 변화량
            day_change = today_unrealized_pl - yesterday_unrealized_pl
            logger.debug(f"[ACCOUNT] {ticker}: QUOTE API (어제: ${yesterday_unrealized_pl:.2f}, 오늘: ${today_unrealized_pl:.2f}) = ${day_change:.2f}")
        else:
            day_change = None
            # 상세 진단 로그
            snapshot_info = f"스냅샷({'O' if yesterday_snapshot else 'X'}"
            if yesterday_snapshot:
                snapshot_info += f", pl_usd: {yesterday_snapshot.unrealized_pl_usd})"
            else:
                snapshot_info += ")"
            quote_info = f"pc:{previous_close}, cp:{current_price}, s:{shares}, ac:{avg_cost}"
            logger.debug(f"[ACCOUNT] {ticker}: 계산불가 ({snapshot_info}, {quote_info})")
        
        position['day_change_pl_usd'] = day_change
    
    # 실현 손익
    total_realized_pl_usd = engine.get_total_realized_pl()
    
    # 총 손익
    total_pl_usd = total_unrealized_pl_usd + total_realized_pl_usd
    
    # 미실현 손익률
    total_unrealized_pl_percent = (total_unrealized_pl_usd / total_cost_usd * 100) if total_cost_usd > 0 else 0.0
    
    # 활성 포지션 수
    active_positions_count = len([p for p in positions if p['shares'] > 0])
    
    # 현금 잔액
    total_cash_usd = crud.get_cash_balance(db, account_id)
    
    # 입금/출금 총액 계산 (순투자금액 계산용)
    deposits = crud.get_cash_list(db, account_id, transaction_type="DEPOSIT", limit=10000)
    withdrawals = crud.get_cash_list(db, account_id, transaction_type="WITHDRAW", limit=10000)
    total_deposits_usd = sum(t.amount_usd for t in deposits)
    total_withdrawals_usd = sum(t.amount_usd for t in withdrawals)
    net_investment_usd = total_deposits_usd - total_withdrawals_usd  # 순투자금액
    
    # 배당금 요약
    dividend_summary = crud.get_dividend_summary(db, account_id)
    total_dividends_usd = dividend_summary['total_dividends_usd']
    
    # 전일 대비 변화량 계산
    # 포지션별 미실현 손익 변화량 합산 (일관성 유지)
    total_position_day_change = 0.0
    for position in positions:
        if position.get('day_change_pl_usd') is not None:
            total_position_day_change += position['day_change_pl_usd']
    
    day_change_pl_usd = None
    yesterday_snapshot = anchor_summary_snapshot
    
    # 스냅샷이 있으면 실현손익 변화량도 계산하여 추가
    if yesterday_snapshot and yesterday_snapshot.total_pl_usd is not None:
        # 미실현 손익 변화량 (포지션별 합산)
        unrealized_day_change = total_position_day_change
        
        # 실현 손익 변화량 (스냅샷 기반)
        realized_day_change = total_realized_pl_usd - (yesterday_snapshot.total_realized_pl_usd or 0.0)
        
        # 총 변화량 = 미실현 변화 + 실현 변화
        day_change_pl_usd = unrealized_day_change + realized_day_change
        
        logger.debug(f"[ACCOUNT] Account {account_id} Total P&L day_change: UNREALIZED=${unrealized_day_change:.2f}, REALIZED=${realized_day_change:.2f}, TOTAL=${day_change_pl_usd:.2f}")
    
    # 스냅샷 없거나 total_pl_usd가 없으면 포지션별 day_change 합산만 사용 (미실현 변화만)
    if day_change_pl_usd is None:
        if total_position_day_change != 0.0 or len([p for p in positions if p.get('day_change_pl_usd') is not None]) > 0:
            day_change_pl_usd = total_position_day_change
            logger.debug(f"[ACCOUNT] Account {account_id} Total P&L day_change: POSITIONS SUM (미실현만) = ${day_change_pl_usd:.2f}")
    
    # Fear & Greed Index 스키마 변환
    fear_greed_index_schema = None
    if fear_greed_data:
        fear_greed_index_schema = schemas.FearGreedIndexResponse(
            value=fear_greed_data['value'],
            classification=fear_greed_data['classification'],
            timestamp=fear_greed_data['timestamp'],
            as_of=fear_greed_data['as_of'],
            cached=fear_greed_data.get('cached', False)
        )
    
    return schemas.DashboardSummary(
        total_market_value_usd=total_market_value_usd,
        total_market_value_krw=total_market_value_usd * fx_rate,
        total_unrealized_pl_usd=total_unrealized_pl_usd,
        total_unrealized_pl_krw=total_unrealized_pl_usd * fx_rate,
        total_unrealized_pl_percent=total_unrealized_pl_percent,
        total_realized_pl_usd=total_realized_pl_usd,
        total_realized_pl_krw=total_realized_pl_usd * fx_rate,
        total_pl_usd=total_pl_usd,
        total_pl_krw=total_pl_usd * fx_rate,
        total_cost_usd=total_cost_usd,
        total_cash_usd=total_cash_usd,
        total_cash_krw=total_cash_usd * fx_rate,
        total_deposits_usd=total_deposits_usd,
        total_deposits_krw=total_deposits_usd * fx_rate,
        total_withdrawals_usd=total_withdrawals_usd,
        total_withdrawals_krw=total_withdrawals_usd * fx_rate,
        net_investment_usd=net_investment_usd,
        net_investment_krw=net_investment_usd * fx_rate,
        fx_rate_usd_krw=fx_rate,
        fx_rate_as_of=fx_as_of,
        positions_count=len(positions),
        active_positions_count=active_positions_count,
        accounts_summary=None,
        day_change_pl_usd=day_change_pl_usd,
        total_dividends_usd=total_dividends_usd,
        total_dividends_krw=total_dividends_usd * fx_rate,
        fear_greed_index=fear_greed_index_schema,
        display_currency=display_currency,
        total_value_display=total_value_display,
    )


async def _get_account_summary_data(db: Session, account_id: int, account_name: str, fx_rate: float, fx_as_of) -> schemas.AccountSummary:
    """계정별 요약 정보 생성"""
    # 거래 조회
    trades = crud.get_all_trades_for_calculation(db, account_id)
    
    # 포지션 엔진으로 계산
    engine = PositionEngine()
    engine.process_trades(trades)
    
    # 포지션 목록
    positions = engine.get_all_positions(include_closed=False)
    
    # 가격 데이터 조회 및 집계 (공통 서비스 사용)
    price_data = price_aggregator.get_prices_for_positions(positions)
    total_market_value_usd, total_unrealized_pl_usd, total_cost_usd = price_aggregator.calculate_position_metrics(positions, price_data)
    
    # 포지션에 가격 정보 적용 (previous_close 포함)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)
    
    # 각 포지션에 전일 대비 변화량 계산
    # 동일한 스냅샷 날짜를 기준으로 계산하기 위해 앵커 스냅샷 날짜를 먼저 결정 (계정 요약)
    anchor_summary_snapshot = crud.get_latest_snapshot(db, account_id=account_id, ticker=None)
    for position in positions:
        ticker = position['ticker']
        current_unrealized_pl = position.get('unrealized_pl_usd')
        previous_close = position.get('previous_close_price')
        current_price = position.get('market_price_usd')
        shares = position.get('shares', 0)
        avg_cost = position.get('avg_cost_usd', 0)
        
        day_change = None
        
        # 스냅샷 조회 (요약 스냅샷의 날짜를 앵커로 사용하여 동일한 날짜 스냅샷만 사용)
        yesterday_snapshot = None
        if anchor_summary_snapshot is not None:
            yesterday_snapshot = crud.get_snapshot_by_date(
                db,
                snapshot_date=anchor_summary_snapshot.snapshot_date,
                account_id=account_id,
                ticker=ticker
            )
        
        # 방법 1: 스냅샷 기반 (우선순위 높음, unrealized_pl_usd가 있어야 함)
        if yesterday_snapshot and yesterday_snapshot.unrealized_pl_usd is not None and current_unrealized_pl is not None:
            day_change = current_unrealized_pl - yesterday_snapshot.unrealized_pl_usd
            logger.debug(f"[ACCOUNT_SUMMARY] {ticker}: SNAPSHOT (현재: ${current_unrealized_pl:.2f}, 스냅샷: ${yesterday_snapshot.unrealized_pl_usd:.2f}) = ${day_change:.2f}")
        
        # 방법 2: Quote API의 전일 종가 기반 (스냅샷 없거나 스냅샷의 unrealized_pl_usd가 없을 때)
        elif previous_close and current_price and shares > 0 and avg_cost > 0:
            # 어제 미실현 손익 = (전일 종가 - 평단가) × 보유수량
            yesterday_unrealized_pl = (previous_close - avg_cost) * shares
            
            # 오늘 미실현 손익 = (현재가 - 평단가) × 보유수량
            today_unrealized_pl = (current_price - avg_cost) * shares
            
            # 변화량
            day_change = today_unrealized_pl - yesterday_unrealized_pl
            logger.debug(f"[ACCOUNT_SUMMARY] {ticker}: QUOTE API (어제: ${yesterday_unrealized_pl:.2f}, 오늘: ${today_unrealized_pl:.2f}) = ${day_change:.2f}")
        else:
            day_change = None
            # 상세 진단 로그
            snapshot_info = f"스냅샷({'O' if yesterday_snapshot else 'X'}"
            if yesterday_snapshot:
                snapshot_info += f", pl_usd: {yesterday_snapshot.unrealized_pl_usd})"
            else:
                snapshot_info += ")"
            quote_info = f"pc:{previous_close}, cp:{current_price}, s:{shares}, ac:{avg_cost}"
            logger.debug(f"[ACCOUNT_SUMMARY] {ticker}: 계산불가 ({snapshot_info}, {quote_info})")
        
        position['day_change_pl_usd'] = day_change
    
    # 실현 손익
    total_realized_pl_usd = engine.get_total_realized_pl()
    
    # 총 손익
    total_pl_usd = total_unrealized_pl_usd + total_realized_pl_usd
    
    # 미실현 손익률
    total_unrealized_pl_percent = (total_unrealized_pl_usd / total_cost_usd * 100) if total_cost_usd > 0 else 0.0
    
    # 활성 포지션 수
    active_positions_count = len([p for p in positions if p['shares'] > 0])
    
    # 현금 잔액
    total_cash_usd = crud.get_cash_balance(db, account_id)
    
    # 전일 대비 변화량 계산
    # 포지션별 미실현 손익 변화량 합산 (일관성 유지)
    total_position_day_change = 0.0
    for position in positions:
        if position.get('day_change_pl_usd') is not None:
            total_position_day_change += position['day_change_pl_usd']
    
    day_change_pl_usd = None
    yesterday_snapshot = anchor_summary_snapshot
    
    # 스냅샷이 있으면 실현손익 변화량도 계산하여 추가
    if yesterday_snapshot and yesterday_snapshot.total_pl_usd is not None:
        # 미실현 손익 변화량 (포지션별 합산)
        unrealized_day_change = total_position_day_change
        
        # 실현 손익 변화량 (스냅샷 기반)
        realized_day_change = total_realized_pl_usd - (yesterday_snapshot.total_realized_pl_usd or 0.0)
        
        # 총 변화량 = 미실현 변화 + 실현 변화
        day_change_pl_usd = unrealized_day_change + realized_day_change
        
        logger.debug(f"[ACCOUNT_SUMMARY] Account {account_id} Total P&L day_change: UNREALIZED=${unrealized_day_change:.2f}, REALIZED=${realized_day_change:.2f}, TOTAL=${day_change_pl_usd:.2f}")
    
    # 스냅샷 없거나 total_pl_usd가 없으면 포지션별 day_change 합산만 사용 (미실현 변화만)
    if day_change_pl_usd is None:
        if total_position_day_change != 0.0 or len([p for p in positions if p.get('day_change_pl_usd') is not None]) > 0:
            day_change_pl_usd = total_position_day_change
            logger.debug(f"[ACCOUNT_SUMMARY] Account {account_id} Total P&L day_change: POSITIONS SUM (미실현만) = ${day_change_pl_usd:.2f}")
    
    # 계정 통화 인식: base_currency == 'KRW'면 위 native 값들은 KRW. USD면 USD.
    # _usd / _krw 필드 양쪽을 정확한 환산값으로 채움.
    account_obj = crud.get_account(db, account_id)
    base_cur = getattr(account_obj, 'base_currency', 'USD') or 'USD'
    rate = fx_rate if fx_rate and fx_rate > 0 else 1.0

    def _to_pair(native: float) -> tuple[float, float]:
        """native 금액을 (usd, krw) 쌍으로 환산. base_cur 기준."""
        if base_cur == 'KRW':
            return (native / rate, native)
        return (native, native * rate)

    mv_usd, mv_krw = _to_pair(total_market_value_usd)
    upl_usd, upl_krw = _to_pair(total_unrealized_pl_usd)
    rpl_usd, rpl_krw = _to_pair(total_realized_pl_usd)
    tpl_usd, tpl_krw = _to_pair(total_pl_usd)
    cash_usd, cash_krw = _to_pair(total_cash_usd)
    # cost는 프론트에서 사용 빈도 낮아 USD 환산본만 필드 유지
    cost_usd = total_cost_usd / rate if base_cur == 'KRW' else total_cost_usd

    return schemas.AccountSummary(
        account_id=account_id,
        account_name=account_name,
        total_market_value_usd=mv_usd,
        total_market_value_krw=mv_krw,
        total_unrealized_pl_usd=upl_usd,
        total_unrealized_pl_krw=upl_krw,
        total_unrealized_pl_percent=total_unrealized_pl_percent,
        total_realized_pl_usd=rpl_usd,
        total_realized_pl_krw=rpl_krw,
        total_pl_usd=tpl_usd,
        total_pl_krw=tpl_krw,
        total_cost_usd=cost_usd,
        total_cash_usd=cash_usd,
        total_cash_krw=cash_krw,
        positions_count=len(positions),
        active_positions_count=active_positions_count,
        day_change_pl_usd=day_change_pl_usd if base_cur == 'USD' else (day_change_pl_usd / rate if day_change_pl_usd is not None else None)
    )

