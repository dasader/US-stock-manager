import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { tradesApi, pricesApi, accountsApi, positionsApi, krxApi } from '@/services/api';
import type { KrxTickerInfo } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { Trade } from '@/types';
import type { Currency } from '@/types';
import { validateTickerForCurrency } from '@/utils/ticker';

interface TradeFormProps {
  selectedAccountId: number | null;
}

export default function TradeForm({ selectedAccountId }: TradeFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    account_id: selectedAccountId || '',
    ticker: '',
    side: 'BUY' as 'BUY' | 'SELL',
    shares: '',
    price_usd: '',
    trade_date: new Date().toISOString().split('T')[0],
    note: '',
  });
  const [tickerValidation, setTickerValidation] = useState<{
    valid: boolean | null;
    message: string;
  }>({ valid: null, message: '' });
  const [isValidatingTicker, setIsValidatingTicker] = useState(false);
  const [tickerError, setTickerError] = useState<string | null>(null);
  const [debouncedQ, setDebouncedQ] = useState('');

  // 활성 계정 목록 조회
  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'active'],
    queryFn: async () => {
      const response = await accountsApi.getAll(true);
      return response.data;
    },
  });

  // 매도 시 현재 포지션 조회 (수량 검증용)
  const { data: currentPosition } = useQuery({
    queryKey: ['position', formData.ticker, formData.account_id],
    queryFn: async () => {
      if (!formData.ticker || !formData.account_id) return null;
      try {
        const response = await positionsApi.getOne(
          formData.ticker,
          typeof formData.account_id === 'string' 
            ? parseInt(formData.account_id) 
            : formData.account_id
        );
        return response.data;
      } catch (error) {
        return null;
      }
    },
    enabled: Boolean(formData.ticker && formData.account_id && formData.side === 'SELL'),
  });

  // selectedAccountId가 변경되면 폼 업데이트
  useEffect(() => {
    if (selectedAccountId) {
      setFormData((prev) => ({ ...prev, account_id: selectedAccountId }));
    }
  }, [selectedAccountId]);

  // 계정 통화 파생
  const selectedAccount = accounts?.find(
    (a) => a.id === formData.account_id || a.id === Number(formData.account_id)
  );
  const accountCurrency: Currency = selectedAccount?.base_currency ?? 'USD';
  const isKRW = accountCurrency === 'KRW';
  const tickerPlaceholder = isKRW ? '005930 또는 GOLD' : 'AAPL';

  // KRX 검색 디바운스
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(formData.ticker), 250);
    return () => clearTimeout(id);
  }, [formData.ticker]);

  const needsSearch =
    isKRW && formData.ticker.length >= 1 && !/^\d{6}$/.test(formData.ticker);

  const { data: suggestions = [] } = useQuery<KrxTickerInfo[]>({
    queryKey: ['krx-search', debouncedQ],
    queryFn: () => krxApi.search(debouncedQ),
    enabled: needsSearch && debouncedQ.length >= 1,
    staleTime: 30_000,
  });

  type TradeCreatePayload = Omit<Trade, 'id' | 'created_at' | 'updated_at'>;

  const createTradeMutation = useMutation({
    mutationFn: (data: TradeCreatePayload) => tradesApi.create(data),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      
      // 폼 초기화
      setFormData((prev) => ({
        ...prev,
        shares: '',
        price_usd: '',
        note: '',
      }));
      
      toast({
        title: "거래 등록 완료",
        description: `${variables.ticker} ${variables.side} 거래가 성공적으로 등록되었습니다.`,
        variant: "success",
      });
    },
    onError: (error: { message?: string; response?: { data?: { detail?: { message?: string } | string } } }) => {
      const errorMessage = error.response?.data?.detail &&
                          typeof error.response.data.detail === 'object'
        ? error.response.data.detail.message
        : error.response?.data?.detail || error.message || '알 수 없는 오류가 발생했습니다.';

      toast({
        title: "거래 등록 실패",
        description: String(errorMessage),
        variant: "destructive",
      });
    },
  });

  const handleTickerBlur = async () => {
    if (!formData.ticker) {
      setTickerValidation({ valid: null, message: '' });
      return;
    }

    setIsValidatingTicker(true);
    try {
      const response = await pricesApi.validateTicker(formData.ticker);
      setTickerValidation({
        valid: response.data.valid,
        message: response.data.message || '',
      });
    } catch (error) {
      setTickerValidation({
        valid: false,
        message: '티커 검증 실패',
      });
      toast({
        title: "티커 검증 오류",
        description: "티커 검증 중 오류가 발생했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    } finally {
      setIsValidatingTicker(false);
    }
  };

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

    if (!tickerValidation.valid) {
      toast({
        title: "입력 오류",
        description: "유효한 티커를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    // 매도 수량 검증
    const sharesToTrade = parseFloat(formData.shares);
    if (formData.side === 'SELL' && currentPosition) {
      if (sharesToTrade > currentPosition.shares) {
        toast({
          title: "수량 초과",
          description: `보유 수량(${currentPosition.shares})을 초과하여 매도할 수 없습니다.`,
          variant: "destructive",
        });
        return;
      }
    }

    const data = {
      account_id: typeof formData.account_id === 'string' ? parseInt(formData.account_id) : formData.account_id,
      ticker: formData.ticker.toUpperCase(),
      side: formData.side,
      shares: sharesToTrade,
      price_usd: parseFloat(formData.price_usd),
      trade_date: formData.trade_date,
      note: formData.note || undefined,
    };

    createTradeMutation.mutate(data);
  };

  return (
    <Card className="hover-lift">
      <CardHeader>
        <CardTitle className="text-gradient-primary text-title">거래 입력</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 계정 선택 - 토글 버튼 */}
          <div className="space-y-2">
            <Label className="text-body">계정 *</Label>
            {!accounts || accounts.length === 0 ? (
              <p className="text-xs text-loss">
                사용 가능한 계정이 없습니다. 먼저 계정을 생성하세요.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((account) => (
                  <Button
                    key={account.id}
                    type="button"
                    variant={formData.account_id === account.id || formData.account_id === String(account.id) ? "default" : "outline"}
                    onClick={() => setFormData({ ...formData, account_id: account.id })}
                    className="h-10 min-h-[40px]"
                  >
                    {account.name}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* 매매유형 - 토글 버튼 */}
          <div className="space-y-2">
            <Label className="text-body">매매유형 *</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={formData.side === 'BUY' ? "gradientSuccess" : "outline"}
                onClick={() => setFormData({ ...formData, side: 'BUY' })}
                className="flex-1 h-11 min-h-[44px]"
              >
                매수 (BUY)
              </Button>
              <Button
                type="button"
                variant={formData.side === 'SELL' ? "gradientDanger" : "outline"}
                onClick={() => setFormData({ ...formData, side: 'SELL' })}
                className="flex-1 h-11 min-h-[44px]"
              >
                매도 (SELL)
              </Button>
            </div>
          </div>

          {/* 거래 정보 그룹 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* 티커 */}
            <div className="space-y-2">
              <Label htmlFor="ticker" className="text-body">티커 *</Label>
              <div className="relative">
                <Input
                  id="ticker"
                  value={formData.ticker}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    setFormData({ ...formData, ticker: value });
                    const err = selectedAccount
                      ? validateTickerForCurrency(value, accountCurrency)
                      : null;
                    setTickerError(err);
                  }}
                  onBlur={handleTickerBlur}
                  placeholder={tickerPlaceholder}
                  required
                  className={`h-11 min-h-[44px] text-sm sm:text-base ${
                    tickerValidation.valid === true
                      ? 'border-profit'
                      : tickerValidation.valid === false
                      ? 'border-loss'
                      : ''
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isValidatingTicker ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  ) : tickerValidation.valid !== null ? (
                    tickerValidation.valid ? (
                      <CheckCircle className="h-4 w-4 text-profit" />
                    ) : (
                      <XCircle className="h-4 w-4 text-loss" />
                    )
                  ) : null}
                </div>
                {needsSearch && suggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded border bg-white dark:bg-gray-800 shadow top-full left-0">
                    {suggestions.map((s) => (
                      <li
                        key={s.ticker}
                        className="px-3 py-2 text-sm hover:bg-blue-100 dark:hover:bg-blue-900 cursor-pointer"
                        onClick={() => {
                          setFormData({ ...formData, ticker: s.ticker });
                          setTickerError(null);
                        }}
                      >
                        <span className="font-mono">{s.ticker}</span> {s.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {tickerError && (
                <p className="text-red-500 text-xs mt-1">{tickerError}</p>
              )}
              {tickerValidation.message && (
                <p
                  className={`text-xs ${
                    tickerValidation.valid ? 'text-profit' : 'text-loss'
                  }`}
                >
                  {tickerValidation.message}
                </p>
              )}
            </div>

            {/* 수량 */}
            <div className="space-y-2">
              <Label htmlFor="shares" className="text-body">
                수량 *
                {formData.side === 'SELL' && currentPosition && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (보유: {currentPosition.shares})
                  </span>
                )}
              </Label>
              <Input
                id="shares"
                type="number"
                step="0.0001"
                value={formData.shares}
                onChange={(e) => setFormData({ ...formData, shares: e.target.value })}
                placeholder="10"
                required
                className={`h-11 min-h-[44px] text-sm sm:text-base font-numeric ${
                  formData.side === 'SELL' && 
                  currentPosition && 
                  formData.shares && 
                  parseFloat(formData.shares) > currentPosition.shares
                    ? 'border-loss'
                    : ''
                }`}
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

            {/* 단가 */}
            <div className="space-y-2">
              <Label htmlFor="price_usd" className="text-body">단가 ({accountCurrency}) *</Label>
              <Input
                id="price_usd"
                type="number"
                step={accountCurrency === 'KRW' ? '1' : '0.01'}
                value={formData.price_usd}
                onChange={(e) => setFormData({ ...formData, price_usd: e.target.value })}
                placeholder={accountCurrency === 'KRW' ? '75000' : '100.00'}
                required
                className="h-11 min-h-[44px] text-sm sm:text-base font-numeric"
              />
            </div>
          </div>

          {/* 거래일 */}
          <div className="space-y-2">
            <Label htmlFor="trade_date" className="text-body">거래일 *</Label>
            <Input
              id="trade_date"
              type="date"
              value={formData.trade_date}
              onChange={(e) => setFormData({ ...formData, trade_date: e.target.value })}
              required
              className="h-11 min-h-[44px] text-sm sm:text-base"
            />
          </div>

          {/* 메모 */}
          <div className="space-y-2">
            <Label htmlFor="note" className="text-body">메모</Label>
            <Input
              id="note"
              value={formData.note}
              onChange={(e) => setFormData({ ...formData, note: e.target.value })}
              placeholder="메모 (선택사항)"
              className="h-11 min-h-[44px] text-sm sm:text-base"
            />
          </div>

          <Button
            type="submit"
            className="w-full h-12 min-h-[48px] text-base sm:text-lg"
            disabled={createTradeMutation.isPending || isValidatingTicker || !!tickerError}
            variant="gradient"
          >
            {createTradeMutation.isPending ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <PlusCircle className="h-5 w-5 mr-2" />
            )}
            {createTradeMutation.isPending ? '등록 중...' : '거래 등록'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}




