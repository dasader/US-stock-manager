import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tradesApi, pricesApi, positionsApi, accountsApi } from '@/services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import CsvManagementModal from './CsvManagementModal';
import type { Trade, Account } from '@/types';
import {
  Plus,
  X,
  Search,
  Trash2,
  Edit2,
  Check,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
} from 'lucide-react';

interface TradesProps {
  accountId: number | null;
}

const INVALIDATE_KEYS = ['trades', 'positions', 'dashboard-summary', 'cash-transactions', 'cash-summary'];
const PAGE_SIZE = 20;

export default function Trades({ accountId }: TradesProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // --- State ---
  const [showPanel, setShowPanel] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [filters, setFilters] = useState({ ticker: '', start_date: '', end_date: '', side: '' });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTrades, setSelectedTrades] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Trade>>({});

  // Trade form state
  const [formData, setFormData] = useState({
    account_id: accountId || ('' as number | string),
    ticker: '',
    side: 'BUY' as 'BUY' | 'SELL',
    shares: '',
    price_usd: '',
    trade_date: new Date().toISOString().split('T')[0],
    note: '',
  });
  const [tickerValidation, setTickerValidation] = useState<{ valid: boolean | null; message: string }>({
    valid: null,
    message: '',
  });
  const [isValidatingTicker, setIsValidatingTicker] = useState(false);

  // --- Debounced filter ---
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setCurrentPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [filters]);

  // Sync accountId prop to form
  useEffect(() => {
    if (accountId) {
      setFormData((prev) => ({ ...prev, account_id: accountId }));
    }
  }, [accountId]);

  // Close panel on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showPanel) setShowPanel(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showPanel]);

  // --- Queries ---
  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'active'],
    queryFn: async () => (await accountsApi.getAll(true)).data,
  });

  const { data: allAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await accountsApi.getAll()).data,
  });

  const { data: trades, isLoading } = useQuery({
    queryKey: ['trades', accountId, debouncedFilters, currentPage],
    queryFn: async () =>
      (
        await tradesApi.getAll({
          account_id: accountId || undefined,
          ticker: debouncedFilters.ticker || undefined,
          start_date: debouncedFilters.start_date || undefined,
          end_date: debouncedFilters.end_date || undefined,
          side: debouncedFilters.side || undefined,
        })
      ).data,
  });

  const { data: currentPosition } = useQuery({
    queryKey: ['position', formData.ticker, formData.account_id],
    queryFn: async () => {
      if (!formData.ticker || !formData.account_id) return null;
      try {
        const aid = typeof formData.account_id === 'string' ? parseInt(formData.account_id) : formData.account_id;
        return (await positionsApi.getOne(formData.ticker, aid)).data;
      } catch {
        return null;
      }
    },
    enabled: Boolean(formData.ticker && formData.account_id && formData.side === 'SELL'),
  });

  // --- Mutations ---
  const invalidateAll = useCallback(() => {
    INVALIDATE_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  }, [queryClient]);

  const createTradeMutation = useMutation({
    mutationFn: (data: Omit<Trade, 'id' | 'created_at' | 'updated_at'>) => tradesApi.create(data),
    onSuccess: (_res, variables) => {
      invalidateAll();
      setFormData((prev) => ({ ...prev, shares: '', price_usd: '', note: '' }));
      toast({ title: '거래 등록 완료', description: `${variables.ticker} ${variables.side} 거래가 등록되었습니다.`, variant: 'success' });
      setShowPanel(false);
    },
    onError: (error: { message?: string }) => {
      toast({ title: '거래 등록 실패', description: error.message || '알 수 없는 오류', variant: 'destructive' });
    },
  });

  const updateTradeMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Trade> }) => tradesApi.update(id, data),
    onSuccess: () => {
      invalidateAll();
      setEditingId(null);
      setEditForm({});
      toast({ title: '거래 수정 완료', variant: 'success' });
    },
  });

  const deleteTradeMutation = useMutation({
    mutationFn: (id: number) => tradesApi.delete(id),
    onSuccess: () => {
      invalidateAll();
      toast({ title: '거래 삭제 완료', variant: 'success' });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => tradesApi.bulkDelete(ids),
    onSuccess: () => {
      invalidateAll();
      setSelectedTrades([]);
      toast({ title: '선택 거래 삭제 완료', variant: 'success' });
    },
  });

  // --- Helpers ---
  const getAccountName = useCallback(
    (id: number) => allAccounts?.find((a: Account) => a.id === id)?.name || `#${id}`,
    [allAccounts],
  );

  const paginatedTrades = useMemo(() => {
    if (!trades) return [];
    const start = (currentPage - 1) * PAGE_SIZE;
    return trades.slice(start, start + PAGE_SIZE);
  }, [trades, currentPage]);

  const totalPages = useMemo(() => (trades ? Math.ceil(trades.length / PAGE_SIZE) : 1), [trades]);

  // Group trades by date
  const groupedTrades = useMemo(() => {
    const groups: Record<string, Trade[]> = {};
    for (const trade of paginatedTrades) {
      const date = trade.trade_date;
      if (!groups[date]) groups[date] = [];
      groups[date].push(trade);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [paginatedTrades]);

  // --- Handlers ---
  const handleTickerBlur = async () => {
    if (!formData.ticker) {
      setTickerValidation({ valid: null, message: '' });
      return;
    }
    setIsValidatingTicker(true);
    try {
      const res = await pricesApi.validateTicker(formData.ticker);
      setTickerValidation({ valid: res.data.valid, message: res.data.message || '' });
    } catch {
      setTickerValidation({ valid: false, message: '티커 검증 실패' });
    } finally {
      setIsValidatingTicker(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.account_id) {
      toast({ title: '입력 오류', description: '계정을 선택해주세요.', variant: 'destructive' });
      return;
    }
    if (!tickerValidation.valid) {
      toast({ title: '입력 오류', description: '유효한 티커를 입력해주세요.', variant: 'destructive' });
      return;
    }
    const sharesToTrade = parseFloat(formData.shares);
    if (formData.side === 'SELL' && currentPosition && sharesToTrade > currentPosition.shares) {
      toast({ title: '수량 초과', description: `보유 수량(${currentPosition.shares})을 초과할 수 없습니다.`, variant: 'destructive' });
      return;
    }
    createTradeMutation.mutate({
      account_id: typeof formData.account_id === 'string' ? parseInt(formData.account_id) : formData.account_id,
      ticker: formData.ticker.toUpperCase(),
      side: formData.side,
      shares: sharesToTrade,
      price_usd: parseFloat(formData.price_usd),
      trade_date: formData.trade_date,
      note: formData.note || undefined,
    });
  };

  const handleEdit = (trade: Trade) => {
    setEditingId(trade.id);
    setEditForm({
      account_id: trade.account_id,
      ticker: trade.ticker,
      side: trade.side,
      shares: trade.shares,
      price_usd: trade.price_usd,
      trade_date: trade.trade_date,
      note: trade.note,
    });
  };

  const handleSaveEdit = () => {
    if (editingId) updateTradeMutation.mutate({ id: editingId, data: editForm });
  };

  const handleDelete = (id: number) => {
    if (confirm('정말로 이 거래를 삭제하시겠습니까?')) deleteTradeMutation.mutate(id);
  };

  const handleBulkDelete = () => {
    if (selectedTrades.length === 0) return;
    if (confirm(`선택한 ${selectedTrades.length}건의 거래를 삭제하시겠습니까?`)) {
      bulkDeleteMutation.mutate(selectedTrades);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedTrades((prev) => (prev.includes(id) ? prev.filter((tid) => tid !== id) : [...prev, id]));
  };

  const handleToggleSelectAll = () => {
    if (selectedTrades.length === paginatedTrades.length) {
      setSelectedTrades([]);
    } else {
      setSelectedTrades(paginatedTrades.map((t) => t.id));
    }
  };

  const openPanel = () => {
    setFormData({
      account_id: accountId || '',
      ticker: '',
      side: 'BUY',
      shares: '',
      price_usd: '',
      trade_date: new Date().toISOString().split('T')[0],
      note: '',
    });
    setTickerValidation({ valid: null, message: '' });
    setShowPanel(true);
  };

  const formatDateHeader = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const weekday = d.toLocaleDateString('ko-KR', { weekday: 'short' });
    return `${dateStr} (${weekday})`;
  };

  // --- Render ---
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-foreground tracking-tight">거래</h2>
        <div className="flex items-center gap-2">
          {selectedTrades.length > 0 && (
            <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulkDeleteMutation.isPending}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              선택 삭제 ({selectedTrades.length})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setIsCsvModalOpen(true)}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            CSV 관리
          </Button>
          <Button variant="gold" size="sm" onClick={openPanel}>
            <Plus className="h-4 w-4 mr-1.5" />
            새 거래
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="relative col-span-2 md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={filters.ticker}
                onChange={(e) => setFilters({ ...filters, ticker: e.target.value.toUpperCase() })}
                placeholder="티커 검색"
                className="pl-9 h-9 bg-background/50"
              />
            </div>
            <Input
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
              className="h-9 bg-background/50"
              placeholder="시작일"
            />
            <Input
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
              className="h-9 bg-background/50"
              placeholder="종료일"
            />
            <select
              value={filters.side}
              onChange={(e) => setFilters({ ...filters, side: e.target.value })}
              className="flex h-9 w-full rounded-lg border border-border bg-background/50 px-3 py-1 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">전체</option>
              <option value="BUY">매수</option>
              <option value="SELL">매도</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Trade List */}
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">불러오는 중...</span>
            </div>
          ) : !trades || trades.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">거래 내역이 없습니다.</p>
            </div>
          ) : (
            <>
              {/* Select all bar */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 bg-muted/30">
                <input
                  type="checkbox"
                  checked={selectedTrades.length === paginatedTrades.length && paginatedTrades.length > 0}
                  onChange={handleToggleSelectAll}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  총 {trades.length}건 | {currentPage}/{totalPages} 페이지
                </span>
              </div>

              {/* Date-grouped timeline */}
              {groupedTrades.map(([date, dateTrades]) => (
                <div key={date}>
                  {/* Date header */}
                  <div className="px-4 py-2 bg-muted/20 border-b border-border/30 sticky top-0 z-10">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {formatDateHeader(date)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground/60">{dateTrades.length}건</span>
                  </div>

                  {/* Trade rows */}
                  {dateTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className={cn(
                        'group relative flex items-center gap-3 px-4 py-3 border-b border-border/20',
                        'hover:bg-accent/30 transition-colors duration-150',
                        'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5',
                        'before:transition-all before:duration-200',
                        'hover:before:w-1',
                        trade.side === 'BUY' ? 'before:bg-profit' : 'before:bg-loss',
                        selectedTrades.includes(trade.id) && 'bg-accent/20',
                      )}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={selectedTrades.includes(trade.id)}
                        onChange={() => handleToggleSelect(trade.id)}
                        className="h-4 w-4 rounded border-border accent-primary shrink-0"
                      />

                      {editingId === trade.id ? (
                        /* --- Inline edit mode --- */
                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
                          <Input
                            type="date"
                            value={editForm.trade_date || ''}
                            onChange={(e) => setEditForm({ ...editForm, trade_date: e.target.value })}
                            className="h-8 text-sm col-span-1"
                          />
                          <Input
                            value={editForm.ticker || ''}
                            onChange={(e) => setEditForm({ ...editForm, ticker: e.target.value.toUpperCase() })}
                            className="h-8 text-sm col-span-1"
                          />
                          <select
                            value={editForm.side || 'BUY'}
                            onChange={(e) => setEditForm({ ...editForm, side: e.target.value as 'BUY' | 'SELL' })}
                            className="h-8 rounded-md border border-border bg-background px-2 text-sm col-span-1"
                          >
                            <option value="BUY">매수</option>
                            <option value="SELL">매도</option>
                          </select>
                          <Input
                            type="number"
                            step="0.0001"
                            value={editForm.shares ?? ''}
                            onChange={(e) => setEditForm({ ...editForm, shares: parseFloat(e.target.value) })}
                            className="h-8 text-sm font-numeric col-span-1"
                            placeholder="수량"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.price_usd ?? ''}
                            onChange={(e) => setEditForm({ ...editForm, price_usd: parseFloat(e.target.value) })}
                            className="h-8 text-sm font-numeric col-span-1"
                            placeholder="단가"
                          />
                          <div className="flex gap-1 col-span-1 justify-end">
                            <Button variant="ghost" size="sm" onClick={handleSaveEdit} disabled={updateTradeMutation.isPending}>
                              <Check className="h-4 w-4 text-profit" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setEditForm({}); }}>
                              <X className="h-4 w-4 text-loss" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* --- Display mode --- */
                        <>
                          {/* Side badge */}
                          <span
                            className={cn(
                              'text-xs font-semibold px-2 py-0.5 rounded-md shrink-0',
                              trade.side === 'BUY' ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss',
                            )}
                          >
                            {trade.side === 'BUY' ? '매수' : '매도'}
                          </span>

                          {/* Ticker */}
                          <button
                            onClick={() => window.open(`https://finance.yahoo.com/quote/${trade.ticker}/`, '_blank')}
                            className="font-semibold text-sm text-foreground hover:text-primary transition-colors shrink-0 min-w-[48px]"
                          >
                            {trade.ticker}
                          </button>

                          {/* Account name (when no filter) */}
                          {accountId === null && (
                            <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">
                              {getAccountName(trade.account_id)}
                            </span>
                          )}

                          {/* Shares x Price */}
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-numeric text-muted-foreground">
                              {formatNumber(trade.shares, trade.shares % 1 === 0 ? 0 : 4)} x{' '}
                              {formatCurrency(trade.price_usd)}
                            </span>
                          </div>

                          {/* Total amount */}
                          <span className="text-sm font-semibold font-numeric text-foreground shrink-0">
                            {formatCurrency(trade.shares * trade.price_usd)}
                          </span>

                          {/* Note indicator */}
                          {trade.note && (
                            <span className="text-xs text-muted-foreground/50 truncate max-w-[80px] hidden lg:inline" title={trade.note}>
                              {trade.note}
                            </span>
                          )}

                          {/* Actions */}
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(trade)}>
                              <Edit2 className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleDelete(trade.id)}
                              disabled={deleteTradeMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-loss" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/10">
                <span className="text-xs text-muted-foreground">
                  {(currentPage - 1) * PAGE_SIZE + 1}~{Math.min(currentPage * PAGE_SIZE, trades.length)} / {trades.length}건
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let page: number;
                    if (totalPages <= 5) {
                      page = i + 1;
                    } else if (currentPage <= 3) {
                      page = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      page = totalPages - 4 + i;
                    } else {
                      page = currentPage - 2 + i;
                    }
                    return (
                      <Button
                        key={page}
                        variant={currentPage === page ? 'default' : 'ghost'}
                        size="sm"
                        className="h-7 w-7 p-0 text-xs"
                        onClick={() => setCurrentPage(page)}
                      >
                        {page}
                      </Button>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ======================== */}
      {/* Slide Panel — Trade Form */}
      {/* ======================== */}

      {/* Backdrop */}
      {showPanel && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setShowPanel(false)} />
      )}

      {/* Panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 w-full sm:w-[420px] z-50',
          'bg-card border-l border-border shadow-2xl',
          'transform transition-transform duration-300 ease-out',
          'flex flex-col',
          showPanel ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h3 className="text-lg font-bold text-foreground">새 거래 등록</h3>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowPanel(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Panel body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Account toggle */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">계정 *</Label>
              {!accounts || accounts.length === 0 ? (
                <p className="text-xs text-loss">사용 가능한 계정이 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {accounts.map((account: Account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, account_id: account.id })}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 border',
                        formData.account_id === account.id
                          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                          : 'bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-foreground',
                      )}
                    >
                      {account.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Side toggle */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">매매유형 *</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, side: 'BUY' })}
                  className={cn(
                    'h-11 rounded-lg text-sm font-semibold transition-all duration-200 border',
                    formData.side === 'BUY'
                      ? 'bg-profit/15 text-profit border-profit/40 shadow-sm'
                      : 'bg-transparent text-muted-foreground border-border hover:border-profit/30',
                  )}
                >
                  매수 (BUY)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, side: 'SELL' })}
                  className={cn(
                    'h-11 rounded-lg text-sm font-semibold transition-all duration-200 border',
                    formData.side === 'SELL'
                      ? 'bg-loss/15 text-loss border-loss/40 shadow-sm'
                      : 'bg-transparent text-muted-foreground border-border hover:border-loss/30',
                  )}
                >
                  매도 (SELL)
                </button>
              </div>
            </div>

            {/* Ticker */}
            <div className="space-y-2">
              <Label htmlFor="panel-ticker" className="text-sm font-medium">
                티커 *
              </Label>
              <div className="relative">
                <Input
                  id="panel-ticker"
                  value={formData.ticker}
                  onChange={(e) => setFormData({ ...formData, ticker: e.target.value.toUpperCase() })}
                  onBlur={handleTickerBlur}
                  placeholder="AAPL"
                  required
                  className={cn(
                    'h-11 pr-10',
                    tickerValidation.valid === true && 'border-profit',
                    tickerValidation.valid === false && 'border-loss',
                  )}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isValidatingTicker ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : tickerValidation.valid === true ? (
                    <CheckCircle className="h-4 w-4 text-profit" />
                  ) : tickerValidation.valid === false ? (
                    <XCircle className="h-4 w-4 text-loss" />
                  ) : null}
                </div>
              </div>
              {tickerValidation.message && (
                <p className={cn('text-xs', tickerValidation.valid ? 'text-profit' : 'text-loss')}>
                  {tickerValidation.message}
                </p>
              )}
            </div>

            {/* Shares */}
            <div className="space-y-2">
              <Label htmlFor="panel-shares" className="text-sm font-medium">
                수량 *
                {formData.side === 'SELL' && currentPosition && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">(보유: {currentPosition.shares})</span>
                )}
              </Label>
              <Input
                id="panel-shares"
                type="number"
                step="0.0001"
                value={formData.shares}
                onChange={(e) => setFormData({ ...formData, shares: e.target.value })}
                placeholder="10"
                required
                className={cn(
                  'h-11 font-numeric',
                  formData.side === 'SELL' &&
                    currentPosition &&
                    formData.shares &&
                    parseFloat(formData.shares) > currentPosition.shares &&
                    'border-loss',
                )}
              />
              {formData.side === 'SELL' &&
                currentPosition &&
                formData.shares &&
                parseFloat(formData.shares) > currentPosition.shares && (
                  <div className="flex items-center gap-1 text-xs text-loss">
                    <AlertTriangle className="h-3 w-3" />
                    <span>보유 수량을 초과할 수 없습니다</span>
                  </div>
                )}
            </div>

            {/* Price */}
            {(() => {
              const aid = typeof formData.account_id === 'string' ? parseInt(formData.account_id) : formData.account_id;
              const selAcc = (accounts ?? allAccounts)?.find((a: Account) => a.id === aid);
              const accCur = (selAcc?.base_currency ?? 'USD') as 'USD' | 'KRW';
              return (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="panel-price" className="text-sm font-medium">
                      단가 ({accCur}) *
                    </Label>
                    <Input
                      id="panel-price"
                      type="number"
                      step={accCur === 'KRW' ? '1' : '0.01'}
                      value={formData.price_usd}
                      onChange={(e) => setFormData({ ...formData, price_usd: e.target.value })}
                      placeholder={accCur === 'KRW' ? '75000' : '100.00'}
                      required
                      className="h-11 font-numeric"
                    />
                  </div>

                  {/* Total preview */}
                  {formData.shares && formData.price_usd && (
                    <div className="rounded-lg bg-muted/30 border border-border/50 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">총 거래금액</span>
                        <span className="text-base font-bold font-numeric text-foreground">
                          {formatCurrency(parseFloat(formData.shares) * parseFloat(formData.price_usd), accCur)}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="panel-date" className="text-sm font-medium">
                거래일 *
              </Label>
              <Input
                id="panel-date"
                type="date"
                value={formData.trade_date}
                onChange={(e) => setFormData({ ...formData, trade_date: e.target.value })}
                required
                className="h-11"
              />
            </div>

            {/* Note */}
            <div className="space-y-2">
              <Label htmlFor="panel-note" className="text-sm font-medium">
                메모
              </Label>
              <Input
                id="panel-note"
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                placeholder="메모 (선택사항)"
                className="h-11"
              />
            </div>
          </form>
        </div>

        {/* Panel footer */}
        <div className="px-5 py-4 border-t border-border/50">
          <Button
            type="submit"
            className="w-full h-12 text-base font-semibold"
            variant="gold"
            disabled={createTradeMutation.isPending || isValidatingTicker}
            onClick={handleSubmit}
          >
            {createTradeMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                등록 중...
              </>
            ) : (
              <>
                <Plus className="h-5 w-5 mr-2" />
                거래 등록
              </>
            )}
          </Button>
        </div>
      </div>

      {/* CSV Modal */}
      <CsvManagementModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        accountId={accountId}
        filters={filters}
        onImportSuccess={() => invalidateAll()}
      />
    </div>
  );
}
