import { useState, useEffect } from 'react';
import { Wallet, Plus, Trash2, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';

interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
  is_fixed_cost: boolean;
  allocation_method: 'school' | 'per_class' | 'per_student';
}

const ALLOCATION_LABELS: Record<ExpenseCategory['allocation_method'], string> = {
  school: 'Custo geral da escola',
  per_class: 'Rateado por turma',
  per_student: 'Rateado por aluno',
};

export function ExpenseCategoriesSection() {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (schoolId) fetchCategories();
  }, [schoolId]);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('expense_categories')
        .select('id, name, color, is_fixed_cost, allocation_method')
        .eq('school_id', schoolId)
        .order('name');
      if (error) throw error;
      setCategories(data || []);
    } catch (err: any) {
      console.error('Error fetching expense categories:', err);
      toast({ title: 'Erro', description: 'Erro ao carregar categorias de despesas', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !schoolId) return;
    setCreating(true);
    try {
      const { data, error } = await (supabase as any)
        .from('expense_categories')
        .insert({ school_id: schoolId, name: newName.trim() })
        .select('id, name, color, is_fixed_cost, allocation_method')
        .single();
      if (error) throw error;
      setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
    } catch (err: any) {
      toast({
        title: 'Erro ao criar categoria',
        description: err.message ?? 'Talvez já exista uma categoria com esse nome',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const updateCategory = async (id: string, patch: Partial<ExpenseCategory>) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setSavingId(id);
    const { error } = await (supabase as any).from('expense_categories').update(patch).eq('id', id);
    setSavingId((current) => (current === id ? null : current));
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      fetchCategories();
      return;
    }
    // Sem botão de salvar (edição é onBlur/onChange direto) — sem esse check
    // momentâneo, a única confirmação era um toast fácil de não notar.
    setSavedId(id);
    setTimeout(() => setSavedId((current) => (current === id ? null : current)), 1500);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await (supabase as any).from('expense_categories').delete().eq('id', deletingId);
      if (error) throw error;
      setCategories((prev) => prev.filter((c) => c.id !== deletingId));
      toast({ title: 'Categoria removida' });
    } catch (err: any) {
      toast({
        title: 'Não foi possível remover',
        description: 'Essa categoria já tem despesas lançadas. Edite ou remova as despesas primeiro.',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <CardTitle>Categorias de Despesas</CardTitle>
        </div>
        <CardDescription>
          Livre para criar quantas categorias fizer sentido (água, luz, IPTU, coordenação...). Nada travado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5 flex-wrap"
              >
                <input
                  type="color"
                  value={cat.color}
                  onChange={(e) => updateCategory(cat.id, { color: e.target.value })}
                  className="h-8 w-8 rounded cursor-pointer border-0 bg-transparent shrink-0"
                  title="Cor da categoria"
                />
                <Input
                  defaultValue={cat.name}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== cat.name) updateCategory(cat.id, { name: value });
                  }}
                  className="max-w-[200px]"
                />
                <div className="w-4 shrink-0">
                  {savingId === cat.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {savedId === cat.id && <Check className="h-4 w-4 text-success" />}
                </div>
                <Select
                  value={cat.allocation_method}
                  onValueChange={(v) => updateCategory(cat.id, { allocation_method: v as ExpenseCategory['allocation_method'] })}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="school">Custo geral da escola</SelectItem>
                    <SelectItem value="per_class">Rateado por turma</SelectItem>
                    <SelectItem value="per_student">Rateado por aluno</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Custo fixo</span>
                  <Switch
                    checked={cat.is_fixed_cost}
                    onCheckedChange={(checked) => updateCategory(cat.id, { is_fixed_cost: checked })}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => setDeletingId(cat.id)}
                  title="Remover categoria"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma categoria cadastrada ainda.</p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Input
            placeholder="Nova categoria (ex: Manutenção predial)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="max-w-sm"
          />
          <Button type="button" variant="outline" onClick={handleCreate} disabled={creating || !newName.trim()} className="gap-2">
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </CardContent>

      {deletingId && (
        <Dialog open onOpenChange={() => setDeletingId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remover categoria</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Tem certeza? Categorias com despesas já lançadas não podem ser removidas.
            </p>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDeletingId(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDelete}>Remover</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
