import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cashApi, dividendsApi, accountsApi, tradesApi } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle, GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { useChartTheme } from '@/hooks/useChartTheme';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  Plus,
  Download,
  Trash2,
  Loader2,
  Wallet,
  TrendingUp,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Eye,
  X,
} from 'lucide-react';
import type { Cash, DividendPreviewItem, Currency } from '@/types';

// ---------- Types ----------

interface CashFlowProps {
  accountId: number | null;
}

type FilterTab = 'all' | 'cash' | 'dividend';

interface UnifiedTimelineItem {
  id: string;
  date: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'BUY' | 'SELL' | 'DIVIDEND';
  amount_usd: number;
  account_id?: number;
  ticker?: string;
  note?: string;
  amountPerShare?: number;
  sharesHeld?: number;
  taxWithheld?: number;
  isAutoImported?: boolean;
  sourceType: 'cash' | 'dividend';
  sourceId: number;
  relatedTradeId?: number;
  relatedDividendId?: number;
}

interface MonthlyChartData {
  month: string;
  deposits: number;
  dividends: number;
  withdrawals: number;
}

interface ApiLikeError {
  message?: string;
  response?: { data?: { detail?: string } };
}

// ---------- Helpers ----------

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${y}년 ${parseInt(m)}월`;
}

function formatShortMonth(key: string): string {
  const [, m] = key.split('-');
  return `${parseInt(m)}월`;
}

// ---------- Component ----------

export default function CashFlow({ accountId }: CashFlowProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const chartTheme = useChartTheme();

  // --- State ---
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Cash form
  const [showCashForm, setShowCashForm] = useState(false);
  const [cashForm, setCashForm] = useState({
    account_id: accountId || '' as string | number,
    amount_usd: '',
    transaction_type: 'DEPOSIT' as 'DEPOSIT' | 'WITHDRAW',
    transaction_date: new Date().toISOString().split('T')[0],
    note: '',
  });

  // Dividend import
  const [showDividendImport, setShowDividendImport] = useState(false);
  const [yearImportData, setYearImportData] = useState({
    account_id: accountId || '' as string | number,
    year: new Date().getFullYear(),
    tickers: [] as string[],
  });
  const [yearPreviewData, setYearPreviewData] = useState<DividendPreviewItem[] | null>(null);
  const [yearPreviewLoading, setYearPreviewLoading] = useState(false);

  // Ticker list for dividend import
  const [importTickers, setImportTickers] = useState<string[]>([]);
  const [importTickerLoading, setImportTickerLoading] = useState(false);

  useEffect(() => {
    const aid = yearImportData.account_id;
    if (aid) {
      const parsedId = parseInt(aid as string, 10);
      if (!Number.isNaN(parsedId)) {
        setImportTickerLoading(true);
        tradesApi.getTickers(parsedId)
          .then((res) => {
            setImportTickers(res.data);
            setYearImportData((prev) => ({ ...prev, tickers: res.data }));
          })
          .catch(() => {
            setImportTickers([]);
            setYearImportData((prev) => ({ ...prev, tickers: [] }));
          })
          .finally(() => setImportTickerLoading(false));
      }
    } else {
      setImportTickers([]);
      setYearImportData((prev) => ({ ...prev, tickers: [] }));
    }
  }, [yearImportData.account_id]);

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter]);

  // --- Queries ---
  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'active'],
    queryFn: () => accountsApi.getAll(true).then((r) => r.data),
  });

  // 계정 ID로 통화 찾기
  const getAccountCurrency = (accountId?: number): Currency => {
    if (accountId == null) return 'USD';
    const account = accounts?.find((a) => a.id === accountId);
    return account?.base_currency ?? 'USD';
  };

  const { data: cashSummary } = useQuery({
    queryKey: ['cash-summary', accountId],
    queryFn: () => cashApi.getSummary(accountId || undefined).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: dividendSummary } = useQuery({
    queryKey: ['dividend-summary', accountId],
    queryFn: () => dividendsApi.getSummary(accountId || undefined).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: cashTransactions } = useQuery({
    queryKey: ['cash-transactions', accountId],
    queryFn: () => cashApi.getAll({ account_id: accountId || undefined }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: dividends } = useQuery({
    queryKey: ['dividends', accountId],
    queryFn: () => dividendsApi.getAll({ account_id: accountId || undefined }).then((r) => r.data),
    refetchInterval: 30000,
  });

  // --- Derived: Unified Timeline ---
  const unifiedItems = useMemo<UnifiedTimelineItem[]>(() => {
    const items: UnifiedTimelineItem[] = [];

    if (cashTransactions) {
      for (const c of cashTransactions) {
        items.push({
          id: `cash-${c.id}`,
          date: c.transaction_date,
          type: c.transaction_type,
          amount_usd: c.amount_usd,
          account_id: c.account_id,
          note: c.note,
          sourceType: 'cash',
          sourceId: c.id,
          relatedTradeId: c.related_trade_id,
          relatedDividendId: c.related_dividend_id,
        });
      }
    }

    // cash 쪽에서 이미 표시 중인 dividend ID를 수집 (related_dividend_id로 연결된 것)
    const linkedDividendIds = new Set(
      items.filter((i) => i.relatedDividendId != null).map((i) => i.relatedDividendId!)
    );

    if (dividends) {
      for (const d of dividends) {
        // cash 레코드와 이미 연결된 배당은 건너뛰기 (중복 방지)
        if (linkedDividendIds.has(d.id)) continue;
        items.push({
          id: `div-${d.id}`,
          date: d.dividend_date,
          type: 'DIVIDEND',
          amount_usd: d.amount_usd,
          account_id: d.account_id,
          ticker: d.ticker,
          note: d.note,
          amountPerShare: d.amount_per_share,
          sharesHeld: d.shares_held,
          taxWithheld: d.tax_withheld_usd,
          isAutoImported: d.is_auto_imported,
          sourceType: 'dividend',
          sourceId: d.id,
        });
      }
    }

    // Sort descending by date
    items.sort((a, b) => b.date.localeCompare(a.date));
    return items;
  }, [cashTransactions, dividends]);

  // Filter
  const filteredItems = useMemo(() => {
    if (activeFilter === 'cash') return unifiedItems.filter((i) => i.sourceType === 'cash');
    if (activeFilter === 'dividend') return unifiedItems.filter((i) => i.sourceType === 'dividend');
    return unifiedItems;
  }, [unifiedItems, activeFilter]);

  // Group by month
  const groupedByMonth = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const paged = filteredItems.slice(start, start + pageSize);
    const groups: { label: string; items: UnifiedTimelineItem[] }[] = [];
    let currentMonth = '';

    for (const item of paged) {
      const mk = getMonthKey(item.date);
      if (mk !== currentMonth) {
        currentMonth = mk;
        groups.push({ label: formatMonthLabel(mk), items: [] });
      }
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [filteredItems, currentPage, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  // --- Derived: Monthly Chart Data (last 12 months) ---
  const monthlyChartData = useMemo<MonthlyChartData[]>(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const map: Record<string, MonthlyChartData> = {};
    for (const m of months) {
      map[m] = { month: m, deposits: 0, dividends: 0, withdrawals: 0 };
    }

    if (cashTransactions) {
      for (const c of cashTransactions) {
        const mk = getMonthKey(c.transaction_date);
        if (!map[mk]) continue;
        if (c.transaction_type === 'DEPOSIT' || c.transaction_type === 'SELL') {
          map[mk].deposits += c.amount_usd;
        } else if (c.transaction_type === 'WITHDRAW' || c.transaction_type === 'BUY') {
          map[mk].withdrawals += c.amount_usd;
        }
        // Cash DIVIDEND type is already counted via dividends query
      }
    }

    if (dividends) {
      for (const d of dividends) {
        const mk = getMonthKey(d.dividend_date);
        if (map[mk]) {
          map[mk].dividends += d.amount_usd;
        }
      }
    }

    return months.map((m) => ({
      ...map[m],
      withdrawals: -map[m].withdrawals, // negative for chart display
    }));
  }, [cashTransactions, dividends]);

  // --- KPI values ---
  const totalCash = cashSummary?.total_cash_usd ?? 0;
  const totalCashKrw = cashSummary?.total_cash_krw ?? 0;
  const totalDividends = dividendSummary?.total_dividends_usd ?? 0;
  const netCashFlow =
    (cashSummary?.total_deposits_usd ?? 0) - (cashSummary?.total_withdrawals_usd ?? 0);

  // --- Mutations ---
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
    queryClient.invalidateQueries({ queryKey: ['dividends'] });
    queryClient.invalidateQueries({ queryKey: ['dividend-summary'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  const cashCreateMutation = useMutation({
    mutationFn: (data: Omit<Cash, 'id' | 'created_at' | 'updated_at' | 'related_trade_id'>) =>
      cashApi.create(data),
    onSuccess: () => {
      invalidateAll();
      setShowCashForm(false);
      setCashForm({
        account_id: accountId || '',
        amount_usd: '',
        transaction_type: 'DEPOSIT',
        transaction_date: new Date().toISOString().split('T')[0],
        note: '',
      });
      toast({ title: '입출금 등록 완료', variant: 'success' });
    },
    onError: (err: ApiLikeError) => {
      toast({
        title: '입출금 등록 실패',
        description: err.response?.data?.detail || err.message,
        variant: 'destructive',
      });
    },
  });

  const cashDeleteMutation = useMutation({
    mutationFn: (id: number) => cashApi.delete(id),
    onSuccess: () => {
      invalidateAll();
      toast({ title: '현금 내역 삭제 완료' });
    },
  });

  const dividendDeleteMutation = useMutation({
    mutationFn: (id: number) => dividendsApi.delete(id),
    onSuccess: () => {
      invalidateAll();
      toast({ title: '배당금 삭제 완료' });
    },
  });

  const yearImportMutation = useMutation({
    mutationFn: (data: { account_id: number; year: number; tickers?: string[]; preview_only?: boolean }) =>
      dividendsApi.yearImport(data),
    onSuccess: (response) => {
      invalidateAll();
      setShowDividendImport(false);
      setYearPreviewData(null);
      const r = response.data;
      let desc = `${r.summary.imported_count}개 배당금 가져오기 완료`;
      if (r.summary.skipped_count > 0) desc += ` (중복 ${r.summary.skipped_count}개 건너뜀)`;
      toast({ title: '배당 가져오기 완료', description: desc, variant: 'success' });
    },
    onError: (err: ApiLikeError) => {
      toast({
        title: '배당 가져오기 실패',
        description: err.response?.data?.detail || err.message,
        variant: 'destructive',
      });
    },
  });

  // --- Handlers ---
  const handleCashSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashForm.account_id) {
      toast({ title: '계정을 선택해주세요.', variant: 'destructive' });
      return;
    }
    cashCreateMutation.mutate({
      account_id: typeof cashForm.account_id === 'string' ? parseInt(cashForm.account_id) : cashForm.account_id,
      amount_usd: parseFloat(cashForm.amount_usd),
      transaction_type: cashForm.transaction_type,
      transaction_date: cashForm.transaction_date,
      note: cashForm.note || undefined,
    });
  };

  const handleDeleteItem = (item: UnifiedTimelineItem) => {
    if (item.sourceType === 'cash') {
      if (item.relatedTradeId || item.relatedDividendId) {
        toast({ title: '연결된 거래가 있어 삭제할 수 없습니다.', variant: 'destructive' });
        return;
      }
      if (window.confirm('이 현금 내역을 삭제하시겠습니까?')) {
        cashDeleteMutation.mutate(item.sourceId);
      }
    } else {
      if (window.confirm('이 배당금을 삭제하시겠습니까?')) {
        dividendDeleteMutation.mutate(item.sourceId);
      }
    }
  };

  const handleYearPreview = async () => {
    if (!yearImportData.account_id) {
      toast({ title: '계정을 선택해주세요.', variant: 'destructive' });
      return;
    }
    setYearPreviewLoading(true);
    try {
      const res = await dividendsApi.getYearPreview(
        parseInt(yearImportData.account_id as string),
        yearImportData.year,
        yearImportData.tickers.length > 0 ? yearImportData.tickers : undefined,
      );
      setYearPreviewData(res.data.preview_data);
    } catch (err: any) {
      toast({
        title: '미리보기 실패',
        description: err.response?.data?.detail || err.message,
        variant: 'destructive',
      });
    } finally {
      setYearPreviewLoading(false);
    }
  };

  const handleYearImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!yearImportData.account_id) {
      toast({ title: '계정을 선택해주세요.', variant: 'destructive' });
      return;
    }
    yearImportMutation.mutate({
      account_id: typeof yearImportData.account_id === 'string' ? parseInt(yearImportData.account_id) : yearImportData.account_id,
      year: yearImportData.year,
      tickers: yearImportData.tickers.length > 0 ? yearImportData.tickers : undefined,
      preview_only: false,
    });
  };


  // --- Badge helpers ---
  const typeBadge = (type: string) => {
    switch (type) {
      case 'DEPOSIT':
        return { label: '입금', cls: 'bg-profit/10 text-profit' };
      case 'WITHDRAW':
        return { label: '출금', cls: 'bg-loss/10 text-loss' };
      case 'BUY':
        return { label: '매수', cls: 'bg-loss/10 text-loss' };
      case 'SELL':
        return { label: '매도', cls: 'bg-profit/10 text-profit' };
      case 'DIVIDEND':
        return { label: '배당', cls: 'bg-primary/10 text-primary' };
      default:
        return { label: type, cls: 'bg-muted text-muted-foreground' };
    }
  };

  const isPositiveFlow = (type: string) => ['DEPOSIT', 'SELL', 'DIVIDEND'].includes(type);

  const borderColor = (type: string) => {
    if (type === 'DIVIDEND') return 'border-l-primary';
    if (isPositiveFlow(type)) return 'border-l-profit';
    return 'border-l-loss';
  };

  // --- Render ---
  return (
    <div className="space-y-6">
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between flex-wrap gap-3 animate-slide-up">
        <h2 className="text-xl font-bold tracking-tight">자금 흐름</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={showCashForm ? 'default' : 'outline'}
            onClick={() => { setShowCashForm(!showCashForm); setShowDividendImport(false); }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            입출금
          </Button>
          <Button
            size="sm"
            variant={showDividendImport ? 'default' : 'outline'}
            onClick={() => { setShowDividendImport(!showDividendImport); setShowCashForm(false); }}
          >
            <Download className="h-4 w-4 mr-1.5" />
            배당 가져오기
          </Button>
        </div>
      </div>

      {/* ===== KPI Cards ===== */}
      <div className="grid gap-4 md:grid-cols-3 animate-slide-up" style={{ animationDelay: '50ms' }}>
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">현금 잔고</span>
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold font-numeric">{formatCurrency(totalCash, 'USD')}</div>
          <div className="text-xs text-muted-foreground mt-1 font-numeric">
            {formatCurrency(totalCashKrw, 'KRW')}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">총 배당금</span>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold font-numeric text-primary">
            {formatCurrency(totalDividends, 'USD')}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {dividendSummary ? `${dividendSummary.dividend_count}회 / ${dividendSummary.tickers_with_dividends}종목` : '-'}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">순 입출금</span>
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className={`text-2xl font-bold font-numeric ${netCashFlow >= 0 ? 'text-profit' : 'text-loss'}`}>
            {netCashFlow >= 0 ? '+' : ''}{formatCurrency(netCashFlow, 'USD')}
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-numeric">
            입금 {formatCurrency(cashSummary?.total_deposits_usd ?? 0, 'USD')} / 출금 {formatCurrency(cashSummary?.total_withdrawals_usd ?? 0, 'USD')}
          </div>
        </GlassCard>
      </div>

      {/* ===== Cash Form (inline) ===== */}
      {showCashForm && (
        <Card className="animate-slide-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>입출금 등록</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowCashForm(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCashSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <Label>계정</Label>
                <select
                  value={cashForm.account_id}
                  onChange={(e) => setCashForm({ ...cashForm, account_id: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">선택</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>유형</Label>
                <select
                  value={cashForm.transaction_type}
                  onChange={(e) => setCashForm({ ...cashForm, transaction_type: e.target.value as 'DEPOSIT' | 'WITHDRAW' })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="DEPOSIT">입금</option>
                  <option value="WITHDRAW">출금</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>금액 (USD)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={cashForm.amount_usd}
                  onChange={(e) => setCashForm({ ...cashForm, amount_usd: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>거래일</Label>
                <Input
                  type="date"
                  value={cashForm.transaction_date}
                  onChange={(e) => setCashForm({ ...cashForm, transaction_date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>메모</Label>
                <div className="flex gap-2">
                  <Input
                    value={cashForm.note}
                    onChange={(e) => setCashForm({ ...cashForm, note: e.target.value })}
                    placeholder="선택"
                  />
                  <Button type="submit" disabled={cashCreateMutation.isPending} className="shrink-0">
                    {cashCreateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '저장'}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ===== Dividend Import Form ===== */}
      {showDividendImport && (
        <Card className="animate-slide-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                연도별 배당 가져오기
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => { setShowDividendImport(false); setYearPreviewData(null); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleYearImport} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>계정</Label>
                  <select
                    value={yearImportData.account_id}
                    onChange={(e) => setYearImportData({ ...yearImportData, account_id: e.target.value, tickers: [] })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  >
                    <option value="">선택</option>
                    {accounts?.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>연도</Label>
                  <select
                    value={yearImportData.year}
                    onChange={(e) => setYearImportData({ ...yearImportData, year: Number(e.target.value) })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {Array.from({ length: new Date().getFullYear() - 2019 }, (_, i) => {
                      const y = new Date().getFullYear() - i;
                      return <option key={y} value={y}>{y}년</option>;
                    })}
                  </select>
                </div>
              </div>

              {/* Ticker selection */}
              {importTickers.length > 0 && (
                <div className="space-y-1.5">
                  <Label>종목 선택</Label>
                  <div className="border rounded-md p-3 max-h-36 overflow-y-auto">
                    {importTickerLoading ? (
                      <div className="text-center text-muted-foreground py-2 text-sm">로딩 중...</div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                        {importTickers.map((t) => (
                          <label key={t} className="flex items-center gap-1.5 cursor-pointer hover:bg-muted p-1 rounded text-sm">
                            <input
                              type="checkbox"
                              checked={yearImportData.tickers.includes(t)}
                              onChange={(e) => {
                                setYearImportData((prev) => ({
                                  ...prev,
                                  tickers: e.target.checked
                                    ? [...prev.tickers, t]
                                    : prev.tickers.filter((x) => x !== t),
                                }));
                              }}
                              className="rounded"
                            />
                            <span className="font-medium">{t}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {yearImportData.tickers.length}개 종목 선택됨
                  </p>
                </div>
              )}

              {/* Preview results */}
              {yearPreviewData && yearPreviewData.length > 0 && (
                <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5">
                    <Eye className="h-4 w-4" />
                    미리보기 결과
                  </h4>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-lg font-bold font-numeric">
                        {yearPreviewData.reduce((s, i) => s + i.dividend_count, 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">총 배당 횟수</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold font-numeric text-primary">
                        {formatCurrency(yearPreviewData.reduce((s, i) => s + i.total_amount_usd, 0), 'USD')}
                      </div>
                      <div className="text-xs text-muted-foreground">예상 총액</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold font-numeric text-muted-foreground">
                        {yearPreviewData.reduce((s, i) => s + i.existing_count, 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">중복 제외</div>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {yearPreviewData.map((item) => (
                      <div key={item.ticker} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                        <span className="font-medium">{item.ticker}</span>
                        <span className="text-muted-foreground">
                          {item.dividend_count}회 &middot; {formatCurrency(item.total_amount_usd, 'USD')}
                          {item.existing_count > 0 && (
                            <span className="text-loss ml-2">(중복 {item.existing_count}건)</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleYearPreview}
                  disabled={yearPreviewLoading || !yearImportData.account_id}
                >
                  {yearPreviewLoading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
                  미리보기
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={yearImportMutation.isPending || yearImportData.tickers.length === 0}
                >
                  {yearImportMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                  {yearImportMutation.isPending ? '가져오는 중...' : '가져오기 실행'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ===== Filter Tabs + Timeline ===== */}
      <Card className="animate-slide-up" style={{ animationDelay: '100ms' }}>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>거래 내역</CardTitle>
            <div className="flex gap-1.5">
              {([
                { key: 'all', label: '전체' },
                { key: 'cash', label: '입출금' },
                { key: 'dividend', label: '배당' },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeFilter === tab.key
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {tab.label}
                  {tab.key === 'all' && ` (${unifiedItems.length})`}
                  {tab.key === 'cash' && ` (${unifiedItems.filter((i) => i.sourceType === 'cash').length})`}
                  {tab.key === 'dividend' && ` (${unifiedItems.filter((i) => i.sourceType === 'dividend').length})`}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              거래 내역이 없습니다.
            </div>
          ) : (
            <div className="space-y-6">
              {groupedByMonth.map((group) => (
                <div key={group.label}>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {group.label}
                  </h4>
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      const badge = typeBadge(item.type);
                      const positive = isPositiveFlow(item.type);
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-3 border-l-2 ${borderColor(item.type)} pl-3 py-2 rounded-r-lg hover:bg-muted/40 transition-colors group`}
                        >
                          {/* Badge */}
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>
                            {badge.label}
                          </span>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{item.date}</span>
                              {item.ticker && (
                                <span className="text-xs font-semibold text-primary">{item.ticker}</span>
                              )}
                              {item.note && item.sourceType !== 'dividend' && (
                                <span className="text-xs text-muted-foreground">
                                  {item.note}
                                </span>
                              )}
                              {item.relatedTradeId && (
                                <span className="text-[10px] text-muted-foreground">(거래 #{item.relatedTradeId})</span>
                              )}
                            </div>
                            {item.sourceType === 'dividend' && item.amountPerShare && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                ${item.amountPerShare.toFixed(4)}/주
                                {item.sharesHeld ? ` x ${Math.round(item.sharesHeld)}주` : ''}
                                {item.taxWithheld ? ` (세금 -$${item.taxWithheld.toFixed(2)})` : ''}
                              </div>
                            )}
                          </div>

                          {/* Amount */}
                          <span className={`text-sm font-semibold font-numeric shrink-0 ${positive ? 'text-profit' : 'text-loss'}`}>
                            {positive ? '+' : '-'}{formatCurrency(item.amount_usd, getAccountCurrency(item.account_id))}
                          </span>

                          {/* Delete */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0 shrink-0"
                            onClick={() => handleDeleteItem(item)}
                            disabled={
                              cashDeleteMutation.isPending ||
                              dividendDeleteMutation.isPending ||
                              !!(item.sourceType === 'cash' && (item.relatedTradeId || item.relatedDividendId))
                            }
                            title={
                              item.sourceType === 'cash' && (item.relatedTradeId || item.relatedDividendId)
                                ? '연결된 거래가 있어 삭제할 수 없습니다'
                                : '삭제'
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5 text-loss" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    총 {filteredItems.length}건 중 {(currentPage - 1) * pageSize + 1}-
                    {Math.min(currentPage * pageSize, filteredItems.length)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs font-medium">{currentPage} / {totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage >= totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Monthly Cash Flow Chart ===== */}
      <Card className="animate-slide-up" style={{ animationDelay: '150ms' }}>
        <CardHeader>
          <CardTitle>월별 자금 흐름 (최근 12개월)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={formatShortMonth}
                  tick={{ fontSize: 11, fill: chartTheme.muted }}
                  axisLine={{ stroke: chartTheme.grid }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: chartTheme.muted }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: chartTheme.tooltipBg,
                    border: `1px solid ${chartTheme.tooltipBorder}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={formatMonthLabel}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = {
                      deposits: '입금/매도',
                      dividends: '배당',
                      withdrawals: '출금/매수',
                    };
                    return [formatCurrency(Math.abs(value), 'USD'), labels[name] || name];
                  }}
                />
                <ReferenceLine y={0} stroke={chartTheme.grid} />
                <Bar dataKey="deposits" stackId="pos" fill={chartTheme.profit} radius={[2, 2, 0, 0]} />
                <Bar dataKey="dividends" stackId="pos" fill={chartTheme.gold} radius={[2, 2, 0, 0]} />
                <Bar dataKey="withdrawals" fill={chartTheme.loss} radius={[0, 0, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
