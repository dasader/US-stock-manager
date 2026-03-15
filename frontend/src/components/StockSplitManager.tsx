import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { splitsApi } from '@/services/api';
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
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Loader2, Eye, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { StockSplit, StockSplitPreview } from '@/types';

export default function StockSplitManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    ticker: '',
    split_date: new Date().toISOString().split('T')[0],
    ratio_from: '',
    ratio_to: '',
    note: '',
  });

  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<StockSplitPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingSplit, setPendingSplit] = useState<StockSplit | null>(null);

  // 분할/병합 목록 조회
  const { data: splits, isLoading: splitsLoading } = useQuery({
    queryKey: ['stock-splits'],
    queryFn: async () => {
      const response = await splitsApi.getAll();
      return response.data;
    },
  });

  // 미리보기 조회
  const handlePreview = async () => {
    if (!formData.ticker || !formData.split_date || !formData.ratio_from || !formData.ratio_to) {
      toast({
        title: '입력 오류',
        description: '티커, 날짜, 비율을 모두 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    const ratioFrom = parseFloat(formData.ratio_from);
    const ratioTo = parseFloat(formData.ratio_to);

    if (isNaN(ratioFrom) || isNaN(ratioTo) || ratioFrom <= 0 || ratioTo <= 0) {
      toast({
        title: '입력 오류',
        description: '비율은 0보다 큰 숫자여야 합니다.',
        variant: 'destructive',
      });
      return;
    }

    setPreviewLoading(true);
    try {
      const response = await splitsApi.preview({
        ticker: formData.ticker.toUpperCase(),
        split_date: formData.split_date,
        ratio_from: ratioFrom,
        ratio_to: ratioTo,
      });
      setPreviewData(response.data);
      setShowPreview(true);
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail?.message ||
                          error.response?.data?.detail ||
                          error.message ||
                          '미리보기 조회 중 오류가 발생했습니다.';
      toast({
        title: '미리보기 실패',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  // 분할/병합 생성 및 적용
  const createSplitMutation = useMutation({
    mutationFn: (apply: boolean) => {
      const ratioFrom = parseFloat(formData.ratio_from);
      const ratioTo = parseFloat(formData.ratio_to);
      return splitsApi.create(
        {
          ticker: formData.ticker.toUpperCase(),
          split_date: formData.split_date,
          ratio_from: ratioFrom,
          ratio_to: ratioTo,
          note: formData.note || undefined,
        },
        apply
      );
    },
    onSuccess: (response, apply) => {
      queryClient.invalidateQueries({ queryKey: ['stock-splits'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });

      if (apply) {
        toast({
          title: '분할/병합 적용 완료',
          description: `${response.data.ticker}의 분할/병합이 성공적으로 적용되었습니다.`,
          variant: 'success',
        });
      } else {
        toast({
          title: '분할/병합 등록 완료',
          description: `${response.data.ticker}의 분할/병합이 등록되었습니다. 적용하려면 목록에서 "적용" 버튼을 클릭하세요.`,
          variant: 'success',
        });
      }

      // 폼 초기화
      setFormData({
        ticker: '',
        split_date: new Date().toISOString().split('T')[0],
        ratio_from: '',
        ratio_to: '',
        note: '',
      });
      setShowPreview(false);
      setPreviewData(null);
      setShowConfirmModal(false);
      setPendingSplit(null);
    },
    onError: (error: any) => {
      const errorMessage = error.response?.data?.detail?.message ||
                          error.response?.data?.detail ||
                          error.message ||
                          '분할/병합 생성 중 오류가 발생했습니다.';
      toast({
        title: '분할/병합 생성 실패',
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });

  // 분할/병합 적용
  const applySplitMutation = useMutation({
    mutationFn: (splitId: number) => splitsApi.apply(splitId, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-splits'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      toast({
        title: '분할/병합 적용 완료',
        description: '분할/병합이 성공적으로 적용되었고 포지션이 재계산되었습니다.',
        variant: 'success',
      });
    },
    onError: (error: any) => {
      const errorMessage = error.response?.data?.detail?.message ||
                          error.response?.data?.detail ||
                          error.message ||
                          '분할/병합 적용 중 오류가 발생했습니다.';
      toast({
        title: '분할/병합 적용 실패',
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });

  const handleCreate = () => {
    if (!formData.ticker || !formData.split_date || !formData.ratio_from || !formData.ratio_to) {
      toast({
        title: '입력 오류',
        description: '티커, 날짜, 비율을 모두 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    const ratioFrom = parseFloat(formData.ratio_from);
    const ratioTo = parseFloat(formData.ratio_to);

    if (isNaN(ratioFrom) || isNaN(ratioTo) || ratioFrom <= 0 || ratioTo <= 0) {
      toast({
        title: '입력 오류',
        description: '비율은 0보다 큰 숫자여야 합니다.',
        variant: 'destructive',
      });
      return;
    }

    // 미리보기 데이터가 있으면 확인 모달 표시
    if (previewData) {
      setShowConfirmModal(true);
    } else {
      // 미리보기 없이 바로 생성 (적용하지 않음)
      createSplitMutation.mutate(false);
    }
  };

  const handleConfirmApply = () => {
    if (pendingSplit) {
      // 이미 생성된 분할/병합 적용
      applySplitMutation.mutate(pendingSplit.id);
    } else {
      // 생성과 동시에 적용
      createSplitMutation.mutate(true);
    }
    setShowConfirmModal(false);
    setPendingSplit(null);
  };

  const getSplitTypeLabel = (splitType: string) => {
    return splitType === 'SPLIT' ? '분할' : '병합';
  };

  const getSplitRatioLabel = (ratioFrom: number, ratioTo: number) => {
    return `${ratioFrom}:${ratioTo}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>주식 분할/병합 관리</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ticker">티커 *</Label>
              <Input
                id="ticker"
                value={formData.ticker}
                onChange={(e) => setFormData({ ...formData, ticker: e.target.value.toUpperCase() })}
                placeholder="예: TQQQ"
              />
            </div>
            <div>
              <Label htmlFor="split_date">분할/병합 날짜 *</Label>
              <Input
                id="split_date"
                type="date"
                value={formData.split_date}
                onChange={(e) => setFormData({ ...formData, split_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ratio_from">분할 전 비율 *</Label>
              <Input
                id="ratio_from"
                type="number"
                step="0.01"
                value={formData.ratio_from}
                onChange={(e) => setFormData({ ...formData, ratio_from: e.target.value })}
                placeholder="예: 1"
              />
            </div>
            <div>
              <Label htmlFor="ratio_to">분할 후 비율 *</Label>
              <Input
                id="ratio_to"
                type="number"
                step="0.01"
                value={formData.ratio_to}
                onChange={(e) => setFormData({ ...formData, ratio_to: e.target.value })}
                placeholder="예: 10 (분할) 또는 0.2 (병합)"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="note">메모</Label>
              <Input
                id="note"
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                placeholder="선택사항"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handlePreview}
              disabled={previewLoading || !formData.ticker || !formData.split_date || !formData.ratio_from || !formData.ratio_to}
              variant="outline"
            >
              {previewLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  조회 중...
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  미리보기
                </>
              )}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createSplitMutation.isPending || !formData.ticker || !formData.split_date || !formData.ratio_from || !formData.ratio_to}
            >
              {createSplitMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  처리 중...
                </>
              ) : (
                '등록'
              )}
            </Button>
          </div>

          {previewData && showPreview && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-lg">미리보기</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewData.warning && (
                  <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                    <span className="text-sm text-yellow-800">{previewData.warning}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>영향받을 거래 수</Label>
                    <p className="text-lg font-semibold">{previewData.trades_count}건</p>
                  </div>
                  <div>
                    <Label>영향받을 계정 수</Label>
                    <p className="text-lg font-semibold">{previewData.accounts_count}개</p>
                  </div>
                </div>
                {previewData.sample_trades.length > 0 && (
                  <div>
                    <Label>샘플 거래 (최대 10개)</Label>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>계정</TableHead>
                          <TableHead>유형</TableHead>
                          <TableHead>거래일</TableHead>
                          <TableHead>기존 수량</TableHead>
                          <TableHead>기존 단가</TableHead>
                          <TableHead>수정 수량</TableHead>
                          <TableHead>수정 단가</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.sample_trades.map((trade, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{trade.account_name}</TableCell>
                            <TableCell>{trade.side}</TableCell>
                            <TableCell>{trade.trade_date}</TableCell>
                            <TableCell>{trade.old_shares.toFixed(2)}</TableCell>
                            <TableCell>${trade.old_price_usd.toFixed(2)}</TableCell>
                            <TableCell>{trade.new_shares.toFixed(2)}</TableCell>
                            <TableCell>${trade.new_price_usd.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>분할/병합 이력</CardTitle>
        </CardHeader>
        <CardContent>
          {splitsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : !splits || splits.length === 0 ? (
            <p className="text-center text-gray-500 py-8">등록된 분할/병합이 없습니다.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>티커</TableHead>
                  <TableHead>날짜</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead>비율</TableHead>
                  <TableHead>적용 여부</TableHead>
                  <TableHead>영향 거래</TableHead>
                  <TableHead>영향 계정</TableHead>
                  <TableHead>작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {splits.map((split) => (
                  <TableRow key={split.id}>
                    <TableCell className="font-medium">{split.ticker}</TableCell>
                    <TableCell>{split.split_date}</TableCell>
                    <TableCell>{getSplitTypeLabel(split.split_type)}</TableCell>
                    <TableCell>{getSplitRatioLabel(split.ratio_from, split.ratio_to)}</TableCell>
                    <TableCell>
                      {split.applied_at ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          적용됨
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-gray-500">
                          <XCircle className="h-4 w-4" />
                          미적용
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{split.trades_affected ?? '-'}</TableCell>
                    <TableCell>{split.accounts_affected ?? '-'}</TableCell>
                    <TableCell>
                      {!split.applied_at && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (confirm(`${split.ticker}의 분할/병합을 적용하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
                              applySplitMutation.mutate(split.id);
                            }
                          }}
                          disabled={applySplitMutation.isPending}
                        >
                          {applySplitMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            '적용'
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 확인 모달 */}
      <Modal
        open={showConfirmModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowConfirmModal(false);
            setPendingSplit(null);
          }
        }}
      >
        <ModalContent>
        <ModalHeader><ModalTitle>분할/병합 적용 확인</ModalTitle></ModalHeader>
        <div className="space-y-4">
          {previewData && (
            <>
              <p className="text-sm text-gray-600">
                다음 분할/병합을 적용하시겠습니까? 이 작업은 되돌릴 수 없습니다.
              </p>
              <div className="bg-gray-50 p-4 rounded space-y-2">
                <p><strong>티커:</strong> {previewData.ticker}</p>
                <p><strong>날짜:</strong> {previewData.split_date}</p>
                <p><strong>유형:</strong> {getSplitTypeLabel(previewData.split_type)}</p>
                <p><strong>비율:</strong> {getSplitRatioLabel(previewData.ratio_from, previewData.ratio_to)}</p>
                <p><strong>영향받을 거래:</strong> {previewData.trades_count}건</p>
                <p><strong>영향받을 계정:</strong> {previewData.accounts_count}개</p>
              </div>
              {previewData.warning && (
                <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  <span className="text-sm text-yellow-800">{previewData.warning}</span>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmModal(false);
                setPendingSplit(null);
              }}
            >
              취소
            </Button>
            <Button
              onClick={handleConfirmApply}
              disabled={createSplitMutation.isPending}
            >
              {createSplitMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  적용 중...
                </>
              ) : (
                '적용'
              )}
            </Button>
          </div>
        </div>
        </ModalContent>
      </Modal>
    </div>
  );
}

