from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Boolean, Text, JSON, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class Account(Base):
    """계정 테이블"""
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    base_currency = Column(String(3), nullable=False, default="USD")
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # 관계 정의
    trades = relationship("Trade", back_populates="account", cascade="all, delete-orphan")
    cash_transactions = relationship("Cash", back_populates="account", cascade="all, delete-orphan")
    realized_pls = relationship("RealizedPL", back_populates="account", cascade="all, delete-orphan")


class Trade(Base):
    """거래 내역 테이블"""
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    side = Column(String(10), nullable=False)  # BUY or SELL
    shares = Column(Float, nullable=False)
    price_usd = Column(Float, nullable=False)
    trade_date = Column(Date, nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # 관계 정의
    account = relationship("Account", back_populates="trades")

    __table_args__ = (
        Index("idx_trade_account_ticker", "account_id", "ticker"),
        Index("idx_trade_account_date",   "account_id", "trade_date"),
    )


class RealizedPL(Base):
    """실현 손익 테이블"""
    __tablename__ = "realized_pl"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    trade_id_sell_ref = Column(Integer, nullable=False)
    shares = Column(Float, nullable=False)
    pl_usd = Column(Float, nullable=False)
    pl_per_share_usd = Column(Float, nullable=False)
    matched_lots_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    # 관계 정의
    account = relationship("Account", back_populates="realized_pls")


class FXRateCache(Base):
    """환율 캐시 테이블"""
    __tablename__ = "fx_rates_cache"

    id = Column(Integer, primary_key=True, index=True)
    base = Column(String(3), nullable=False)
    quote = Column(String(3), nullable=False)
    rate = Column(Float, nullable=False)
    as_of = Column(Date, nullable=False)
    updated_at = Column(DateTime, server_default=func.now())


class Settings(Base):
    """설정 테이블"""
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(50), unique=True, nullable=False)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PriceCache(Base):
    """주가 캐시 테이블"""
    __tablename__ = "price_cache"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False, unique=True, index=True)
    price_usd = Column(Float, nullable=False)
    as_of = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, server_default=func.now())


class Cash(Base):
    """현금 내역 테이블"""
    __tablename__ = "cash"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    amount_usd = Column(Float, nullable=False)
    transaction_type = Column(String(20), nullable=False)  # DEPOSIT, WITHDRAW, BUY, SELL, DIVIDEND
    related_trade_id = Column(Integer, nullable=True)  # 거래와 연결된 경우
    related_dividend_id = Column(Integer, nullable=True)  # 배당금과 연결된 경우
    transaction_date = Column(Date, nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # 관계 정의
    account = relationship("Account", back_populates="cash_transactions")

    __table_args__ = (
        Index("idx_cash_account_date", "account_id", "transaction_date"),
    )


class DailySnapshot(Base):
    """일일 포트폴리오 스냅샷 테이블"""
    __tablename__ = "daily_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    account_id = Column(Integer, nullable=True, index=True)  # NULL이면 전체 계정
    ticker = Column(String(20), nullable=True, index=True)  # NULL이면 전체 합계
    
    # 포지션 정보
    shares = Column(Float, nullable=True)
    avg_cost_usd = Column(Float, nullable=True)
    market_price_usd = Column(Float, nullable=True)
    market_value_usd = Column(Float, nullable=True)
    unrealized_pl_usd = Column(Float, nullable=True)
    unrealized_pl_percent = Column(Float, nullable=True)
    
    # 전체 요약 정보
    total_market_value_usd = Column(Float, nullable=True)
    total_unrealized_pl_usd = Column(Float, nullable=True)
    total_realized_pl_usd = Column(Float, nullable=True)
    total_pl_usd = Column(Float, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_snapshot_account_date", "account_id", "snapshot_date"),
    )


class Dividend(Base):
    """배당금 테이블"""
    __tablename__ = "dividends"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    amount_usd = Column(Float, nullable=False)  # 배당금 (USD) - 세후 총 배당금
    dividend_date = Column(Date, nullable=False, index=True)  # 배당 지급일
    note = Column(Text, nullable=True)
    is_auto_imported = Column(Boolean, default=False)  # yfinance로 자동 가져온 것인지
    
    # 자동 가져오기 시 추가 정보 (선택적)
    amount_per_share = Column(Float, nullable=True)  # 주당 배당금
    shares_held = Column(Float, nullable=True)  # 배당 시점 보유 수량
    tax_withheld_usd = Column(Float, nullable=True)  # 원천징수 세금 (15%)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # 관계 정의
    account = relationship("Account", backref="dividends")


class StockSplit(Base):
    """주식 분할/병합 테이블"""
    __tablename__ = "stock_splits"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    split_date = Column(Date, nullable=False, index=True)
    ratio_from = Column(Float, nullable=False)  # 분할 전 비율 (예: 1)
    ratio_to = Column(Float, nullable=False)  # 분할 후 비율 (예: 10)
    split_type = Column(String(20), nullable=False)  # "SPLIT" 또는 "REVERSE_SPLIT"
    note = Column(Text, nullable=True)
    applied_at = Column(DateTime, nullable=True)  # 적용 일시
    trades_affected = Column(Integer, nullable=True)  # 영향받은 거래 수
    accounts_affected = Column(Integer, nullable=True)  # 영향받은 계정 수
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
