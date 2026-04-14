import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsApi, splitsApi, backupApi } from '@/services/api';
import type { Account, Currency, StockSplitPreview, BackupCreateRequest, RestorePreview } from '@/types';
import { CurrencyBadge } from '@/components/accounts/CurrencyBadge';
import { Card, CardContent } from '@/components/ui/card';
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
import { useToast } from '@/hooks/useToast';
import {
  ChevronDown,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  Eye,
  Download,
  Upload,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Settings as SettingsIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Accordion Section wrapper
// ---------------------------------------------------------------------------
function Section({
  id,
  title,
  icon,
  isOpen,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-border/60">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-5 py-4 text-left cursor-pointer
                   hover:bg-accent/30 transition-colors duration-150"
      >
        <span className="flex items-center gap-2.5 font-semibold text-base">
          {icon}
          {title}
        </span>
        <ChevronDown
          className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        className="transition-[max-height] duration-300 ease-in-out overflow-hidden"
        style={{ maxHeight: isOpen ? '5000px' : '0px' }}
      >
        <div className={`border-t px-5 py-5 ${isOpen ? '' : 'invisible'}`}>
          {children}
        </div>
      </div>
    </Card>
  );
}

// ===========================================================================
// Main Settings component
// ===========================================================================
export default function Settings() {
  const [openSection, setOpenSection] = useState<string | null>('accounts');
  const toggleSection = (id: string) =>
    setOpenSection((prev) => (prev === id ? null : id));

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        <SettingsIcon className="h-6 w-6 text-[#D4A853]" />
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
      </div>

      {/* Section 1 */}
      <Section
        id="accounts"
        title="계정 관리"
        icon={<span className="text-[#D4A853]">01</span>}
        isOpen={openSection === 'accounts'}
        onToggle={toggleSection}
      >
        <AccountSection />
      </Section>

      {/* Section 2 */}
      <Section
        id="splits"
        title="주식 분할/병합"
        icon={<span className="text-[#D4A853]">02</span>}
        isOpen={openSection === 'splits'}
        onToggle={toggleSection}
      >
        <SplitSection />
      </Section>

      {/* Section 3 */}
      <Section
        id="data"
        title="데이터 관리"
        icon={<span className="text-[#D4A853]">03</span>}
        isOpen={openSection === 'data'}
        onToggle={toggleSection}
      >
        <DataSection />
      </Section>
    </div>
  );
}

// ===========================================================================
// Section 1 — Account Management
// ===========================================================================
function AccountSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', is_active: true, base_currency: 'USD' as Currency });

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await accountsApi.getAll()).data,
  });

  const resetForm = () => {
    setFormData({ name: '', description: '', is_active: true, base_currency: 'USD' });
  };

  const createMutation = useMutation({
    mutationFn: (data: Omit<Account, 'id' | 'created_at' | 'updated_at'>) =>
      accountsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      resetForm();
      setIsCreating(false);
      toast({ title: '계정 생성 완료', description: '계정이 성공적으로 생성되었습니다.', variant: 'success' });
    },
    onError: (err: any) => {
      toast({ title: '계정 생성 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Account> }) =>
      accountsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setEditingId(null);
      resetForm();
      setIsCreating(false);
      toast({ title: '계정 수정 완료', description: '계정이 성공적으로 수정되었습니다.', variant: 'success' });
    },
    onError: (err: any) => {
      toast({ title: '계정 수정 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => accountsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({ title: '계정 삭제 완료', description: '계정이 삭제되었습니다.', variant: 'success' });
    },
    onError: (err: any) => {
      toast({ title: '계정 삭제 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: '입력 오류', description: '계정명은 필수입니다.', variant: 'destructive' });
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: { name: formData.name.trim(), description: formData.description.trim() || undefined, is_active: formData.is_active, base_currency: formData.base_currency } });
    } else {
      createMutation.mutate({ name: formData.name.trim(), description: formData.description.trim() || '', is_active: formData.is_active, base_currency: formData.base_currency });
    }
  };

  const handleEdit = (account: Account) => {
    setEditingId(account.id);
    setFormData({ name: account.name, description: account.description || '', is_active: account.is_active, base_currency: account.base_currency ?? 'USD' });
    setIsCreating(true);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    resetForm();
  };

  const handleDelete = (id: number) => {
    if (id === 1) return;
    if (window.confirm('정말로 이 계정을 삭제하시겠습니까?\n\n이 계정에 거래 내역이나 현금 거래가 있으면 삭제할 수 없습니다.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleToggleActive = (account: Account) => {
    if (account.id === 1 && account.is_active) {
      toast({ title: '비활성화 불가', description: '기본 계정은 비활성화할 수 없습니다.', variant: 'destructive' });
      return;
    }
    updateMutation.mutate({ id: account.id, data: { is_active: !account.is_active } });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> 불러오는 중...</div>;
  }

  return (
    <div className="space-y-5">
      {/* Add / Edit form */}
      {isCreating ? (
        <Card className="p-5 border-[#D4A853]/30">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-[#D4A853]">
              {editingId ? '계정 수정' : '새 계정 생성'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="acc-name">계정명 *</Label>
                <Input id="acc-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="예: 키움증권" required />
              </div>
              <div>
                <Label htmlFor="acc-desc">설명</Label>
                <Input id="acc-desc" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="선택사항" />
              </div>
              <div>
                <Label htmlFor="acc-currency">기준 통화</Label>
                <select
                  id="acc-currency"
                  value={formData.base_currency}
                  onChange={(e) => setFormData({ ...formData, base_currency: e.target.value as Currency })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="USD">USD (미국)</option>
                  <option value="KRW">KRW (한국)</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="acc-active" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="h-4 w-4 accent-[#D4A853]" />
              <Label htmlFor="acc-active" className="cursor-pointer">활성 계정</Label>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingId ? '수정' : '생성'}
              </Button>
              <Button type="button" variant="outline" onClick={handleCancel}>취소</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setIsCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> 새 계정 추가
        </Button>
      )}

      {/* Account cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts?.map((account) => (
          <Card
            key={account.id}
            className={`relative overflow-hidden ${
              account.is_active ? 'border-l-[3px] border-l-emerald-500' : 'border-l-[3px] border-l-muted-foreground/30 opacity-70'
            }`}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{account.name}</span>
                    <CurrencyBadge currency={account.base_currency ?? 'USD'} />
                    {account.id === 1 && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#D4A853]/15 text-[#D4A853] rounded">기본</span>
                    )}
                  </div>
                  {account.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{account.description}</p>
                  )}
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleEdit(account)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-7 w-7 p-0 ${account.id === 1 ? 'opacity-20 cursor-not-allowed' : ''}`}
                    onClick={() => handleDelete(account.id)}
                    disabled={deleteMutation.isPending || account.id === 1}
                    title={account.id === 1 ? '기본 계정은 삭제할 수 없습니다' : '삭제'}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-xs font-medium">
                  {account.is_active ? (
                    <span className="flex items-center text-emerald-500"><Check className="h-3.5 w-3.5 mr-1" />활성</span>
                  ) : (
                    <span className="flex items-center text-muted-foreground"><X className="h-3.5 w-3.5 mr-1" />비활성</span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs px-2"
                  onClick={() => handleToggleActive(account)}
                  disabled={updateMutation.isPending || (account.id === 1 && account.is_active)}
                >
                  {account.is_active ? '비활성화' : '활성화'}
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                생성일: {new Date(account.created_at).toLocaleDateString('ko-KR')}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {accounts?.length === 0 && (
        <p className="text-center text-muted-foreground py-6 text-sm">등록된 계정이 없습니다.</p>
      )}
    </div>
  );
}

// ===========================================================================
// Section 2 — Stock Splits
// ===========================================================================
function SplitSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    ticker: '',
    split_date: new Date().toISOString().split('T')[0],
    ratio_from: '',
    ratio_to: '',
    note: '',
  });
  const [previewData, setPreviewData] = useState<StockSplitPreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data: splits, isLoading: splitsLoading } = useQuery({
    queryKey: ['stock-splits'],
    queryFn: async () => (await splitsApi.getAll()).data,
  });

  const validateForm = (): boolean => {
    if (!formData.ticker || !formData.split_date || !formData.ratio_from || !formData.ratio_to) {
      toast({ title: '입력 오류', description: '티커, 날짜, 비율을 모두 입력해주세요.', variant: 'destructive' });
      return false;
    }
    const rf = parseFloat(formData.ratio_from);
    const rt = parseFloat(formData.ratio_to);
    if (isNaN(rf) || isNaN(rt) || rf <= 0 || rt <= 0) {
      toast({ title: '입력 오류', description: '비율은 0보다 큰 숫자여야 합니다.', variant: 'destructive' });
      return false;
    }
    return true;
  };

  const handlePreview = async () => {
    if (!validateForm()) return;
    setPreviewLoading(true);
    try {
      const resp = await splitsApi.preview({
        ticker: formData.ticker.toUpperCase(),
        split_date: formData.split_date,
        ratio_from: parseFloat(formData.ratio_from),
        ratio_to: parseFloat(formData.ratio_to),
      });
      setPreviewData(resp.data);
      setShowPreview(true);
    } catch (err: any) {
      toast({ title: '미리보기 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const createSplitMutation = useMutation({
    mutationFn: (apply: boolean) =>
      splitsApi.create(
        {
          ticker: formData.ticker.toUpperCase(),
          split_date: formData.split_date,
          ratio_from: parseFloat(formData.ratio_from),
          ratio_to: parseFloat(formData.ratio_to),
          note: formData.note || undefined,
        },
        apply,
      ),
    onSuccess: (_resp, apply) => {
      queryClient.invalidateQueries({ queryKey: ['stock-splits'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      toast({
        title: apply ? '분할/병합 적용 완료' : '분할/병합 등록 완료',
        description: apply
          ? '거래 내역이 성공적으로 조정되었습니다.'
          : '등록되었습니다. 목록에서 "적용" 버튼으로 실행하세요.',
        variant: 'success',
      });
      setFormData({ ticker: '', split_date: new Date().toISOString().split('T')[0], ratio_from: '', ratio_to: '', note: '' });
      setShowPreview(false);
      setPreviewData(null);
    },
    onError: (err: any) => {
      toast({ title: '분할/병합 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  const applySplitMutation = useMutation({
    mutationFn: (splitId: number) => splitsApi.apply(splitId, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-splits'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      toast({ title: '적용 완료', description: '분할/병합이 성공적으로 적용되었습니다.', variant: 'success' });
    },
    onError: (err: any) => {
      toast({ title: '적용 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  const handleCreateAndApply = () => {
    if (!validateForm()) return;
    if (window.confirm('분할/병합을 생성하고 즉시 적용하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
      createSplitMutation.mutate(true);
    }
  };

  const formDisabled = !formData.ticker || !formData.split_date || !formData.ratio_from || !formData.ratio_to;

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="sp-ticker">티커 *</Label>
          <Input id="sp-ticker" value={formData.ticker} onChange={(e) => setFormData({ ...formData, ticker: e.target.value.toUpperCase() })} placeholder="예: TQQQ" />
        </div>
        <div>
          <Label htmlFor="sp-date">분할/병합 날짜 *</Label>
          <Input id="sp-date" type="date" value={formData.split_date} onChange={(e) => setFormData({ ...formData, split_date: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="sp-from">분할 전 비율 *</Label>
          <Input id="sp-from" type="number" step="0.01" min="0" value={formData.ratio_from} onChange={(e) => setFormData({ ...formData, ratio_from: e.target.value })} placeholder="예: 1" />
        </div>
        <div>
          <Label htmlFor="sp-to">분할 후 비율 *</Label>
          <Input id="sp-to" type="number" step="0.01" min="0" value={formData.ratio_to} onChange={(e) => setFormData({ ...formData, ratio_to: e.target.value })} placeholder="예: 10 (분할) 또는 0.2 (병합)" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="sp-note">메모</Label>
          <Input id="sp-note" value={formData.note} onChange={(e) => setFormData({ ...formData, note: e.target.value })} placeholder="선택사항" />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={handlePreview} disabled={previewLoading || formDisabled}>
          {previewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
          미리보기
        </Button>
        <Button onClick={handleCreateAndApply} disabled={createSplitMutation.isPending || formDisabled}>
          {createSplitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          생성 및 적용
        </Button>
      </div>

      {/* Preview */}
      {showPreview && previewData && (
        <Card className="border-[#D4A853]/30">
          <CardContent className="p-4 space-y-4">
            <h4 className="font-semibold text-sm text-[#D4A853] uppercase tracking-wider">미리보기</h4>
            {previewData.warning && (
              <div className="flex items-center gap-2 p-3 rounded bg-yellow-500/10 border border-yellow-500/20 text-sm">
                <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                <span>{previewData.warning}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">영향받을 거래</span>
                <p className="text-lg font-semibold tabular-nums">{previewData.trades_count}건</p>
              </div>
              <div>
                <span className="text-muted-foreground">영향받을 계정</span>
                <p className="text-lg font-semibold tabular-nums">{previewData.accounts_count}개</p>
              </div>
            </div>
            {previewData.sample_trades.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>계정</TableHead>
                      <TableHead>유형</TableHead>
                      <TableHead>거래일</TableHead>
                      <TableHead className="text-right">기존 수량</TableHead>
                      <TableHead className="text-right">기존 단가</TableHead>
                      <TableHead className="text-right">수정 수량</TableHead>
                      <TableHead className="text-right">수정 단가</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.sample_trades.map((t, i) => (
                      <TableRow key={i}>
                        <TableCell>{t.account_name}</TableCell>
                        <TableCell>{t.side}</TableCell>
                        <TableCell className="tabular-nums">{t.trade_date}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.old_shares.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">${t.old_price_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.new_shares.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">${t.new_price_usd.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* History */}
      <div>
        <h4 className="font-semibold text-sm mb-3">분할/병합 이력</h4>
        {splitsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !splits || splits.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-6">등록된 분할/병합이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>티커</TableHead>
                  <TableHead>날짜</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead>비율</TableHead>
                  <TableHead>적용 여부</TableHead>
                  <TableHead className="text-right">영향 거래</TableHead>
                  <TableHead>작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {splits.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.ticker}</TableCell>
                    <TableCell className="tabular-nums">{s.split_date}</TableCell>
                    <TableCell>{s.split_type === 'SPLIT' ? '분할' : '병합'}</TableCell>
                    <TableCell className="tabular-nums">{s.ratio_from}:{s.ratio_to}</TableCell>
                    <TableCell>
                      {s.applied_at ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500 text-xs"><CheckCircle className="h-3.5 w-3.5" />적용됨</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs"><XCircle className="h-3.5 w-3.5" />미적용</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.trades_affected ?? '-'}</TableCell>
                    <TableCell>
                      {!s.applied_at && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={applySplitMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`${s.ticker}의 분할/병합을 적용하시겠습니까? 되돌릴 수 없습니다.`)) {
                              applySplitMutation.mutate(s.id);
                            }
                          }}
                        >
                          {applySplitMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '적용'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Section 3 — Data Management (Backup / Restore)
// ===========================================================================
function DataSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Backup state ----
  const [backupRequest, setBackupRequest] = useState<BackupCreateRequest>({
    include_accounts: true,
    include_trades: true,
    include_cash: true,
    include_dividends: true,
    include_realized_pl: true,
    include_snapshots: true,
    include_settings: true,
    backup_name: '',
  });

  // ---- Restore state ----
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoreMode, setRestoreMode] = useState<string>('smart_merge');
  const [accountNameConflict, setAccountNameConflict] = useState<string>('map');
  const [duplicateData, setDuplicateData] = useState<string>('skip');
  const [restoreStep, setRestoreStep] = useState<'upload' | 'preview' | 'restoring'>('upload');
  const [preview, setPreview] = useState<RestorePreview | null>(null);

  // ---- Backup mutation ----
  const backupMutation = useMutation({
    mutationFn: (req: BackupCreateRequest) => backupApi.createDownload(req),
    onSuccess: (response) => {
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.download = backupRequest.backup_name
        ? `${backupRequest.backup_name}_${ts}.json`
        : `backup_${ts}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({ title: '백업 완료', description: '백업 파일이 다운로드되었습니다.', variant: 'success' });
    },
    onError: (err: any) => {
      toast({ title: '백업 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  // ---- Restore mutations ----
  const previewMutation = useMutation({
    mutationFn: (file: File) =>
      backupApi.restorePreview(file, restoreMode, accountNameConflict, duplicateData),
    onSuccess: (data) => {
      setPreview(data.data);
      setRestoreStep('preview');
    },
    onError: (err: any) => {
      toast({ title: '미리보기 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (file: File) =>
      backupApi.restore(file, restoreMode, accountNameConflict, duplicateData),
    onSuccess: (data) => {
      if (data.data.success) {
        toast({ title: '복원 완료', description: data.data.message, variant: 'success' });
        queryClient.invalidateQueries();
        resetRestore();
      } else {
        toast({ title: '복원 실패', description: data.data.message, variant: 'destructive' });
        setRestoreStep('preview');
      }
    },
    onError: (err: any) => {
      toast({ title: '복원 실패', description: err.message || '오류가 발생했습니다.', variant: 'destructive' });
      setRestoreStep('preview');
    },
  });

  const resetRestore = () => {
    setSelectedFile(null);
    setPreview(null);
    setRestoreStep('upload');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreview(null);
      setRestoreStep('upload');
    }
  };

  const handleRestorePreview = () => {
    if (!selectedFile) {
      toast({ title: '파일 없음', description: '백업 파일을 선택해주세요.', variant: 'destructive' });
      return;
    }
    previewMutation.mutate(selectedFile);
  };

  const handleRestoreConfirm = () => {
    if (!selectedFile) return;
    if (!window.confirm('복원을 시작하시겠습니까?\n\n복원 모드에 따라 기존 데이터가 변경될 수 있습니다.')) return;
    setRestoreStep('restoring');
    restoreMutation.mutate(selectedFile);
  };

  const checkboxItems: { key: keyof BackupCreateRequest; label: string }[] = [
    { key: 'include_accounts', label: '계정' },
    { key: 'include_trades', label: '거래 내역' },
    { key: 'include_cash', label: '현금 내역' },
    { key: 'include_dividends', label: '배당금' },
    { key: 'include_realized_pl', label: '실현 손익' },
    { key: 'include_snapshots', label: '일일 스냅샷' },
    { key: 'include_settings', label: '설정' },
  ];

  return (
    <div className="space-y-8">
      {/* ---- Backup ---- */}
      <div className="space-y-4">
        <h4 className="font-semibold text-sm uppercase tracking-wider text-[#D4A853] flex items-center gap-2">
          <Download className="h-4 w-4" /> 백업 생성
        </h4>
        <div>
          <Label htmlFor="bk-name">백업 이름 (선택)</Label>
          <Input
            id="bk-name"
            value={backupRequest.backup_name || ''}
            onChange={(e) => setBackupRequest({ ...backupRequest, backup_name: e.target.value })}
            placeholder="예: monthly_backup"
          />
        </div>
        <div>
          <Label className="mb-2 block">백업할 항목</Label>
          <div className="grid grid-cols-2 gap-3">
            {checkboxItems.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={!!backupRequest[key]}
                  onChange={(e) => setBackupRequest({ ...backupRequest, [key]: e.target.checked })}
                  className="h-4 w-4 accent-[#D4A853]"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <Button onClick={() => backupMutation.mutate(backupRequest)} disabled={backupMutation.isPending}>
          {backupMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {backupMutation.isPending ? '생성 중...' : '백업 생성 및 다운로드'}
        </Button>
      </div>

      <hr className="border-border/50" />

      {/* ---- Restore ---- */}
      <div className="space-y-4">
        <h4 className="font-semibold text-sm uppercase tracking-wider text-[#D4A853] flex items-center gap-2">
          <Upload className="h-4 w-4" /> 데이터 복원
        </h4>

        {/* Step: Upload */}
        {restoreStep === 'upload' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="rs-file">백업 파일 선택 (JSON)</Label>
              <input
                ref={fileInputRef}
                id="rs-file"
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="mt-2 block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#D4A853]/10 file:text-[#D4A853] hover:file:bg-[#D4A853]/20 file:cursor-pointer"
              />
              {selectedFile && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            {/* Restore mode */}
            <div>
              <Label>복원 모드</Label>
              <div className="mt-2 space-y-1.5">
                {([
                  ['smart_merge', '스마트 병합 (권장) - 기존 데이터와 병합'],
                  ['replace', '전체 교체 - 모든 기존 데이터 삭제 후 복원'],
                  ['append', '추가 - 기존 데이터 유지하고 추가'],
                ] as const).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" value={val} checked={restoreMode === val} onChange={(e) => setRestoreMode(e.target.value)} className="accent-[#D4A853]" />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Smart merge options */}
            {restoreMode === 'smart_merge' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-2 border-l-2 border-[#D4A853]/20">
                <div>
                  <Label className="text-xs">계정 이름 충돌 처리</Label>
                  <div className="mt-1.5 space-y-1">
                    {([
                      ['map', '기존 계정 매핑'],
                      ['overwrite', '덮어쓰기'],
                      ['create_new', '새 이름 생성'],
                    ] as const).map(([val, label]) => (
                      <label key={val} className="flex items-center gap-2 cursor-pointer text-xs">
                        <input type="radio" value={val} checked={accountNameConflict === val} onChange={(e) => setAccountNameConflict(e.target.value)} className="accent-[#D4A853]" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">중복 데이터 처리</Label>
                  <div className="mt-1.5 space-y-1">
                    {([
                      ['skip', '건너뛰기'],
                      ['add_all', '모두 추가'],
                    ] as const).map(([val, label]) => (
                      <label key={val} className="flex items-center gap-2 cursor-pointer text-xs">
                        <input type="radio" value={val} checked={duplicateData === val} onChange={(e) => setDuplicateData(e.target.value)} className="accent-[#D4A853]" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <Button onClick={handleRestorePreview} disabled={!selectedFile || previewMutation.isPending} className="w-full sm:w-auto">
              {previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
              {previewMutation.isPending ? '분석 중...' : '미리보기'}
            </Button>
          </div>
        )}

        {/* Step: Preview */}
        {restoreStep === 'preview' && preview && (
          <div className="space-y-4">
            {preview.warnings.length > 0 && (
              <div className="rounded p-3 bg-yellow-500/10 border border-yellow-500/20 text-sm space-y-1">
                <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-yellow-500" /> 경고</div>
                <ul className="list-disc list-inside text-xs space-y-0.5">
                  {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([
                ['계정', `복원: ${preview.accounts_to_restore}`, `매핑: ${preview.accounts_to_map} | 생성: ${preview.accounts_to_create}`],
                ['거래 내역', `복원: ${preview.trades_to_restore}`, `중복: ${preview.trades_duplicate}`],
                ['현금', `${preview.cash_to_restore}`, ''],
                ['배당금', `${preview.dividends_to_restore}`, ''],
                ['실현 손익', `${preview.realized_pl_to_restore}`, ''],
                ['스냅샷', `${preview.snapshots_to_restore}`, ''],
              ] as const).map(([label, main, sub], i) => (
                <div key={i} className="rounded-md bg-muted/50 p-3">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="text-sm font-semibold tabular-nums">{main}</div>
                  {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRestoreStep('upload')}>뒤로</Button>
              <Button onClick={handleRestoreConfirm} disabled={restoreMutation.isPending}>
                {restoreMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {restoreMutation.isPending ? '복원 중...' : '복원 실행'}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Restoring */}
        {restoreStep === 'restoring' && (
          <div className="text-center py-8 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-[#D4A853]" />
            <p className="font-semibold">복원 중...</p>
            <p className="text-xs text-muted-foreground">잠시만 기다려주세요.</p>
          </div>
        )}
      </div>

      {/* Info note */}
      <div className="text-xs text-muted-foreground space-y-1 pt-2">
        <p className="font-medium">참고:</p>
        <ul className="list-disc list-inside space-y-0.5 ml-1">
          <li>백업 파일은 JSON 형식으로 저장됩니다.</li>
          <li>캐시 데이터(환율, 시세)는 백업에 포함되지 않습니다.</li>
          <li>정기적으로 백업을 생성하는 것을 권장합니다.</li>
        </ul>
      </div>
    </div>
  );
}
