import { useState, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { tradesApi, accountsApi } from '@/services/api';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, Download } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

interface CsvManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: number | null;
  filters?: {
    ticker?: string;
    start_date?: string;
    end_date?: string;
    side?: string;
  };
  onImportSuccess?: () => void;
}

export default function CsvManagementModal({
  isOpen,
  onClose,
  accountId,
  filters = {},
  onImportSuccess,
}: CsvManagementModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace' | 'merge'>('append');
  const [defaultAccountId, setDefaultAccountId] = useState<number | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);

  // 계정 목록 조회
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const response = await accountsApi.getAll();
      return response.data;
    },
  });

  // CSV 임포트 mutation
  const importCSVMutation = useMutation({
    mutationFn: (file: File) => tradesApi.importCSV(file, importMode, defaultAccountId),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });

      let message = `CSV 임포트 완료:\n성공: ${response.data.success}건\n실패: ${response.data.failed}건`;

      if (response.data.created_accounts && response.data.created_accounts.length > 0) {
        message += `\n\n✨ 자동 생성된 계정:\n${response.data.created_accounts.join(', ')}`;
      }

      toast({
        title: 'CSV 임포트 완료',
        description: message,
        variant: 'default',
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      onImportSuccess?.();
      onClose();
    },
    onError: (error: any) => {
      console.error('CSV Import Error:', error);
      const errorDetail = error.response?.data?.detail;
      let errorMessage = 'CSV 임포트 실패';

      if (typeof errorDetail === 'string') {
        errorMessage += `: ${errorDetail}`;
      } else if (typeof errorDetail === 'object' && errorDetail.message) {
        errorMessage += `: ${errorDetail.message}`;
      } else if (error.message) {
        errorMessage += `: ${error.message}`;
      }

      toast({
        title: 'CSV 임포트 실패',
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });

  // CSV 다운로드
  const handleExportCSV = async () => {
    try {
      const response = await tradesApi.exportCSV({
        account_id: accountId || undefined,
        ticker: filters.ticker || undefined,
        start_date: filters.start_date || undefined,
        end_date: filters.end_date || undefined,
      });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trades_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: 'CSV 다운로드 완료',
        description: '거래 내역이 성공적으로 다운로드되었습니다.',
        variant: 'default',
      });
    } catch (error: any) {
      toast({
        title: 'CSV 다운로드 실패',
        description: error.message || 'CSV 다운로드 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    }
  };

  // 파일 선택 핸들러
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        importCSVMutation.mutate(file);
      } else {
        toast({
          title: '파일 형식 오류',
          description: 'CSV 파일만 업로드할 수 있습니다.',
          variant: 'destructive',
        });
      }
    }
  };

  // 드래그 오버 핸들러
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  // 드래그 리브 핸들러
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // 드롭 핸들러
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        importCSVMutation.mutate(file);
      } else {
        toast({
          title: '파일 형식 오류',
          description: 'CSV 파일만 업로드할 수 있습니다.',
          variant: 'destructive',
        });
      }
    }
  };

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>CSV 관리</ModalTitle>
          <ModalDescription>
            거래 내역을 CSV 파일로 다운로드하거나 업로드할 수 있습니다.
          </ModalDescription>
        </ModalHeader>

        <div className="space-y-6 py-4">
          {/* CSV 다운로드 섹션 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">CSV 다운로드</h3>
            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <p className="text-sm text-muted-foreground mb-3">
                현재 필터 조건에 맞는 거래 내역을 CSV 파일로 다운로드합니다.
              </p>
              <Button
                variant="outline"
                onClick={handleExportCSV}
                className="w-full sm:w-auto"
              >
                <Download className="h-4 w-4 mr-2" />
                CSV 다운로드
              </Button>
            </div>
          </div>

          {/* CSV 업로드 섹션 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">CSV 업로드</h3>

            {/* 임포트 모드 선택 */}
            <div className="space-y-2">
              <Label htmlFor="import-mode">임포트 모드</Label>
              <select
                id="import-mode"
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'append' | 'replace' | 'merge')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="append">추가 - 기존 데이터에 추가</option>
                <option value="replace">교체 - 기존 거래를 모두 삭제하고 새로 추가</option>
                <option value="merge">병합 - 중복 거래는 건너뛰고 새 거래만 추가</option>
              </select>
            </div>

            {/* 기본 계정 선택 */}
            {accountId === null && (
              <div className="space-y-2">
                <Label htmlFor="default-account">기본 계정 (선택사항)</Label>
                <select
                  id="default-account"
                  value={defaultAccountId || ''}
                  onChange={(e) =>
                    setDefaultAccountId(e.target.value ? parseInt(e.target.value) : undefined)
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">계정 선택 안 함</option>
                  {accounts
                    ?.filter((a) => a.is_active)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  CSV 파일에 계정 정보가 없을 경우 이 계정을 사용합니다.
                </p>
              </div>
            )}

            {/* 드래그 앤 드롭 영역 */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-400 dark:hover:border-gray-600'
              }`}
            >
              <Upload
                className={`h-12 w-12 mx-auto mb-4 ${
                  isDragging ? 'text-blue-500' : 'text-gray-400'
                }`}
              />
              <p className="text-lg font-semibold mb-2">
                {isDragging ? 'CSV 파일을 여기에 놓으세요' : 'CSV 파일을 드래그하여 업로드'}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                또는 아래 버튼을 클릭하여 파일을 선택하세요
              </p>
              <div className="text-xs text-muted-foreground mb-4">
                <p>
                  모드: {importMode === 'append' ? '추가' : importMode === 'replace' ? '교체' : '병합'}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importCSVMutation.isPending}
              >
                <Upload className="h-4 w-4 mr-2" />
                {importCSVMutation.isPending ? '업로드 중...' : '파일 선택'}
              </Button>
            </div>

            {/* 업로드 진행 상태 */}
            {importCSVMutation.isPending && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 dark:border-blue-400"></div>
                  <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                    CSV 파일을 업로드하고 있습니다. 잠시만 기다려주세요...
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
