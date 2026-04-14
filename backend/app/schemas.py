from pydantic import BaseModel, Field, field_validator
from datetime import date, datetime
from typing import Optional, List, Dict, Any
from decimal import Decimal


class AccountBase(BaseModel):
    """계정 기본 스키마"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    is_active: bool = True
    base_currency: str = Field(default="USD", pattern="^(USD|KRW)$")


class AccountCreate(AccountBase):
    """계정 생성"""
    pass


class AccountUpdate(BaseModel):
    """계정 수정"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    base_currency: Optional[str] = Field(None, pattern="^(USD|KRW)$")


class AccountResponse(AccountBase):
    """계정 응답"""
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AccountSummary(BaseModel):
    """계정별 요약 정보"""
    account_id: int
    account_name: str
    total_market_value_usd: float
    total_market_value_krw: float
    total_unrealized_pl_usd: float
    total_unrealized_pl_krw: float
    total_unrealized_pl_percent: float
    total_realized_pl_usd: float
    total_realized_pl_krw: float
    total_pl_usd: float
    total_pl_krw: float
    total_cost_usd: float
    total_cash_usd: float
    total_cash_krw: float
    positions_count: int
    active_positions_count: int
    day_change_pl_usd: Optional[float] = None  # 전일 대비 총손익 변화


class TradeBase(BaseModel):
    account_id: int = Field(..., gt=0)
    ticker: str = Field(..., min_length=1, max_length=20)
    side: str = Field(..., pattern="^(BUY|SELL)$")
    shares: float = Field(..., gt=0)
    price_usd: float = Field(..., gt=0)
    trade_date: date
    note: Optional[str] = None

    @field_validator("ticker")
    @classmethod
    def uppercase_ticker(cls, v: str) -> str:
        return v.upper().strip()


class TradeCreate(TradeBase):
    pass


class TradeUpdate(BaseModel):
    account_id: Optional[int] = None
    ticker: Optional[str] = None
    side: Optional[str] = None
    shares: Optional[float] = None
    price_usd: Optional[float] = None
    trade_date: Optional[date] = None
    note: Optional[str] = None


class TradeResponse(TradeBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Position(BaseModel):
    """포지션 정보"""
    account_id: int
    ticker: str
    shares: float
    avg_cost_usd: float
    market_price_usd: Optional[float] = None
    market_value_usd: Optional[float] = None
    unrealized_pl_usd: Optional[float] = None
    unrealized_pl_percent: Optional[float] = None
    total_cost_usd: float
    is_closed: bool = False
    last_updated: Optional[datetime] = None
    first_buy_date: Optional[date] = None
    holding_days: Optional[int] = None
    day_change_pl_usd: Optional[float] = None  # 전일 대비 손익 변화
    day_change_pl_percent: Optional[float] = None  # 전일 대비 손익 변화율 (%)
    previous_close_price: Optional[float] = None  # 전일 종가 (Finnhub Quote API)
    realized_pl_usd: Optional[float] = None  # 실현 손익
    currency: str = "USD"  # 계정 기준 통화 (USD 또는 KRW)


class RealizedPLResponse(BaseModel):
    """실현 손익 응답"""
    id: int
    account_id: int
    ticker: str
    trade_id_sell_ref: int
    shares: float
    pl_usd: float
    pl_per_share_usd: float
    matched_lots_json: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DashboardSummary(BaseModel):
    """대시보드 요약 (전체 계정)"""
    total_market_value_usd: float
    total_market_value_krw: float
    total_unrealized_pl_usd: float
    total_unrealized_pl_krw: float
    total_unrealized_pl_percent: float
    total_realized_pl_usd: float
    total_realized_pl_krw: float
    total_pl_usd: float
    total_pl_krw: float
    total_cost_usd: float
    total_cash_usd: float
    total_cash_krw: float
    total_deposits_usd: float  # 총입금
    total_deposits_krw: float
    total_withdrawals_usd: float  # 총출금
    total_withdrawals_krw: float
    net_investment_usd: float  # 순투자금액 (총입금 - 총출금)
    net_investment_krw: float
    fx_rate_usd_krw: float
    fx_rate_as_of: date
    positions_count: int
    active_positions_count: int
    accounts_summary: Optional[List['AccountSummary']] = None
    day_change_pl_usd: Optional[float] = None  # 전일 대비 총손익 변화
    total_dividends_usd: Optional[float] = None  # 총 배당금 (USD)
    total_dividends_krw: Optional[float] = None  # 총 배당금 (KRW)
    fear_greed_index: Optional['FearGreedIndexResponse'] = None  # Fear & Greed Index


class PriceResponse(BaseModel):
    """시세 응답"""
    ticker: str
    price_usd: float
    as_of: datetime
    cached: bool = False


class FXRateResponse(BaseModel):
    """환율 응답"""
    base: str
    quote: str
    rate: float
    as_of: date
    cached: bool = False


class FearGreedIndexResponse(BaseModel):
    """Fear & Greed Index 응답"""
    value: int  # 0-100
    classification: str  # Extreme Fear, Fear, Neutral, Greed, Extreme Greed
    timestamp: int  # Unix timestamp
    as_of: date
    cached: bool = False


class TickerValidationResponse(BaseModel):
    """티커 검증 응답"""
    ticker: str
    valid: bool
    name: Optional[str] = None
    exchange: Optional[str] = None
    message: Optional[str] = None


class CSVImportResponse(BaseModel):
    """CSV 임포트 응답"""
    success: int
    failed: int
    errors: List[str] = []
    created_accounts: List[str] = []  # 자동 생성된 계정 이름 목록


class CashBase(BaseModel):
    """현금 기본 스키마"""
    account_id: int = Field(..., gt=0)
    amount_usd: float
    transaction_type: str = Field(..., pattern="^(DEPOSIT|WITHDRAW|BUY|SELL|DIVIDEND)$")
    transaction_date: date
    note: Optional[str] = None


class CashCreate(CashBase):
    """현금 생성"""
    pass


class CashUpdate(BaseModel):
    """현금 수정"""
    account_id: Optional[int] = None
    amount_usd: Optional[float] = None
    transaction_type: Optional[str] = Field(None, pattern="^(DEPOSIT|WITHDRAW|BUY|SELL|DIVIDEND)$")
    transaction_date: Optional[date] = None
    note: Optional[str] = None


class CashResponse(CashBase):
    """현금 응답"""
    id: int
    related_trade_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CashSummary(BaseModel):
    """현금 요약"""
    total_cash_usd: float
    total_cash_krw: float
    total_deposits_usd: float
    total_withdrawals_usd: float


class DailySnapshotCreate(BaseModel):
    """일일 스냅샷 생성"""
    snapshot_date: date
    account_id: Optional[int] = None
    ticker: Optional[str] = None
    shares: Optional[float] = None
    avg_cost_usd: Optional[float] = None
    market_price_usd: Optional[float] = None
    market_value_usd: Optional[float] = None
    unrealized_pl_usd: Optional[float] = None
    unrealized_pl_percent: Optional[float] = None
    total_market_value_usd: Optional[float] = None
    total_unrealized_pl_usd: Optional[float] = None
    total_realized_pl_usd: Optional[float] = None
    total_pl_usd: Optional[float] = None


class DailySnapshotResponse(BaseModel):
    """일일 스냅샷 응답"""
    id: int
    snapshot_date: date
    account_id: Optional[int] = None
    ticker: Optional[str] = None
    shares: Optional[float] = None
    avg_cost_usd: Optional[float] = None
    market_price_usd: Optional[float] = None
    market_value_usd: Optional[float] = None
    unrealized_pl_usd: Optional[float] = None
    unrealized_pl_percent: Optional[float] = None
    total_market_value_usd: Optional[float] = None
    total_unrealized_pl_usd: Optional[float] = None
    total_realized_pl_usd: Optional[float] = None
    total_pl_usd: Optional[float] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DividendBase(BaseModel):
    """배당금 기본 스키마"""
    account_id: int = Field(..., gt=0)
    ticker: str = Field(..., min_length=1, max_length=20)
    amount_usd: float = Field(..., gt=0)  # 세후 총 배당금
    dividend_date: date
    note: Optional[str] = None
    
    # 자동 가져오기 시 추가 정보 (선택적)
    amount_per_share: Optional[float] = None  # 주당 배당금
    shares_held: Optional[float] = None  # 배당 시점 보유 수량
    tax_withheld_usd: Optional[float] = None  # 원천징수 세금

    @field_validator("ticker")
    @classmethod
    def uppercase_ticker(cls, v: str) -> str:
        return v.upper().strip()


class DividendCreate(DividendBase):
    """배당금 생성"""
    pass


class DividendUpdate(BaseModel):
    """배당금 수정"""
    account_id: Optional[int] = None
    ticker: Optional[str] = None
    amount_usd: Optional[float] = None
    dividend_date: Optional[date] = None
    note: Optional[str] = None


class DividendResponse(DividendBase):
    """배당금 응답"""
    id: int
    is_auto_imported: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DividendSummary(BaseModel):
    """배당금 요약"""
    total_dividends_usd: float
    total_dividends_krw: float
    dividend_count: int
    tickers_with_dividends: int


class DividendByTicker(BaseModel):
    """티커별 배당금 집계"""
    ticker: str
    total_amount_usd: float
    count: int
    latest_date: Optional[date] = None


class DividendAutoImportRequest(BaseModel):
    """자동 배당금 가져오기 요청"""
    account_id: int
    ticker: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class DividendYearImportRequest(BaseModel):
    """연도별 배당금 가져오기 요청"""
    account_id: int
    year: int = Field(..., ge=2020, le=datetime.now().year)
    tickers: Optional[List[str]] = None  # None이면 모든 티커
    preview_only: bool = False  # True면 미리보기만


class DividendPreviewItem(BaseModel):
    """배당 미리보기 항목"""
    ticker: str
    dividend_count: int
    total_amount_usd: float
    existing_count: int  # 이미 등록된 배당 수
    dividends: List[Dict[str, Any]]  # 상세 배당 내역


class DividendYearImportResponse(BaseModel):
    """연도별 배당금 가져오기 응답"""
    preview_data: Optional[List[DividendPreviewItem]] = None
    summary: Dict[str, Any]


class DividendImportHistory(BaseModel):
    """배당 가져오기 히스토리"""
    id: int
    account_id: int
    year: int
    tickers_count: int
    dividends_count: int
    total_amount_usd: float
    imported_count: int
    skipped_count: int
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================================
# Portfolio Analysis Schemas
# =====================================================================

class StockInfo(BaseModel):
    """종목 정보"""
    ticker: str
    sector: str
    industry: str
    country: str
    longName: str
    shortName: str


class SectorAllocation(BaseModel):
    """섹터별 배분"""
    sector: str
    count: int  # 종목 수
    total_value_usd: float
    percentage: float
    unrealized_pl_usd: float
    unrealized_pl_percent: float


class IndustryAllocation(BaseModel):
    """산업별 배분"""
    industry: str
    sector: str
    count: int
    total_value_usd: float
    percentage: float
    unrealized_pl_usd: float
    unrealized_pl_percent: float


class PositionWithInfo(BaseModel):
    """정보가 포함된 포지션"""
    ticker: str
    shares: float
    avg_cost_usd: float
    market_price_usd: Optional[float] = None
    market_value_usd: Optional[float] = None
    unrealized_pl_usd: Optional[float] = None
    unrealized_pl_percent: Optional[float] = None
    weight: Optional[float] = None  # 포트폴리오 내 비중
    sector: str
    industry: str
    longName: str
    yearly_dividend_usd: Optional[float] = 0.0  # 당해 연도 배당금


class ConcentrationWarning(BaseModel):
    """집중도 경고"""
    type: str  # 'position' 또는 'sector'
    name: str  # 티커 또는 섹터명
    percentage: float
    threshold: float
    message: str


class PortfolioAnalysis(BaseModel):
    """포트폴리오 분석 결과"""
    total_positions: int
    total_market_value_usd: float
    total_unrealized_pl_usd: float
    total_unrealized_pl_percent: float
    
    # 섹터 분석
    sector_allocations: List[SectorAllocation]
    top_sectors: List[str]  # 상위 3개 섹터
    
    # 산업 분석
    industry_allocations: List[IndustryAllocation]
    
    # 포지션 정보
    positions_with_info: List[PositionWithInfo]
    
    # 집중도 경고
    concentration_warnings: List[ConcentrationWarning]
    
    # 다양성 지표
    diversification_score: float  # 0-100, 높을수록 분산 잘됨
    sector_count: int
    industry_count: int
    
    class Config:
        from_attributes = True


# =====================================================================
# Trade Statistics Schemas
# =====================================================================

class TradeStatistics(BaseModel):
    """거래 통계"""
    total_trades: int
    buy_trades: int
    sell_trades: int
    
    # 거래 금액
    total_buy_amount_usd: float
    total_sell_amount_usd: float
    avg_buy_amount_usd: float
    avg_sell_amount_usd: float
    
    # 실현 손익
    total_realized_pl_usd: float
    avg_realized_pl_usd: float
    
    # 승률 (이익 매도 / 전체 매도)
    win_rate: float  # 0-100
    profitable_sells: int
    loss_sells: int
    
    # 티커별 통계
    unique_tickers: int
    most_traded_ticker: Optional[str] = None
    most_traded_count: int = 0
    
    # 기간
    first_trade_date: Optional[date] = None
    last_trade_date: Optional[date] = None
    
    class Config:
        from_attributes = True


# =====================================================================
# Backup and Restore Schemas
# =====================================================================

class BackupCreateRequest(BaseModel):
    """백업 생성 요청"""
    include_accounts: bool = True
    include_trades: bool = True
    include_cash: bool = True
    include_dividends: bool = True
    include_realized_pl: bool = True
    include_snapshots: bool = True
    include_settings: bool = True
    backup_name: Optional[str] = None


class BackupMetadata(BaseModel):
    """백업 메타데이터"""
    version: str = "1.0"
    backup_date: datetime
    backup_name: Optional[str] = None
    total_accounts: int = 0
    total_trades: int = 0
    total_cash_transactions: int = 0
    total_dividends: int = 0
    total_realized_pl: int = 0
    total_snapshots: int = 0
    total_settings: int = 0


class BackupData(BaseModel):
    """백업 데이터"""
    accounts: List[Dict[str, Any]] = []
    trades: List[Dict[str, Any]] = []
    cash: List[Dict[str, Any]] = []
    dividends: List[Dict[str, Any]] = []
    realized_pl: List[Dict[str, Any]] = []
    daily_snapshots: List[Dict[str, Any]] = []
    settings: List[Dict[str, Any]] = []


class BackupResponse(BaseModel):
    """백업 응답"""
    metadata: BackupMetadata
    data: BackupData


class RestoreRequest(BaseModel):
    """복원 요청"""
    restore_mode: str = "smart_merge"  # replace, append, smart_merge
    account_name_conflict: str = "map"  # map (기존 계정 매핑), overwrite, create_new
    duplicate_data: str = "skip"  # skip, add_all


class RestorePreview(BaseModel):
    """복원 미리보기"""
    accounts_to_restore: int = 0
    accounts_to_map: int = 0
    accounts_to_create: int = 0
    trades_to_restore: int = 0
    trades_duplicate: int = 0
    cash_to_restore: int = 0
    dividends_to_restore: int = 0
    realized_pl_to_restore: int = 0
    snapshots_to_restore: int = 0
    settings_to_restore: int = 0
    warnings: List[str] = []


class RestoreResponse(BaseModel):
    """복원 응답"""
    success: bool
    message: str
    accounts_created: int = 0
    accounts_mapped: int = 0
    trades_restored: int = 0
    trades_skipped: int = 0
    cash_restored: int = 0
    cash_skipped: int = 0  # Trade와 연결된 Cash는 건너뛴 개수
    dividends_restored: int = 0
    realized_pl_restored: int = 0
    snapshots_restored: int = 0
    settings_restored: int = 0
    errors: List[str] = []


# =====================================================================
# Stock Split Schemas
# =====================================================================

class StockSplitBase(BaseModel):
    """주식 분할/병합 기본 스키마"""
    ticker: str = Field(..., min_length=1, max_length=20)
    split_date: date
    ratio_from: float = Field(..., gt=0)
    ratio_to: float = Field(..., gt=0)
    note: Optional[str] = None

    @field_validator("ticker")
    @classmethod
    def uppercase_ticker(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("ratio_from", "ratio_to")
    @classmethod
    def validate_ratios(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("비율은 0보다 커야 합니다.")
        return v


class StockSplitCreate(StockSplitBase):
    """주식 분할/병합 생성 요청"""
    pass


class StockSplitResponse(StockSplitBase):
    """주식 분할/병합 응답"""
    id: int
    split_type: str  # "SPLIT" 또는 "REVERSE_SPLIT"
    applied_at: Optional[datetime] = None
    trades_affected: Optional[int] = None
    accounts_affected: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StockSplitPreview(BaseModel):
    """주식 분할/병합 적용 전 미리보기"""
    ticker: str
    split_date: date
    ratio_from: float
    ratio_to: float
    split_type: str
    trades_count: int  # 영향받을 거래 수
    accounts_count: int  # 영향받을 계정 수
    accounts: List[Dict[str, Any]]  # 영향받을 계정 목록
    sample_trades: List[Dict[str, Any]]  # 샘플 거래 (최대 10개)
    warning: Optional[str] = None  # 경고 메시지 (중복 등)


# =====================================================================
# Market Index Schemas
# =====================================================================

class NasdaqIndexData(BaseModel):
    """NASDAQ 지수 / 선물 데이터"""
    symbol: str            # "^NDX" 또는 "NQ=F"
    price: float
    change: float
    change_percent: float
    previous_close: float
    is_futures: bool
    market_state: str      # 'open' | 'pre_market' | 'post_market' | 'closed'
    as_of: str
    cached: bool
