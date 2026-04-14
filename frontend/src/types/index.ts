export type Currency = "USD" | "KRW";

export interface Account {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  base_currency?: Currency;
  created_at: string;
  updated_at?: string;
}

export interface Trade {
  id: number;
  account_id: number;
  ticker: string;
  side: 'BUY' | 'SELL';
  shares: number;
  price_usd: number;
  trade_date: string;
  note?: string;
  created_at: string;
  updated_at?: string;
}

export interface Position {
  account_id: number;
  ticker: string;
  shares: number;
  avg_cost_usd: number;
  market_price_usd?: number;
  market_value_usd?: number;
  unrealized_pl_usd?: number;
  unrealized_pl_percent?: number;
  total_cost_usd: number;
  is_closed: boolean;
  last_updated?: string;
  first_buy_date?: string;
  holding_days?: number;
  day_change_pl_usd?: number;
  day_change_pl_percent?: number;
  previous_close_price?: number;
  realized_pl_usd?: number;
  currency?: Currency;
}

export interface RealizedPL {
  id: number;
  account_id: number;
  ticker: string;
  trade_id_sell_ref: number;
  shares: number;
  pl_usd: number;
  pl_per_share_usd: number;
  matched_lots_json?: any;
  created_at: string;
}

export interface AccountSummary {
  account_id: number;
  account_name: string;
  total_market_value_usd: number;
  total_market_value_krw: number;
  total_unrealized_pl_usd: number;
  total_unrealized_pl_krw: number;
  total_unrealized_pl_percent: number;
  total_realized_pl_usd: number;
  total_realized_pl_krw: number;
  total_pl_usd: number;
  total_pl_krw: number;
  total_cost_usd: number;
  total_cash_usd: number;
  total_cash_krw: number;
  positions_count: number;
  active_positions_count: number;
  day_change_pl_usd?: number;
}

export interface DashboardSummary {
  total_market_value_usd: number;
  total_market_value_krw: number;
  total_unrealized_pl_usd: number;
  total_unrealized_pl_krw: number;
  total_unrealized_pl_percent: number;
  total_realized_pl_usd: number;
  total_realized_pl_krw: number;
  total_pl_usd: number;
  total_pl_krw: number;
  total_cost_usd: number;
  total_cash_usd: number;
  total_cash_krw: number;
  fx_rate_usd_krw: number;
  fx_rate_as_of: string;
  positions_count: number;
  active_positions_count: number;
  accounts_summary?: AccountSummary[];
  day_change_pl_usd?: number;
  total_dividends_usd?: number;
  total_dividends_krw?: number;
  net_investment_usd?: number;
  fear_greed_index?: FearGreedIndexResponse;
  display_currency?: Currency;
  total_value_display?: number;
}

export interface PriceResponse {
  ticker: string;
  price_usd: number;
  as_of: string;
  cached: boolean;
}

export interface FXRateResponse {
  base: string;
  quote: string;
  rate: number;
  as_of: string;
  cached: boolean;
}

export interface FearGreedIndexResponse {
  value: number;  // 0-100
  classification: string;  // Extreme Fear, Fear, Neutral, Greed, Extreme Greed
  timestamp: number;  // Unix timestamp
  as_of: string;
  cached: boolean;
}

export interface TickerValidation {
  ticker: string;
  valid: boolean;
  name?: string;
  exchange?: string;
  message?: string;
}

export interface Cash {
  id: number;
  account_id: number;
  amount_usd: number;
  transaction_type: 'DEPOSIT' | 'WITHDRAW' | 'BUY' | 'SELL' | 'DIVIDEND';
  related_trade_id?: number;
  related_dividend_id?: number;
  transaction_date: string;
  note?: string;
  created_at: string;
  updated_at?: string;
}

export interface CashSummary {
  total_cash_usd: number;
  total_cash_krw: number;
  total_deposits_usd: number;
  total_withdrawals_usd: number;
}


export interface DailySnapshot {
  id: number;
  snapshot_date: string;
  account_id?: number;
  ticker?: string;
  shares?: number;
  avg_cost_usd?: number;
  market_price_usd?: number;
  market_value_usd?: number;
  unrealized_pl_usd?: number;
  unrealized_pl_percent?: number;
  total_market_value_usd?: number;
  total_unrealized_pl_usd?: number;
  total_realized_pl_usd?: number;
  total_pl_usd?: number;
  created_at: string;
}

export interface PortfolioChartData {
  date: string;
  total_market_value_usd: number;
  total_cost_usd: number;
  total_pl_usd: number;
  total_pl_percent: number;
}

export interface Dividend {
  id: number;
  account_id: number;
  ticker: string;
  amount_usd: number;  // 세후 총 배당금
  dividend_date: string;
  note?: string;
  is_auto_imported: boolean;
  // 자동 가져오기 시 추가 정보
  amount_per_share?: number;  // 주당 배당금
  shares_held?: number;  // 배당 시점 보유 수량
  tax_withheld_usd?: number;  // 원천징수 세금 (15%)
  created_at: string;
  updated_at?: string;
}

export interface DividendSummary {
  total_dividends_usd: number;
  total_dividends_krw: number;
  dividend_count: number;
  tickers_with_dividends: number;
}

export interface DividendByTicker {
  ticker: string;
  total_amount_usd: number;
  count: number;
  latest_date?: string;
}

export interface DividendYearImportRequest {
  account_id: number;
  year: number;
  tickers?: string[];
  preview_only?: boolean;
}

export interface DividendPreviewItem {
  ticker: string;
  dividend_count: number;
  total_amount_usd: number;
  existing_count: number;
  dividends: Array<{
    date: string;
    amount_per_share: number;
    shares_held: number;
    gross_amount: number;
    tax_withheld: number;
    net_amount: number;
  }>;
}

export interface DividendYearImportResponse {
  preview_data?: DividendPreviewItem[];
  summary: {
    year: number;
    tickers_processed: number;
    total_dividends_found: number;
    total_amount_usd: number;
    imported_count: number;
    skipped_count: number;
    error_count?: number;
    failed_count?: number;
    failed_tickers?: Array<{
      ticker: string;
      error: string;
    }>;
  };
}

export interface DividendYearPreview {
  year: number;
  account_id: number;
  tickers: string[];
  preview_data: DividendPreviewItem[];
  summary: {
    total_dividends: number;
    estimated_total_usd: number;
  };
}

// Portfolio Analysis
export interface StockInfo {
  ticker: string;
  sector: string;
  industry: string;
  country: string;
  longName: string;
  shortName: string;
}

export interface SectorAllocation {
  sector: string;
  count: number;
  total_value_usd: number;
  percentage: number;
  unrealized_pl_usd: number;
  unrealized_pl_percent: number;
}

export interface IndustryAllocation {
  industry: string;
  sector: string;
  count: number;
  total_value_usd: number;
  percentage: number;
  unrealized_pl_usd: number;
  unrealized_pl_percent: number;
}

export interface PositionWithInfo {
  ticker: string;
  shares: number;
  avg_cost_usd: number;
  market_price_usd?: number;
  market_value_usd?: number;
  unrealized_pl_usd?: number;
  unrealized_pl_percent?: number;
  weight?: number;
  sector: string;
  industry: string;
  longName: string;
}

export interface ConcentrationWarning {
  type: string;
  name: string;
  percentage: number;
  threshold: number;
  message: string;
}

export interface PortfolioAnalysis {
  total_positions: number;
  total_market_value_usd: number;
  total_unrealized_pl_usd: number;
  total_unrealized_pl_percent: number;
  sector_allocations: SectorAllocation[];
  top_sectors: string[];
  industry_allocations: IndustryAllocation[];
  positions_with_info: PositionWithInfo[];
  concentration_warnings: ConcentrationWarning[];
  diversification_score: number;
  sector_count: number;
  industry_count: number;
}

// Trade Statistics
export interface TradeStatistics {
  total_trades: number;
  buy_trades: number;
  sell_trades: number;
  total_buy_amount_usd: number;
  total_sell_amount_usd: number;
  avg_buy_amount_usd: number;
  avg_sell_amount_usd: number;
  total_realized_pl_usd: number;
  avg_realized_pl_usd: number;
  win_rate: number;
  profitable_sells: number;
  loss_sells: number;
  unique_tickers: number;
  most_traded_ticker?: string;
  most_traded_count: number;
  first_trade_date?: string;
  last_trade_date?: string;
}

// Backup and Restore
export interface BackupCreateRequest {
  include_accounts?: boolean;
  include_trades?: boolean;
  include_cash?: boolean;
  include_dividends?: boolean;
  include_realized_pl?: boolean;
  include_snapshots?: boolean;
  include_settings?: boolean;
  backup_name?: string;
}

export interface BackupMetadata {
  version: string;
  backup_date: string;
  backup_name?: string;
  total_accounts: number;
  total_trades: number;
  total_cash_transactions: number;
  total_dividends: number;
  total_realized_pl: number;
  total_snapshots: number;
  total_settings: number;
}

export interface BackupData {
  accounts: any[];
  trades: any[];
  cash: any[];
  dividends: any[];
  realized_pl: any[];
  daily_snapshots: any[];
  settings: any[];
}

export interface BackupResponse {
  metadata: BackupMetadata;
  data: BackupData;
}

export interface RestoreRequest {
  restore_mode?: string;
  account_name_conflict?: string;
  duplicate_data?: string;
}

export interface RestorePreview {
  accounts_to_restore: number;
  accounts_to_map: number;
  accounts_to_create: number;
  trades_to_restore: number;
  trades_duplicate: number;
  cash_to_restore: number;
  dividends_to_restore: number;
  realized_pl_to_restore: number;
  snapshots_to_restore: number;
  settings_to_restore: number;
  warnings: string[];
}

export interface StockSplit {
  id: number;
  ticker: string;
  split_date: string;
  ratio_from: number;
  ratio_to: number;
  split_type: 'SPLIT' | 'REVERSE_SPLIT';
  note?: string;
  applied_at?: string;
  trades_affected?: number;
  accounts_affected?: number;
  created_at: string;
  updated_at?: string;
}

export interface StockSplitCreate {
  ticker: string;
  split_date: string;
  ratio_from: number;
  ratio_to: number;
  note?: string;
}

export interface StockSplitPreview {
  ticker: string;
  split_date: string;
  ratio_from: number;
  ratio_to: number;
  split_type: 'SPLIT' | 'REVERSE_SPLIT';
  trades_count: number;
  accounts_count: number;
  accounts: Array<{
    id: number;
    name: string;
    trades_count: number;
  }>;
  sample_trades: Array<{
    id: number;
    account_id: number;
    account_name: string;
    side: string;
    trade_date: string;
    old_shares: number;
    old_price_usd: number;
    old_amount_usd: number;
    new_shares: number;
    new_price_usd: number;
    new_amount_usd: number;
  }>;
  warning?: string;
}

export interface RestoreResponse {
  success: boolean;
  message: string;
  accounts_created: number;
  accounts_mapped: number;
  trades_restored: number;
  trades_skipped: number;
  cash_restored: number;
  cash_skipped: number;  // Trade와 연결된 Cash는 건너뛴 개수
  dividends_restored: number;
  realized_pl_restored: number;
  snapshots_restored: number;
  settings_restored: number;
  errors: string[];
}

// Market Index
export interface NasdaqIndexData {
  symbol: string;
  price: number;
  change: number;
  change_percent: number;
  previous_close: number;
  is_futures: boolean;
  market_state: 'open' | 'pre_market' | 'post_market' | 'closed';
  as_of: string;
  cached: boolean;
}





