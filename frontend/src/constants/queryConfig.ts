/**
 * React Query staleTime / refetchInterval 공통 상수
 *
 * REALTIME : 백그라운드 로딩 상태 등 2초 갱신
 * MEDIUM   : 대시보드, 포지션, 시세 60초 갱신
 * LONG     : 계정 목록, 설정 등 5분 갱신
 * STATIC   : 환율 기준값 등 자동 갱신 없음
 */
export const QUERY_CONFIG = {
  REALTIME: { staleTime: 2_000,   refetchInterval: 2_000   },
  MEDIUM:   { staleTime: 60_000,  refetchInterval: 60_000  },
  LONG:     { staleTime: 300_000, refetchInterval: 300_000 },
  STATIC:   { staleTime: 60_000 },
} as const;
