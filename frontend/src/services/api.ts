import axios, { AxiosError } from 'axios';
import type {
  Account,
  Trade,
  Position,
  RealizedPL,
  DashboardSummary,
  PriceResponse,
  FXRateResponse,
  TickerValidation,
  Cash,
  CashSummary,
  DailySnapshot,
  Dividend,
  DividendSummary,
  DividendByTicker,
  StockSplit,
  StockSplitCreate,
  StockSplitPreview,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface ApiError {
  message: string;
  status?: number;
  error_code?: string;
  detail?: unknown;
  response?: AxiosError['response'];
}

// 자동으로 trailing slash 추가
api.interceptors.request.use((config) => {
  if (config.url) {
    // 쿼리 파라미터가 있는 경우
    if (config.url.includes('?')) {
      const [path, query] = config.url.split('?');
      if (!path.endsWith('/')) {
        config.url = `${path}/?${query}`;
      }
    } 
    // 쿼리 파라미터가 없고 /로 끝나지 않는 경우
    else if (!config.url.endsWith('/')) {
      config.url += '/';
    }
  }
  if (import.meta.env.DEV) {
    console.log('[API] Request URL:', config.url, 'Params:', config.params);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const responseData = error.response?.data as
      | { detail?: { message?: string; error_code?: string; detail?: unknown } | string; message?: string; error_code?: string }
      | undefined;

    const detail = responseData?.detail;
    const normalizedError: ApiError = {
      message:
        (typeof detail === 'object' && detail?.message) ||
        (typeof detail === 'string' ? detail : undefined) ||
        responseData?.message ||
        error.message ||
        '알 수 없는 오류가 발생했습니다.',
      status: error.response?.status,
      error_code:
        (typeof detail === 'object' && detail?.error_code) ||
        responseData?.error_code,
      detail:
        (typeof detail === 'object' && detail?.detail) ||
        detail,
      response: error.response,
    };

    return Promise.reject(normalizedError);
  }
);

// Accounts
export const accountsApi = {
  getAll: (isActive?: boolean) => 
    api.get<Account[]>('/accounts/', { params: { is_active: isActive } }),
  
  getOne: (id: number) => api.get<Account>(`/accounts/${id}/`),
  
  create: (data: Omit<Account, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<Account>('/accounts/', data),
  
  update: (id: number, data: Partial<Account>) =>
    api.put<Account>(`/accounts/${id}/`, data),
  
  delete: (id: number) => api.delete(`/accounts/${id}/`),
};

// Trades
export const tradesApi = {
  getAll: (params?: {
    account_id?: number;
    ticker?: string;
    start_date?: string;
    end_date?: string;
    side?: string;
    min_amount_usd?: number;
    max_amount_usd?: number;
    skip?: number;
    limit?: number;
  }) => api.get<Trade[]>('/trades', { params }),
  
  getOne: (id: number) => api.get<Trade>(`/trades/${id}`),
  
  create: (data: Omit<Trade, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<Trade>('/trades', data),
  
  update: (id: number, data: Partial<Trade>) =>
    api.put<Trade>(`/trades/${id}`, data),
  
  delete: (id: number) => api.delete(`/trades/${id}`),
  
  bulkDelete: (ids: number[]) => api.post('/trades/bulk-delete', ids),
  
  getStatistics: (params?: {
    account_id?: number;
    ticker?: string;
    start_date?: string;
    end_date?: string;
  }) => api.get<import('../types').TradeStatistics>('/trades/statistics', { params }),
  
  importCSV: (file: File, importMode: string = 'append', defaultAccountId?: number) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('import_mode', importMode);
    if (defaultAccountId) {
      formData.append('default_account_id', defaultAccountId.toString());
    }
    return api.post('/trades/import/csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  exportCSV: (params?: {
    account_id?: number;
    ticker?: string;
    start_date?: string;
    end_date?: string;
  }) => {
    return api.get('/trades/export/csv', {
      params,
      responseType: 'blob',
    });
  },
  
  getTickers: (accountId?: number) => {
    const params: { account_id?: number } = {};
    if (accountId !== undefined && accountId !== null) {
      params.account_id = accountId;
    }
    if (import.meta.env.DEV) {
      console.log('[getTickers] Calling API with accountId:', accountId, 'params:', params);
    }
    return api.get<string[]>('/trades/tickers', { params });
  },
};

// Positions
export const positionsApi = {
  getAll: (params?: { account_id?: number; include_closed?: boolean }) =>
    api.get<Position[]>('/positions', { params }),
  
  getOne: (ticker: string, accountId?: number) => 
    api.get<Position>(`/positions/${ticker}`, { params: { account_id: accountId } }),
  
  getRealizedPL: (params?: { account_id?: number; ticker?: string }) =>
    api.get<RealizedPL[]>('/positions/realized/list', { params }),
  
  recalculate: () => api.post('/positions/recalculate'),
};

// Prices
export const pricesApi = {
  getPrice: (ticker: string) => api.get<PriceResponse>(`/prices/${ticker}`),
  
  refreshPrice: (ticker: string) => api.post<PriceResponse>(`/prices/refresh/${ticker}`),
  
  refreshAll: () => api.post('/prices/refresh-all'),
  
  validateTicker: (ticker: string) =>
    api.get<TickerValidation>(`/prices/validate/${ticker}`),
};

// FX
export const fxApi = {
  getUSDKRW: () => api.get<FXRateResponse>('/fx/usdkrw'),
  
  refresh: () => api.post<FXRateResponse>('/fx/refresh'),
};

// Dashboard
export const dashboardApi = {
  getSummary: (params?: { account_id?: number; include_account_summaries?: boolean; display_currency?: string }) =>
    api.get<DashboardSummary>('/dashboard/summary', { params }),
};

// Background Services
export const backgroundApi = {
  getPriceLoadingStatus: () => api.get('/background/price-loading-status'),
  startPriceLoading: () => api.post('/background/start-price-loading'),
  stopPriceLoading: () => api.post('/background/stop-price-loading'),
  forceRefresh: () => api.post('/background/force-refresh'),
  getCachedPrices: () => api.get('/background/cached-prices'),
};

// Cash
export const cashApi = {
  getAll: (params?: {
    account_id?: number;
    transaction_type?: string;
    start_date?: string;
    end_date?: string;
    skip?: number;
    limit?: number;
  }) => api.get<Cash[]>('/cash', { params }),
  
  getOne: (id: number) => api.get<Cash>(`/cash/${id}`),
  
  create: (data: Omit<Cash, 'id' | 'created_at' | 'updated_at' | 'related_trade_id'>) =>
    api.post<Cash>('/cash', data),
  
  update: (id: number, data: Partial<Cash>) =>
    api.put<Cash>(`/cash/${id}`, data),
  
  delete: (id: number) => api.delete(`/cash/${id}`),
  
  getSummary: (accountId?: number) => 
    api.get<CashSummary>('/cash/balance', { params: { account_id: accountId } }),
};

// Snapshots
export const snapshotsApi = {
  getRange: (params: {
    start_date: string;
    end_date: string;
    account_id?: number;
  }) => api.get<DailySnapshot[]>('/snapshots/range/', { params }),
  
  getLatest: (account_id?: number) =>
    api.get<DailySnapshot[]>('/snapshots/latest', { params: { account_id } }),
  
  getByDate: (snapshot_date: string) =>
    api.get<DailySnapshot[]>(`/snapshots/date/${snapshot_date}`),
  
  create: (snapshot_date?: string) =>
    api.post('/snapshots/create', null, { params: { snapshot_date } }),
  
  delete: (snapshot_date: string) =>
    api.delete(`/snapshots/date/${snapshot_date}`),
  
  getSchedulerStatus: () =>
    api.get('/snapshots/scheduler/status'),
  
  triggerManual: () =>
    api.post('/snapshots/scheduler/trigger'),
  
  diagnose: (account_id?: number) =>
    api.get('/snapshots/diagnose', { params: { account_id } }),
};

// Dividends
export const dividendsApi = {
  getAll: (params?: {
    account_id?: number;
    ticker?: string;
    start_date?: string;
    end_date?: string;
    skip?: number;
    limit?: number;
  }) => api.get<Dividend[]>('/dividends/', { params }),
  
  getOne: (id: number) => api.get<Dividend>(`/dividends/${id}/`),
  
  create: (data: Omit<Dividend, 'id' | 'created_at' | 'updated_at' | 'is_auto_imported'>) =>
    api.post<Dividend>('/dividends/', data),
  
  update: (id: number, data: Partial<Dividend>) =>
    api.put<Dividend>(`/dividends/${id}/`, data),
  
  delete: (id: number) => api.delete(`/dividends/${id}/`),
  
  getSummary: (account_id?: number, options?: { year?: number }) => {
    const params = new URLSearchParams();
    if (account_id !== undefined) params.append('account_id', account_id.toString());
    if (options?.year !== undefined) params.append('year', options.year.toString());
    return api.get<DividendSummary>(`/dividends/summary/?${params}`);
  },

  getByTicker: (account_id?: number, options?: { year?: number }) => {
    const params = new URLSearchParams();
    if (account_id !== undefined) params.append('account_id', account_id.toString());
    if (options?.year !== undefined) params.append('year', options.year.toString());
    return api.get<DividendByTicker[]>(`/dividends/by-ticker/?${params}`);
  },
  
  autoImport: (data: {
    account_id: number;
    ticker: string;
    start_date?: string;
    end_date?: string;
  }) => api.post<{ imported_count: number; skipped_count: number }>('/dividends/auto-import/', data),
  
  getDividendYield: (ticker: string) =>
    api.get(`/dividends/yield/${ticker}/`),

  yearImport: (data: {
    account_id: number;
    year: number;
    tickers?: string[];
    preview_only?: boolean;
  }) => api.post<import('../types').DividendYearImportResponse>('/dividends/year-import/', data),

  getYearPreview: (account_id: number, year: number, tickers?: string[]) =>
    api.get(`/dividends/year-preview/${account_id}/${year}/`, { params: { tickers } }),
};

// Analysis
export const analysisApi = {
  getPortfolioAnalysis: (account_id?: number) =>
    api.get<import('../types').PortfolioAnalysis>('/analysis/portfolio/', { 
      params: { account_id } 
    }),
  
  getStockInfo: (ticker: string) =>
    api.get<import('../types').StockInfo>(`/analysis/stock-info/${ticker}/`),
};

// Backup
export const backupApi = {
  create: (request: import('../types').BackupCreateRequest) =>
    api.post<import('../types').BackupResponse>('/backup/create', request),
  
  createDownload: (request: import('../types').BackupCreateRequest) =>
    api.post('/backup/create/download', request, {
      responseType: 'blob',
    }),
  
  restorePreview: (
    file: File,
    restore_mode: string = 'smart_merge',
    account_name_conflict: string = 'map',
    duplicate_data: string = 'skip'
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<import('../types').RestorePreview>(
      '/backup/restore/preview',
      formData,
      {
        params: {
          restore_mode,
          account_name_conflict,
          duplicate_data,
        },
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
  },
  
  restore: (
    file: File,
    restore_mode: string = 'smart_merge',
    account_name_conflict: string = 'map',
    duplicate_data: string = 'skip'
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<import('../types').RestoreResponse>(
      '/backup/restore',
      formData,
      {
        params: {
          restore_mode,
          account_name_conflict,
          duplicate_data,
        },
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
  },
};

// Stock Splits
export const splitsApi = {
  preview: (params: {
    ticker: string;
    split_date: string;
    ratio_from: number;
    ratio_to: number;
  }) => api.get<StockSplitPreview>('/splits/preview', { params }),
  
  getAll: (params?: {
    ticker?: string;
    skip?: number;
    limit?: number;
  }) => api.get<StockSplit[]>('/splits/', { params }),
  
  getByTicker: (ticker: string) =>
    api.get<StockSplit[]>(`/splits/${ticker}`),
  
  create: (data: StockSplitCreate, apply: boolean = false) =>
    api.post<StockSplit>('/splits/', data, { params: { apply } }),
  
  apply: (splitId: number, recalculatePositions: boolean = true) =>
    api.post(`/splits/${splitId}/apply`, null, {
      params: { recalculate_positions: recalculatePositions },
    }),
};

// Market Index
export const marketApi = {
  getNasdaqIndex: () => api.get<import('../types').NasdaqIndexData>('/market/indices/'),
};

// KRX
export interface KrxTickerInfo {
  ticker: string;
  name: string;
  sector?: string | null;
}

export const krxApi = {
  search: async (q: string): Promise<KrxTickerInfo[]> => {
    const response = await api.get<KrxTickerInfo[]>(`/krx/search`, { params: { q } });
    return response.data;
  },
  info: async (code: string): Promise<KrxTickerInfo> => {
    const response = await api.get<KrxTickerInfo>(`/krx/ticker/${code}/info`);
    return response.data;
  },
};

export default api;

