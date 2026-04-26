import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountsApi } from '@/services/api';
import { QUERY_CONFIG } from '@/constants/queryConfig';
import type { Currency } from '@/types';

/**
 * 계정 ID → 통화 코드 매핑 Map 반환.
 * Dashboard, Portfolio, Trades, CashFlow 4곳에서 반복되던 useMemo 패턴을 중앙화.
 */
export function useAccountCurrencyMap(): Map<number, Currency> {
  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => (await accountsApi.getAll()).data,
    ...QUERY_CONFIG.LONG,
  });

  return useMemo(
    () =>
      new Map(
        (accounts ?? []).map((a) => [a.id, (a.base_currency ?? 'USD') as Currency])
      ),
    [accounts]
  );
}
