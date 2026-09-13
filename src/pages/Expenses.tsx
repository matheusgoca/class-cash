import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useToast } from "@/hooks/use-toast";
import { generateExpenses } from "@/lib/generateExpenses";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ExpenseForm, type ExpenseRecord } from "@/components/expenses/ExpenseForm";
import { ExpenseTable } from "@/components/expenses/ExpenseTable";
import { ExpenseCategoriesSection } from "@/components/expenses/ExpenseCategoriesSection";
import { Plus, Repeat, ChevronDown, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ExpenseTableRow extends ExpenseRecord {
  category: { name: string; color: string } | null;
  className: string | null;
}

interface RecurringExpenseRow {
  id: string;
  description: string;
  amount: number;
  due_day: number;
  start_date: string;
  end_date: string | null;
  active: boolean;
  category: { name: string; color: string } | null;
  className: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface ClassOption {
  id: string;
  name: string;
}

const Expenses = () => {
  const { schoolId } = useSchool();
  const { toast } = useToast();

  const [expenses, setExpenses] = useState<ExpenseTableRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpenseRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [classFilter, setClassFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseTableRow | null>(null);
  const [showRecurring, setShowRecurring] = useState(false);
  const [deletingRecurringId, setDeletingRecurringId] = useState<string | null>(null);

  useEffect(() => {
    if (schoolId) {
      fetchAll();
    }
  }, [schoolId]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchExpenses(), fetchRecurring(), fetchOptions()]);
    setLoading(false);
  };

  const fetchOptions = async () => {
    if (!schoolId) return;
    const [{ data: cats }, { data: cls }] = await Promise.all([
      (supabase as any).from("expense_categories").select("id, name").eq("school_id", schoolId).order("name"),
      supabase.from("classes").select("id, name").eq("school_id", schoolId).order("name"),
    ]);
    setCategories(cats || []);
    setClasses(cls || []);
  };

  const fetchExpenses = async () => {
    if (!schoolId) return;
    try {
      const { data, error } = await (supabase as any)
        .from("expenses")
        .select(
          `
          id, category_id, class_id, description, amount, due_date, paid_date,
          status, payment_method, notes, recurring_expense_id,
          expense_categories ( name, color ),
          classes ( name )
        `
        )
        .eq("school_id", schoolId)
        .order("due_date", { ascending: false });

      if (error) throw error;

      const typed: ExpenseTableRow[] = (data || []).map((item: any) => ({
        ...item,
        category: item.expense_categories ?? null,
        className: item.classes?.name ?? null,
      }));
      setExpenses(typed);
    } catch (error: any) {
      console.error("Error fetching expenses:", error);
      toast({ title: "Erro", description: "Erro ao carregar despesas", variant: "destructive" });
    }
  };

  const fetchRecurring = async () => {
    if (!schoolId) return;
    try {
      const { data, error } = await (supabase as any)
        .from("recurring_expenses")
        .select(
          `
          id, description, amount, due_day, start_date, end_date, active,
          expense_categories ( name, color ),
          classes ( name )
        `
        )
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const typed: RecurringExpenseRow[] = (data || []).map((item: any) => ({
        ...item,
        category: item.expense_categories ?? null,
        className: item.classes?.name ?? null,
      }));
      setRecurring(typed);
    } catch (error: any) {
      console.error("Error fetching recurring expenses:", error);
    }
  };

  const handleToggleActive = async (r: RecurringExpenseRow) => {
    try {
      const { error } = await (supabase as any)
        .from("recurring_expenses")
        .update({ active: !r.active })
        .eq("id", r.id);
      if (error) throw error;

      if (!r.active) {
        // Reactivating: backfill any missing instances
        await generateExpenses(r.id);
        await fetchExpenses();
      }
      await fetchRecurring();
      toast({ title: r.active ? "Despesa recorrente pausada" : "Despesa recorrente reativada" });
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  };

  const handleDeleteRecurring = async () => {
    if (!deletingRecurringId) return;
    try {
      const { error } = await (supabase as any).from("recurring_expenses").delete().eq("id", deletingRecurringId);
      if (error) throw error;
      toast({ title: "Despesa recorrente removida", description: "Os lançamentos já gerados foram mantidos." });
      setDeletingRecurringId(null);
      fetchRecurring();
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  };

  const handleEdit = (expense: ExpenseTableRow) => {
    setEditingExpense(expense);
    setShowForm(true);
  };

  const handleNew = () => {
    setEditingExpense(null);
    setShowForm(true);
  };

  const handleFormSubmit = () => {
    setShowForm(false);
    setEditingExpense(null);
    fetchAll();
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingExpense(null);
  };

  const scopedExpenses = expenses.filter((e) => {
    if (classFilter === "all") return true;
    if (classFilter === "school") return !e.class_id;
    return e.class_id === classFilter;
  });

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const summary = scopedExpenses.reduce(
    (acc, e) => {
      const isOverdue = new Date(e.due_date) < new Date() && e.status === "pending";
      const status = isOverdue ? "overdue" : e.status;
      acc.total += 1;
      if (status !== "cancelled") acc.totalAmount += Number(e.amount);
      if (status === "pending") {
        acc.pending += 1;
        acc.pendingAmount += Number(e.amount);
      } else if (status === "paid") {
        acc.paid += 1;
        acc.paidAmount += Number(e.amount);
      } else if (status === "overdue") {
        acc.overdue += 1;
        acc.overdueAmount += Number(e.amount);
      }
      return acc;
    },
    { total: 0, pending: 0, paid: 0, overdue: 0, totalAmount: 0, pendingAmount: 0, paidAmount: 0, overdueAmount: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">
            Água, luz, IPTU, coordenação e qualquer outro custo da escola — livre para organizar por categoria
          </p>
        </div>
        <Button onClick={handleNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Despesa
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{summary.total}</div>
            <p className="text-muted-foreground text-sm">{formatCurrency(summary.totalAmount)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Pendentes
              <span className="bg-yellow-500 text-slate-900 text-xs px-2 py-1 rounded-full">{summary.pending}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{formatCurrency(summary.pendingAmount)}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Pagas
              <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full">{summary.paid}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{formatCurrency(summary.paidAmount)}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Atrasadas
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">{summary.overdue}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{formatCurrency(summary.overdueAmount)}</div>
          </CardContent>
        </Card>
      </div>

      <ExpenseTable
        data={scopedExpenses}
        loading={loading}
        categories={categories}
        classes={classes}
        classFilter={classFilter}
        onClassFilterChange={setClassFilter}
        onEdit={handleEdit}
        onRefresh={fetchAll}
      />

      <Card>
        <Collapsible open={showRecurring} onOpenChange={setShowRecurring}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Despesas recorrentes ({recurring.filter((r) => r.active).length} ativas)
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showRecurring ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {recurring.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhuma despesa recorrente cadastrada. Marque "Despesa recorrente" ao criar uma nova despesa para gerar lançamentos automaticamente todo mês.
                </p>
              ) : (
                <div className="space-y-2">
                  {recurring.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 flex-wrap"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{r.description}</span>
                          {r.category && (
                            <Badge variant="outline" className="gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.category.color }} />
                              {r.category.name}
                            </Badge>
                          )}
                          {!r.active && <Badge variant="secondary">Pausada</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatCurrency(r.amount)} · todo dia {r.due_day} · {r.className || "Escola toda"} · desde{" "}
                          {format(new Date(r.start_date), "MM/yyyy", { locale: ptBR })}
                          {r.end_date ? ` até ${format(new Date(r.end_date), "MM/yyyy", { locale: ptBR })}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{r.active ? "Ativa" : "Pausada"}</span>
                          <Switch checked={r.active} onCheckedChange={() => handleToggleActive(r)} />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => setDeletingRecurringId(r.id)}
                          title="Remover despesa recorrente"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ExpenseCategoriesSection />

      {showForm && (
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <ExpenseForm expense={editingExpense ?? undefined} onSubmit={handleFormSubmit} onCancel={handleFormCancel} />
        </Dialog>
      )}

      {deletingRecurringId && (
        <Dialog open onOpenChange={() => setDeletingRecurringId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remover despesa recorrente</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Isso interrompe a geração de novos lançamentos mensais. Os lançamentos já criados continuam na lista de despesas.
            </p>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDeletingRecurringId(null)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDeleteRecurring}>
                Remover
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default Expenses;
