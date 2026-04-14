import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cashApi, accountsApi } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/utils';
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
import { Plus, Trash2, RefreshCw, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import type { Cash, Currency } from '@/types';

interface CashManagerProps {
  accountId: number | null;
}

export default function CashManager({ accountId }: CashManagerProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    account_id: accountId || '',
    amount_usd: '',
    transaction_type: 'DEPOSIT' as 'DEPOSIT' | 'WITHDRAW',
    transaction_date: new Date().toISOString().split('T')[0],
    note: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  // 계정 목록 조회
  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'active'],
    queryFn: async () => {
      const response = await accountsApi.getAll(true);
      return response.data;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['cash-summary', accountId],
    queryFn: () => cashApi.getSummary(accountId || undefined).then((res) => res.data),
  });

  const { data: transactions, isLoading, refetch } = useQuery({
    queryKey: ['cash-transactions', accountId, currentPage],
    queryFn: () =>
      cashApi.getAll({ 
        account_id: accountId || undefined,
        skip: (currentPage - 1) * pageSize,
        limit: pageSize,
      }).then((res) => res.data),
  });

  // 계정 ID로 계정명 찾기
  const getAccountName = (accountId: number) => {
    const account = accounts?.find((a) => a.id === accountId);
    return account?.name || `계정 #${accountId}`;
  };

  // 계정 ID로 통화 찾기
  const getAccountCurrency = (accountId: number): Currency => {
    const account = accounts?.find((a) => a.id === accountId);
    return account?.base_currency ?? 'USD';
  };

  const createMutation = useMutation({
    mutationFn: (data: Omit<Cash, 'id' | 'created_at' | 'updated_at' | 'related_trade_id'>) =>
      cashApi.create(data),
      onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      setShowForm(false);
      setForm({
        account_id: accountId || '',
        amount_usd: '',
        transaction_type: 'DEPOSIT',
        transaction_date: new Date().toISOString().split('T')[0],
        note: '',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => cashApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.account_id) {
      alert('계정을 선택해주세요.');
      return;
    }
    
    createMutation.mutate({
      account_id: typeof form.account_id === 'string' ? parseInt(form.account_id) : form.account_id,
      amount_usd: parseFloat(form.amount_usd),
      transaction_type: form.transaction_type,
      transaction_date: form.transaction_date,
      note: form.note || undefined,
    });
  };

  const handleDelete = (id: number, hasRelatedTrade: boolean) => {
    if (hasRelatedTrade) {
      alert('거래와 연결된 현금 내역은 삭제할 수 없습니다.');
      return;
    }
    if (confirm('정말로 이 현금 내역을 삭제하시겠습니까?')) {
      deleteMutation.mutate(id);
    }
  };

  const getTransactionTypeLabel = (type: string) => {
    switch (type) {
      case 'DEPOSIT':
        return '입금';
      case 'WITHDRAW':
        return '출금';
      case 'BUY':
        return '매수 차감';
      case 'SELL':
        return '매도 추가';
      case 'DIVIDEND':
        return '배당금';
      default:
        return type;
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'DEPOSIT':
      case 'SELL':
      case 'DIVIDEND':
        return 'text-green-600';
      case 'WITHDRAW':
      case 'BUY':
        return 'text-red-600';
      default:
        return '';
    }
  };

  if (isLoading) {
    return <div className="text-center p-8">로딩 중...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 현금 요약 카드 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">현재 현금</CardTitle>
            <Wallet className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary ? formatCurrency(summary.total_cash_usd, 'USD') : '-'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {summary ? formatCurrency(summary.total_cash_krw, 'KRW') : '-'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">총 입금</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {summary ? formatCurrency(summary.total_deposits_usd, 'USD') : '-'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">총 출금</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {summary ? formatCurrency(summary.total_withdrawals_usd, 'USD') : '-'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 현금 거래 내역 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>현금 거래 내역</CardTitle>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowForm(!showForm)}
              >
                <Plus className="h-4 w-4 mr-2" />
                {showForm ? '취소' : '입금/출금'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                새로고침
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* 입금/출금 폼 */}
          {showForm && (
            <form onSubmit={handleSubmit} className="mb-6 p-4 border rounded-lg bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {/* 계정 선택 */}
                <div className="space-y-2">
                  <Label htmlFor="form_account_id">계정 *</Label>
                  <select
                    id="form_account_id"
                    value={form.account_id}
                    onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                    required
                  >
                    <option value="">선택</option>
                    {accounts?.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="transaction_type">유형</Label>
                  <select
                    id="transaction_type"
                    value={form.transaction_type}
                    onChange={(e) =>
                      setForm({ ...form, transaction_type: e.target.value as 'DEPOSIT' | 'WITHDRAW' })
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  >
                    <option value="DEPOSIT">입금</option>
                    <option value="WITHDRAW">출금</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount_usd">금액 ({form.account_id ? getAccountCurrency(typeof form.account_id === 'string' ? parseInt(form.account_id) : form.account_id) : 'USD'})</Label>
                  <Input
                    id="amount_usd"
                    type="number"
                    step="0.01"
                    value={form.amount_usd}
                    onChange={(e) => setForm({ ...form, amount_usd: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transaction_date">거래일</Label>
                  <Input
                    id="transaction_date"
                    type="date"
                    value={form.transaction_date}
                    onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note">메모</Label>
                  <Input
                    id="note"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="메모 (선택)"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? '처리 중...' : '저장'}
                </Button>
              </div>
            </form>
          )}

          {/* 테이블 */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[90px]">거래일</TableHead>
                  {accountId === null && <TableHead className="min-w-[100px] hidden sm:table-cell">계정</TableHead>}
                  <TableHead className="min-w-[70px]">유형</TableHead>
                  <TableHead className="text-right min-w-[100px]">금액</TableHead>
                  <TableHead className="min-w-[130px] hidden lg:table-cell">메모</TableHead>
                  <TableHead className="text-center min-w-[50px]">작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!transactions || transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={accountId === null ? 6 : 5} className="text-center text-muted-foreground py-8">
                      현금 거래 내역이 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="text-sm">{formatDate(transaction.transaction_date)}</TableCell>
                      {accountId === null && (
                        <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                          {getAccountName(transaction.account_id)}
                        </TableCell>
                      )}
                      <TableCell>
                        <span
                          className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
                            transaction.transaction_type === 'DEPOSIT' || 
                            transaction.transaction_type === 'SELL' || 
                            transaction.transaction_type === 'DIVIDEND'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          }`}
                        >
                          {getTransactionTypeLabel(transaction.transaction_type)}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right font-medium text-sm ${getTransactionColor(transaction.transaction_type)}`}>
                        {(transaction.transaction_type === 'DEPOSIT' || 
                          transaction.transaction_type === 'SELL' || 
                          transaction.transaction_type === 'DIVIDEND') && '+'}
                        {(transaction.transaction_type === 'WITHDRAW' || transaction.transaction_type === 'BUY') && '-'}
                        {formatCurrency(transaction.amount_usd, getAccountCurrency(transaction.account_id))}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate hidden lg:table-cell max-w-[130px]">
                        {transaction.note || '-'}
                        {transaction.related_trade_id && (
                          <span className="ml-2 text-blue-600">(거래 #{transaction.related_trade_id})</span>
                        )}
                        {transaction.related_dividend_id && (
                          <span className="ml-2 text-green-600">(배당금 #{transaction.related_dividend_id})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(transaction.id, !!(transaction.related_trade_id || transaction.related_dividend_id))}
                          disabled={deleteMutation.isPending || !!(transaction.related_trade_id || transaction.related_dividend_id)}
                          title={transaction.related_trade_id ? '거래와 연결된 현금 내역은 삭제할 수 없습니다' : transaction.related_dividend_id ? '배당금과 연결된 현금 내역은 삭제할 수 없습니다' : '삭제'}
                        >
                          <Trash2 className={`h-4 w-4 ${(transaction.related_trade_id || transaction.related_dividend_id) ? 'text-gray-400' : 'text-red-600'}`} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* 페이지네이션 */}
          <div className="flex items-center justify-between px-4 py-3 border-t flex-wrap gap-2">
            <div className="text-sm text-muted-foreground">
              페이지 {currentPage} (총 {transactions?.length || 0}개 항목)
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
                disabled={!transactions || transactions.length < pageSize}
              >
                다음
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
