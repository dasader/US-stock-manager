import { useQuery } from '@tanstack/react-query';
import { dashboardApi, backgroundApi, positionsApi, marketApi, accountsApi, fxApi } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DashboardSkeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatPercent } from '@/lib/utils';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  RefreshCw,
  Clock,
  Activity,
  BarChart2,
} from 'lucide-react';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';
import PortfolioChart from './PortfolioChart';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency';
import { DisplayCurrencyToggle } from './dashboard/DisplayCurrencyToggle';
import { CurrencyBadge } from './accounts/CurrencyBadge';
import type { Currency } from '@/types';

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

interface DashboardProps {
  accountId: number | null;
}

export default function Dashboard({ accountId }: DashboardProps) {
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const { toast } = useToast();
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();

  const { data: summary, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard-summary', accountId, displayCurrency],
    queryFn: () =>
      dashboardApi
        .getSummary({
          account_id: accountId || undefined,
          include_account_summaries: accountId === null,
          display_currency: displayCurrency,
        })
        .then((res) => res.data),
    refetchInterval: 60000,
    retry: 3,
    retryDelay: 1000,
  });

  // 포지션 데이터 (상위 포지션 테이블용)
  const { data: positions } = useQuery({
    queryKey: ['positions-dashboard', accountId],
    queryFn: () =>
      positionsApi
        .getAll({ account_id: accountId || undefined, include_closed: false })
        .then((res) => res.data),
    refetchInterval: 60000,
    retry: 2,
  });

  // NASDAQ 지수 데이터
  const { data: nasdaqData } = useQuery({
    queryKey: ['nasdaq-index'],
    queryFn: () => marketApi.getNasdaqIndex().then((r) => r.data),
    refetchInterval: 60000,
    retry: 1,
  });

  // 계정 목록 (base_currency 조회용)
  const { data: allAccounts } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => (await accountsApi.getAll()).data,
  });
  const accountCurrencyMap = useMemo(() => {
    const m = new Map<number, Currency>();
    (allAccounts ?? []).forEach((a: any) => m.set(a.id, (a.base_currency ?? 'USD') as Currency));
    return m;
  }, [allAccounts]);

  // FX 환율
  const { data: fxData } = useQuery({
    queryKey: ['fx-rate', 'USD', 'KRW'],
    queryFn: () => fxApi.getUSDKRW().then((r) => r.data),
    staleTime: 60_000,
  });
  const fxUsdKrw = fxData?.rate ?? summary?.fx_rate_usd_krw ?? 1350;

  const toDisplay = (amount: number, cur: Currency): number => {
    if (cur === displayCurrency) return amount;
    if (cur === 'USD' && displayCurrency === 'KRW') return amount * fxUsdKrw;
    if (cur === 'KRW' && displayCurrency === 'USD') return fxUsdKrw > 0 ? amount / fxUsdKrw : 0;
    return amount;
  };

  const getCurForAccount = (accountId?: number): Currency =>
    accountId != null ? (accountCurrencyMap.get(accountId) ?? 'USD') : 'USD';

  // 백그라운드 로딩 상태 조회
  const { data: bgStatus } = useQuery({
    queryKey: ['background-loading-status'],
    queryFn: () => backgroundApi.getPriceLoadingStatus().then((res) => res.data),
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (bgStatus) {
      setLoadingStatus(bgStatus);
      setShowProgress(bgStatus.completed < bgStatus.total && bgStatus.total > 0);
    }
  }, [bgStatus]);

  const handleForceRefresh = useCallback(async () => {
    try {
      await backgroundApi.forceRefresh();
      setTimeout(() => {
        refetch();
      }, 1000);
    } catch (error) {
      console.error('Failed to force refresh:', error);
      toast({
        title: '새로고침 실패',
        description: error instanceof Error ? error.message : '새로고침 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    }
  }, [refetch, toast]);

  // 상위 포지션 (market_value_usd 기준 상위 8개)
  const topPositions = useMemo(() => {
    if (!positions) return [];
    return [...positions]
      .filter((p) => !p.is_closed && (p.market_value_usd ?? 0) > 0)
      .sort((a, b) => (b.market_value_usd ?? 0) - (a.market_value_usd ?? 0))
      .slice(0, 8);
  }, [positions]);

  // 포트폴리오 전체 시장가 (비중 계산용, 통화 인식)
  const totalMarketValueDisplay = useMemo(() => {
    if (!positions) return 0;
    return positions
      .filter((p) => !p.is_closed)
      .reduce((sum, p) => {
        const cur = (p.currency as Currency) ?? getCurForAccount(p.account_id);
        return sum + toDisplay(p.market_value_usd ?? 0, cur);
      }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, displayCurrency, fxUsdKrw, accountCurrencyMap]);

  const unrealizedPL = summary?.total_unrealized_pl_usd ?? 0;
  const realizedPL = summary?.total_realized_pl_usd ?? 0;
  const totalPL = summary?.total_pl_usd ?? 0;
  const dayChange = summary?.day_change_pl_usd;
  const netInvestment = summary?.net_investment_usd ?? 0;
  const totalAssets = netInvestment + realizedPL + unrealizedPL;
  const netInvestmentWidth = totalAssets > 0 ? (Math.abs(netInvestment) / totalAssets) * 100 : 0;
  const realizedPLWidth = totalAssets > 0 ? (Math.abs(realizedPL) / totalAssets) * 100 : 0;
  const unrealizedPLWidth = totalAssets > 0 ? (Math.abs(unrealizedPL) / totalAssets) * 100 : 0;

  // 헤더: 항상 표시 (통화 토글이 데이터 로딩 전에도 보여야 함)
  const headerRow = (
    <div className="flex items-center justify-between">
      <h2 className="text-2xl font-bold tracking-tight">
        대시보드{accountId !== null && ' — 계정별 보기'}
      </h2>
      <div className="flex items-center gap-2">
        <DisplayCurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
        <Button onClick={handleForceRefresh} variant="outline" size="sm" className="hover-lift">
          <RefreshCw className="h-4 w-4 mr-2" />
          새로고침
        </Button>
      </div>
    </div>
  );

  if (isLoading && !summary) {
    return (
      <div className="space-y-5">
        {headerRow}
        <DashboardSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        {headerRow}
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <div className="text-red-600 text-center">
            <h3 className="text-lg font-semibold mb-2">데이터를 불러올 수 없습니다</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다'}
            </p>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              다시 시도
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="space-y-5">
        {headerRow}
        <div className="flex items-center justify-center p-8">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">데이터 로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 헤더 행 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">
          대시보드{accountId !== null && ' — 계정별 보기'}
        </h2>
        <div className="flex items-center gap-2">
          <DisplayCurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
          <Button onClick={handleForceRefresh} variant="outline" size="sm" className="hover-lift">
            <RefreshCw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
          {/* 환율 배지 */}
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-medium shadow-sm"
            title={`환율: ${formatCurrency(summary.fx_rate_usd_krw ?? 1350, 'KRW')}/USD (기준일: ${summary.fx_rate_as_of ?? '-'})`}
          >
            <DollarSign className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-700 dark:text-blue-300 font-numeric">
              {Math.round(summary.fx_rate_usd_krw ?? 1350).toLocaleString()}
            </span>
          </div>
          {/* Fear & Greed 배지 */}
          {summary.fear_greed_index && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm border ${
                summary.fear_greed_index.value <= 25
                  ? 'bg-gradient-to-r from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800'
                  : summary.fear_greed_index.value <= 45
                  ? 'bg-gradient-to-r from-orange-100 to-orange-200 dark:from-orange-900/30 dark:to-orange-800/30 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800'
                  : summary.fear_greed_index.value <= 55
                  ? 'bg-gradient-to-r from-yellow-100 to-yellow-200 dark:from-yellow-900/30 dark:to-yellow-800/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800'
                  : summary.fear_greed_index.value <= 75
                  ? 'bg-gradient-to-r from-green-100 to-green-200 dark:from-green-900/30 dark:to-green-800/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800'
                  : 'bg-gradient-to-r from-emerald-100 to-emerald-200 dark:from-emerald-900/30 dark:to-emerald-800/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
              }`}
              title={`Fear & Greed Index: ${summary.fear_greed_index.value} (${summary.fear_greed_index.classification}) — 기준일: ${new Date(summary.fear_greed_index.as_of).toLocaleDateString('ko-KR')}`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span className="font-numeric">{summary.fear_greed_index.value}</span>
              <span className="hidden sm:inline opacity-75">
                {summary.fear_greed_index.value <= 25
                  ? '극단적 공포'
                  : summary.fear_greed_index.value <= 45
                  ? '공포'
                  : summary.fear_greed_index.value <= 55
                  ? '중립'
                  : summary.fear_greed_index.value <= 75
                  ? '탐욕'
                  : '극단적 탐욕'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 백그라운드 로딩 상태 */}
      {showProgress && loadingStatus && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/30">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 animate-pulse" />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-xs text-blue-700 dark:text-blue-300 mb-1">
                  <span>주가 업데이트 중{loadingStatus.current_ticker && ` — ${loadingStatus.current_ticker}`}</span>
                  <span className="font-numeric">{loadingStatus.completed}/{loadingStatus.total} ({loadingStatus.progress_percent?.toFixed(0)}%)</span>
                </div>
                <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-1.5">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${loadingStatus.progress_percent || 0}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI 카드 4개 */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {/* 카드 0: NASDAQ 지수 */}
        <Card className="hover-lift relative overflow-hidden group animate-fade-in">
          <div className="absolute inset-0 gradient-info opacity-5 group-hover:opacity-10 transition-opacity duration-300" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {nasdaqData ? (nasdaqData.is_futures ? 'NASDAQ 선물 (NQ=F)' : 'NASDAQ 100') : 'NASDAQ'}
            </CardTitle>
            <div className={`bg-gradient-to-br ${!nasdaqData || nasdaqData.change_percent >= 0 ? 'from-indigo-500 to-indigo-700' : 'from-red-500 to-red-700'} p-1.5 rounded-lg shadow-sm`}>
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10 space-y-1">
            {nasdaqData ? (
              <>
                <div className={`text-2xl font-bold font-numeric tracking-tight ${nasdaqData.change_percent >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {nasdaqData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-xs font-semibold font-numeric flex items-center gap-1 ${nasdaqData.change_percent >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {nasdaqData.change_percent >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {nasdaqData.change >= 0 ? '+' : ''}{nasdaqData.change.toFixed(2)}
                  &nbsp;{nasdaqData.change_percent >= 0 ? '+' : ''}{nasdaqData.change_percent.toFixed(2)}%
                </div>
                <div className="text-xs text-muted-foreground pt-1">
                  {nasdaqData.market_state === 'open' ? '개장중' :
                   nasdaqData.market_state === 'pre_market' ? '프리마켓 선물' :
                   nasdaqData.market_state === 'post_market' ? '장 마감' : '휴장'}
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold font-numeric text-muted-foreground">-</div>
                <div className="text-xs text-muted-foreground">데이터 없음</div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 카드 1: 총 평가금액 */}
        <Card className="hover-lift relative overflow-hidden group animate-fade-in">
          <div className="absolute inset-0 gradient-info opacity-5 group-hover:opacity-10 transition-opacity duration-300" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">총 평가금액</CardTitle>
            <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-1.5 rounded-lg shadow-sm">
              <Wallet className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10 space-y-1">
            <div className="text-2xl font-bold font-numeric tracking-tight text-blue-700 dark:text-blue-400">
              {formatCurrency(summary.total_value_display ?? summary.total_market_value_usd ?? 0, displayCurrency)}
            </div>
            <div className="text-xs text-muted-foreground font-numeric">
              {displayCurrency === 'KRW'
                ? formatCurrency(summary.total_market_value_usd ?? 0, 'USD')
                : formatCurrency(summary.total_market_value_krw ?? 0, 'KRW')}
            </div>
            <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <span className="font-numeric font-medium">{summary.active_positions_count ?? 0}개</span>
              <span>종목 보유</span>
              {(summary.total_cash_usd ?? 0) > 0 && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span>현금 <span className="font-numeric">{formatCurrency(summary.total_cash_usd ?? 0, 'USD')}</span></span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 카드 2: 미실현 손익 */}
        {/* TODO: currency-aware aggregation — 현재 backend에서 혼합 통화 집계값(USD) 그대로 사용. KRW 계정 혼재 시 합산 부정확. */}
        <Card className="hover-lift relative overflow-hidden group animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <div className={`absolute inset-0 ${unrealizedPL >= 0 ? 'gradient-success' : 'gradient-danger'} opacity-5 group-hover:opacity-10 transition-opacity duration-300`} />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">미실현 손익</CardTitle>
            <div className={`bg-gradient-to-br ${unrealizedPL >= 0 ? 'from-green-500 to-green-700' : 'from-red-500 to-red-700'} p-1.5 rounded-lg shadow-sm`}>
              {unrealizedPL >= 0
                ? <TrendingUp className="h-4 w-4 text-white" />
                : <TrendingDown className="h-4 w-4 text-white" />}
            </div>
          </CardHeader>
          <CardContent className="relative z-10 space-y-1">
            <div className={`text-2xl font-bold font-numeric tracking-tight ${unrealizedPL >= 0 ? 'text-profit' : 'text-loss'}`}>
              {unrealizedPL >= 0 ? '+' : ''}{formatCurrency(unrealizedPL, 'USD')}
            </div>
            <div className="text-xs text-muted-foreground font-numeric">
              {formatCurrency((summary.total_unrealized_pl_krw ?? 0), 'KRW')}
            </div>
            <div className={`text-xs font-semibold font-numeric pt-1 ${unrealizedPL >= 0 ? 'text-profit' : 'text-loss'}`}>
              수익률 {formatPercent(summary.total_unrealized_pl_percent ?? 0)}
            </div>
          </CardContent>
        </Card>

        {/* 카드 3: 실현 손익 + 총 손익 */}
        <Card className="hover-lift relative overflow-hidden group animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <div className={`absolute inset-0 ${totalPL >= 0 ? 'gradient-success' : 'gradient-danger'} opacity-5 group-hover:opacity-10 transition-opacity duration-300`} />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground">손익 현황</CardTitle>
            <div className={`bg-gradient-to-br ${totalPL >= 0 ? 'from-green-500 to-green-700' : 'from-red-500 to-red-700'} p-1.5 rounded-lg shadow-sm`}>
              {totalPL >= 0
                ? <TrendingUp className="h-4 w-4 text-white" />
                : <TrendingDown className="h-4 w-4 text-white" />}
            </div>
          </CardHeader>
          <CardContent className="relative z-10 space-y-1">
            {/* 총 손익 */}
            <div className={`text-2xl font-bold font-numeric tracking-tight ${totalPL >= 0 ? 'text-profit' : 'text-loss'}`}>
              {totalPL >= 0 ? '+' : ''}{formatCurrency(totalPL, 'USD')}
            </div>
            {/* 실현 손익 서브 */}
            <div className="text-xs text-muted-foreground font-numeric">
              실현 <span className={`font-semibold ${realizedPL >= 0 ? 'text-profit' : 'text-loss'}`}>
                {realizedPL >= 0 ? '+' : ''}{formatCurrency(realizedPL, 'USD')}
              </span>
            </div>
            {/* 전일 대비 */}
            {dayChange !== undefined && dayChange !== null && (
              <div className={`text-xs font-semibold flex items-center gap-1 font-numeric pt-1 ${dayChange >= 0 ? 'text-profit' : 'text-loss'}`}>
                {dayChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                전일대비 {dayChange >= 0 ? '+' : ''}{formatCurrency(dayChange, 'USD')}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* 포트폴리오 가치 그래프 */}
      <PortfolioChart accountId={accountId} />

      {/* 하단 2-컬럼: 상위 포지션 + 포트폴리오 구성 */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-5">
        {/* 상위 포지션 미니 테이블 (3/5) */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              상위 보유 종목
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {topPositions.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8 px-4">보유 종목이 없습니다</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">종목</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground hidden sm:table-cell">현재가</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">평가금액</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground hidden md:table-cell">비중</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">손익</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground hidden lg:table-cell">전일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPositions.map((pos) => {
                      const posCur = (pos.currency as Currency) ?? getCurForAccount(pos.account_id);
                      const mvDisplay = toDisplay(pos.market_value_usd ?? 0, posCur);
                      const plDisplay = toDisplay(pos.unrealized_pl_usd ?? 0, posCur);
                      const plPct = pos.unrealized_pl_percent ?? 0;
                      const weight =
                        totalMarketValueDisplay > 0
                          ? (mvDisplay / totalMarketValueDisplay) * 100
                          : 0;
                      const dayChgRaw = pos.day_change_pl_usd ?? null;
                      const dayChgDisplay = dayChgRaw != null ? toDisplay(dayChgRaw, posCur) : null;
                      return (
                        <tr
                          key={`${pos.account_id}-${pos.ticker}`}
                          className="border-b border-border/50 hover:bg-muted/40 transition-colors"
                        >
                          <td className="px-4 py-1.5">
                            <span className="font-semibold text-sm">{pos.ticker}</span>
                          </td>
                          <td className="text-right px-3 py-1.5 font-numeric text-xs hidden sm:table-cell">
                            {pos.market_price_usd != null
                              ? formatCurrency(pos.market_price_usd, posCur)
                              : '-'}
                          </td>
                          <td className="text-right px-3 py-1.5 font-numeric text-xs">
                            {formatCurrency(mvDisplay, displayCurrency)}
                          </td>
                          <td className="text-right px-3 py-1.5 font-numeric text-xs hidden md:table-cell">
                            {weight.toFixed(1)}%
                          </td>
                          <td className={`text-right px-3 py-1.5 font-numeric text-xs font-semibold ${plDisplay >= 0 ? 'text-profit' : 'text-loss'}`}>
                            {plDisplay >= 0 ? '+' : ''}{formatCurrency(plDisplay, displayCurrency)}
                            <span className="text-[10px] ml-1 opacity-80">({formatPercent(plPct)})</span>
                          </td>
                          <td className={`text-right px-4 py-1.5 font-numeric text-xs hidden lg:table-cell ${dayChgDisplay != null ? (dayChgDisplay >= 0 ? 'text-profit' : 'text-loss') : 'text-muted-foreground'}`}>
                            {dayChgDisplay != null
                              ? `${dayChgDisplay >= 0 ? '+' : ''}${formatCurrency(dayChgDisplay, displayCurrency)}`
                              : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 우측 패널 (2/5): 포트폴리오 구성 + 계정 요약 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 포트폴리오 구성 바 */}
          {totalAssets > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">포트폴리오 구성</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex h-8 rounded-md overflow-hidden border border-border shadow-sm">
                  {netInvestment !== 0 && (
                    <div
                      className="flex items-center justify-center bg-gradient-to-r from-gray-500 to-gray-600 text-white text-[10px] font-semibold"
                      style={{ width: `${Math.max(netInvestmentWidth, 1)}%`, minWidth: '6px' }}
                      title={`순투자금액: ${formatCurrency(netInvestment, 'USD')}`}
                    >
                      {netInvestmentWidth > 12 && <span className="px-1 truncate">순투자</span>}
                    </div>
                  )}
                  {realizedPL !== 0 && (
                    <div
                      className={`flex items-center justify-center text-white text-[10px] font-semibold ${realizedPL >= 0 ? 'bg-gradient-to-r from-green-600 to-green-700' : 'bg-gradient-to-r from-red-600 to-red-700'}`}
                      style={{ width: `${Math.max(realizedPLWidth, 1)}%`, minWidth: '6px' }}
                      title={`실현손익: ${formatCurrency(realizedPL, 'USD')}`}
                    >
                      {realizedPLWidth > 12 && <span className="px-1 truncate">실현</span>}
                    </div>
                  )}
                  {unrealizedPL !== 0 && (
                    <div
                      className={`flex items-center justify-center text-white text-[10px] font-semibold rounded-r-md ${unrealizedPL >= 0 ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-gradient-to-r from-rose-500 to-rose-600'}`}
                      style={{ width: `${Math.max(unrealizedPLWidth, 1)}%`, minWidth: '6px' }}
                      title={`미실현손익: ${formatCurrency(unrealizedPL, 'USD')}`}
                    >
                      {unrealizedPLWidth > 12 && <span className="px-1 truncate">미실현</span>}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-gray-500 inline-block" />
                      <span className="text-muted-foreground">순투자금액</span>
                    </div>
                    <span className="font-numeric font-medium">{formatCurrency(netInvestment, 'USD')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-sm inline-block ${realizedPL >= 0 ? 'bg-green-600' : 'bg-red-600'}`} />
                      <span className="text-muted-foreground">실현 손익</span>
                    </div>
                    <span className={`font-numeric font-medium ${realizedPL >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {realizedPL >= 0 ? '+' : ''}{formatCurrency(realizedPL, 'USD')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-sm inline-block ${unrealizedPL >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      <span className="text-muted-foreground">미실현 손익</span>
                    </div>
                    <span className={`font-numeric font-medium ${unrealizedPL >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {unrealizedPL >= 0 ? '+' : ''}{formatCurrency(unrealizedPL, 'USD')}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 계정별 요약 (전체 보기 모드에서만) */}
          {accountId === null && summary?.accounts_summary && summary.accounts_summary.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">계정별 요약</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {/* 데스크탑: 테이블 */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">계정</th>
                        <th className="text-right px-2 py-1.5 text-muted-foreground font-medium whitespace-nowrap">평가금액</th>
                        <th className="text-right px-3 py-1.5 text-muted-foreground font-medium whitespace-nowrap">총 손익</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.accounts_summary.map((acc) => {
                        const accCur = getCurForAccount(acc.account_id);
                        const mvDisp = toDisplay(acc.total_market_value_usd, accCur);
                        const plDisp = toDisplay(acc.total_pl_usd ?? 0, accCur);
                        return (
                          <tr key={`acc-${acc.account_id}`} className="border-b border-border/50 hover:bg-muted/40">
                            <td className="px-3 py-1.5 font-medium min-w-0 max-w-[140px]">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate">{acc.account_name ?? '—'}</span>
                                <CurrencyBadge currency={accCur} />
                              </div>
                            </td>
                            <td className="text-right px-2 py-1.5 font-numeric whitespace-nowrap">
                              {formatCurrency(mvDisp, displayCurrency)}
                              {acc.total_market_value_usd === 0 && (acc.active_positions_count ?? 0) > 0 && (
                                <span className="block text-[10px] text-muted-foreground">(시세 로딩 중)</span>
                              )}
                            </td>
                            <td className={`text-right px-3 py-1.5 font-numeric font-semibold whitespace-nowrap ${plDisp >= 0 ? 'text-profit' : 'text-loss'}`}>
                              {plDisp >= 0 ? '+' : ''}{formatCurrency(plDisp, displayCurrency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 모바일: 카드형 */}
                <div className="md:hidden px-3 space-y-2">
                  {summary.accounts_summary.map((acc) => {
                    const accCur = getCurForAccount(acc.account_id);
                    const mvDisp = toDisplay(acc.total_market_value_usd, accCur);
                    const pl = toDisplay(acc.total_pl_usd ?? 0, accCur);
                    return (
                      <div key={`acc-card-${acc.account_id}`} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm font-semibold truncate">{acc.account_name ?? '—'}</span>
                          <CurrencyBadge currency={accCur} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-[11px] text-muted-foreground mb-0.5">평가금액</div>
                            <div className="text-sm font-numeric font-medium">
                              {formatCurrency(mvDisp, displayCurrency)}
                              {acc.total_market_value_usd === 0 && (acc.active_positions_count ?? 0) > 0 && (
                                <span className="text-[10px] text-muted-foreground ml-1">(시세 로딩 중)</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-muted-foreground mb-0.5">총 손익</div>
                            <div className={`text-sm font-numeric font-semibold ${pl >= 0 ? 'text-profit' : 'text-loss'}`}>
                              {pl >= 0 ? '+' : ''}{formatCurrency(pl, displayCurrency)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
