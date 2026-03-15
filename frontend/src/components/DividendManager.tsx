import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dividendsApi, accountsApi, tradesApi } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlusCircle, Download, Trash2, Loader2, Calendar, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { formatCurrency } from '@/lib/utils';
import type { Dividend, DividendYearImportRequest, DividendPreviewItem } from '@/types';

interface DividendManagerProps {
  accountId: number | null;
}

interface ApiLikeError {
  message?: string;
  response?: { data?: { detail?: string } };
}

interface DividendAutoImportRequest {
  account_id: number;
  ticker: string;
  start_date?: string;
  end_date?: string;
}

export default function DividendManager({ accountId }: DividendManagerProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentYear = new Date().getFullYear();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showAutoImportForm, setShowAutoImportForm] = useState(false);
  const [showYearImportForm, setShowYearImportForm] = useState(false);

  // 페이징 관련 state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);

  // 올해 필터링 관련 state
  const [showAllYears, setShowAllYears] = useState(false);
  const [showSummaryAllYears, setShowSummaryAllYears] = useState(false);

  const [formData, setFormData] = useState({
    account_id: accountId || '',
    ticker: '',
    amount_usd: '',
    dividend_date: new Date().toISOString().split('T')[0],
    note: '',
  });

  const [autoImportData, setAutoImportData] = useState({
    account_id: accountId || '',
    ticker: '',
    start_date: new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0], // 올해 1월 1일
    end_date: new Date().toISOString().split('T')[0],
  });

  // 연도 기반 가져오기
  const [yearImportData, setYearImportData] = useState({
    account_id: accountId || '',
    year: new Date().getFullYear(),
    tickers: [] as string[],
    preview_only: true,
  });

  const [yearPreviewData, setYearPreviewData] = useState<DividendPreviewItem[] | null>(null);
  const [yearPreviewLoading, setYearPreviewLoading] = useState(false);

  // 계정별 티커 목록 조회 (자동 가져오기)
  const [autoImportTickers, setAutoImportTickers] = useState<string[]>([]);
  const [autoImportTickerLoading, setAutoImportTickerLoading] = useState(false);

  // 계정별 티커 목록 조회 (수동 입력)
  const [manualTickers, setManualTickers] = useState<string[]>([]);
  const [manualTickerLoading, setManualTickerLoading] = useState(false);

  // 자동 가져오기: 계정 선택 시 티커 목록 로드
  useEffect(() => {
    const accountId = autoImportData.account_id;
    if (accountId) {
      const parsedId = parseInt(accountId as string, 10);
      if (!Number.isNaN(parsedId)) {
        setAutoImportTickerLoading(true);
        tradesApi.getTickers(parsedId)
          .then((response) => {
            setAutoImportTickers(response.data);
            setAutoImportTickerLoading(false);
          })
          .catch(() => {
            setAutoImportTickers([]);
            setAutoImportTickerLoading(false);
          });
      } else {
        setAutoImportTickers([]);
        setAutoImportData((prev) => ({ ...prev, ticker: '' }));
      }
    } else {
      setAutoImportTickers([]);
      setAutoImportData((prev) => ({ ...prev, ticker: '' }));
    }
  }, [autoImportData.account_id]);

  // 수동 입력: 계정 선택 시 티커 목록 로드
  useEffect(() => {
    const accountId = formData.account_id;
    if (accountId) {
      const parsedId = parseInt(accountId as string, 10);
      if (!Number.isNaN(parsedId)) {
        setManualTickerLoading(true);
        tradesApi.getTickers(parsedId)
          .then((response) => {
            setManualTickers(response.data);
            setManualTickerLoading(false);
          })
          .catch(() => {
            setManualTickers([]);
            setManualTickerLoading(false);
          });
      } else {
        setManualTickers([]);
        setFormData((prev) => ({ ...prev, ticker: '' }));
      }
    } else {
      setManualTickers([]);
      setFormData((prev) => ({ ...prev, ticker: '' }));
    }
  }, [formData.account_id]);

  // 연도 기반 가져오기: 계정 선택 시 티커 목록 로드
  const [yearImportTickers, setYearImportTickers] = useState<string[]>([]);
  const [yearImportTickerLoading, setYearImportTickerLoading] = useState(false);

  useEffect(() => {
    const accountId = yearImportData.account_id;
    if (accountId) {
      const parsedId = parseInt(accountId as string, 10);
      if (!Number.isNaN(parsedId)) {
        setYearImportTickerLoading(true);
        tradesApi.getTickers(parsedId)
          .then((response) => {
            setYearImportTickers(response.data);
            setYearImportTickerLoading(false);
            // 기본적으로 모든 티커 선택
            setYearImportData(prev => ({ ...prev, tickers: response.data }));
          })
          .catch(() => {
            setYearImportTickers([]);
            setYearImportTickerLoading(false);
            setYearImportData(prev => ({ ...prev, tickers: [] }));
          });
      } else {
        setYearImportTickers([]);
        setYearImportData(prev => ({ ...prev, tickers: [] }));
      }
    } else {
      setYearImportTickers([]);
      setYearImportData(prev => ({ ...prev, tickers: [] }));
    }
  }, [yearImportData.account_id]);

  // 활성 계정 목록 조회
  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'active'],
    queryFn: async () => {
      const response = await accountsApi.getAll(true);
      return response.data;
    },
  });

  // 배당금 목록 조회 (페이징 지원)
  const { data: dividends, isLoading: isDividendsLoading } = useQuery({
    queryKey: ['dividends', accountId, currentPage, pageSize],
    queryFn: () =>
      dividendsApi
        .getAll({
          account_id: accountId || undefined,
          skip: (currentPage - 1) * pageSize,
          limit: pageSize
        })
        .then((res) => res.data),
  });

  // 모든 배당금 데이터 조회 (페이징을 위해)
  const { data: allDividends } = useQuery({
    queryKey: ['dividends-all', accountId],
    queryFn: () =>
      dividendsApi
        .getAll({ account_id: accountId || undefined })
        .then((res) => res.data),
  });

  const totalDividends = allDividends?.length || 0;

  // 배당금 요약 조회 (올해 필터링 지원)
  const { data: summary } = useQuery({
    queryKey: ['dividends-summary', accountId, showSummaryAllYears],
    queryFn: () =>
      dividendsApi
        .getSummary(accountId || undefined, showSummaryAllYears ? undefined : { year: currentYear })
        .then((res) => res.data),
  });

  // 티커별 집계 조회 (올해 필터링 지원)
  const { data: byTicker } = useQuery({
    queryKey: ['dividends-by-ticker', accountId, showAllYears],
    queryFn: () =>
      dividendsApi
        .getByTicker(accountId || undefined, showAllYears ? undefined : { year: currentYear })
        .then((res) => res.data),
  });

  // 배당금 생성 뮤테이션
  const createMutation = useMutation({
    mutationFn: (data: Omit<Dividend, 'id' | 'created_at' | 'updated_at' | 'is_auto_imported'>) => dividendsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-by-ticker'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      
      setFormData({
        ...formData,
        ticker: '',
        amount_usd: '',
        note: '',
      });
      setShowAddForm(false);
      
      toast({
        title: "배당금 등록 완료",
        description: "배당금이 성공적으로 등록되었습니다.",
        variant: "success",
      });
    },
    onError: (error: ApiLikeError) => {
      toast({
        title: "배당금 등록 실패",
        description: error.response?.data?.detail || error.message,
        variant: "destructive",
      });
    },
  });

  // 배당금 삭제 뮤테이션
  const deleteMutation = useMutation({
    mutationFn: (id: number) => dividendsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-by-ticker'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      
      toast({
        title: "배당금 삭제 완료",
        description: "배당금 및 관련 현금 거래가 삭제되었습니다.",
      });
    },
    onError: (error: ApiLikeError) => {
      toast({
        title: "배당금 삭제 실패",
        description: error.response?.data?.detail || error.message,
        variant: "destructive",
      });
    },
  });

  // 자동 가져오기 뮤테이션
  const autoImportMutation = useMutation({
    mutationFn: (data: DividendAutoImportRequest) => dividendsApi.autoImport(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-by-ticker'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });

      const result = response.data;
      setShowAutoImportForm(false);

      toast({
        title: "자동 가져오기 완료",
        description: `${result.imported_count}개 배당금 가져오기 완료 (중복 ${result.skipped_count}개 건너뜀)`,
        variant: "success",
      });
    },
    onError: (error: ApiLikeError) => {
      toast({
        title: "자동 가져오기 실패",
        description: error.response?.data?.detail || error.message,
        variant: "destructive",
      });
    },
  });

  // 연도 기반 가져오기 뮤테이션
  const yearImportMutation = useMutation({
    mutationFn: (data: DividendYearImportRequest) => dividendsApi.yearImport(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dividends-by-ticker'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });

      const result = response.data;
      setShowYearImportForm(false);
      setYearPreviewData(null);

      // 성공 메시지 생성
      let description = `${result.summary.imported_count}개 배당금 가져오기 완료`;
      if (result.summary.skipped_count > 0) {
        description += ` (중복 ${result.summary.skipped_count}개 건너뜀)`;
      }
      if (result.summary.error_count && result.summary.error_count > 0) {
        description += ` (에러 ${result.summary.error_count}개 발생)`;
      }
      
      // 실패한 티커가 있으면 경고 표시
      if (result.summary.failed_count && result.summary.failed_count > 0) {
        const failedTickers = result.summary.failed_tickers || [];
        const tickerList = failedTickers.map((f: { ticker: string }) => f.ticker).join(', ');
        toast({
          title: "연도별 배당 가져오기 완료 (일부 실패)",
          description: `${description}\n실패한 종목: ${tickerList} (${result.summary.failed_count}개)`,
          variant: "default",
        });
        
        // 실패한 티커별 상세 에러 표시
        failedTickers.forEach((failed: { ticker: string; error: string }) => {
          toast({
            title: `${failed.ticker} 가져오기 실패`,
            description: failed.error || "알 수 없는 오류",
            variant: "destructive",
          });
        });
      } else {
        toast({
          title: "연도별 배당 가져오기 완료",
          description: description,
          variant: "success",
        });
      }
    },
    onError: (error: ApiLikeError) => {
      toast({
        title: "연도별 가져오기 실패",
        description: error.response?.data?.detail || error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.account_id) {
      toast({
        title: "입력 오류",
        description: "계정을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    const data = {
      account_id: typeof formData.account_id === 'string' ? parseInt(formData.account_id) : formData.account_id,
      ticker: formData.ticker.toUpperCase(),
      amount_usd: parseFloat(formData.amount_usd),
      dividend_date: formData.dividend_date,
      note: formData.note || undefined,
    };

    createMutation.mutate(data);
  };

  const handleAutoImport = (e: React.FormEvent) => {
    e.preventDefault();

    if (!autoImportData.account_id || !autoImportData.ticker) {
      toast({
        title: "입력 오류",
        description: "계정과 티커를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    const data = {
      account_id: typeof autoImportData.account_id === 'string' ? parseInt(autoImportData.account_id) : autoImportData.account_id,
      ticker: autoImportData.ticker.toUpperCase(),
      start_date: autoImportData.start_date,
      end_date: autoImportData.end_date,
    };

    autoImportMutation.mutate(data);
  };

  const handleYearPreview = async () => {
    if (!yearImportData.account_id) {
      toast({
        title: "입력 오류",
        description: "계정을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    setYearPreviewLoading(true);
    try {
      const response = await dividendsApi.getYearPreview(
        parseInt(yearImportData.account_id as string),
        yearImportData.year,
        yearImportData.tickers.length > 0 ? yearImportData.tickers : undefined
      );
      setYearPreviewData(response.data.preview_data);
    } catch (error: any) {
      toast({
        title: "미리보기 실패",
        description: error.response?.data?.detail || error.message,
        variant: "destructive",
      });
    } finally {
      setYearPreviewLoading(false);
    }
  };

  const handleYearImport = (e: React.FormEvent) => {
    e.preventDefault();

    if (!yearImportData.account_id) {
      toast({
        title: "입력 오류",
        description: "계정을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    const data = {
      account_id: typeof yearImportData.account_id === 'string' ? parseInt(yearImportData.account_id) : yearImportData.account_id,
      year: yearImportData.year,
      tickers: yearImportData.tickers.length > 0 ? yearImportData.tickers : undefined,
      preview_only: false,
    };

    yearImportMutation.mutate(data);
  };

  const handleDelete = (id: number) => {
    if (window.confirm('이 배당금을 삭제하시겠습니까?')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* 배당금 요약 */}
      {summary && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                배당금 요약 {showSummaryAllYears ? "(전체 기간)" : `(${currentYear}년)`}
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSummaryAllYears(!showSummaryAllYears)}
              >
                {showSummaryAllYears ? "올해 보기" : "전체 보기"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-sm text-muted-foreground">총 배당금 (USD)</div>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(summary.total_dividends_usd, 'USD')}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">총 배당금 (KRW)</div>
                <div className="text-xl font-bold text-green-600">
                  {formatCurrency(summary.total_dividends_krw, 'KRW')}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">배당 횟수</div>
                <div className="text-2xl font-bold">{summary.dividend_count}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">배당 종목</div>
                <div className="text-2xl font-bold">{summary.tickers_with_dividends}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 티커별 집계 */}
      {byTicker && byTicker.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>티커별 배당금 {showAllYears ? "(전체 기간)" : `(${currentYear}년)`}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllYears(!showAllYears)}
              >
                {showAllYears ? "올해 보기" : "전체 보기"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {byTicker.map((item) => (
                <div key={item.ticker} className="border rounded-lg p-3">
                  <div className="font-medium text-blue-600">{item.ticker}</div>
                  <div className="text-sm text-muted-foreground">{formatCurrency(item.total_amount_usd, 'USD')}</div>
                  <div className="text-xs text-muted-foreground">{item.count}회</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 배당금 등록/자동가져오기 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>배당금 관리</CardTitle>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setShowYearImportForm(!showYearImportForm);
                  setShowAddForm(false);
                  setShowAutoImportForm(false);
                }}
                variant="default"
                size="sm"
              >
                <Calendar className="h-4 w-4 mr-2" />
                연도별 가져오기
              </Button>
              <Button
                onClick={() => {
                  setShowAutoImportForm(!showAutoImportForm);
                  setShowAddForm(false);
                  setShowYearImportForm(false);
                }}
                variant="outline"
                size="sm"
              >
                <Download className="h-4 w-4 mr-2" />
                자동 가져오기
              </Button>
              <Button
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  setShowAutoImportForm(false);
                  setShowYearImportForm(false);
                }}
                variant="outline"
                size="sm"
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                수동 입력
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* 수동 입력 폼 */}
          {showAddForm && (
            <form onSubmit={handleSubmit} className="space-y-4 mb-6 p-4 border rounded-lg bg-gray-50 dark:bg-gray-900">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="account_id">계정 *</Label>
                  <select
                    id="account_id"
                    value={formData.account_id}
                    onChange={(e) => setFormData({ ...formData, account_id: e.target.value, ticker: '' })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  >
                    <option value="">계정을 선택하세요</option>
                    {accounts?.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ticker">티커 *</Label>
                  <select
                    id="ticker"
                    value={formData.ticker}
                    onChange={(e) => setFormData({ ...formData, ticker: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    disabled={!formData.account_id || manualTickerLoading}
                    required
                  >
                    <option value="">
                      {manualTickerLoading ? '로딩 중...' : formData.account_id ? '티커를 선택하세요' : '계정을 먼저 선택하세요'}
                    </option>
                    {manualTickers.map((ticker) => (
                      <option key={ticker} value={ticker}>
                        {ticker}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount_usd">배당금 (USD) *</Label>
                  <Input
                    id="amount_usd"
                    type="number"
                    step="0.01"
                    value={formData.amount_usd}
                    onChange={(e) => setFormData({ ...formData, amount_usd: e.target.value })}
                    placeholder="10.50"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dividend_date">배당 지급일 *</Label>
                  <Input
                    id="dividend_date"
                    type="date"
                    value={formData.dividend_date}
                    onChange={(e) => setFormData({ ...formData, dividend_date: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">메모</Label>
                <Input
                  id="note"
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  placeholder="메모 (선택사항)"
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlusCircle className="h-4 w-4 mr-2" />
                  )}
                  {createMutation.isPending ? '등록 중...' : '배당금 등록'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
                  취소
                </Button>
              </div>
            </form>
          )}

          {/* 자동 가져오기 폼 */}
          {showAutoImportForm && (
            <form onSubmit={handleAutoImport} className="space-y-4 mb-6 p-4 border rounded-lg bg-blue-50 dark:bg-blue-950">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="auto_account_id">계정 *</Label>
                  <select
                    id="auto_account_id"
                    value={autoImportData.account_id}
                    onChange={(e) => setAutoImportData({ ...autoImportData, account_id: e.target.value, ticker: '' })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  >
                    <option value="">계정을 선택하세요</option>
                    {accounts?.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="auto_ticker">티커 *</Label>
                  <select
                    id="auto_ticker"
                    value={autoImportData.ticker}
                    onChange={(e) => setAutoImportData({ ...autoImportData, ticker: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    disabled={!autoImportData.account_id || autoImportTickerLoading}
                    required
                  >
                    <option value="">
                      {autoImportTickerLoading ? '로딩 중...' : autoImportData.account_id ? '티커를 선택하세요' : '계정을 먼저 선택하세요'}
                    </option>
                    {autoImportTickers.map((ticker) => (
                      <option key={ticker} value={ticker}>
                        {ticker}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_date">시작 날짜</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={autoImportData.start_date}
                    onChange={(e) => setAutoImportData({ ...autoImportData, start_date: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end_date">종료 날짜</Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={autoImportData.end_date}
                    onChange={(e) => setAutoImportData({ ...autoImportData, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={autoImportMutation.isPending}>
                  {autoImportMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {autoImportMutation.isPending ? '가져오는 중...' : '자동 가져오기'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAutoImportForm(false)}>
                  취소
                </Button>
              </div>
            </form>
          )}

          {/* 연도 기반 가져오기 폼 */}
          {showYearImportForm && (
            <div className="space-y-4 mb-6 p-4 border rounded-lg bg-green-50 dark:bg-green-950">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  연도별 배당 가져오기
                </h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={handleYearPreview}
                    variant="outline"
                    size="sm"
                    disabled={yearPreviewLoading}
                  >
                    {yearPreviewLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Eye className="h-4 w-4 mr-2" />
                    )}
                    미리보기
                  </Button>
                </div>
              </div>

              <form onSubmit={handleYearImport} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="year_account_id">계정 *</Label>
                    <select
                      id="year_account_id"
                      value={yearImportData.account_id}
                      onChange={(e) => setYearImportData({ ...yearImportData, account_id: e.target.value, tickers: [] })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">계정을 선택하세요</option>
                      {accounts?.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="year">연도 *</Label>
                    <select
                      id="year"
                      value={yearImportData.year}
                      onChange={(e) => setYearImportData({ ...yearImportData, year: Number(e.target.value) })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      {Array.from({ length: new Date().getFullYear() - 2019 }, (_, i) => {
                        const year = new Date().getFullYear() - i;
                        return (
                          <option key={year} value={year}>
                            {year}년
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* 티커 선택 */}
                {yearImportTickers.length > 0 && (
                  <div className="space-y-2">
                    <Label>종목 선택</Label>
                    <div className="border rounded-md p-3 max-h-40 overflow-y-auto">
                      {yearImportTickerLoading ? (
                        <div className="text-center text-muted-foreground py-4">
                          종목 목록을 불러오는 중...
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                          {yearImportTickers.map((ticker) => (
                            <label key={ticker} className="flex items-center space-x-2 cursor-pointer hover:bg-muted p-1 rounded">
                              <input
                                type="checkbox"
                                checked={yearImportData.tickers.includes(ticker)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setYearImportData(prev => ({
                                      ...prev,
                                      tickers: [...prev.tickers, ticker]
                                    }));
                                  } else {
                                    setYearImportData(prev => ({
                                      ...prev,
                                      tickers: prev.tickers.filter(t => t !== ticker)
                                    }));
                                  }
                                }}
                                className="rounded"
                              />
                              <span className="text-sm font-medium">{ticker}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      선택된 {yearImportData.tickers.length}개 종목의 배당 데이터를 가져옵니다.
                    </p>
                  </div>
                )}

                {/* 미리보기 결과 */}
                {yearPreviewData && yearPreviewData.length > 0 && (
                  <div className="border rounded-lg p-4 bg-background">
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      가져오기 미리보기
                    </h4>

                    {/* 요약 정보 */}
                    <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-muted rounded">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {yearPreviewData.reduce((sum, item) => sum + item.dividend_count, 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">총 배당 횟수</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {formatCurrency(
                            yearPreviewData.reduce((sum, item) => sum + item.total_amount_usd, 0),
                            'USD'
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">예상 총액</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">
                          {yearPreviewData.reduce((sum, item) => sum + item.existing_count, 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">중복 제외</div>
                      </div>
                    </div>

                    {/* 종목별 상세 */}
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {yearPreviewData.map((item) => (
                        <div key={item.ticker} className="border rounded p-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium">{item.ticker}</span>
                            <span className="text-sm text-muted-foreground">
                              {item.dividend_count}회 • {formatCurrency(item.total_amount_usd, 'USD')}
                            </span>
                          </div>

                          {item.existing_count > 0 && (
                            <div className="text-xs text-orange-600 mb-2">
                              ⚠️ {item.existing_count}건의 중복 데이터가 제외됩니다.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={yearImportMutation.isPending || yearImportData.tickers.length === 0}
                  >
                    {yearImportMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {yearImportMutation.isPending ? '가져오는 중...' : '연도별 가져오기'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowYearImportForm(false);
                      setYearPreviewData(null);
                    }}
                  >
                    취소
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* 배당금 목록 */}
          {isDividendsLoading ? (
            <div className="text-center p-8">로딩 중...</div>
          ) : dividends && dividends.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>날짜</TableHead>
                      <TableHead>티커</TableHead>
                      <TableHead className="text-right hidden lg:table-cell">주당</TableHead>
                      <TableHead className="text-right hidden lg:table-cell">수량</TableHead>
                      <TableHead className="text-right hidden md:table-cell">세금</TableHead>
                      <TableHead className="text-right">세후 배당금</TableHead>
                      <TableHead className="hidden xl:table-cell text-sm">메모</TableHead>
                      <TableHead className="hidden sm:table-cell">방법</TableHead>
                      <TableHead className="text-right">작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dividends.map((dividend) => (
                      <TableRow key={dividend.id}>
                        <TableCell>{dividend.dividend_date}</TableCell>
                        <TableCell className="font-medium">{dividend.ticker}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground hidden lg:table-cell">
                          {dividend.amount_per_share ? `$${dividend.amount_per_share.toFixed(4)}` : '-'}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground hidden lg:table-cell">
                          {dividend.shares_held ? `${Math.round(dividend.shares_held)}주` : '-'}
                        </TableCell>
                        <TableCell className="text-right text-xs text-red-600 hidden md:table-cell">
                          {dividend.tax_withheld_usd ? `-$${dividend.tax_withheld_usd.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-semibold">
                          {formatCurrency(dividend.amount_usd, 'USD')}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                          {dividend.note || '-'}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className={`text-xs px-2 py-1 rounded ${
                            dividend.is_auto_imported
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                          }`}>
                            {dividend.is_auto_imported ? '자동' : '수동'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(dividend.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {totalDividends && totalDividends > pageSize && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    총 {totalDividends}개 항목 중 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalDividends)}개 표시
                  </div>
                  <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    이전
                  </Button>

                    <span className="text-sm">
                      {currentPage} / {Math.ceil(totalDividends / pageSize)}
                    </span>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.min(Math.ceil(totalDividends / pageSize), currentPage + 1))}
                    disabled={currentPage >= Math.ceil(totalDividends / pageSize)}
                  >
                    다음
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center p-8 text-muted-foreground">
              배당금 기록이 없습니다.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

