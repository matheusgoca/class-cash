import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useToast } from "@/hooks/use-toast";
import { generateExpenses } from "@/lib/generateExpenses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Dialog } from "@/components/ui/dialog";
import { CalendarIcon, Plus } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/dateUtils";

interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
}

interface ClassOption {
  id: string;
  name: string;
}

export interface ExpenseRecord {
  id: string;
  category_id: string;
  class_id: string | null;
  description: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  status: "pending" | "paid" | "overdue" | "cancelled";
  payment_method: string | null;
  notes: string | null;
  recurring_expense_id: string | null;
}

interface ExpenseFormProps {
  expense?: ExpenseRecord;
  onSubmit: () => void;
  onCancel: () => void;
}

const toDateStr = (d: Date) => format(d, "yyyy-MM-dd");

export function ExpenseForm({ expense, onSubmit, onCancel }: ExpenseFormProps) {
  const { toast } = useToast();
  const { schoolId } = useSchool();
  const isEditing = !!expense;

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  const [categoryId, setCategoryId] = useState(expense?.category_id ?? "");
  const [classId, setClassId] = useState(expense?.class_id ?? "school");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState<number | "">(expense?.amount ?? "");
  const [paymentMethod, setPaymentMethod] = useState(expense?.payment_method ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [status, setStatus] = useState<ExpenseRecord["status"]>(expense?.status ?? "pending");

  // One-off fields
  const [dueDate, setDueDate] = useState<Date>(expense?.due_date ? parseLocalDate(expense.due_date) : new Date());
  const [paidDate, setPaidDate] = useState<Date | undefined>(
    expense?.paid_date ? parseLocalDate(expense.paid_date) : undefined
  );

  // Recurring fields
  const [isRecurring, setIsRecurring] = useState(false);
  const [dueDay, setDueDay] = useState(10);
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [hasEndDate, setHasEndDate] = useState(false);

  useEffect(() => {
    fetchOptions();
  }, [schoolId]);

  const fetchOptions = async () => {
    if (!schoolId) return;
    setLoadingOptions(true);
    try {
      const [{ data: cats, error: catErr }, { data: cls, error: clsErr }] = await Promise.all([
        (supabase as any)
          .from("expense_categories")
          .select("id, name, color")
          .eq("school_id", schoolId)
          .order("name"),
        supabase.from("classes").select("id, name").eq("school_id", schoolId).order("name"),
      ]);
      if (catErr) throw catErr;
      if (clsErr) throw clsErr;
      setCategories(cats || []);
      setClasses(cls || []);
    } catch (error: any) {
      console.error("Error fetching options:", error);
      toast({ title: "Erro", description: "Erro ao carregar categorias/turmas", variant: "destructive" });
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !schoolId) return;
    setCreatingCategory(true);
    try {
      const { data, error } = await (supabase as any)
        .from("expense_categories")
        .insert({ school_id: schoolId, name: newCategoryName.trim() })
        .select("id, name, color")
        .single();
      if (error) throw error;
      setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(data.id);
      setNewCategoryName("");
      setShowNewCategory(false);
      toast({ title: "Categoria criada!", description: `"${data.name}" já pode ser usada.` });
    } catch (error: any) {
      toast({
        title: "Erro ao criar categoria",
        description: error.message ?? "Talvez já exista uma categoria com esse nome",
        variant: "destructive",
      });
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!categoryId || !description.trim() || !amount || Number(amount) <= 0) {
      toast({ title: "Erro", description: "Preencha categoria, descrição e valor", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const resolvedClassId = classId === "school" ? null : classId;

      if (isEditing) {
        const updateData = {
          category_id: categoryId,
          class_id: resolvedClassId,
          description: description.trim(),
          amount: Number(amount),
          due_date: toDateStr(dueDate),
          status,
          payment_method: paymentMethod || null,
          paid_date: status === "paid" && paidDate ? toDateStr(paidDate) : null,
          notes: notes || null,
        };
        const { error } = await (supabase as any).from("expenses").update(updateData).eq("id", expense!.id);
        if (error) throw error;
        toast({ title: "Sucesso", description: "Despesa atualizada com sucesso!" });
        onSubmit();
        return;
      }

      if (!isRecurring) {
        const insertData = {
          school_id: schoolId,
          category_id: categoryId,
          class_id: resolvedClassId,
          description: description.trim(),
          amount: Number(amount),
          due_date: toDateStr(dueDate),
          status: dueDate < new Date(new Date().setHours(0, 0, 0, 0)) ? "overdue" : "pending",
          payment_method: paymentMethod || null,
          notes: notes || null,
        };
        const { error } = await (supabase as any).from("expenses").insert([insertData]);
        if (error) throw error;
        toast({ title: "Despesa criada!", description: "Lançamento avulso salvo com sucesso." });
        onSubmit();
        return;
      }

      // Recurring: create the mold, then backfill instances
      const recurringData = {
        school_id: schoolId,
        category_id: categoryId,
        class_id: resolvedClassId,
        description: description.trim(),
        amount: Number(amount),
        due_day: dueDay,
        start_date: toDateStr(startDate),
        end_date: hasEndDate && endDate ? toDateStr(endDate) : null,
      };
      const { data: created, error: createError } = await (supabase as any)
        .from("recurring_expenses")
        .insert([recurringData])
        .select("id")
        .single();
      if (createError) throw createError;

      const { inserted, error: genError } = await generateExpenses(created.id);
      if (genError) {
        toast({
          title: "Despesa recorrente criada",
          description: `Molde salvo, mas houve um erro ao gerar os lançamentos: ${genError}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Despesa recorrente criada!",
          description: `${inserted} lançamento${inserted !== 1 ? "s" : ""} gerado${inserted !== 1 ? "s" : ""} automaticamente.`,
        });
      }
      onSubmit();
    } catch (error: any) {
      console.error("Error saving expense:", error);
      toast({ title: "Erro", description: error.message ?? "Erro ao salvar despesa", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isEditing ? "Editar Despesa" : "Nova Despesa"}</DialogTitle>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Categoria *</Label>
            <div className="flex gap-2">
              <Select value={categoryId} onValueChange={setCategoryId} disabled={loadingOptions}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingOptions ? "Carregando..." : "Selecione"} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" onClick={() => setShowNewCategory(true)} title="Nova categoria">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Turma</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="school">Escola toda (rateio)</SelectItem>
                {classes.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Descrição *</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Conta de luz, Coordenação pedagógica..."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Valor (R$) *</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value === "" ? "" : parseFloat(e.target.value))}
              placeholder="0,00"
            />
          </div>

          {!isEditing && (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 mt-auto h-10 self-end">
              <Label htmlFor="is-recurring" className="text-sm cursor-pointer">
                Despesa recorrente
              </Label>
              <Switch id="is-recurring" checked={isRecurring} onCheckedChange={setIsRecurring} />
            </div>
          )}
        </div>

        {(!isRecurring || isEditing) && (
          <div className="space-y-2">
            <Label>Data de Vencimento *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(dueDate, "dd/MM/yyyy", { locale: ptBR })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dueDate} onSelect={(d) => d && setDueDate(d)} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {isRecurring && !isEditing && (
          <div className="space-y-4 rounded-lg border p-3 bg-muted/40">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Dia do vencimento</Label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={dueDay}
                  onChange={(e) => setDueDay(Number(e.target.value) || 1)}
                />
                <p className="text-xs text-muted-foreground">1–28</p>
              </div>
              <div className="space-y-2">
                <Label>Início</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(startDate, "dd/MM/yyyy", { locale: ptBR })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={startDate} onSelect={(d) => d && setStartDate(d)} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Fim</Label>
                  <button
                    type="button"
                    onClick={() => setHasEndDate((v) => !v)}
                    className="text-xs text-primary hover:underline"
                  >
                    {hasEndDate ? "Remover" : "Definir"}
                  </button>
                </div>
                {hasEndDate ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <div className="flex items-center h-10 text-sm text-muted-foreground">Sem data fim (contínua)</div>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Os lançamentos mensais são gerados automaticamente a partir desta data. Você pode pausar ou editar essa despesa recorrente depois, na lista abaixo da página.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label>Forma de Pagamento</Label>
          <Select value={paymentMethod || "none"} onValueChange={(v) => setPaymentMethod(v === "none" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Não informado</SelectItem>
              <SelectItem value="Dinheiro">Dinheiro</SelectItem>
              <SelectItem value="PIX">PIX</SelectItem>
              <SelectItem value="Cartão de Débito">Cartão de Débito</SelectItem>
              <SelectItem value="Cartão de Crédito">Cartão de Crédito</SelectItem>
              <SelectItem value="Transferência">Transferência</SelectItem>
              <SelectItem value="Boleto">Boleto</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Observações</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional" />
        </div>

        {isEditing && (
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ExpenseRecord["status"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="paid">Paga</SelectItem>
                <SelectItem value="overdue">Atrasada</SelectItem>
                <SelectItem value="cancelled">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {isEditing && status === "paid" && (
          <div className="space-y-2">
            <Label>Data de Pagamento</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {paidDate ? format(paidDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={paidDate} onSelect={setPaidDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting || loadingOptions}>
            {submitting ? "Salvando..." : isEditing ? "Atualizar" : "Criar Despesa"}
          </Button>
        </DialogFooter>
      </form>

      {showNewCategory && (
        <Dialog open onOpenChange={() => setShowNewCategory(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Nova categoria de despesa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Ex: Manutenção predial"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Cor e forma de rateio podem ser ajustadas depois em Configurações → Categorias de Despesas.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowNewCategory(false)} disabled={creatingCategory}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateCategory} disabled={creatingCategory || !newCategoryName.trim()}>
                  {creatingCategory ? "Criando..." : "Criar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </DialogContent>
  );
}
