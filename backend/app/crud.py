"""
데이터베이스 CRUD 작업
"""
import logging
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import List, Optional, Dict, Any
from datetime import date, datetime
from . import models, schemas
from .services.position_engine import PositionEngine
from .services.dividend_service import dividend_service

logger = logging.getLogger(__name__)


# Account CRUD operations
def create_account(db: Session, account: schemas.AccountCreate) -> models.Account:
    """계정 생성"""
    db_account = models.Account(**account.model_dump())
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


def get_account(db: Session, account_id: int) -> Optional[models.Account]:
    """계정 조회"""
    return db.query(models.Account).filter(models.Account.id == account_id).first()


def get_account_by_name(db: Session, name: str) -> Optional[models.Account]:
    """이름으로 계정 조회"""
    return db.query(models.Account).filter(models.Account.name == name).first()


def get_accounts(
    db: Session, 
    is_active: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100
) -> List[models.Account]:
    """계정 목록 조회"""
    query = db.query(models.Account)
    
    if is_active is not None:
        query = query.filter(models.Account.is_active == is_active)
    
    return query.order_by(models.Account.name).offset(skip).limit(limit).all()


def update_account(db: Session, account_id: int, account_update: schemas.AccountUpdate) -> Optional[models.Account]:
    """계정 수정"""
    db_account = get_account(db, account_id)
    if not db_account:
        return None
    
    # 기본 계정(ID 1)의 비활성화 방지
    if account_id == 1 and account_update.is_active is False:
        raise ValueError("기본 계정은 비활성화할 수 없습니다.")
    
    update_data = account_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_account, key, value)
    
    # updated_at 필드를 명시적으로 업데이트
    db_account.updated_at = datetime.now()
    
    db.commit()
    db.refresh(db_account)
    return db_account


def delete_account(db: Session, account_id: int) -> bool:
    """계정 삭제"""
    db_account = get_account(db, account_id)
    if not db_account:
        return False
    
    # 기본 계정(ID 1) 삭제 방지
    if account_id == 1:
        raise ValueError("기본 계정은 삭제할 수 없습니다.")
    
    # 연결된 거래가 있는지 확인
    trades_count = db.query(models.Trade).filter(models.Trade.account_id == account_id).count()
    if trades_count > 0:
        raise ValueError(f"이 계정에는 {trades_count}건의 거래 내역이 있어 삭제할 수 없습니다. 먼저 거래 내역을 삭제하거나 다른 계정으로 이동시켜주세요.")
    
    # 연결된 현금 거래가 있는지 확인
    cash_count = db.query(models.Cash).filter(models.Cash.account_id == account_id).count()
    if cash_count > 0:
        raise ValueError(f"이 계정에는 {cash_count}건의 현금 거래가 있어 삭제할 수 없습니다.")
    
    db.delete(db_account)
    db.commit()
    return True


# Trade CRUD operations
def create_trade(
    db: Session,
    trade: schemas.TradeCreate,
    commit: bool = True
) -> models.Trade:
    """거래 생성"""
    db_trade = models.Trade(**trade.model_dump())
    db.add(db_trade)
    if commit:
        db.commit()
        db.refresh(db_trade)
    else:
        db.flush()
    return db_trade


def get_trade(db: Session, trade_id: int) -> Optional[models.Trade]:
    """거래 조회"""
    return db.query(models.Trade).filter(models.Trade.id == trade_id).first()


def get_trades(
    db: Session,
    account_id: Optional[int] = None,
    ticker: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    side: Optional[str] = None,
    skip: int = 0,
    limit: int = 50
) -> List[models.Trade]:
    """거래 목록 조회"""
    query = db.query(models.Trade)
    
    if account_id:
        query = query.filter(models.Trade.account_id == account_id)
    if ticker:
        query = query.filter(models.Trade.ticker == ticker.upper())
    if start_date:
        query = query.filter(models.Trade.trade_date >= start_date)
    if end_date:
        query = query.filter(models.Trade.trade_date <= end_date)
    if side:
        query = query.filter(models.Trade.side == side.upper())
    
    return query.order_by(models.Trade.trade_date.desc(), models.Trade.id.desc()).offset(skip).limit(limit).all()


def update_trade(
    db: Session,
    trade_id: int,
    trade_update: schemas.TradeUpdate,
    commit: bool = True
) -> Optional[models.Trade]:
    """거래 수정"""
    db_trade = get_trade(db, trade_id)
    if not db_trade:
        return None
    
    update_data = trade_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_trade, key, value)
    
    # updated_at 필드를 명시적으로 업데이트
    db_trade.updated_at = datetime.now()
    
    if commit:
        db.commit()
        db.refresh(db_trade)
    else:
        db.flush()
    return db_trade


def delete_trade(db: Session, trade_id: int) -> bool:
    """거래 삭제"""
    db_trade = get_trade(db, trade_id)
    if not db_trade:
        return False
    
    db.delete(db_trade)
    db.commit()
    return True


def get_all_trades_for_calculation(db: Session, account_id: Optional[int] = None) -> List[dict]:
    """포지션 계산용 거래 조회"""
    query = db.query(models.Trade)
    
    if account_id:
        query = query.filter(models.Trade.account_id == account_id)
    
    trades = query.order_by(models.Trade.trade_date, models.Trade.id).all()
    return [
        {
            "id": t.id,
            "account_id": t.account_id,
            "ticker": t.ticker,
            "side": t.side,
            "shares": t.shares,
            "price_usd": t.price_usd,
            "trade_date": t.trade_date,
            "note": t.note
        }
        for t in trades
    ]


def save_realized_pl(db: Session, realized_pl_data: dict) -> models.RealizedPL:
    """실현 손익 저장"""
    db_realized = models.RealizedPL(
        account_id=realized_pl_data['account_id'],
        ticker=realized_pl_data['ticker'],
        trade_id_sell_ref=realized_pl_data['trade_id_sell_ref'],
        shares=realized_pl_data['shares'],
        pl_usd=realized_pl_data['pl_usd'],
        pl_per_share_usd=realized_pl_data['pl_per_share_usd'],
        matched_lots_json=realized_pl_data.get('matched_lots', [])
    )
    db.add(db_realized)
    db.commit()
    db.refresh(db_realized)
    return db_realized


def get_realized_pl_list(db: Session, account_id: Optional[int] = None, ticker: Optional[str] = None) -> List[models.RealizedPL]:
    """실현 손익 목록 조회"""
    query = db.query(models.RealizedPL)
    if account_id:
        query = query.filter(models.RealizedPL.account_id == account_id)
    if ticker:
        query = query.filter(models.RealizedPL.ticker == ticker.upper())
    return query.order_by(models.RealizedPL.created_at.desc()).all()


def clear_realized_pl(db: Session):
    """실현 손익 데이터 초기화 (재계산용)"""
    db.query(models.RealizedPL).delete()
    db.commit()


def get_or_create_fx_cache(db: Session, base: str, quote: str, rate: float, as_of: date) -> models.FXRateCache:
    """환율 캐시 조회 또는 생성"""
    cache = db.query(models.FXRateCache).filter(
        and_(
            models.FXRateCache.base == base,
            models.FXRateCache.quote == quote,
            models.FXRateCache.as_of == as_of
        )
    ).first()
    
    if cache:
        cache.rate = rate
        cache.updated_at = datetime.now()
    else:
        cache = models.FXRateCache(base=base, quote=quote, rate=rate, as_of=as_of)
        db.add(cache)
    
    db.commit()
    db.refresh(cache)
    return cache


def get_or_create_price_cache(db: Session, ticker: str, price_usd: float, as_of: datetime) -> models.PriceCache:
    """주가 캐시 조회 또는 생성"""
    cache = db.query(models.PriceCache).filter(models.PriceCache.ticker == ticker.upper()).first()
    
    if cache:
        cache.price_usd = price_usd
        cache.as_of = as_of
        cache.updated_at = datetime.now()
    else:
        cache = models.PriceCache(ticker=ticker.upper(), price_usd=price_usd, as_of=as_of)
        db.add(cache)
    
    db.commit()
    db.refresh(cache)
    return cache


# Cash CRUD operations
def create_cash(
    db: Session, 
    cash: schemas.CashCreate, 
    related_trade_id: Optional[int] = None,
    related_dividend_id: Optional[int] = None,
    commit: bool = True
) -> models.Cash:
    """현금 거래 생성"""
    db_cash = models.Cash(
        **cash.model_dump(),
        related_trade_id=related_trade_id,
        related_dividend_id=related_dividend_id
    )
    db.add(db_cash)
    if commit:
        db.commit()
        db.refresh(db_cash)
    else:
        db.flush()
    return db_cash


def get_cash(db: Session, cash_id: int) -> Optional[models.Cash]:
    """현금 거래 조회"""
    return db.query(models.Cash).filter(models.Cash.id == cash_id).first()


def get_cash_list(
    db: Session,
    account_id: Optional[int] = None,
    transaction_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 50
) -> List[models.Cash]:
    """현금 거래 목록 조회"""
    query = db.query(models.Cash)
    
    if account_id:
        query = query.filter(models.Cash.account_id == account_id)
    if transaction_type:
        query = query.filter(models.Cash.transaction_type == transaction_type.upper())
    if start_date:
        query = query.filter(models.Cash.transaction_date >= start_date)
    if end_date:
        query = query.filter(models.Cash.transaction_date <= end_date)
    
    return query.order_by(models.Cash.transaction_date.desc(), models.Cash.id.desc()).offset(skip).limit(limit).all()


def update_cash(db: Session, cash_id: int, cash_update: schemas.CashUpdate) -> Optional[models.Cash]:
    """현금 거래 수정"""
    db_cash = get_cash(db, cash_id)
    if not db_cash:
        return None
    
    update_data = cash_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_cash, key, value)
    
    # updated_at 필드를 명시적으로 업데이트
    db_cash.updated_at = datetime.now()
    
    db.commit()
    db.refresh(db_cash)
    return db_cash


def delete_cash(db: Session, cash_id: int) -> bool:
    """현금 거래 삭제"""
    db_cash = get_cash(db, cash_id)
    if not db_cash:
        return False
    
    db.delete(db_cash)
    db.commit()
    return True


def get_cash_balance(db: Session, account_id: Optional[int] = None, fx_rate_krw: float = 1350.0) -> float:
    """현재 현금 잔액 계산 — USD 환산 기준.
    KRW 계정(base_currency='KRW')의 amount_usd는 실제 KRW 금액이므로 fx_rate_krw로 나눠 USD 변환."""
    query = db.query(models.Cash, models.Account.base_currency).join(
        models.Account, models.Cash.account_id == models.Account.id
    )

    if account_id:
        query = query.filter(models.Cash.account_id == account_id)

    total = 0.0
    for cash, base_currency in query.all():
        amount = cash.amount_usd
        if base_currency == 'KRW' and fx_rate_krw > 0:
            amount = amount / fx_rate_krw

        if cash.transaction_type in ('DEPOSIT', 'SELL', 'DIVIDEND'):
            total += amount
        elif cash.transaction_type in ('WITHDRAW', 'BUY'):
            total -= amount

    return total


def delete_trades_bulk(db: Session, trade_ids: List[int]) -> int:
    """거래 일괄 삭제"""
    deleted_count = db.query(models.Trade).filter(models.Trade.id.in_(trade_ids)).delete(synchronize_session=False)
    db.commit()
    return deleted_count


def get_existing_trade_hashes(db: Session) -> set:
    """기존 거래의 해시셋을 반환 (중복 확인용)"""
    trades = db.query(models.Trade).all()
    trade_hashes = set()
    
    for trade in trades:
        trade_hash = f"{trade.account_id}_{trade.ticker}_{trade.side}_{trade.shares}_{trade.price_usd}_{trade.trade_date.isoformat()}"
        trade_hashes.add(trade_hash)
    
    return trade_hashes


# DailySnapshot CRUD operations
def create_snapshot(db: Session, snapshot: schemas.DailySnapshotCreate) -> models.DailySnapshot:
    """일일 스냅샷 생성"""
    db_snapshot = models.DailySnapshot(**snapshot.model_dump())
    db.add(db_snapshot)
    db.commit()
    db.refresh(db_snapshot)
    return db_snapshot


def get_latest_snapshot(
    db: Session,
    account_id: Optional[int] = None,
    ticker: Optional[str] = None
) -> Optional[models.DailySnapshot]:
    """최신 스냅샷 조회"""
    query = db.query(models.DailySnapshot)
    
    # account_id와 ticker 조건 처리
    if account_id is None:
        query = query.filter(models.DailySnapshot.account_id.is_(None))
    else:
        query = query.filter(models.DailySnapshot.account_id == account_id)
    
    if ticker is None:
        query = query.filter(models.DailySnapshot.ticker.is_(None))
    else:
        query = query.filter(models.DailySnapshot.ticker == ticker)
    
    return query.order_by(models.DailySnapshot.snapshot_date.desc()).first()


def get_snapshot_by_date(
    db: Session,
    snapshot_date: date,
    account_id: Optional[int] = None,
    ticker: Optional[str] = None
) -> Optional[models.DailySnapshot]:
    """특정 날짜의 스냅샷 조회"""
    query = db.query(models.DailySnapshot).filter(
        models.DailySnapshot.snapshot_date == snapshot_date
    )
    
    if account_id is None:
        query = query.filter(models.DailySnapshot.account_id.is_(None))
    else:
        query = query.filter(models.DailySnapshot.account_id == account_id)
    
    if ticker is None:
        query = query.filter(models.DailySnapshot.ticker.is_(None))
    else:
        query = query.filter(models.DailySnapshot.ticker == ticker)
    
    return query.first()


def get_snapshots_by_date(db: Session, snapshot_date: date) -> List[models.DailySnapshot]:
    """특정 날짜의 모든 스냅샷 조회"""
    return db.query(models.DailySnapshot).filter(
        models.DailySnapshot.snapshot_date == snapshot_date
    ).all()


def delete_snapshots_by_date(db: Session, snapshot_date: date) -> int:
    """특정 날짜의 모든 스냅샷 삭제"""
    deleted = db.query(models.DailySnapshot).filter(
        models.DailySnapshot.snapshot_date == snapshot_date
    ).delete(synchronize_session=False)
    db.commit()
    return deleted


def get_snapshots_by_date_range(
    db: Session,
    start_date: date,
    end_date: date,
    account_id: Optional[int] = None,
    ticker: Optional[str] = None
) -> List[models.DailySnapshot]:
    """날짜 범위의 스냅샷 조회 (그래프용)"""
    query = db.query(models.DailySnapshot).filter(
        and_(
            models.DailySnapshot.snapshot_date >= start_date,
            models.DailySnapshot.snapshot_date <= end_date
        )
    )
    
    # account_id 조건 처리
    if account_id is None:
        query = query.filter(models.DailySnapshot.account_id.is_(None))
    else:
        query = query.filter(models.DailySnapshot.account_id == account_id)
    
    # ticker 조건 처리
    if ticker is None:
        query = query.filter(models.DailySnapshot.ticker.is_(None))
    else:
        query = query.filter(models.DailySnapshot.ticker == ticker)
    
    # total_market_value_usd가 있는 요약 스냅샷만 조회
    query = query.filter(models.DailySnapshot.total_market_value_usd.isnot(None))
    
    return query.order_by(models.DailySnapshot.snapshot_date.asc()).all()


# Dividend CRUD operations
def create_dividend(db: Session, dividend: schemas.DividendCreate, is_auto_imported: bool = False) -> models.Dividend:
    """배당금 생성"""
    db_dividend = models.Dividend(
        **dividend.model_dump(),
        is_auto_imported=is_auto_imported
    )
    db.add(db_dividend)
    db.commit()
    db.refresh(db_dividend)
    return db_dividend


def get_dividend(db: Session, dividend_id: int) -> Optional[models.Dividend]:
    """배당금 조회"""
    return db.query(models.Dividend).filter(models.Dividend.id == dividend_id).first()


def get_dividends(
    db: Session,
    account_id: Optional[int] = None,
    ticker: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 100
) -> List[models.Dividend]:
    """배당금 목록 조회"""
    query = db.query(models.Dividend)
    
    if account_id is not None:
        query = query.filter(models.Dividend.account_id == account_id)
    
    if ticker is not None:
        query = query.filter(models.Dividend.ticker == ticker.upper())
    
    if start_date is not None:
        query = query.filter(models.Dividend.dividend_date >= start_date)
    
    if end_date is not None:
        query = query.filter(models.Dividend.dividend_date <= end_date)
    
    return query.order_by(models.Dividend.dividend_date.desc()).offset(skip).limit(limit).all()


def update_dividend(db: Session, dividend_id: int, dividend_update: schemas.DividendUpdate) -> Optional[models.Dividend]:
    """배당금 수정"""
    db_dividend = get_dividend(db, dividend_id)
    if not db_dividend:
        return None
    
    update_data = dividend_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_dividend, field, value)
    
    db.commit()
    db.refresh(db_dividend)
    return db_dividend


def delete_dividend(db: Session, dividend_id: int) -> bool:
    """배당금 삭제"""
    db_dividend = get_dividend(db, dividend_id)
    if not db_dividend:
        return False
    
    db.delete(db_dividend)
    db.commit()
    return True


def get_dividend_summary(db: Session, account_id: Optional[int] = None, year: Optional[int] = None) -> dict:
    """배당금 요약 조회"""
    query = db.query(
        func.sum(models.Dividend.amount_usd).label('total'),
        func.count(models.Dividend.id).label('count'),
        func.count(func.distinct(models.Dividend.ticker)).label('tickers_count')
    )

    if account_id is not None:
        query = query.filter(models.Dividend.account_id == account_id)

    if year is not None:
        query = query.filter(func.extract('year', models.Dividend.dividend_date) == year)

    result = query.first()

    return {
        'total_dividends_usd': result.total or 0.0,
        'dividend_count': result.count or 0,
        'tickers_with_dividends': result.tickers_count or 0
    }


def get_dividends_by_ticker(
    db: Session,
    account_id: Optional[int] = None,
    year: Optional[int] = None
) -> List[dict]:
    """티커별 배당금 집계"""
    query = db.query(
        models.Dividend.ticker,
        func.sum(models.Dividend.amount_usd).label('total_amount'),
        func.count(models.Dividend.id).label('count'),
        func.max(models.Dividend.dividend_date).label('latest_date')
    )

    if account_id is not None:
        query = query.filter(models.Dividend.account_id == account_id)

    if year is not None:
        query = query.filter(func.extract('year', models.Dividend.dividend_date) == year)

    query = query.group_by(models.Dividend.ticker).order_by(func.sum(models.Dividend.amount_usd).desc())

    results = query.all()

    return [
        {
            'ticker': r.ticker,
            'total_amount_usd': r.total_amount,
            'count': r.count,
            'latest_date': r.latest_date
        }
        for r in results
    ]


def check_dividend_exists(
    db: Session,
    account_id: int,
    ticker: str,
    dividend_date: date,
    amount_usd: float
) -> bool:
    """동일한 배당금이 이미 존재하는지 확인"""
    existing = db.query(models.Dividend).filter(
        and_(
            models.Dividend.account_id == account_id,
            models.Dividend.ticker == ticker.upper(),
            models.Dividend.dividend_date == dividend_date,
            models.Dividend.amount_usd == amount_usd
        )
    ).first()
    return existing is not None


def get_account_tickers_in_year(db: Session, account_id: int, year: int) -> List[str]:
    """특정 연도에 거래가 있었거나 연말 시점에 보유 중인 계정의 모든 티커 반환"""
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)

    # 1. 해당 연도에 거래가 있었던 티커들
    traded_tickers = db.query(models.Trade.ticker).filter(
        and_(
            models.Trade.account_id == account_id,
            models.Trade.trade_date >= start_date,
            models.Trade.trade_date <= end_date
        )
    ).distinct().all()

    # 2. 연말 시점에 보유 중인 티커들 (해당 연도 말까지의 모든 거래를 고려)
    # PositionEngine을 사용하여 연말 시점의 포지션 계산
    all_trades = get_all_trades_for_calculation(db, account_id)

    # 연말까지의 거래만 필터링
    year_end_trades = [
        t for t in all_trades
        if t["trade_date"] <= end_date
    ]

    if year_end_trades:
        engine = PositionEngine()
        engine.process_trades(year_end_trades)

        # 연말 시점에 보유 수량이 있는 모든 티커
        held_tickers = [
            ticker for ticker, position in engine.positions.items()
            if position and not position.is_closed() and position.total_shares > 0
        ]
    else:
        held_tickers = []

    # 중복 제거하여 합치기
    all_tickers = list(set([row[0] for row in traded_tickers] + held_tickers))
    return sorted(all_tickers)


def generate_dividend_preview(
    db: Session, account_id: int, ticker: str,
    start_date: date, end_date: date, dividend_cache: Optional[Dict[str, List]] = None
) -> Dict[str, Any]:
    """배당 데이터 미리보기 생성"""
    # 배당 데이터 조회 (캐시 우선 사용)
    if dividend_cache and ticker in dividend_cache:
        dividends = dividend_cache[ticker]
    else:
        try:
            dividends = dividend_service.get_dividend_history(ticker, start_date, end_date)
            # 캐시에 저장
            if dividend_cache is not None:
                dividend_cache[ticker] = dividends
        except Exception as e:
            # yfinance 조회 실패 시 빈 결과 반환 (미리보기는 계속 진행)
            logger.warning(f"[PREVIEW] {ticker} 배당 이력 조회 실패: {e}")
            dividends = []

    # 계정의 모든 거래 조회
    all_trades = get_all_trades_for_calculation(db, account_id)

    preview_dividends = []
    total_amount = 0.0
    existing_count = 0

    for div in dividends:
        div_date = div['date']
        amount_per_share = div['amount']

        # 배당락일 시점의 보유 수량 계산
        trades_until_div_date = [
            t for t in all_trades
            if t["trade_date"] <= div_date and t["ticker"] == ticker
        ]

        if not trades_until_div_date:
            continue

        # 포지션 계산
        engine = PositionEngine()
        engine.process_trades(trades_until_div_date)
        position = engine.get_position(ticker)

        if not position or position.is_closed() or position.total_shares <= 0:
            continue

        shares_held = position.total_shares
        gross_dividend = amount_per_share * shares_held
        tax_withheld = gross_dividend * 0.15
        net_dividend = gross_dividend - tax_withheld

        # 중복 확인
        is_existing = check_dividend_exists(
            db, account_id, ticker, div_date, net_dividend
        )

        if is_existing:
            existing_count += 1
            continue

        preview_dividends.append({
            'date': div_date.isoformat(),
            'amount_per_share': amount_per_share,
            'shares_held': shares_held,
            'gross_amount': gross_dividend,
            'tax_withheld': tax_withheld,
            'net_amount': net_dividend,
        })

        total_amount += net_dividend

    return {
        'ticker': ticker,
        'dividend_count': len(preview_dividends),
        'total_amount_usd': total_amount,
        'existing_count': existing_count,
        'dividends': preview_dividends,
    }


# Stock Split CRUD operations
def create_stock_split(db: Session, stock_split: schemas.StockSplitCreate) -> models.StockSplit:
    """주식 분할/병합 이벤트 생성"""
    # split_type 결정 (ratio_to/ratio_from > 1이면 분할, < 1이면 병합)
    split_type = "SPLIT" if stock_split.ratio_to / stock_split.ratio_from > 1 else "REVERSE_SPLIT"
    
    db_split = models.StockSplit(
        ticker=stock_split.ticker.upper(),
        split_date=stock_split.split_date,
        ratio_from=stock_split.ratio_from,
        ratio_to=stock_split.ratio_to,
        split_type=split_type,
        note=stock_split.note
    )
    db.add(db_split)
    db.commit()
    db.refresh(db_split)
    return db_split


def get_stock_split(db: Session, split_id: int) -> Optional[models.StockSplit]:
    """주식 분할/병합 조회"""
    return db.query(models.StockSplit).filter(models.StockSplit.id == split_id).first()


def get_stock_splits(
    db: Session,
    ticker: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
) -> List[models.StockSplit]:
    """주식 분할/병합 목록 조회"""
    query = db.query(models.StockSplit)
    
    if ticker:
        query = query.filter(models.StockSplit.ticker == ticker.upper())
    
    return query.order_by(models.StockSplit.split_date.desc(), models.StockSplit.created_at.desc()).offset(skip).limit(limit).all()


def get_stock_split_by_ticker_and_date(
    db: Session,
    ticker: str,
    split_date: date
) -> Optional[models.StockSplit]:
    """특정 티커와 날짜의 분할/병합 조회 (중복 확인용)"""
    return db.query(models.StockSplit).filter(
        and_(
            models.StockSplit.ticker == ticker.upper(),
            models.StockSplit.split_date == split_date
        )
    ).first()


def preview_stock_split(
    db: Session,
    ticker: str,
    split_date: date,
    ratio_from: float,
    ratio_to: float
) -> Dict[str, Any]:
    """주식 분할/병합 적용 전 미리보기"""
    ticker_upper = ticker.upper()
    
    # 분할/병합 날짜 이전의 모든 거래 조회 (모든 계정)
    trades = db.query(models.Trade).filter(
        and_(
            models.Trade.ticker == ticker_upper,
            models.Trade.trade_date < split_date
        )
    ).order_by(models.Trade.trade_date.desc(), models.Trade.id.desc()).all()
    
    if not trades:
        return {
            'ticker': ticker_upper,
            'split_date': split_date,
            'ratio_from': ratio_from,
            'ratio_to': ratio_to,
            'split_type': 'SPLIT' if ratio_to / ratio_from > 1 else 'REVERSE_SPLIT',
            'trades_count': 0,
            'accounts_count': 0,
            'accounts': [],
            'sample_trades': [],
            'warning': f'{ticker_upper}의 {split_date} 이전 거래가 없습니다.'
        }
    
    # 영향받을 계정 목록
    account_ids = set(t.account_id for t in trades)
    accounts = db.query(models.Account).filter(models.Account.id.in_(account_ids)).all()
    accounts_data = [
        {
            'id': acc.id,
            'name': acc.name,
            'trades_count': len([t for t in trades if t.account_id == acc.id])
        }
        for acc in accounts
    ]
    
    # 샘플 거래 (최대 10개)
    sample_trades = []
    for trade in trades[:10]:
        # 분할/병합 적용 후 값 계산
        if ratio_to / ratio_from > 1:  # 분할
            new_shares = trade.shares * (ratio_to / ratio_from)
            new_price = trade.price_usd * (ratio_from / ratio_to)
        else:  # 병합
            new_shares = trade.shares * (ratio_from / ratio_to)
            new_price = trade.price_usd * (ratio_to / ratio_from)
        
        sample_trades.append({
            'id': trade.id,
            'account_id': trade.account_id,
            'account_name': next((acc.name for acc in accounts if acc.id == trade.account_id), ''),
            'side': trade.side,
            'trade_date': trade.trade_date.isoformat(),
            'old_shares': trade.shares,
            'old_price_usd': trade.price_usd,
            'old_amount_usd': trade.shares * trade.price_usd,
            'new_shares': new_shares,
            'new_price_usd': new_price,
            'new_amount_usd': new_shares * new_price,
        })
    
    # 중복 확인
    existing_split = get_stock_split_by_ticker_and_date(db, ticker_upper, split_date)
    warning = None
    if existing_split:
        warning = f'이미 {split_date}에 {ticker_upper}의 분할/병합이 적용되어 있습니다. (ID: {existing_split.id})'
    
    split_type = 'SPLIT' if ratio_to / ratio_from > 1 else 'REVERSE_SPLIT'
    
    return {
        'ticker': ticker_upper,
        'split_date': split_date,
        'ratio_from': ratio_from,
        'ratio_to': ratio_to,
        'split_type': split_type,
        'trades_count': len(trades),
        'accounts_count': len(account_ids),
        'accounts': accounts_data,
        'sample_trades': sample_trades,
        'warning': warning
    }


def apply_stock_split(
    db: Session,
    split_id: int
) -> Dict[str, Any]:
    """주식 분할/병합 적용 (거래 기록 수정)"""
    from sqlalchemy import update
    
    # 분할/병합 이벤트 조회
    stock_split = get_stock_split(db, split_id)
    if not stock_split:
        raise ValueError(f"분할/병합 이벤트를 찾을 수 없습니다. (ID: {split_id})")
    
    if stock_split.applied_at is not None:
        raise ValueError(f"이미 적용된 분할/병합입니다. (적용일시: {stock_split.applied_at})")
    
    ticker_upper = stock_split.ticker.upper()
    split_date = stock_split.split_date
    ratio_from = stock_split.ratio_from
    ratio_to = stock_split.ratio_to
    
    # 분할/병합 비율 계산
    if ratio_to / ratio_from > 1:  # 분할
        shares_multiplier = ratio_to / ratio_from
        price_multiplier = ratio_from / ratio_to
    else:  # 병합
        shares_multiplier = ratio_from / ratio_to
        price_multiplier = ratio_to / ratio_from
    
    # 분할/병합 날짜 이전의 모든 거래 조회 (모든 계정)
    trades = db.query(models.Trade).filter(
        and_(
            models.Trade.ticker == ticker_upper,
            models.Trade.trade_date < split_date
        )
    ).all()
    
    if not trades:
        # 거래가 없어도 이벤트는 기록
        stock_split.applied_at = datetime.now()
        stock_split.trades_affected = 0
        stock_split.accounts_affected = 0
        stock_split.updated_at = datetime.now()
        db.commit()
        db.refresh(stock_split)
        return {
            'split_id': split_id,
            'trades_affected': 0,
            'accounts_affected': 0,
            'message': f'{ticker_upper}의 {split_date} 이전 거래가 없어 적용할 내용이 없습니다.'
        }
    
    # 영향받을 계정 수
    account_ids = set(t.account_id for t in trades)
    
    # 배치 처리 (1000건씩)
    BATCH_SIZE = 1000
    trades_affected = 0
    
    try:
        for i in range(0, len(trades), BATCH_SIZE):
            batch = trades[i:i + BATCH_SIZE]
            trade_ids = [t.id for t in batch]
            
            # 거래 수정 (배치 업데이트)
            for trade in batch:
                # 검증: 거래 금액이 동일한지 확인
                old_amount = trade.shares * trade.price_usd
                new_shares = trade.shares * shares_multiplier
                new_price = trade.price_usd * price_multiplier
                new_amount = new_shares * new_price
                
                # 부동소수점 오차 허용 (0.01 USD)
                if abs(old_amount - new_amount) > 0.01:
                    logger.warning(
                        f"거래 ID {trade.id}: 금액 불일치 (기존: ${old_amount:.2f}, 수정: ${new_amount:.2f})"
                    )
                
                # 거래 수정
                trade.shares = new_shares
                trade.price_usd = new_price
                trade.updated_at = datetime.now()
                trades_affected += 1
            
            # 배치마다 flush (메모리 절약)
            db.flush()
        
        # 분할/병합 이벤트 업데이트
        stock_split.applied_at = datetime.now()
        stock_split.trades_affected = trades_affected
        stock_split.accounts_affected = len(account_ids)
        stock_split.updated_at = datetime.now()
        
        # 모든 변경사항 커밋
        db.commit()
        db.refresh(stock_split)
        
        logger.info(
            f"분할/병합 적용 완료: {ticker_upper} ({split_date}), "
            f"거래 {trades_affected}건, 계정 {len(account_ids)}개"
        )
        
        return {
            'split_id': split_id,
            'trades_affected': trades_affected,
            'accounts_affected': len(account_ids),
            'message': f'{ticker_upper}의 분할/병합이 성공적으로 적용되었습니다.'
        }
        
    except Exception as e:
        # 오류 발생 시 롤백
        db.rollback()
        logger.error(f"분할/병합 적용 중 오류 발생: {e}", exc_info=True)
        raise ValueError(f"분할/병합 적용 중 오류가 발생했습니다: {str(e)}")



