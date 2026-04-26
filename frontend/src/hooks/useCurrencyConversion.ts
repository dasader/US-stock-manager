import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fxApi } from '@/services/api';
import { useDisplayCurrency } from './useDisplayCurrency';
import { QUERY_CONFIG } from '@/constants/queryConfig';
import type { Currency } from '@/types';

interface UseCurrencyConversionReturn {
  toDisplay: (amount: number, sourceCurrency: Currency) => number;
  fxRate: number | undefined;
  displayCurrency: Currency;
}

export function useCurrencyConversion(): UseCurrencyConversionReturn {
  const [displayCurrency] = useDisplayCurrency();

  const { data: fxData } = useQuery({
    queryKey: ['fx-rate', 'USD', 'KRW'],
    queryFn: () => fxApi.getUSDKRW().then((r) => r.data),
    ...QUERY_CONFIG.STATIC,
  });

  const fxRate = fxData?.rate;

  const toDisplay = useCallback(
    (amount: number, sourceCurrency: Currency): number => {
      if (sourceCurrency === displayCurrency) return amount;
      const rate = fxRate ?? 1350;
      if (sourceCurrency === 'USD' && displayCurrency === 'KRW') return amount * rate;
      if (sourceCurrency === 'KRW' && displayCurrency === 'USD') return rate > 0 ? amount / rate : 0;
      return amount;
    },
    [displayCurrency, fxRate]
  );

  return { toDisplay, fxRate, displayCurrency };
}
