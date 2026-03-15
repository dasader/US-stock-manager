import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tradesApi, accountsApi } from '@/services/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
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
import { Upload, Trash2, RefreshCw, Edit2, Check, X } from 'lucide-react';
import type { Trade } from '@/types';
import CsvManagementModal from './CsvManagementModal';

interface TradesTableProps {
  accountId: number | null;
}

export default function TradesTable({ accountId }: TradesTableProps) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    ticker: '',
    start_date: '',
    end_date: '',
    side: '',
  });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Trade>>({});
  const [selectedTrades, setSelectedTrades] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);

  // 필터 디바운싱 (500ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setCurrentPage(1); // 필터 변경 시 첫 페이지로 이동
    }, 500);

    return () => clearTimeout(timer);
  }, [filters]);

  // 계정 정보 조회 (계정명 표시용)
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const response = await accountsApi.getAll();
      return response.data;
    },
  });

  const { data: trades, isLoading, refetch } = useQuery({
    queryKey: ['trades', accountId, debouncedFilters, currentPage],
    queryFn: () =>
      tradesApi
        .getAll({
          account_id: accountId || undefined,
          ticker: debouncedFilters.ticker || undefined,
          start_date: debouncedFilters.start_date || undefined,
          end_date: debouncedFilters.end_date || undefined,
          side: debouncedFilters.side || undefined,
          skip: (currentPage - 1) * pageSize,
          limit: pageSize,
        })
        .then((res) => res.data),
  });

  // 계정 ID로 계정명 찾기
  const getAccountName = (accountId: number) => {
    const account = accounts?.find((a) => a.id === accountId);
    return account?.name || `계정 #${accountId}`;
  };

  const deleteTradeMutation = useMutation({
    mutationFn: (id: number) => tradesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
    },
  });

  const updateTradeMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Trade> }) =>
      tradesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      setEditingId(null);
      setEditForm({});
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => tradesApi.bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      setSelectedTrades([]);
    },
  });


  const handleDelete = (id: number) => {
    if (confirm('정말로 이 거래를 삭제하시겠습니까?')) {
      deleteTradeMutation.mutate(id);
    }
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
    if (editingId) {
      updateTradeMutation.mutate({ id: editingId, data: editForm });
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleToggleSelect = (id: number) => {
    setSelectedTrades((prev) =>
      prev.includes(id) ? prev.filter((tid) => tid !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (selectedTrades.length === trades?.length) {
      setSelectedTrades([]);
    } else {
      setSelectedTrades(trades?.map((t) => t.id) || []);
    }
  };

  const handleBulkDelete = () => {
    if (selectedTrades.length === 0) return;
    if (confirm(`선택한 ${selectedTrades.length}건의 거래를 삭제하시겠습니까?`)) {
      bulkDeleteMutation.mutate(selectedTrades);
    }
  };

  if (isLoading) {
    return <div className="text-center p-8">로딩 중...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle>거래 내역</CardTitle>
          <div className="flex gap-2 flex-wrap">
            {selectedTrades.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={bulkDeleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                선택 삭제 ({selectedTrades.length})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCsvModalOpen(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              CSV 관리
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              새로고침
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* 필터 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div className="space-y-2">
            <Label htmlFor="filter-ticker">티커</Label>
            <Input
              id="filter-ticker"
              value={filters.ticker}
              onChange={(e) =>
                setFilters({ ...filters, ticker: e.target.value.toUpperCase() })
              }
              placeholder="AAPL"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-start">시작일</Label>
            <Input
              id="filter-start"
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-end">종료일</Label>
            <Input
              id="filter-end"
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-side">매매유형</Label>
            <select
              id="filter-side"
              value={filters.side}
              onChange={(e) => setFilters({ ...filters, side: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">전체</option>
              <option value="BUY">매수</option>
              <option value="SELL">매도</option>
            </select>
          </div>
        </div>

        {/* 테이블 */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 sticky left-0 z-10 bg-background">
                  <input
                    type="checkbox"
                    checked={selectedTrades.length === trades?.length && trades?.length > 0}
                    onChange={handleToggleSelectAll}
                    className="h-4 w-4"
                  />
                </TableHead>
                <TableHead className="min-w-[85px]">거래일</TableHead>
                {accountId === null && <TableHead className="min-w-[100px] hidden sm:table-cell">계정</TableHead>}
                <TableHead className="min-w-[65px]">티커</TableHead>
                <TableHead className="min-w-[55px]">유형</TableHead>
                <TableHead className="text-right min-w-[70px]">수량</TableHead>
                <TableHead className="text-right min-w-[75px] hidden md:table-cell">단가</TableHead>
                <TableHead className="text-right min-w-[90px]">금액</TableHead>
                <TableHead className="min-w-[120px] hidden lg:table-cell">메모</TableHead>
                <TableHead className="text-center min-w-[50px]">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!trades || trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={accountId === null ? 10 : 9} className="text-center text-muted-foreground py-8">
                    거래 내역이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="sticky left-0 z-10 bg-background">
                      <input
                        type="checkbox"
                        checked={selectedTrades.includes(trade.id)}
                        onChange={() => handleToggleSelect(trade.id)}
                        className="h-4 w-4"
                      />
                    </TableCell>
                    {editingId === trade.id ? (
                      <>
                        <TableCell>
                          <Input
                            type="date"
                            value={editForm.trade_date || ''}
                            onChange={(e) =>
                              setEditForm({ ...editForm, trade_date: e.target.value })
                            }
                            className="w-24 text-sm"
                          />
                        </TableCell>
                        {accountId === null && (
                          <TableCell className="hidden sm:table-cell">
                            <select
                              value={editForm.account_id || ''}
                              onChange={(e) =>
                                setEditForm({ ...editForm, account_id: parseInt(e.target.value) })
                              }
                              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                              required
                            >
                              <option value="">계정 선택</option>
                              {accounts?.filter(a => a.is_active).map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.name}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                        )}
                        <TableCell>
                          <Input
                            value={editForm.ticker || ''}
                            onChange={(e) =>
                              setEditForm({ ...editForm, ticker: e.target.value.toUpperCase() })
                            }
                            className="w-16 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            value={editForm.side || 'BUY'}
                            onChange={(e) =>
                              setEditForm({ ...editForm, side: e.target.value as 'BUY' | 'SELL' })
                            }
                            className="flex h-8 w-16 rounded-md border border-input bg-background px-1 py-1 text-sm"
                          >
                            <option value="BUY">매수</option>
                            <option value="SELL">매도</option>
                          </select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.0001"
                            value={editForm.shares || ''}
                            onChange={(e) =>
                              setEditForm({ ...editForm, shares: parseFloat(e.target.value) })
                            }
                            className="w-16 text-right text-sm"
                          />
                        </TableCell>
                        <TableCell className="text-right hidden md:table-cell">
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.price_usd || ''}
                            onChange={(e) =>
                              setEditForm({ ...editForm, price_usd: parseFloat(e.target.value) })
                            }
                            className="w-16 text-right text-sm"
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">
                          {formatCurrency(
                            (editForm.shares || 0) * (editForm.price_usd || 0),
                            'USD'
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Input
                            value={editForm.note || ''}
                            onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                            className="w-24 text-sm"
                            placeholder="메모"
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex gap-1 justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleSaveEdit}
                              disabled={updateTradeMutation.isPending}
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                              <X className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-sm">{formatDate(trade.trade_date)}</TableCell>
                        {accountId === null && (
                          <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                            {getAccountName(trade.account_id)}
                          </TableCell>
                        )}
                        <TableCell className="font-medium">
                          <button
                            onClick={() => window.open(`https://finance.yahoo.com/quote/${trade.ticker}/`, '_blank')}
                            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-sm"
                          >
                            {trade.ticker}
                          </button>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${
                              trade.side === 'BUY'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {trade.side === 'BUY' ? '매수' : '매도'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatNumber(trade.shares, 0)}
                        </TableCell>
                        <TableCell className="text-right text-sm hidden md:table-cell">
                          {formatCurrency(trade.price_usd, 'USD')}
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">
                          {formatCurrency(trade.shares * trade.price_usd, 'USD')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate hidden lg:table-cell max-w-[120px]">
                          {trade.note || '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex gap-1 justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(trade)}
                            >
                              <Edit2 className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(trade.id)}
                              disabled={deleteTradeMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        
        {/* 페이지네이션 */}
        <div className="flex items-center justify-between px-4 py-3 border-t flex-wrap gap-2">
          <div className="text-sm text-muted-foreground">
            페이지 {currentPage} (총 {trades?.length || 0}개 항목)
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              이전
            </Button>
            <span className="text-sm">
              {currentPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={!trades || trades.length < pageSize}
            >
              다음
            </Button>
          </div>
        </div>
      </CardContent>

      {/* CSV 관리 모달 */}
      <CsvManagementModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        accountId={accountId}
        filters={filters}
        onImportSuccess={() => {
          refetch();
        }}
      />
    </Card>
  );
}
