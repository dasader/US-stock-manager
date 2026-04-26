import { useMutation } from '@tanstack/react-query';
import type {
  UseMutationOptions,
  UseMutationResult,
  MutationFunction,
} from '@tanstack/react-query';
import { useToast } from './useToast';
import type { ApiError } from '@/services/api';

interface MutationWithToastOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn' | 'onError' | 'onSuccess'> {
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: (data: TData) => void;
  onError?: (error: ApiError, variables: TVariables, context: unknown) => void;
}

/**
 * useMutation + 자동 toast 래퍼.
 * 8개 이상 컴포넌트에서 반복되던 onError toast 패턴을 중앙화.
 *
 * @example
 * const mutation = useMutationWithToast(tradesApi.create, {
 *   successMessage: '거래가 추가되었습니다.',
 *   onSuccess: () => invalidate.afterTradeChange(),
 * });
 */
export function useMutationWithToast<TData, TVariables>(
  mutationFn: MutationFunction<TData, TVariables>,
  options: MutationWithToastOptions<TData, TVariables> = {}
): UseMutationResult<TData, ApiError, TVariables> {
  const { toast } = useToast();
  const { successMessage, errorMessage, onError, onSuccess, ...rest } = options;

  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    onSuccess: (data, _variables, _context) => {
      if (successMessage) {
        toast({ title: successMessage });
      }
      onSuccess?.(data);
    },
    onError: (error, variables, context) => {
      toast({
        title: errorMessage ?? '오류가 발생했습니다.',
        description: error.message,
        variant: 'destructive',
      });
      onError?.(error, variables, context);
    },
    ...rest,
  });
}
