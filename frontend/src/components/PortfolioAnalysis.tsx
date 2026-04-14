import { useQuery, useQueryClient } from '@tanstack/react-query';
import { analysisApi, dividendsApi, snapshotsApi, positionsApi, fxApi } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import {
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  PieChart as PieChartIcon,
  DollarSign,
  Loader2,
  ShieldAlert,
  Award,
  BarChart2,
  Calendar,
} from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { useState, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import type { DividendByTicker, DailySnapshot, Currency } from '@/types';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';

interface PortfolioAnalysisProps {
  accountId: number | null;
}

// 섹터별 색상 팔레트
const SECTOR_COLORS: Record<string, string> = {
  'Technology': '#3b82f6',
  'Healthcare': '#10b981',
  'Financial Services': '#f59e0b',
  'Consumer Cyclical': '#ec4899',
  'Communication Services': '#8b5cf6',
  'Industrials': '#06b6d4',
  'Consumer Defensive': '#84cc16',
  'Energy': '#ef4444',
  'Basic Materials': '#f97316',
  'Real Estate': '#6366f1',
  'Utilities': '#14b8a6',
  // ETF 전용 섹터
  'Broad Market': '#2563eb',
  'International Equity': '#0891b2',
  'Emerging Markets': '#d946ef',
  'Fixed Income': '#64748b',
  'Commodities': '#ca8a04',
  'Alternative': '#78716c',
  'Other ETF': '#a1a1aa',
  'Unknown': '#9ca3af',
};

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6',
  '#06b6d4', '#84cc16', '#ef4444', '#f97316', '#6366f1',
  '#14b8a6', '#f43f5e', '#a3e635', '#fb923c', '#c084fc',
];

type DrawdownRange = '1M' | '3M' | '1Y' | 'ALL';

const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const MONTH_KEYS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

export default function PortfolioAnalysis({ accountId }: PortfolioAnalysisProps) {
  const queryClient = useQueryClient();
  const [drawdownRange, setDrawdownRange] = useState<DrawdownRange>('1Y');
  const [displayCurrency] = useDisplayCurrency();

  const { data: fx } = useQuery({
    queryKey: ['fx-rate', 'USD', 'KRW'],
    queryFn: () => fxApi.getUSDKRW().then(res => res.data),
    staleTime: 60_000,
  });
  const fxUsdKrw = fx?.rate ?? 1350;

  const toDisplay = (amount: number, cur: Currency = 'USD'): number => {
    if (cur === displayCurrency) return amount;
    if (cur === 'USD' && displayCurrency === 'KRW') return amount * fxUsdKrw;
    if (cur === 'KRW' && displayCurrency === 'USD') return fxUsdKrw > 0 ? amount / fxUsdKrw : 0;
    return amount;
  };

  // 포트폴리오 분석 데이터
  const { data: analysis, isLoading: analysisLoading, refetch } = useQuery({
    queryKey: ['portfolio-analysis', accountId],
    queryFn: () => analysisApi.getPortfolioAnalysis(accountId || undefined).then(res => res.data),
    refetchInterval: 300000,
  });

  // 배당 데이터 (캐시 우선)
  const cachedDividendData = queryClient.getQueryData<DividendByTicker[]>(
    ['dividends-by-ticker', accountId, false]
  );
  const { data: dividendByTicker, isLoading: dividendLoading } = useQuery({
    queryKey: ['dividends-by-ticker', accountId, false],
    queryFn: () =>
      dividendsApi.getByTicker(accountId || undefined, { year: new Date().getFullYear() })
        .then(res => res.data),
    enabled: !cachedDividendData,
    staleTime: 5 * 60 * 1000,
    initialData: cachedDividendData,
  });
  const finalDividendData = dividendByTicker || cachedDividendData;

  // 전체 스냅샷 (월별 히트맵 + 드로우다운용)
  const allSnapshotsEnd = format(new Date(), 'yyyy-MM-dd');
  const { data: allSnapshots } = useQuery({
    queryKey: ['snapshots-all-analysis', accountId, allSnapshotsEnd],
    queryFn: () =>
      snapshotsApi.getRange({
        start_date: '2020-01-01',
        end_date: allSnapshotsEnd,
        account_id: accountId || undefined,
      }).then(res => res.data),
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });

  // 포지션 데이터 (YOC 계산용)
  const { data: positions } = useQuery({
    queryKey: ['positions-analysis', accountId],
    queryFn: () =>
      positionsApi.getAll({ account_id: accountId || undefined, include_closed: false })
        .then(res => res.data),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // ---- 월별 히트맵 계산 ----
  const monthlyHeatmapData = useMemo(() => {
    if (!allSnapshots || allSnapshots.length === 0) return { years: [], data: {} as Record<string, number | null> };

    const portfolioSnaps = (allSnapshots as DailySnapshot[])
      .filter(s => s.total_market_value_usd != null)
      .sort((a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime());

    const byMonth: Record<string, DailySnapshot[]> = {};
    portfolioSnaps.forEach(snap => {
      const key = snap.snapshot_date.substring(0, 7);
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(snap);
    });

    const data: Record<string, number | null> = {};
    Object.entries(byMonth).forEach(([month, snaps]) => {
      const first = snaps[0].total_market_value_usd ?? 0;
      const last = snaps[snaps.length - 1].total_market_value_usd ?? 0;
      data[month] = first > 0 ? ((last - first) / first) * 100 : null;
    });

    const years = [...new Set(Object.keys(byMonth).map(k => k.substring(0, 4)))].sort();
    return { years, data };
  }, [allSnapshots]);

  // ---- 드로우다운 계산 ----
  const drawdownData = useMemo(() => {
    if (!allSnapshots || allSnapshots.length === 0) return [];

    const portfolioSnaps = (allSnapshots as DailySnapshot[])
      .filter(s => s.total_market_value_usd != null)
      .sort((a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime());

    const now = new Date();
    let cutoff: Date;
    switch (drawdownRange) {
      case '1M': cutoff = subDays(now, 30); break;
      case '3M': cutoff = subDays(now, 90); break;
      case '1Y': cutoff = subDays(now, 365); break;
      default: cutoff = new Date('2020-01-01');
    }

    const filtered = portfolioSnaps.filter(s => new Date(s.snapshot_date) >= cutoff);
    if (filtered.length === 0) return [];

    let runningMax = 0;
    return filtered.map(snap => {
      const value = snap.total_market_value_usd ?? 0;
      if (value > runningMax) runningMax = value;
      const drawdown = runningMax > 0 ? ((value - runningMax) / runningMax) * 100 : 0;
      return { date: snap.snapshot_date, value, peak: runningMax, drawdown };
    });
  }, [allSnapshots, drawdownRange]);

  const drawdownStats = useMemo(() => {
    if (drawdownData.length === 0) return null;
    const last = drawdownData[drawdownData.length - 1];
    const maxDD = Math.min(...drawdownData.map(d => d.drawdown));
    const maxDDEntry = drawdownData.find(d => d.drawdown === maxDD);
    const peakEntry = drawdownData.reduce((a, b) => a.peak > b.peak ? a : b);
    return {
      currentDrawdown: last.drawdown,
      maxDrawdown: maxDD,
      maxDrawdownDate: maxDDEntry?.date,
      peakValue: peakEntry.peak,
      peakDate: peakEntry.date,
    };
  }, [drawdownData]);

  // ---- YOC 계산 ----
  const yocData = useMemo(() => {
    if (!positions || !finalDividendData) return [];
    const dividendMap = new Map(finalDividendData.map(d => [d.ticker, d.total_amount_usd]));
    return positions
      .filter(p => !p.is_closed && p.shares > 0 && p.avg_cost_usd > 0)
      .map(p => {
        const totalCost = p.avg_cost_usd * p.shares;
        const annualDividend = dividendMap.get(p.ticker) ?? 0;
        return { ticker: p.ticker, avgCost: p.avg_cost_usd, shares: p.shares, totalCost, annualDividend, yoc: totalCost > 0 ? (annualDividend / totalCost) * 100 : 0 };
      })
      .filter(p => p.annualDividend > 0)
      .sort((a, b) => b.yoc - a.yoc);
  }, [positions, finalDividendData]);

  const isLoading = analysisLoading || (dividendLoading && !cachedDividendData);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <h3 className="text-lg font-semibold">데이터 로딩 중...</h3>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-muted-foreground">데이터가 없습니다.</p>
      </div>
    );
  }

  // ---- 데이터 가공 ----
  const topPositionsByValue = analysis.positions_with_info
    .filter(pos => (pos.market_value_usd ?? 0) > 0)
    .sort((a, b) => (b.market_value_usd ?? 0) - (a.market_value_usd ?? 0))
    .slice(0, 10)
    .map(pos => ({ ticker: pos.ticker, value: toDisplay(pos.market_value_usd ?? 0, 'USD'), percentage: pos.weight ?? 0 }));

  const topPositionsByDividend = finalDividendData
    ?.filter(div => div.total_amount_usd > 0)
    .sort((a, b) => b.total_amount_usd - a.total_amount_usd)
    .slice(0, 10)
    .map(div => ({ ticker: div.ticker, dividend: toDisplay(div.total_amount_usd, 'USD') })) ?? [];

  const sortedByPL = [...analysis.positions_with_info]
    .filter(p => p.unrealized_pl_usd !== undefined)
    .sort((a, b) => (b.unrealized_pl_usd ?? 0) - (a.unrealized_pl_usd ?? 0));
  const topContributors = sortedByPL.filter(p => (p.unrealized_pl_usd ?? 0) >= 0).slice(0, 5);
  const topDetractors = sortedByPL.filter(p => (p.unrealized_pl_usd ?? 0) < 0).slice(-5).reverse();

  const divScore = analysis.diversification_score ?? 0;
  const divScoreColor = divScore >= 70 ? 'text-profit' : divScore >= 40 ? 'text-yellow-600 dark:text-yellow-400' : 'text-loss';
  const divScoreLabel = divScore >= 70 ? '분산형' : divScore >= 40 ? '보통' : '집중형';
  const divScoreBarColor = divScore >= 70 ? 'bg-green-500' : divScore >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  const sectorPieData = analysis.sector_allocations.filter(s => s.percentage > 0).sort((a, b) => b.percentage - a.percentage);
  const industryPieData = analysis.industry_allocations.filter(i => i.percentage > 0).sort((a, b) => b.percentage - a.percentage).slice(0, 10);

  const getHeatmapColor = (value: number | null | undefined) => {
    if (value == null) return 'bg-muted/30 text-muted-foreground/40';
    if (value > 8) return 'bg-green-600 text-white';
    if (value > 4) return 'bg-green-500 text-white';
    if (value > 1) return 'bg-green-400 text-white';
    if (value > 0) return 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-300';
    if (value > -1) return 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-300';
    if (value > -4) return 'bg-red-400 text-white';
    if (value > -8) return 'bg-red-500 text-white';
    return 'bg-red-600 text-white';
  };

  const PieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-border rounded-lg shadow-lg text-xs">
          <p className="font-semibold mb-1.5">{d.sector ?? d.industry}</p>
          <div className="space-y-0.5">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">비중</span>
              <span className="font-numeric font-semibold">{formatPercent(d.percentage)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">평가금액</span>
              <span className="font-numeric font-semibold">{formatCurrency(toDisplay(d.total_value_usd, 'USD'), displayCurrency)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">미실현 손익</span>
              <span className={`font-numeric font-semibold ${(d.unrealized_pl_usd ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                {(d.unrealized_pl_usd ?? 0) >= 0 ? '+' : ''}{formatCurrency(toDisplay(d.unrealized_pl_usd ?? 0, 'USD'), displayCurrency)}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">포트폴리오 분석</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={analysisLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${analysisLoading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {/* 요약 카드 5개 */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">총 포지션</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold font-numeric">{analysis.total_positions}</div>
            <div className="text-xs text-muted-foreground mt-0.5">종목</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">총 평가금액</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-lg font-bold font-numeric">{formatCurrency(toDisplay(analysis.total_market_value_usd, 'USD'), displayCurrency)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">미실현 손익</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className={`text-lg font-bold font-numeric ${analysis.total_unrealized_pl_usd >= 0 ? 'text-profit' : 'text-loss'}`}>
              {analysis.total_unrealized_pl_usd >= 0 ? '+' : ''}{formatCurrency(toDisplay(analysis.total_unrealized_pl_usd, 'USD'), displayCurrency)}
            </div>
            <div className={`text-xs font-numeric mt-0.5 ${analysis.total_unrealized_pl_usd >= 0 ? 'text-profit' : 'text-loss'}`}>
              {formatPercent(analysis.total_unrealized_pl_percent)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">섹터 / 산업군</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold font-numeric">{analysis.sector_count}</div>
            <div className="text-xs text-muted-foreground mt-0.5 font-numeric">{analysis.industry_count}개 산업군</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">분산도 점수</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className={`text-2xl font-bold font-numeric ${divScoreColor}`}>{divScore.toFixed(0)}</div>
            <div className="mt-1.5 w-full bg-muted rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${divScoreBarColor}`} style={{ width: `${divScore}%` }} />
            </div>
            <div className={`text-xs mt-1 font-semibold ${divScoreColor}`}>{divScoreLabel}</div>
          </CardContent>
        </Card>
      </div>

      {/* 집중도 경고 */}
      {analysis.concentration_warnings && analysis.concentration_warnings.length > 0 && (
        <Card className="border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4" />
              집중도 경고
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-1.5">
              {analysis.concentration_warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold text-orange-800 dark:text-orange-300">{w.name}</span>
                    <span className="text-orange-700 dark:text-orange-400 ml-1">
                      — {w.message}
                      {' '}(<span className="font-numeric">{formatPercent(w.percentage)}</span>,{' '}
                      임계값 <span className="font-numeric">{formatPercent(w.threshold)}</span>)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 섹터 / 산업군 파이차트 */}
      {(sectorPieData.length > 0 || industryPieData.length > 0) && (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {sectorPieData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PieChartIcon className="h-4 w-4 text-muted-foreground" />
                  섹터 배분
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={sectorPieData} cx="50%" cy="50%" innerRadius={52} outerRadius={90} dataKey="percentage" nameKey="sector">
                        {sectorPieData.map((entry, index) => (
                          <Cell key={`sector-${index}`} fill={SECTOR_COLORS[entry.sector] || DEFAULT_COLORS[index % DEFAULT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1">
                  {sectorPieData.slice(0, 7).map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: SECTOR_COLORS[s.sector] || DEFAULT_COLORS[i % DEFAULT_COLORS.length] }} />
                        <span className="truncate text-muted-foreground">{s.sector}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-numeric font-semibold">{formatPercent(s.percentage)}</span>
                        <span className={`font-numeric text-[10px] w-20 text-right ${(s.unrealized_pl_usd ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {(s.unrealized_pl_usd ?? 0) >= 0 ? '+' : ''}{formatCurrency(toDisplay(s.unrealized_pl_usd ?? 0, 'USD'), displayCurrency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {industryPieData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PieChartIcon className="h-4 w-4 text-muted-foreground" />
                  산업군 배분 (상위 10개)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={industryPieData} cx="50%" cy="50%" innerRadius={52} outerRadius={90} dataKey="percentage" nameKey="industry">
                        {industryPieData.map((_, index) => (
                          <Cell key={`ind-${index}`} fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1">
                  {industryPieData.slice(0, 7).map((ind, i) => (
                    <div key={i} className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: DEFAULT_COLORS[i % DEFAULT_COLORS.length] }} />
                        <span className="truncate text-muted-foreground">{ind.industry}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-numeric font-semibold">{formatPercent(ind.percentage)}</span>
                        <span className={`font-numeric text-[10px] w-20 text-right ${(ind.unrealized_pl_usd ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {(ind.unrealized_pl_usd ?? 0) >= 0 ? '+' : ''}{formatCurrency(toDisplay(ind.unrealized_pl_usd ?? 0, 'USD'), displayCurrency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* 성과 기여도 */}
      {(topContributors.length > 0 || topDetractors.length > 0) && (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-profit">
                <Award className="h-4 w-4" />
                상위 기여 종목 (수익)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">종목</th>
                    <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">비중</th>
                    <th className="text-right px-4 py-1.5 text-muted-foreground font-medium">미실현 손익</th>
                  </tr>
                </thead>
                <tbody>
                  {topContributors.map((pos) => (
                    <tr key={pos.ticker} className="border-b border-border/50 hover:bg-muted/40">
                      <td className="px-4 py-1.5">
                        <div className="font-semibold">{pos.ticker}</div>
                        <div className="text-muted-foreground truncate max-w-[130px]">{pos.longName}</div>
                      </td>
                      <td className="text-right px-3 py-1.5 font-numeric">{formatPercent(pos.weight ?? 0)}</td>
                      <td className="text-right px-4 py-1.5">
                        <div className="font-numeric font-semibold text-profit">
                          +{formatCurrency(toDisplay(pos.unrealized_pl_usd ?? 0, 'USD'), displayCurrency)}
                        </div>
                        <div className="font-numeric text-[10px] text-profit">{formatPercent(pos.unrealized_pl_percent ?? 0)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-loss">
                <TrendingDown className="h-4 w-4" />
                하위 기여 종목 (손실)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">종목</th>
                    <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">비중</th>
                    <th className="text-right px-4 py-1.5 text-muted-foreground font-medium">미실현 손익</th>
                  </tr>
                </thead>
                <tbody>
                  {topDetractors.map((pos) => (
                    <tr key={pos.ticker} className="border-b border-border/50 hover:bg-muted/40">
                      <td className="px-4 py-1.5">
                        <div className="font-semibold">{pos.ticker}</div>
                        <div className="text-muted-foreground truncate max-w-[130px]">{pos.longName}</div>
                      </td>
                      <td className="text-right px-3 py-1.5 font-numeric">{formatPercent(pos.weight ?? 0)}</td>
                      <td className="text-right px-4 py-1.5">
                        <div className="font-numeric font-semibold text-loss">
                          {formatCurrency(toDisplay(pos.unrealized_pl_usd ?? 0, 'USD'), displayCurrency)}
                        </div>
                        <div className="font-numeric text-[10px] text-loss">{formatPercent(pos.unrealized_pl_percent ?? 0)}</div>
                      </td>
                    </tr>
                  ))}
                  {topDetractors.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-4 text-center text-muted-foreground">손실 종목 없음</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 월별 수익률 히트맵 */}
      {monthlyHeatmapData.years.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              월별 수익률 히트맵
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[560px]">
                <thead>
                  <tr>
                    <th className="text-left py-1.5 pr-3 text-muted-foreground font-medium w-12">연도</th>
                    {MONTHS.map(m => (
                      <th key={m} className="text-center py-1.5 px-0.5 text-muted-foreground font-medium min-w-[44px]">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlyHeatmapData.years.map(year => (
                    <tr key={year}>
                      <td className="py-1 pr-3 font-semibold text-muted-foreground">{year}</td>
                      {MONTH_KEYS.map(month => {
                        const key = `${year}-${month}`;
                        const value = monthlyHeatmapData.data[key];
                        return (
                          <td key={month} className="py-1 px-0.5">
                            <div
                              className={`rounded text-center py-1.5 font-numeric text-[10px] font-medium leading-tight ${getHeatmapColor(value)}`}
                              title={value != null ? `${year}년 ${parseInt(month)}월: ${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '데이터 없음'}
                            >
                              {value != null ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}` : '—'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
              <span>손실</span>
              {(['bg-red-600', 'bg-red-400', 'bg-red-200', 'bg-green-200', 'bg-green-400', 'bg-green-600'] as const).map((cls, i) => (
                <div key={i} className={`w-5 h-3 rounded-sm ${cls}`} />
              ))}
              <span>수익</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 드로우다운 분석 */}
      {allSnapshots && allSnapshots.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                드로우다운 분석
              </CardTitle>
              <div className="flex gap-1">
                {(['1M', '3M', '1Y', 'ALL'] as DrawdownRange[]).map(r => (
                  <Button key={r} variant={drawdownRange === r ? 'default' : 'outline'} size="sm" className="px-2.5 py-1 text-xs h-7" onClick={() => setDrawdownRange(r)}>
                    {r}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {drawdownData.length === 0 ? (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
                선택한 기간({drawdownRange}) 내 스냅샷 데이터가 없습니다.
              </div>
            ) : (
              <>
                {drawdownStats && (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1">현재 드로우다운</div>
                      <div className={`text-lg font-bold font-numeric ${drawdownStats.currentDrawdown < -5 ? 'text-loss' : drawdownStats.currentDrawdown < -1 ? 'text-yellow-600 dark:text-yellow-400' : 'text-profit'}`}>
                        {drawdownStats.currentDrawdown.toFixed(2)}%
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1">최대 드로우다운</div>
                      <div className="text-lg font-bold font-numeric text-loss">{drawdownStats.maxDrawdown.toFixed(2)}%</div>
                      {drawdownStats.maxDrawdownDate && (
                        <div className="text-[10px] text-muted-foreground font-numeric mt-0.5">
                          {format(new Date(drawdownStats.maxDrawdownDate), 'yyyy.MM.dd')}
                        </div>
                      )}
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1">구간 최고점</div>
                      <div className="text-lg font-bold font-numeric text-blue-600 dark:text-blue-400">
                        {formatCurrency(toDisplay(drawdownStats.peakValue, 'USD'), displayCurrency)}
                      </div>
                      {drawdownStats.peakDate && (
                        <div className="text-[10px] text-muted-foreground font-numeric mt-0.5">
                          {format(new Date(drawdownStats.peakDate), 'yyyy.MM.dd')}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={drawdownData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                      <XAxis dataKey="date" tickFormatter={(v) => format(new Date(v), 'MM/dd')} stroke="#9ca3af" fontSize={10} interval="preserveStartEnd" />
                      <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} stroke="#9ca3af" fontSize={10} domain={['auto', 0]} />
                      <Tooltip
                        formatter={(value: number) => [`${value.toFixed(2)}%`, '드로우다운']}
                        labelFormatter={(label) => format(new Date(label), 'yyyy년 MM월 dd일')}
                      />
                      <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
                      <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={2} fill="url(#ddGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 배당 수익률(YOC) */}
      {yocData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              배당 수익률(YOC) — {new Date().getFullYear()}년 기준
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-muted-foreground font-medium">종목</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">평균 매수가</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium hidden md:table-cell">보유 수량</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">매수 총액</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">연간 배당금</th>
                    <th className="text-right px-4 py-2 text-muted-foreground font-medium">YOC</th>
                  </tr>
                </thead>
                <tbody>
                  {yocData.map((item) => (
                    <tr key={item.ticker} className="border-b border-border/50 hover:bg-muted/40">
                      <td className="px-4 py-1.5 font-semibold">{item.ticker}</td>
                      <td className="text-right px-3 py-1.5 font-numeric hidden sm:table-cell">{formatCurrency(toDisplay(item.avgCost, 'USD'), displayCurrency)}</td>
                      <td className="text-right px-3 py-1.5 font-numeric hidden md:table-cell">{item.shares.toFixed(3)}</td>
                      <td className="text-right px-3 py-1.5 font-numeric hidden sm:table-cell">{formatCurrency(toDisplay(item.totalCost, 'USD'), displayCurrency)}</td>
                      <td className="text-right px-3 py-1.5 font-numeric text-profit">{formatCurrency(toDisplay(item.annualDividend, 'USD'), displayCurrency)}</td>
                      <td className="text-right px-4 py-1.5 font-numeric font-bold text-profit">{item.yoc.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 종목별 투자규모 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            종목별 투자규모 (상위 10개)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topPositionsByValue} margin={{ top: 10, right: 20, left: 20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis dataKey="ticker" angle={-45} textAnchor="end" height={60} fontSize={11} stroke="#9ca3af" />
                <YAxis tickFormatter={(v) => displayCurrency === 'KRW' ? `₩${Math.round(v / 1_000_000)}M` : `$${Math.round(v / 1000)}K`} fontSize={11} stroke="#9ca3af" />
                <Tooltip formatter={(v: number) => [formatCurrency(v, displayCurrency), '평가금액']} labelFormatter={(l) => `${l}`} />
                <Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 배당규모 */}
      {topPositionsByDividend.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              종목별 배당규모 (상위 10개, {new Date().getFullYear()}년)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topPositionsByDividend} margin={{ top: 10, right: 20, left: 20, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="ticker" angle={-45} textAnchor="end" height={60} fontSize={11} stroke="#9ca3af" />
                  <YAxis tickFormatter={(v) => displayCurrency === 'KRW' ? `₩${Math.round(v / 1000)}K` : `$${Math.round(v)}`} fontSize={11} stroke="#9ca3af" />
                  <Tooltip formatter={(v: number) => [formatCurrency(v, displayCurrency), '배당금']} labelFormatter={(l) => `${l}`} />
                  <Bar dataKey="dividend" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 포지션 상세 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
            포지션 상세
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">종목</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">비중</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">평가금액</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">미실현 손익</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">수익률</th>
                </tr>
              </thead>
              <tbody>
                {analysis.positions_with_info
                  .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
                  .map((position) => (
                    <tr key={position.ticker} className="border-b border-border/50 hover:bg-muted/40">
                      <td className="px-4 py-1.5">
                        <div className="font-semibold">{position.ticker}</div>
                        <div className="text-muted-foreground truncate max-w-[150px]">{position.longName}</div>
                      </td>
                      <td className="text-right px-3 py-1.5 font-numeric font-semibold">{formatPercent(position.weight ?? 0)}</td>
                      <td className="text-right px-3 py-1.5 font-numeric">{formatCurrency(toDisplay(position.market_value_usd ?? 0, 'USD'), displayCurrency)}</td>
                      <td className={`text-right px-3 py-1.5 font-numeric font-semibold ${(position.unrealized_pl_usd ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {(position.unrealized_pl_usd ?? 0) >= 0 ? '+' : ''}{formatCurrency(toDisplay(position.unrealized_pl_usd ?? 0, 'USD'), displayCurrency)}
                      </td>
                      <td className={`text-right px-4 py-1.5 font-numeric ${(position.unrealized_pl_percent ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {formatPercent(position.unrealized_pl_percent ?? 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
