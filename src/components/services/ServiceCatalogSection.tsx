import { useState, useEffect } from 'react';
import { Sparkles, Plus, Trash2, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

type ServiceType = 'avulso' | 'mensal' | 'anual_parcelado';

interface SchoolService {
  id: string;
  name: string;
  price: number;
  active: boolean;
  type: ServiceType;
  default_installments: number | null;
}

export function ServiceCatalogSection() {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [services, setServices] = useState<SchoolService[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newType, setNewType] = useState<ServiceType>('avulso');
  const [newInstallments, setNewInstallments] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (schoolId) fetchServices();
  }, [schoolId]);

  const fetchServices = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('school_services')
        .select('id, name, price, active, type, default_installments')
        .eq('school_id', schoolId)
        .order('name');
      if (error) throw error;
      setServices(data || []);
    } catch (err) {
      console.error('Error fetching school services:', err);
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(err, 'Erro ao carregar serviços'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    // Number() (não parseFloat) rejeita lixo à direita como "10abc", que
    // parseFloat aceitaria silenciosamente como 10.
    const price = Number(newPrice);
    if (!newName.trim() || !schoolId || !price || Number.isNaN(price) || price <= 0) return;
    const installments = newType === 'anual_parcelado' ? Number(newInstallments) : null;
    if (newType === 'anual_parcelado' && (!installments || Number.isNaN(installments) || installments <= 0)) {
      toast({ title: 'Informe o número de parcelas', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await (supabase as any)
        .from('school_services')
        .insert({ school_id: schoolId, name: newName.trim(), price, type: newType, default_installments: installments })
        .select('id, name, price, active, type, default_installments')
        .single();
      if (error) throw error;
      setServices((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewPrice('');
      setNewInstallments('');
    } catch (err) {
      toast({
        title: 'Erro ao criar serviço',
        description: getFriendlyErrorMessage(err, 'Talvez já exista um serviço com esse nome'),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const updateService = async (id: string, patch: Partial<SchoolService>) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setSavingId(id);
    const { error } = await (supabase as any).from('school_services').update(patch).eq('id', id).eq('school_id', schoolId);
    setSavingId((current) => (current === id ? null : current));
    if (error) {
      toast({
        title: 'Erro ao salvar',
        description: getFriendlyErrorMessage(error, 'Erro ao salvar serviço'),
        variant: 'destructive',
      });
      // refaz a lista com o valor real do servidor — os inputs abaixo usam
      // key={id-valor} pra remontar e refletir a reversão (defaultValue
      // não atualiza sozinho num input não controlado)
      fetchServices();
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
      const { error } = await (supabase as any).from('school_services').delete().eq('id', deletingId).eq('school_id', schoolId);
      if (error) throw error;
      setServices((prev) => prev.filter((s) => s.id !== deletingId));
      toast({ title: 'Serviço removido' });
    } catch {
      toast({
        title: 'Não foi possível remover',
        description: 'Esse serviço já tem alunos assinados ou cobranças lançadas. Desative em vez de remover.',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <CardTitle>Catálogo de Serviços</CardTitle>
        </div>
        <CardDescription>
          Livre para criar quantos serviços fizer sentido (alimentação, inglês, natação, dança...).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 flex-wrap">
                <Input
                  key={`${s.id}-name-${s.name}`}
                  defaultValue={s.name}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== s.name) updateService(s.id, { name: value });
                  }}
                  className="max-w-[180px]"
                />
                <Input
                  key={`${s.id}-price-${s.price}`}
                  type="number" min="0" step="0.01"
                  defaultValue={s.price}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isNaN(value) || !(value > 0)) {
                      toast({ title: 'Preço inválido', description: 'Informe um valor maior que zero.', variant: 'destructive' });
                      e.target.value = String(s.price);
                      return;
                    }
                    if (value !== s.price) updateService(s.id, { price: value });
                  }}
                  className="max-w-[120px]"
                />
                <Select
                  value={s.type}
                  onValueChange={(v) => updateService(s.id, { type: v as ServiceType })}
                >
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avulso">Avulso</SelectItem>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="anual_parcelado">Anual parcelado</SelectItem>
                  </SelectContent>
                </Select>
                {s.type === 'anual_parcelado' && (
                  <Input
                    key={`${s.id}-installments-${s.default_installments}`}
                    type="number" min="1" step="1"
                    placeholder="Nº parcelas"
                    defaultValue={s.default_installments ?? ''}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isNaN(value) || !(value > 0)) {
                        toast({ title: 'Nº de parcelas inválido', variant: 'destructive' });
                        e.target.value = String(s.default_installments ?? '');
                        return;
                      }
                      if (value !== s.default_installments) updateService(s.id, { default_installments: value });
                    }}
                    className="max-w-[110px]"
                  />
                )}
                <div className="w-4 shrink-0">
                  {savingId === s.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {savedId === s.id && <Check className="h-4 w-4 text-success" />}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground">Ativo</span>
                  <Switch
                    checked={s.active}
                    onCheckedChange={(checked) => updateService(s.id, { active: checked })}
                  />
                </div>
                <Button
                  size="sm" variant="ghost"
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => setDeletingId(s.id)}
                  title="Remover serviço"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {services.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum serviço cadastrado ainda.</p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2 flex-wrap">
          <Input
            placeholder="Nome (ex: Uniforme)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="max-w-[200px]"
          />
          <Input
            type="number" min="0" step="0.01"
            placeholder={newType === 'anual_parcelado' ? 'Valor da parcela' : 'Preço (R$)'}
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="max-w-[130px]"
          />
          <Select value={newType} onValueChange={(v) => setNewType(v as ServiceType)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="avulso">Avulso</SelectItem>
              <SelectItem value="mensal">Mensal</SelectItem>
              <SelectItem value="anual_parcelado">Anual parcelado</SelectItem>
            </SelectContent>
          </Select>
          {newType === 'anual_parcelado' && (
            <Input
              type="number" min="1" step="1"
              placeholder="Nº parcelas"
              value={newInstallments}
              onChange={(e) => setNewInstallments(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="max-w-[110px]"
            />
          )}
          <Button type="button" variant="outline" onClick={handleCreate}
            disabled={creating || !newName.trim() || !newPrice} className="gap-2">
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </CardContent>

      {deletingId && (
        <Dialog open onOpenChange={() => setDeletingId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remover serviço</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Tem certeza? Serviços com assinaturas ou cobranças já lançadas não podem ser removidos.
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
