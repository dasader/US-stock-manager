import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsApi } from '../services/api';
import { Account } from '../types';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Plus, Edit2, Trash2, Check, X } from 'lucide-react';

export default function AccountManager() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_active: true,
  });

  // 계정 목록 조회
  const { data: accounts, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const response = await accountsApi.getAll();
      return response.data;
    },
  });

  // 계정 생성
  const createMutation = useMutation({
    mutationFn: (data: Omit<Account, 'id' | 'created_at' | 'updated_at'>) =>
      accountsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      resetForm();
      setIsCreating(false);
      alert('계정이 성공적으로 생성되었습니다.');
    },
    onError: (error: any) => {
      console.error('Account create error:', error);
      console.error('Error response:', error.response?.data);
      const errorMessage = error.response?.data?.detail || '계정 생성에 실패했습니다.';
      alert(`생성 실패:\n${errorMessage}`);
    },
  });

  // 계정 수정
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Account> }) =>
      accountsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setEditingId(null);
      resetForm();
      alert('계정이 성공적으로 수정되었습니다.');
    },
    onError: (error: any) => {
      console.error('Account update error:', error);
      console.error('Error response:', error.response?.data);
      const errorMessage = error.response?.data?.detail || '계정 수정에 실패했습니다.';
      alert(`수정 실패:\n${errorMessage}`);
    },
  });

  // 계정 삭제
  const deleteMutation = useMutation({
    mutationFn: (id: number) => accountsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      alert('계정이 성공적으로 삭제되었습니다.');
    },
    onError: (error: any) => {
      const errorMessage = error.response?.data?.detail || '계정 삭제에 실패했습니다.';
      alert(`삭제 실패: ${errorMessage}`);
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      is_active: true,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingId) {
      // 수정 시: 빈 문자열을 undefined로 변환하여 전송
      const updateData: any = {
        name: formData.name.trim() || undefined,
        description: formData.description?.trim() || undefined,
        is_active: formData.is_active,
      };
      
      // undefined 필드 제거 (name은 제외, 필수 필드이므로)
      if (updateData.name === undefined) {
        alert('계정명은 필수입니다.');
        return;
      }
      
      updateMutation.mutate({ id: editingId, data: updateData });
    } else {
      // 생성 시: 빈 문자열 체크
      if (!formData.name.trim()) {
        alert('계정명은 필수입니다.');
        return;
      }
      
      const createData = {
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        is_active: formData.is_active,
      };
      
      createMutation.mutate(createData);
    }
  };

  const handleEdit = (account: Account) => {
    setEditingId(account.id);
    setFormData({
      name: account.name,
      description: account.description || '',
      is_active: account.is_active,
    });
    setIsCreating(true);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    resetForm();
  };

  const handleDelete = (id: number, _name: string) => {
    if (id === 1) {
      alert('기본 계정은 삭제할 수 없습니다.');
      return;
    }
    if (window.confirm('정말로 이 계정을 삭제하시겠습니까?\n\n⚠️ 주의: 이 계정에 거래 내역이나 현금 거래가 있으면 삭제할 수 없습니다.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleToggleActive = (account: Account) => {
    if (account.id === 1 && account.is_active) {
      alert('기본 계정은 비활성화할 수 없습니다.');
      return;
    }
    updateMutation.mutate({
      id: account.id,
      data: { is_active: !account.is_active },
    });
  };

  if (isLoading) {
    return <div className="text-center py-8">계정 정보를 불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">계정 관리</h2>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            새 계정 추가
          </Button>
        )}
      </div>

      {/* 계정 생성/수정 폼 */}
      {isCreating && (
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? '계정 수정' : '새 계정 생성'}
            </h3>

            <div>
              <Label htmlFor="name">계정명 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="예: 키움증권, NH투자증권"
                required
              />
            </div>

            <div>
              <Label htmlFor="description">설명</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="계정에 대한 설명 (선택사항)"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4"
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                활성 계정
              </Label>
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingId ? '수정' : '생성'}
              </Button>
              <Button type="button" variant="outline" onClick={handleCancel}>
                취소
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* 계정 목록 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {accounts?.map((account) => (
          <Card key={account.id} className="p-6">
            <div className="space-y-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg">{account.name}</h3>
                    {account.id === 1 && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                        기본
                      </span>
                    )}
                  </div>
                  {account.description && (
                    <p className="text-sm text-muted-foreground mt-1">{account.description}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(account)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(account.id, account.name)}
                    disabled={deleteMutation.isPending || account.id === 1}
                    className={account.id === 1 ? 'opacity-30 cursor-not-allowed' : ''}
                    title={account.id === 1 ? '기본 계정은 삭제할 수 없습니다' : '계정 삭제'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-medium">
                  {account.is_active ? (
                    <span className="flex items-center text-green-600">
                      <Check className="h-4 w-4 mr-1" />
                      활성
                    </span>
                  ) : (
                    <span className="flex items-center text-gray-400">
                      <X className="h-4 w-4 mr-1" />
                      비활성
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggleActive(account)}
                  disabled={updateMutation.isPending || (account.id === 1 && account.is_active)}
                  title={account.id === 1 && account.is_active ? '기본 계정은 비활성화할 수 없습니다' : ''}
                >
                  {account.is_active ? '비활성화' : '활성화'}
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                생성일: {new Date(account.created_at).toLocaleDateString()}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {accounts?.length === 0 && (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">등록된 계정이 없습니다.</p>
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            첫 번째 계정 추가하기
          </Button>
        </Card>
      )}
    </div>
  );
}

