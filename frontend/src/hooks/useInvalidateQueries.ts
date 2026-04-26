import { useQueryClient } from '@tanstack/react-query';

/**
 * React Query 캐시 무효화 키 중앙 관리.
 * Trades / CsvManagementModal / Settings 등에서 반복되던 invalidateQueries 패턴을 통합.
 */
export const QUERY_KEYS = {
  trades:    ['trades']           as const,
  positions: ['positions']        as const,
  dashboard: ['dashboard-summary'] as const,
  cash:      ['cash']             as const,
  dividends: ['dividends']        as const,
  accounts:  ['accounts', 'all']  as const,
  snapshots: ['snapshots']        as const,
  splits:    ['splits']           as const,
} as const;

export function useInvalidateQueries() {
  const queryClient = useQueryClient();

  return {
    /** 거래 추가/수정/삭제 후 — positions, dashboard도 함께 갱신 */
    afterTradeChange: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trades }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
      ]),

    /** 현금 거래 변경 후 */
    afterCashChange: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cash }),

    /** 배당 변경 후 */
    afterDividendChange: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dividends }),

    /** 계정 변경 후 — accounts + positions + dashboard 갱신 */
    afterAccountChange: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accounts }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
      ]),

    /** 스플릿 적용 후 — 전체 갱신 */
    afterSplitApplied: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trades }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.splits }),
      ]),
  };
}
