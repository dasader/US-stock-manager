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
    
    trades_by_ticker = {t['ticker']: t for t in trades}
    account_currency_map: dict = {}

    price_data = price_aggregator.get_prices_for_positions(positions)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)

    for position in positions:
        ticker = position['ticker']

        matching_trade = trades_by_ticker.get(ticker)
        position['account_id'] = matching_trade['account_id'] if matching_trade else (account_id or 0)

        acc_id = position['account_id']
        if acc_id not in account_currency_map:
            acc = crud.get_account(db, acc_id)
            account_currency_map[acc_id] = acc.base_currency if acc else "USD"
        position['currency'] = account_currency_map[acc_id]

        if position['currency'] == 'KRW':
            info = stock_info_service.get_stock_info(ticker)
            long_name = info.get('longName') if info else None
            position['longName'] = long_name if long_name and '\n' not in long_name else None

        # day_change: (현재가 - 전일 정규장 종가) × 수량 — Yahoo Finance 동일 기준
        previous_close = position.get('previous_close_price')
        current_price = position.get('market_price_usd')
        shares = position.get('shares', 0)
        if previous_close and current_price and shares > 0:
            position['day_change_pl_usd'] = (current_price - previous_close) * shares
            position['day_change_pl_percent'] = ((current_price - previous_close) / previous_close) * 100
            logger.debug(f"[DAY_CHANGE] {ticker}: (${current_price:.2f} - ${previous_close:.2f}) × {shares} = ${position['day_change_pl_usd']:.2f}")
        else:
            position['day_change_pl_usd'] = None
            position['day_change_pl_percent'] = None
            logger.debug(f"[DAY_CHANGE] {ticker}: 계산불가 (pc:{previous_close}, cp:{current_price}, s:{shares})")

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

