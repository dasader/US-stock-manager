import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  dashboardApi,
  backgroundApi,
  positionsApi,
  marketApi,
  snapshotsApi,
  analysisApi,
  accountsApi,
  fxApi,
} from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle, GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useChartTheme } from '@/hooks/useChartTheme';
import { useToast } from '@/hooks/useToast';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { DisplayCurrencyToggle } from './dashboard/DisplayCurrencyToggle';
import { CurrencyBadge } from './accounts/CurrencyBadge';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Search,
  ArrowUpDown,
  RefreshCw,
  ShieldAlert,
  Award,
  BarChart2,
} from 'lucide-react';
import { format, subDays, subMonths, subYears } from 'date-fns';
import type {
  DailySnapshot,
  Currency,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface PortfolioProps {
  accountId: number | null;
}

type TabId = 'summary' | 'holdings' | 'analysis';
type ChartRange = '1W' | '1M' | '3M' | '1Y' | 'ALL';
type SortField =
  | 'ticker' | 'shares' | 'avg_cost_usd' | 'market_price_usd'
  | 'market_value_usd' | 'weight' | 'unrealized_pl_usd'
  | 'unrealized_pl_percent' | 'day_change_pl_usd' | 'holding_days';
type SortDirection = 'asc' | 'desc';

const TABS: { id: TabId; label: string }[] = [
  { id: 'summary', label: '요약' },
  { id: 'holdings', label: '보유종목' },
  { id: 'analysis', label: '분석' },
];

const CHART_RANGES: { id: ChartRange; label: string }[] = [
  { id: '1W', label: '1W' },
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: '1Y', label: '1Y' },
  { id: 'ALL', label: 'ALL' },
];

const SECTOR_COLORS: Record<string, string> = {
  'Technology': '#3b82f6', 'Healthcare': '#10b981', 'Financial Services': '#f59e0b',
  'Consumer Cyclical': '#ec4899', 'Communication Services': '#8b5cf6',
  'Industrials': '#06b6d4', 'Consumer Defensive': '#84cc16', 'Energy': '#ef4444',
  'Basic Materials': '#f97316', 'Real Estate': '#6366f1', 'Utilities': '#14b8a6',
  'Broad Market': '#2563eb', 'International Equity': '#0891b2',
  'Emerging Markets': '#d946ef', 'Fixed Income': '#64748b',
  'Commodities': '#ca8a04', 'Alternative': '#78716c',
  'Other ETF': '#a1a1aa', 'Unknown': '#9ca3af',
};

const DEFAULT_COLORS = [
  '#D4A853', '#3b82f6', '#10b981', '#f59e0b', '#ec4899',
  '#8b5cf6', '#06b6d4', '#84cc16', '#ef4444', '#f97316',
];

function getSectorColor(sector: string, idx: number): string {
  return SECTOR_COLORS[sector] ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
}

function rangeStartDate(range: ChartRange): string {
  const today = new Date();
  switch (range) {
    case '1W': return format(subDays(today, 7), 'yyyy-MM-dd');
    case '1M': return format(subMonths(today, 1), 'yyyy-MM-dd');
    case '3M': return format(subMonths(today, 3), 'yyyy-MM-dd');
    case '1Y': return format(subYears(today, 1), 'yyyy-MM-dd');
    case 'ALL': return format(subYears(today, 10), 'yyyy-MM-dd');
  }
}

interface LoadingStatus {
  total: number;
  completed: number;
  failed: number;
  current_ticker: string | null;
  progress_percent: number;
  estimated_remaining_seconds: number;
  start_time: string;
  estimated_completion: string | null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg glass border border-border/40 px-3 py-2 shadow-obsidian text-xs space-y-1">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-numeric font-semibold text-foreground">
        {formatCurrency(payload[0]?.value, 'USD')}
      </p>
    </div>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-lg glass border border-border/40 px-3 py-2 shadow-obsidian text-xs space-y-0.5">
      <p className="font-semibold">{d.name}</p>
      <p className="font-numeric">{formatCurrency(d.value, 'USD')}</p>
      <p className="font-numeric text-muted-foreground">{formatPercent(d.payload?.percentage)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Portfolio({ accountId }: PortfolioProps) {
  const { toast } = useToast();
  const chartTheme = useChartTheme();

  // Display currency toggle
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();

  // Tab & section refs
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const summaryRef = useRef<HTMLDivElement>(null);
  const holdingsRef = useRef<HTMLDivElement>(null);
  const analysisRef = useRef<HTMLDivElement>(null);

  // Chart range
  const [chartRange, setChartRange] = useState<ChartRange>('3M');

  // Holdings state
  const [searchQuery, setSearchQuery] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [sortField, setSortField] = useState<SortField>('market_value_usd');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [isMobile, setIsMobile] = useState(false);

  // Loading status
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ['portfolio-summary', accountId],
    queryFn: () =>
      dashboardApi
        .getSummary({ account_id: accountId ?? undefined, include_account_summaries: accountId === null })
        .then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: nasdaqData } = useQuery({
    queryKey: ['nasdaq-index'],
    queryFn: () => marketApi.getNasdaqIndex().then((r) => r.data),
    refetchInterval: 60000,
    retry: 1,
  });

  const { data: positions, isLoading: posLoading } = useQuery({
    queryKey: ['portfolio-positions', accountId, includeClosed],
    queryFn: () =>
      positionsApi
        .getAll({ account_id: accountId ?? undefined, include_closed: includeClosed })
        .then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: snapshots } = useQuery({
    queryKey: ['portfolio-snapshots', accountId, chartRange],
    queryFn: () =>
      snapshotsApi
        .getRange({
          start_date: rangeStartDate(chartRange),
          end_date: format(new Date(), 'yyyy-MM-dd'),
          account_id: accountId ?? undefined,
        })
        .then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: analysis, isLoading: analysisLoading } = useQuery({
    queryKey: ['portfolio-analysis', accountId],
    queryFn: () => analysisApi.getPortfolioAnalysis(accountId ?? undefined).then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: bgStatus } = useQuery({
    queryKey: ['background-loading-status'],
    queryFn: () => backgroundApi.getPriceLoadingStatus().then((r) => r.data),
    refetchInterval: 2000,
  });

  const { data: allAccounts } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => accountsApi.getAll().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: fxData } = useQuery({
    queryKey: ['fx-rate', 'USD', 'KRW'],
    queryFn: () => fxApi.getUSDKRW().then((r) => r.data),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (bgStatus) {
      setLoadingStatus(bgStatus);
      setShowProgress(bgStatus.completed < bgStatus.total && bgStatus.total > 0);
    }
  }, [bgStatus]);

  // -------------------------------------------------------------------------
  // Currency helpers
  // -------------------------------------------------------------------------

  const accountCurrencyMap = useMemo(() => {
    const m = new Map<number, Currency>();
    (allAccounts ?? []).forEach((a) => m.set(a.id, (a.base_currency ?? 'USD') as Currency));
    return m;
  }, [allAccounts]);

  const fxUsdKrw = (fxData?.rate ?? summary?.fx_rate_usd_krw ?? 1350);

  const getCurForAccount = useCallback((accountId?: number): Currency =>
    accountId != null ? (accountCurrencyMap.get(accountId) ?? 'USD') : 'USD',
  [accountCurrencyMap]);

  const getPosCurrency = useCallback((p: { currency?: Currency; account_id: number }): Currency =>
    (p.currency as Currency | undefined) ?? getCurForAccount(p.account_id),
  [getCurForAccount]);

  /** Convert an amount from its native currency to the current displayCurrency */
  const toDisplay = useCallback((amount: number, nativeCur: Currency): number => {
    if (nativeCur === displayCurrency) return amount;
    if (nativeCur === 'USD' && displayCurrency === 'KRW') return amount * fxUsdKrw;
    if (nativeCur === 'KRW' && displayCurrency === 'USD') return fxUsdKrw > 0 ? amount / fxUsdKrw : 0;
    return amount;
  }, [displayCurrency, fxUsdKrw]);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const totalMarketValue = useMemo(() => {
    if (!positions) return 0;
    return positions
      .filter((p) => !p.is_closed && p.shares > 0)
      .reduce((sum, p) => {
        const cur = getPosCurrency(p);
        return sum + toDisplay(p.market_value_usd ?? 0, cur);
      }, 0);
  }, [positions, getPosCurrency, toDisplay]);

  const chartData = useMemo(() => {
    if (!snapshots?.length) return [];
    // Deduplicate by date — pick the summary-level row (ticker is null / undefined)
    const byDate = new Map<string, DailySnapshot>();
    for (const s of snapshots) {
      if (!s.ticker && s.total_market_value_usd != null) {
        byDate.set(s.snapshot_date, s);
      }
    }
    return Array.from(byDate.values())
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      .map((s) => ({
        date: format(new Date(s.snapshot_date), 'MM/dd'),
        value: s.total_market_value_usd ?? 0,
      }));
  }, [snapshots]);

  // Composition bar data (in displayCurrency)
  const compositionData = useMemo(() => {
    if (!positions) return [];
    return positions
      .filter((p) => !p.is_closed && p.shares > 0 && (p.market_value_usd ?? 0) > 0)
      .map((p) => {
        const cur = getPosCurrency(p);
        const displayValue = toDisplay(p.market_value_usd ?? 0, cur);
        return { ticker: p.ticker, value: displayValue };
      })
      .sort((a, b) => b.value - a.value)
      .map((d) => ({
        ...d,
        weight: totalMarketValue > 0 ? (d.value / totalMarketValue) * 100 : 0,
      }));
  }, [positions, totalMarketValue, getPosCurrency, toDisplay]);

  // Holdings: filter + sort
  const filteredPositions = useMemo(() => {
    if (!positions) return [];
    let list = positions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.ticker.toLowerCase().includes(q));
    }
    return list;
  }, [positions, searchQuery]);

  const sortedPositions = useMemo(() => {
    const list = [...filteredPositions];
    list.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortField === 'ticker') {
        va = a.ticker; vb = b.ticker;
        return sortDir === 'asc' ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string);
      }
      if (sortField === 'weight') {
        va = totalMarketValue > 0 ? ((a.market_value_usd ?? 0) / totalMarketValue) : 0;
        vb = totalMarketValue > 0 ? ((b.market_value_usd ?? 0) / totalMarketValue) : 0;
      } else {
        va = (a as any)[sortField] ?? 0;
        vb = (b as any)[sortField] ?? 0;
      }
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return list;
  }, [filteredPositions, sortField, sortDir, totalMarketValue]);

  // Totals row (in displayCurrency)
  const totals = useMemo(() => {
    const active = filteredPositions.filter((p) => !p.is_closed && p.shares > 0);
    return {
      shares: active.reduce((s, p) => s + p.shares, 0),
      marketValue: active.reduce((s, p) => {
        const cur = getPosCurrency(p);
        return s + toDisplay(p.market_value_usd ?? 0, cur);
      }, 0),
      totalCost: active.reduce((s, p) => {
        const cur = getPosCurrency(p);
        return s + toDisplay(p.total_cost_usd, cur);
      }, 0),
      unrealizedPl: active.reduce((s, p) => {
        const cur = getPosCurrency(p);
        return s + toDisplay(p.unrealized_pl_usd ?? 0, cur);
      }, 0),
      dayChange: active.reduce((s, p) => {
        const cur = getPosCurrency(p);
        return s + toDisplay(p.day_change_pl_usd ?? 0, cur);
      }, 0),
    };
  }, [filteredPositions, getPosCurrency, toDisplay]);

  // Analysis: top gainers / losers
  const { topGainers, topLosers } = useMemo(() => {
    if (!analysis?.positions_with_info) return { topGainers: [], topLosers: [] };
    const sorted = [...analysis.positions_with_info].sort(
      (a, b) => (b.unrealized_pl_usd ?? 0) - (a.unrealized_pl_usd ?? 0)
    );
    return {
      topGainers: sorted.filter((p) => (p.unrealized_pl_usd ?? 0) > 0).slice(0, 5),
      topLosers: sorted.filter((p) => (p.unrealized_pl_usd ?? 0) < 0).slice(-5).reverse(),
    };
  }, [analysis]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const scrollTo = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const ref = tab === 'summary' ? summaryRef : tab === 'holdings' ? holdingsRef : analysisRef;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortDir((prev) => (sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortField(field);
  }, [sortField]);

  const handleForceRefresh = useCallback(async () => {
    try {
      await backgroundApi.forceRefresh();
      setTimeout(() => refetchSummary(), 1000);
    } catch {
      toast({ title: '새로고침 실패', description: '새로고침 중 오류가 발생했습니다.', variant: 'destructive' });
    }
  }, [refetchSummary, toast]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const plClass = (v: number | null | undefined) =>
    (v ?? 0) >= 0 ? 'text-profit' : 'text-loss';

  const plBg = (v: number | null | undefined) =>
    (v ?? 0) > 0
      ? 'bg-emerald-500/8 dark:bg-emerald-400/8'
      : (v ?? 0) < 0
        ? 'bg-red-500/8 dark:bg-red-400/8'
        : '';

  const accentColor = (v: number | null | undefined) =>
    (v ?? 0) >= 0 ? 'bg-emerald-500' : 'bg-red-500';

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead
      className={cn(
        "cursor-pointer select-none hover:text-foreground transition-colors",
        field !== 'ticker' && 'text-right'
      )}
      onClick={() => handleSort(field)}
    >
      <span className={cn("inline-flex items-center gap-1", field !== 'ticker' && 'justify-end')}>
        {children}
        <ArrowUpDown className={cn('h-3 w-3', sortField === field ? 'text-primary' : 'text-muted-foreground/50')} />
      </span>
    </TableHead>
  );

  // Score badge color
  const scoreColor = (score: number) =>
    score >= 80 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
    score >= 60 ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' :
    'text-red-400 border-red-500/30 bg-red-500/10';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // KPI values: pick _usd or _krw variants based on displayCurrency
  // TODO[multi-currency-pl]: /docs/pl_todo.md 참조. 백엔드 DashboardSummary.total_unrealized_pl_usd/krw는
  // 전체 포지션을 currency 구분 없이 shares*price로 단순 합산한 값이라
  // KRW 계정 혼재 시 합계가 수학적으로 부정확함 (KRW 금액이 USD에 섞여 들어감).
  // 정확한 집계를 위해선:
  //   1) backend/app/services/position_engine.py: get_all_positions()에 account_id 포함
  //   2) backend/app/api/dashboard.py: 계정 base_currency별로 집계 후 통화별 합계 반환
  //   3) backend/app/schemas.py DashboardSummary: total_unrealized_pl_native_krw, _native_usd 분리
  //   4) 프론트: 각 통화별 합계를 toDisplay로 환산 후 합산
  const unrealizedPL = displayCurrency === 'KRW'
    ? (summary?.total_unrealized_pl_krw ?? 0)
    : (summary?.total_unrealized_pl_usd ?? 0);
  const realizedPL = displayCurrency === 'KRW'
    ? (summary?.total_realized_pl_krw ?? 0)
    : (summary?.total_realized_pl_usd ?? 0);
  const dayChangePL = displayCurrency === 'KRW'
    ? toDisplay(summary?.day_change_pl_usd ?? 0, 'USD')
    : (summary?.day_change_pl_usd ?? 0);
  const totalPL = displayCurrency === 'KRW'
    ? (summary?.total_pl_krw ?? 0)
    : (summary?.total_pl_usd ?? 0);
  const totalMarketValueDisplay = displayCurrency === 'KRW'
    ? (summary?.total_market_value_krw ?? 0)
    : (summary?.total_market_value_usd ?? 0);

  return (
    <div className="space-y-0 pb-12">
      {/* ---- Background loading progress ---- */}
      {showProgress && loadingStatus && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-muted">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500"
            style={{ width: `${loadingStatus.progress_percent}%` }}
          />
        </div>
      )}

      {/* ---- Sticky sub-nav pills ---- */}
      <div className="sticky top-0 z-40 -mx-1 px-1 py-3 backdrop-blur-xl bg-background/70 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => scrollTo(tab.id)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {summary && (
              <span className="text-xs text-muted-foreground font-numeric hidden sm:inline">
                USD/KRW {formatNumber(summary.fx_rate_usd_krw, 0)}
              </span>
            )}
            <DisplayCurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
            <Button onClick={handleForceRefresh} variant="outline" size="sm" className="hover-lift">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              새로고침
            </Button>
          </div>
        </div>
      </div>

      {/* ==================================================================
         SECTION 1: Summary
         ================================================================== */}
      <section ref={summaryRef} className="pt-6 space-y-5 scroll-mt-16">
        {/* KPI Bento Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* NASDAQ */}
          <GlassCard className="p-4 animate-slide-up stagger-1 hover-lift">
            <div className="flex items-start gap-3">
              <div className={cn('w-1 h-full min-h-[48px] rounded-full', nasdaqData && nasdaqData.change >= 0 ? 'bg-emerald-500' : 'bg-red-500')} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">NASDAQ</p>
                <p className="text-lg font-bold font-numeric truncate">
                  {nasdaqData ? formatNumber(nasdaqData.price, 0) : '--'}
                </p>
                {nasdaqData && (
                  <p className={cn('text-xs font-numeric', plClass(nasdaqData.change))}>
                    {formatPercent(nasdaqData.change_percent)}
                  </p>
                )}
              </div>
            </div>
          </GlassCard>

          {/* Total Market Value */}
          <GlassCard className="p-4 animate-slide-up stagger-2 hover-lift">
            <div className="flex items-start gap-3">
              <div className="w-1 h-full min-h-[48px] rounded-full bg-amber-500" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">총 평가금액</p>
                <p className="text-lg font-bold font-numeric truncate">
                  {summary ? formatCurrency(totalMarketValueDisplay, displayCurrency) : '--'}
                </p>
                <p className="text-xs text-muted-foreground font-numeric truncate">
                  {summary && displayCurrency === 'USD'
                    ? formatCurrency(summary.total_market_value_krw, 'KRW')
                    : summary
                    ? formatCurrency(summary.total_market_value_usd, 'USD')
                    : ''}
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Unrealized P&L */}
          <GlassCard className="p-4 animate-slide-up stagger-3 hover-lift">
            <div className="flex items-start gap-3">
              <div className={cn('w-1 h-full min-h-[48px] rounded-full', accentColor(unrealizedPL))} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">미실현 손익</p>
                <p className={cn('text-lg font-bold font-numeric truncate', plClass(unrealizedPL))}>
                  {summary ? formatCurrency(unrealizedPL, displayCurrency) : '--'}
                </p>
                <p className={cn('text-xs font-numeric', plClass(summary?.total_unrealized_pl_percent))}>
                  {summary ? formatPercent(summary.total_unrealized_pl_percent) : ''}
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Total P&L */}
          <GlassCard className="p-4 animate-slide-up stagger-4 hover-lift">
            <div className="flex items-start gap-3">
              <div className={cn('w-1 h-full min-h-[48px] rounded-full', accentColor(totalPL))} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">총 손익</p>
                <p className={cn('text-lg font-bold font-numeric truncate', plClass(totalPL))}>
                  {summary ? formatCurrency(totalPL, displayCurrency) : '--'}
                </p>
                <p className="text-xs text-muted-foreground font-numeric truncate">
                  실현 {formatCurrency(realizedPL, displayCurrency)} | 일간 {formatCurrency(dayChangePL, displayCurrency)}
                </p>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Portfolio Value Chart */}
        <Card className="animate-slide-up stagger-5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" />
              포트폴리오 가치 추이
            </CardTitle>
            <div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
              {CHART_RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setChartRange(r.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                    chartRange === r.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartTheme.gold} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={chartTheme.gold} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: chartTheme.muted }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: chartTheme.muted }}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    width={55}
                  />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={chartTheme.gold}
                    strokeWidth={2}
                    fill="url(#goldGradient)"
                    animationDuration={800}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
                스냅샷 데이터가 없습니다
              </div>
            )}
          </CardContent>
        </Card>

        {/* Composition Bar */}
        {compositionData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">포트폴리오 구성</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-6 rounded-lg overflow-hidden">
                {compositionData.map((d, i) => (
                  <div
                    key={d.ticker}
                    className="relative group transition-all hover:brightness-110"
                    style={{
                      width: `${d.weight}%`,
                      backgroundColor: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                      minWidth: d.weight > 2 ? undefined : '2px',
                    }}
                  >
                    {d.weight > 6 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white/90">
                        {d.ticker}
                      </span>
                    )}
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                      <div className="glass rounded px-2 py-1 text-[10px] whitespace-nowrap border border-border/40 shadow-obsidian">
                        {d.ticker} {formatPercent(d.weight)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                {compositionData.slice(0, 10).map((d, i) => (
                  <div key={d.ticker} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: DEFAULT_COLORS[i % DEFAULT_COLORS.length] }} />
                    <span className="font-medium text-foreground">{d.ticker}</span>
                    <span className="font-numeric">{d.weight.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Account Summary Table (when no specific account selected) */}
        {accountId === null && summary?.accounts_summary && summary.accounts_summary.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">계정별 요약</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>계정</TableHead>
                    <TableHead className="text-right">평가금액</TableHead>
                    <TableHead className="text-right">미실현 손익</TableHead>
                    <TableHead className="text-right">실현 손익</TableHead>
                    <TableHead className="text-right">종목 수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.accounts_summary.map((acc) => {
                    const accCur = getCurForAccount(acc.account_id);
                    const mvDisplay = displayCurrency === 'KRW'
                      ? acc.total_market_value_krw
                      : acc.total_market_value_usd;
                    const urplDisplay = displayCurrency === 'KRW'
                      ? acc.total_unrealized_pl_krw
                      : acc.total_unrealized_pl_usd;
                    const rplDisplay = displayCurrency === 'KRW'
                      ? acc.total_realized_pl_krw
                      : acc.total_realized_pl_usd;
                    return (
                      <TableRow key={acc.account_id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-1.5">
                            {acc.account_name}
                            <CurrencyBadge currency={accCur} />
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-numeric">{formatCurrency(mvDisplay, displayCurrency)}</TableCell>
                        <TableCell className={cn('text-right font-numeric', plClass(urplDisplay))}>
                          {formatCurrency(urplDisplay, displayCurrency)}
                        </TableCell>
                        <TableCell className={cn('text-right font-numeric', plClass(rplDisplay))}>
                          {formatCurrency(rplDisplay, displayCurrency)}
                        </TableCell>
                        <TableCell className="text-right font-numeric">{acc.active_positions_count}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ==================================================================
         SECTION 2: Holdings
         ================================================================== */}
      <section ref={holdingsRef} className="pt-8 space-y-4 scroll-mt-16">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight">보유종목</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="종목 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 w-44 text-sm"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeClosed}
                onChange={(e) => setIncludeClosed(e.target.checked)}
                className="rounded border-border"
              />
              매도 종목 포함
            </label>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {posLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" /> 로딩 중...
              </div>
            ) : isMobile ? (
              /* ---- Mobile Card List ---- */
              <div className="divide-y divide-border">
                {sortedPositions.map((p) => {
                  const posCur = getPosCurrency(p);
                  const mvDisp = toDisplay(p.market_value_usd ?? 0, posCur);
                  const urplDisp = toDisplay(p.unrealized_pl_usd ?? 0, posCur);
                  const weight = totalMarketValue > 0 ? (mvDisp / totalMarketValue) * 100 : 0;
                  return (
                    <div key={`${p.account_id}-${p.ticker}`} className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{p.ticker}</span>
                        <span className={cn('font-numeric text-sm font-semibold', plClass(urplDisp))}>
                          {formatCurrency(urplDisp, displayCurrency)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <div>
                          <span className="block">수량</span>
                          <span className="font-numeric text-foreground">{formatNumber(p.shares, p.shares % 1 === 0 ? 0 : 4)}</span>
                        </div>
                        <div>
                          <span className="block">평균단가</span>
                          <span className="font-numeric text-foreground">{formatCurrency(p.avg_cost_usd, posCur)}</span>
                        </div>
                        <div>
                          <span className="block">현재가</span>
                          <span className="font-numeric text-foreground">{formatCurrency(p.market_price_usd, posCur)}</span>
                        </div>
                        <div>
                          <span className="block">평가금액</span>
                          <span className="font-numeric text-foreground">{formatCurrency(mvDisp, displayCurrency)}</span>
                        </div>
                        <div>
                          <span className="block">비중</span>
                          <span className="font-numeric text-foreground">{weight.toFixed(1)}%</span>
                        </div>
                        <div>
                          <span className="block">수익률</span>
                          <span className={cn('font-numeric', plClass(p.unrealized_pl_percent))}>
                            {formatPercent(p.unrealized_pl_percent)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {sortedPositions.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground text-sm">보유종목이 없습니다</div>
                )}
              </div>
            ) : (
              /* ---- Desktop Table ---- */
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortHeader field="ticker">종목</SortHeader>
                      <SortHeader field="shares">수량</SortHeader>
                      <SortHeader field="avg_cost_usd">평균단가</SortHeader>
                      <SortHeader field="market_price_usd">현재가</SortHeader>
                      <SortHeader field="market_value_usd">평가금액</SortHeader>
                      <SortHeader field="weight">비중</SortHeader>
                      <SortHeader field="unrealized_pl_usd">미실현 손익</SortHeader>
                      <SortHeader field="unrealized_pl_percent">수익률</SortHeader>
                      <SortHeader field="day_change_pl_usd">일간변동</SortHeader>
                      <SortHeader field="holding_days">보유일</SortHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPositions.map((p) => {
                      const posCur = getPosCurrency(p);
                      const mvDisp = toDisplay(p.market_value_usd ?? 0, posCur);
                      const urplDisp = toDisplay(p.unrealized_pl_usd ?? 0, posCur);
                      const dayDisp = toDisplay(p.day_change_pl_usd ?? 0, posCur);
                      const weight = totalMarketValue > 0 ? (mvDisp / totalMarketValue) * 100 : 0;
                      return (
                        <TableRow
                          key={`${p.account_id}-${p.ticker}`}
                          className={cn(
                            'group relative transition-colors',
                            p.is_closed && 'opacity-50',
                          )}
                        >
                          <TableCell className="font-bold relative">
                            <span className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r bg-primary/0 group-hover:bg-primary transition-colors" />
                            {p.ticker}
                          </TableCell>
                          <TableCell className="font-numeric text-right">{formatNumber(p.shares, p.shares % 1 === 0 ? 0 : 4)}</TableCell>
                          <TableCell className="font-numeric text-right">{formatCurrency(p.avg_cost_usd, posCur)}</TableCell>
                          <TableCell className="font-numeric text-right">{formatCurrency(p.market_price_usd, posCur)}</TableCell>
                          <TableCell className="font-numeric text-right">{formatCurrency(mvDisp, displayCurrency)}</TableCell>
                          <TableCell className="font-numeric text-right">{weight.toFixed(1)}%</TableCell>
                          <TableCell className={cn('font-numeric text-right', plClass(urplDisp), plBg(urplDisp))}>
                            {formatCurrency(urplDisp, displayCurrency)}
                          </TableCell>
                          <TableCell className={cn('font-numeric text-right', plClass(p.unrealized_pl_percent))}>
                            {formatPercent(p.unrealized_pl_percent)}
                          </TableCell>
                          <TableCell className={cn('font-numeric text-right', plClass(dayDisp), plBg(dayDisp))}>
                            {formatCurrency(dayDisp, displayCurrency)}
                          </TableCell>
                          <TableCell className="font-numeric text-right">{p.holding_days ?? '-'}</TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Totals Row */}
                    {sortedPositions.length > 0 && (
                      <TableRow className="border-t-2 border-border font-semibold bg-muted/30">
                        <TableCell>합계 ({filteredPositions.filter((p) => !p.is_closed && p.shares > 0).length}종목)</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell className="font-numeric text-right">{formatCurrency(totals.marketValue, displayCurrency)}</TableCell>
                        <TableCell className="font-numeric text-right">100%</TableCell>
                        <TableCell className={cn('font-numeric text-right', plClass(totals.unrealizedPl))}>
                          {formatCurrency(totals.unrealizedPl, displayCurrency)}
                        </TableCell>
                        <TableCell className={cn('font-numeric text-right', plClass(totals.unrealizedPl))}>
                          {totals.totalCost > 0 ? formatPercent((totals.unrealizedPl / totals.totalCost) * 100) : '-'}
                        </TableCell>
                        <TableCell className={cn('font-numeric text-right', plClass(totals.dayChange))}>
                          {formatCurrency(totals.dayChange, displayCurrency)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    )}
                    {sortedPositions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                          보유종목이 없습니다
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ==================================================================
         SECTION 3: Analysis
         ================================================================== */}
      <section ref={analysisRef} className="pt-8 space-y-5 scroll-mt-16">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">분석</h2>
          {analysis && (
            <div className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold', scoreColor(analysis.diversification_score))}>
              <Award className="h-3.5 w-3.5" />
              분산투자 점수 {analysis.diversification_score.toFixed(1)}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Sector Donut */}
          <Card className="animate-slide-up">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                섹터 배분
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analysis && analysis.sector_allocations.length > 0 ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={analysis.sector_allocations}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        dataKey="total_value_usd"
                        nameKey="sector"
                        paddingAngle={2}
                        animationDuration={600}
                      >
                        {analysis.sector_allocations.map((entry, i) => (
                          <Cell key={entry.sector} fill={getSectorColor(entry.sector, i)} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<PieTooltip />} />
                      {/* Center label */}
                      <text
                        x="50%"
                        y="46%"
                        textAnchor="middle"
                        className="fill-muted-foreground text-[10px]"
                      >
                        총 평가금액
                      </text>
                      <text
                        x="50%"
                        y="56%"
                        textAnchor="middle"
                        className="fill-foreground font-numeric text-sm font-semibold"
                      >
                        {formatCurrency(analysis.total_market_value_usd, 'USD')}
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
                    {analysis.sector_allocations.map((s, i) => (
                      <div key={s.sector} className="flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: getSectorColor(s.sector, i) }} />
                        <span className="text-muted-foreground">{s.sector}</span>
                        <span className="font-numeric font-medium">{s.percentage.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">
                  {analysisLoading ? '분석 중...' : '분석 데이터가 없습니다'}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performance Contributors */}
          <Card className="animate-slide-up">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-profit" />
                수익 기여 종목
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Top Gainers */}
              {topGainers.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">상위 수익 종목</p>
                  <div className="space-y-1.5">
                    {topGainers.map((p) => (
                      <div key={p.ticker} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-3 w-3 text-profit" />
                          <span className="font-medium text-sm">{p.ticker}</span>
                          <span className="text-xs text-muted-foreground">{p.longName?.split(' ').slice(0, 2).join(' ')}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-profit font-numeric text-sm font-semibold">
                            {formatCurrency(p.unrealized_pl_usd, 'USD')}
                          </span>
                          <span className="text-profit font-numeric text-xs ml-1.5">
                            {formatPercent(p.unrealized_pl_percent)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Losers */}
              {topLosers.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">하위 손실 종목</p>
                  <div className="space-y-1.5">
                    {topLosers.map((p) => (
                      <div key={p.ticker} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
                        <div className="flex items-center gap-2">
                          <TrendingDown className="h-3 w-3 text-loss" />
                          <span className="font-medium text-sm">{p.ticker}</span>
                          <span className="text-xs text-muted-foreground">{p.longName?.split(' ').slice(0, 2).join(' ')}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-loss font-numeric text-sm font-semibold">
                            {formatCurrency(p.unrealized_pl_usd, 'USD')}
                          </span>
                          <span className="text-loss font-numeric text-xs ml-1.5">
                            {formatPercent(p.unrealized_pl_percent)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {topGainers.length === 0 && topLosers.length === 0 && (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  데이터가 없습니다
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Concentration Warnings */}
        {analysis && analysis.concentration_warnings.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-amber-500">
                <ShieldAlert className="h-4 w-4" />
                집중도 경고
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {analysis.concentration_warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15"
                  >
                    <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{w.message}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
