import { useQuery } from '@tanstack/react-query';
import { snapshotsApi } from '@/services/api';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  LineChart, 
  Line, 
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Brush
} from 'recharts';
import { useState, useMemo } from 'react';
import { subDays, format } from 'date-fns';
import { Calendar, RefreshCw, ChevronDown, ChevronUp, Download, BarChart3, LineChart as LineChartIcon, Activity } from 'lucide-react';
import type { PortfolioChartData } from '@/types';

interface PortfolioChartProps {
  accountId: number | null;
}

type TimeRange = '1W' | '1M' | '3M' | '1Y' | 'ALL';
type ChartType = 'line' | 'area' | 'bar';

const TIME_RANGES: Record<TimeRange, { label: string; days: number }> = {
  '1W': { label: '1W', days: 7 },
  '1M': { label: '1M', days: 30 },
  '3M': { label: '3M', days: 90 },
  '1Y': { label: '1Y', days: 365 },
  'ALL': { label: 'ALL', days: 0 },
};

export default function PortfolioChart({ accountId }: PortfolioChartProps) {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('3M');
  const [isExpanded, setIsExpanded] = useState(true);
  const [chartType, setChartType] = useState<ChartType>('area');

  // 날짜 범위 계산
  const dateRange = useMemo(() => {
    const endDate = new Date();
    const startDate = selectedRange === 'ALL' 
      ? new Date('2020-01-01') // 충분히 과거 날짜
      : subDays(endDate, TIME_RANGES[selectedRange].days);
    
    return {
      start_date: format(startDate, 'yyyy-MM-dd'),
      end_date: format(endDate, 'yyyy-MM-dd'),
    };
  }, [selectedRange]);

  // 스냅샷 데이터 조회
  const { data: snapshots, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['snapshots-range', accountId, dateRange.start_date, dateRange.end_date],
    queryFn: () =>
      snapshotsApi
        .getRange({
          start_date: dateRange.start_date,
          end_date: dateRange.end_date,
          account_id: accountId || undefined,
        })
        .then((res) => res.data),
    refetchInterval: 300000, // 5분마다 자동 갱신
    retry: 3,
  });

  // 차트 데이터 변환
  const chartData: PortfolioChartData[] = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];

    return snapshots
      .filter(snapshot => 
        snapshot.total_market_value_usd !== null && 
        snapshot.total_market_value_usd !== undefined
      )
      .map(snapshot => {
        const totalCost = (snapshot.total_market_value_usd || 0) - (snapshot.total_pl_usd || 0);
        const totalPlPercent = totalCost > 0 ? ((snapshot.total_pl_usd || 0) / totalCost) * 100 : 0;
        
        return {
          date: snapshot.snapshot_date,
          total_market_value_usd: snapshot.total_market_value_usd || 0,
          total_cost_usd: totalCost,
          total_pl_usd: snapshot.total_pl_usd || 0,
          total_pl_percent: totalPlPercent,
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [snapshots]);

  // 통계 계산
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;

    const latest = chartData[chartData.length - 1];
    const first = chartData[0];
    
    const totalReturn = latest.total_market_value_usd - first.total_market_value_usd;
    const totalReturnPercent = first.total_market_value_usd > 0 
      ? (totalReturn / first.total_market_value_usd) * 100 
      : 0;

    return {
      currentValue: latest.total_market_value_usd,
      totalReturn,
      totalReturnPercent,
      period: `${format(new Date(first.date), 'MM/dd')} - ${format(new Date(latest.date), 'MM/dd')}`,
    };
  }, [chartData]);

  // CSV 내보내기
  const exportToCSV = () => {
    if (!chartData || chartData.length === 0) return;

    const csvHeaders = ['날짜', '평가금액(USD)', '투자원금(USD)', '총손익(USD)', '수익률(%)'];
    const csvRows = chartData.map(data => [
      data.date,
      data.total_market_value_usd.toFixed(2),
      data.total_cost_usd.toFixed(2),
      data.total_pl_usd.toFixed(2),
      data.total_pl_percent.toFixed(2),
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `portfolio_chart_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // 커스텀 툴팁 (다크모드 지원)
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as PortfolioChartData;
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg shadow-elevation-4 min-w-[220px] backdrop-blur-sm">
          <p className="font-semibold text-gray-900 dark:text-gray-100 mb-3 text-base border-b border-gray-200 dark:border-gray-700 pb-2">
            {format(new Date(label), 'yyyy년 MM월 dd일')}
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center gap-3 p-2 rounded bg-gradient-to-r from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10">
              <span className="text-blue-600 dark:text-blue-400 font-medium">총 평가금액:</span>
              <span className="font-bold text-blue-700 dark:text-blue-300">{formatCurrency(data.total_market_value_usd, 'USD')}</span>
            </div>
            <div className="flex justify-between items-center gap-3 p-2 rounded bg-gray-50 dark:bg-gray-900/50">
              <span className="text-gray-600 dark:text-gray-400">투자원금:</span>
              <span className="font-semibold">{formatCurrency(data.total_cost_usd, 'USD')}</span>
            </div>
            <div className={`flex justify-between items-center gap-3 p-2 rounded ${
              data.total_pl_usd >= 0 
                ? 'bg-gradient-to-r from-green-50 to-green-100/50 dark:from-green-900/20 dark:to-green-800/10' 
                : 'bg-gradient-to-r from-red-50 to-red-100/50 dark:from-red-900/20 dark:to-red-800/10'
            }`}>
              <span className="text-gray-600 dark:text-gray-400 font-medium">총 손익:</span>
              <span className={`font-bold ${data.total_pl_usd >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {data.total_pl_usd >= 0 ? '+' : ''}{formatCurrency(data.total_pl_usd, 'USD')}
              </span>
            </div>
            <div className={`flex justify-between items-center gap-3 p-2 rounded ${
              data.total_pl_percent >= 0 
                ? 'bg-gradient-to-r from-green-50 to-green-100/50 dark:from-green-900/20 dark:to-green-800/10' 
                : 'bg-gradient-to-r from-red-50 to-red-100/50 dark:from-red-900/20 dark:to-red-800/10'
            }`}>
              <span className="text-gray-600 dark:text-gray-400 font-medium">수익률:</span>
              <span className={`font-bold ${data.total_pl_percent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {formatPercent(data.total_pl_percent)}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // 로딩 상태
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">데이터 로딩 중...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 에러 상태
  if (isError) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-48 space-y-4">
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
        </CardContent>
      </Card>
    );
  }

  // 데이터 없음
  if (!chartData || chartData.length === 0) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-48 space-y-4">
            <Calendar className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2">데이터가 없습니다</h3>
              <p className="text-sm text-muted-foreground">
                스냅샷 데이터가 없어 그래프를 표시할 수 없습니다.
                <br />
                수동으로 스냅샷을 생성하거나 자동 스케줄러를 확인해주세요.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover-lift">
      <CardHeader 
        className={`${isExpanded ? 'pb-2' : 'pb-4'} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-t-lg`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-gradient-primary">
            포트폴리오 그래프
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 transition-transform" />
            ) : (
              <ChevronDown className="h-4 w-4 transition-transform" />
            )}
          </CardTitle>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <>
          <CardHeader className="pb-2 pt-0">
            {/* 컨트롤 영역 */}
            <div className="space-y-3">
              {/* 기간 선택 및 차트 타입 */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-1 items-center">
                  {/* 기간 선택 */}
                  {Object.entries(TIME_RANGES).map(([key, range]) => (
                    <Button
                      key={key}
                      variant={selectedRange === key ? 'default' : 'outline'}
                      size="sm"
                      className="px-2 py-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRange(key as TimeRange);
                      }}
                    >
                      {range.label}
                    </Button>
                  ))}
                  
                  {/* 구분선 */}
                  <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-1" />
                  
                  {/* 차트 타입 선택 */}
                  <Button
                    variant={chartType === 'line' ? 'default' : 'outline'}
                    size="sm"
                    className="px-2 py-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChartType('line');
                    }}
                    title="라인 차트"
                  >
                    <LineChartIcon className="h-3 w-3" />
                  </Button>
                  <Button
                    variant={chartType === 'area' ? 'default' : 'outline'}
                    size="sm"
                    className="px-2 py-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChartType('area');
                    }}
                    title="영역 차트"
                  >
                    <Activity className="h-3 w-3" />
                  </Button>
                  <Button
                    variant={chartType === 'bar' ? 'default' : 'outline'}
                    size="sm"
                    className="px-2 py-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChartType('bar');
                    }}
                    title="막대 차트"
                  >
                    <BarChart3 className="h-3 w-3" />
                  </Button>
                </div>
                
                {/* 액션 버튼 */}
                <div className="flex gap-1">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      exportToCSV();
                    }}
                    variant="outline"
                    size="sm"
                    className="px-2 py-1"
                    title="CSV 내보내기"
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      refetch();
                    }}
                    variant="outline"
                    size="sm"
                    className="px-2 py-1"
                    title="새로고침"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* 통계 */}
              {stats && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 border border-blue-200/50 dark:border-blue-800/50 p-3 rounded-lg hover-lift">
                    <div className="text-xs text-muted-foreground mb-1">현재 평가금액</div>
                    <div className="text-base font-bold text-blue-600 dark:text-blue-400">{formatCurrency(stats.currentValue, 'USD')}</div>
                  </div>
                  <div className={`p-3 rounded-lg border hover-lift ${
                    stats.totalReturn >= 0 
                      ? 'bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-900/20 dark:to-green-800/10 border-green-200/50 dark:border-green-800/50' 
                      : 'bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-900/20 dark:to-red-800/10 border-red-200/50 dark:border-red-800/50'
                  }`}>
                    <div className="text-xs text-muted-foreground mb-1">기간 수익</div>
                    <div className={`text-base font-bold ${stats.totalReturn >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {stats.totalReturn >= 0 ? '+' : ''}{formatCurrency(stats.totalReturn, 'USD')}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg border col-span-2 md:col-span-1 hover-lift ${
                    stats.totalReturnPercent >= 0 
                      ? 'bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-900/20 dark:to-green-800/10 border-green-200/50 dark:border-green-800/50' 
                      : 'bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-900/20 dark:to-red-800/10 border-red-200/50 dark:border-red-800/50'
                  }`}>
                    <div className="text-xs text-muted-foreground mb-1">기간 수익률</div>
                    <div className={`text-base font-bold ${stats.totalReturnPercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatPercent(stats.totalReturnPercent)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          
          <CardContent className="pt-0">
            <div className="h-80 w-full bg-gradient-to-br from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-800/50 rounded-lg p-4 border border-gray-200/50 dark:border-gray-700/50 shadow-inner">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'line' ? (
                  <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                        <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#60a5fa" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                      stroke="#9ca3af"
                      fontSize={11}
                    />
                    <YAxis 
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                      stroke="#9ca3af"
                      fontSize={11}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Brush 
                      dataKey="date" 
                      height={30} 
                      stroke="#3b82f6"
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_market_value_usd"
                      name="평가금액"
                      stroke="url(#lineGradient)"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 7, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                      animationDuration={800}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_cost_usd"
                      name="투자원금"
                      stroke="#6b7280"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      animationDuration={800}
                    />
                  </LineChart>
                ) : chartType === 'area' ? (
                  <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
                        <stop offset="50%" stopColor="#60a5fa" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6b7280" stopOpacity={0.7} />
                        <stop offset="50%" stopColor="#9ca3af" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#6b7280" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="areaLineGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#60a5fa" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                      stroke="#9ca3af"
                      fontSize={11}
                    />
                    <YAxis 
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                      stroke="#9ca3af"
                      fontSize={11}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Brush 
                      dataKey="date" 
                      height={30} 
                      stroke="#3b82f6"
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                    />
                    <Area
                      type="monotone"
                      dataKey="total_market_value_usd"
                      name="평가금액"
                      stroke="url(#areaLineGradient)"
                      strokeWidth={3}
                      fill="url(#colorValue)"
                      activeDot={{ r: 7, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                      animationDuration={800}
                    />
                    <Area
                      type="monotone"
                      dataKey="total_cost_usd"
                      name="투자원금"
                      stroke="#6b7280"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      fill="url(#colorCost)"
                      animationDuration={800}
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#60a5fa" />
                      </linearGradient>
                      <linearGradient id="barCostGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6b7280" />
                        <stop offset="100%" stopColor="#9ca3af" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                      stroke="#9ca3af"
                      fontSize={11}
                    />
                    <YAxis 
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                      stroke="#9ca3af"
                      fontSize={11}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Brush 
                      dataKey="date" 
                      height={30} 
                      stroke="#3b82f6"
                      tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                    />
                    <Bar
                      dataKey="total_market_value_usd"
                      name="평가금액"
                      fill="url(#barGradient)"
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                    />
                    <Bar
                      dataKey="total_cost_usd"
                      name="투자원금"
                      fill="url(#barCostGradient)"
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}
