"""
포지션 관련 API 엔드포인트
"""
import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas
from ..database import get_db
from ..services.position_engine import PositionEngine
from ..services.price_service import price_service
from ..services.background_price_service import background_price_service
from ..services.price_aggregator import price_aggregator
from ..services.stock_info_service import stock_info_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/positions", tags=["positions"])


@router.get("/", response_model=List[schemas.Position])
def get_positions(
    account_id: Optional[int] = None,
    include_closed: bool = Query(False, description="전량 매도된 포지션 포함 여부"),
    db: Session = Depends(get_db)
):
    """포지션 목록 조회"""
    # 거래 조회 (계정별 필터링 가능)
    trades = crud.get_all_trades_for_calculation(db, account_id)
    
    # 포지션 엔진으로 계산
    engine = PositionEngine()
    engine.process_trades(trades)
    
    # 포지션 목록 가져오기
    positions = engine.get_all_positions(include_closed=include_closed)
    
    # 계정별 통화 매핑 (account_id → base_currency)
    account_currency_map: dict = {}

    # 각 포지션에 account_id 추가
    for position in positions:
        # 해당 ticker의 첫 번째 거래에서 account_id 가져오기
        matching_trade = next((t for t in trades if t['ticker'] == position['ticker']), None)
        if matching_trade:
            position['account_id'] = matching_trade['account_id']
        else:
            position['account_id'] = account_id or 0

        # currency 필드: account_id별 base_currency 조회 (캐시)
        acc_id = position['account_id']
        if acc_id not in account_currency_map:
            acc = crud.get_account(db, acc_id)
            account_currency_map[acc_id] = acc.base_currency if acc else "USD"
        position['currency'] = account_currency_map[acc_id]

        # KRX 종목은 longName(한국어명) 추가 (24h 캐시)
        if position['currency'] == 'KRW':
            info = stock_info_service.get_stock_info(position['ticker'])
            long_name = info.get('longName') if info else None
            position['longName'] = long_name if long_name and '\n' not in long_name else None
    
    # 현재가 추가 (공통 서비스 사용)
    price_data = price_aggregator.get_prices_for_positions(positions)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)
    
    # 티커별 전일 대비 변화량 계산
    # 동일한 스냅샷 날짜를 기준으로 계산하기 위해 앵커 스냅샷 날짜를 먼저 결정
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
            logger.debug(f"[DAY_CHANGE] {ticker}: SNAPSHOT (현재: ${current_unrealized_pl:.2f}, 스냅샷: ${yesterday_snapshot.unrealized_pl_usd:.2f}) = ${day_change:.2f}")
        
        # 방법 2: Quote API의 전일 종가 기반 (스냅샷 없거나 스냅샷의 unrealized_pl_usd가 없을 때)
        elif previous_close and current_price and shares > 0 and avg_cost > 0:
            # 어제 미실현 손익 = (전일 종가 - 평단가) × 보유수량
            yesterday_unrealized_pl = (previous_close - avg_cost) * shares
            
            # 오늘 미실현 손익 = (현재가 - 평단가) × 보유수량
            today_unrealized_pl = (current_price - avg_cost) * shares
            
            # 변화량
            day_change = today_unrealized_pl - yesterday_unrealized_pl
            logger.debug(f"[DAY_CHANGE] {ticker}: QUOTE API (어제: ${yesterday_unrealized_pl:.2f}, 오늘: ${today_unrealized_pl:.2f}) = ${day_change:.2f}")
        else:
            day_change = None
            # 상세 진단 로그
            snapshot_info = f"스냅샷({'O' if yesterday_snapshot else 'X'}"
            if yesterday_snapshot:
                snapshot_info += f", pl_usd: {yesterday_snapshot.unrealized_pl_usd})"
            else:
                snapshot_info += ")"
            quote_info = f"pc:{previous_close}, cp:{current_price}, s:{shares}, ac:{avg_cost}"
            logger.debug(f"[DAY_CHANGE] {ticker}: 계산불가 ({snapshot_info}, {quote_info})")
        
        position['day_change_pl_usd'] = day_change
        
        # 전일 대비 변화율 계산 (가격 기준: (현재가 - 전일종가) / 전일종가 * 100)
        previous_close = position.get('previous_close_price')
        current_price = position.get('market_price_usd')
        if previous_close and current_price and previous_close > 0:
            position['day_change_pl_percent'] = ((current_price - previous_close) / previous_close) * 100
        else:
            position['day_change_pl_percent'] = None
    
    return positions


@router.get("/{ticker}", response_model=schemas.Position, include_in_schema=True)
@router.get("/{ticker}/", response_model=schemas.Position, include_in_schema=False)
def get_position(ticker: str, account_id: Optional[int] = None, db: Session = Depends(get_db)):
    """특정 종목 포지션 조회"""
    from fastapi import HTTPException
    
    trades = crud.get_all_trades_for_calculation(db, account_id)
    
    engine = PositionEngine()
    engine.process_trades(trades)
    
    position = engine.get_position(ticker)
    if not position:
        raise HTTPException(status_code=404, detail="포지션을 찾을 수 없습니다.")
    
    position_dict = position.to_dict()
    
    # 현재가 추가
    price_data = price_service.get_price(ticker)
    if price_data:
        position_dict['market_price_usd'] = price_data['price_usd']
        position_dict['market_value_usd'] = position.total_shares * price_data['price_usd']
        unrealized_pl, unrealized_pl_percent = position.get_unrealized_pl(price_data['price_usd'])
        position_dict['unrealized_pl_usd'] = unrealized_pl
        position_dict['unrealized_pl_percent'] = unrealized_pl_percent
        position_dict['last_updated'] = price_data['as_of']
    
    return position_dict


@router.get("/realized/list/", response_model=List[schemas.RealizedPLResponse])
def get_realized_pl_list(
    account_id: Optional[int] = None,
    ticker: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """실현 손익 목록 조회"""
    return crud.get_realized_pl_list(db, account_id, ticker)


@router.post("/recalculate/")
def recalculate_positions(db: Session = Depends(get_db)):
    """포지션 재계산 (실현 손익 DB 갱신)"""
    # 기존 실현 손익 삭제
    crud.clear_realized_pl(db)
    
    # 모든 거래 조회
    trades = crud.get_all_trades_for_calculation(db)
    
    # 포지션 엔진으로 계산
    engine = PositionEngine()
    engine.process_trades(trades)
    
    # 실현 손익 저장
    realized_pl_list = engine.get_all_realized_pl_history()
    for realized in realized_pl_list:
        crud.save_realized_pl(db, realized)
    
    return {
        "message": "포지션이 재계산되었습니다.",
        "realized_count": len(realized_pl_list)
    }

