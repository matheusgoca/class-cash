import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaginationCompact } from "@/components/ui/pagination-compact";
import { ArrowUpDown, Edit, CheckCircle, Search, Repeat } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import type { ExpenseRecord } from "./ExpenseForm";
import { isTuitionOverdue } from "@/lib/calculations";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";

interface ExpenseTableRow extends ExpenseRecord {
  category: { name: string; color: string } | null;
  className: string | null;
}

interface ExpenseTableProps {
  data: ExpenseTableRow[];
  loading: boolean;
  categories: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  classFilter: string;
  onClassFilterChange: (v: string) => void;
  onEdit: (expense: ExpenseTableRow) => void;
  onRefresh: () => void;
}

type SortField = "description" | "category" | "class" | "amount" | "status" | "due_date";

export function ExpenseTable({
  data,
  loading,
  categories,
  classes,
  classFilter,
  onClassFilterChange,
  onEdit,
  onRefresh,
}: ExpenseTableProps) {
  const { toast } = useToast();
  const [sortField, setSortField] = useState<SortField>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(30);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");

  const availableMonths = useMemo(() => {
    const seen = new Set<string>();
    for (const e of data) {
      const [y, m] = e.due_date.split("-");
      seen.add(`${y}-${m}`);
    }
    return Array.from(seen).sort().reverse();
  }, [data]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const parseLocalDate = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const formatDate = (date: string) => format(parseLocalDate(date), "dd/MM/yyyy", { locale: ptBR });

  const getStatusBadge = (expense: ExpenseTableRow) => {
    const isOverdue = isTuitionOverdue(expense.due_date, expense.status);
    const status = isOverdue ? "overdue" : expense.status;
    switch (status) {
      case "pending":
        return <Badge className="bg-pending text-primary-foreground">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-paid text-success-foreground">Paga</Badge>;
      case "overdue":
        return <Badge className="bg-overdue text-danger-foreground">Atrasada</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Cancelada</Badge>;
      default:
        return <Badge variant="secondary">{expense.status}</Badge>;
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const handleMarkAsPaid = async (expense: ExpenseTableRow) => {
    try {
      const { error } = await (supabase as any)
        .from("expenses")
        .update({
          status: "paid",
          paid_date: format(new Date(), "yyyy-MM-dd"),
          payment_method: expense.payment_method || "Não informado",
        })
        .eq("id", expense.id);

      if (error) throw error;
      toast({ title: "Sucesso", description: "Despesa marcada como paga!" });
      onRefresh();
    } catch (error: any) {
      console.error("Error marking as paid:", error);
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao marcar como paga"),
        variant: "destructive",
      });
    }
  };

  const filteredData = useMemo(() => {
    return data.filter((e) => {
      const isOverdue = isTuitionOverdue(e.due_date, e.status);
      const effectiveStatus = isOverdue ? "overdue" : e.status;
      const matchesSearch = !search || e.description.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || effectiveStatus === statusFilter;
      const matchesCategory = categoryFilter === "all" || e.category_id === categoryFilter;
      const matchesMonth = monthFilter === "all" || e.due_date.startsWith(monthFilter);
      return matchesSearch && matchesStatus && matchesCategory && matchesMonth;
    });
  }, [data, search, statusFilter, categoryFilter, monthFilter]);

  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case "description":
          aVal = a.description;
          bVal = b.description;
          break;
        case "category":
          aVal = a.category?.name || "";
          bVal = b.category?.name || "";
          break;
        case "class":
          aVal = a.className || "";
          bVal = b.className || "";
          break;
        case "amount":
          aVal = a.amount;
          bVal = b.amount;
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        default:
          aVal = new Date(a.due_date);
          bVal = new Date(b.due_date);
      }
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
  const paginatedData = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Despesas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Despesas ({filteredData.length} {filteredData.length === 1 ? "registro" : "registros"})
        </CardTitle>
        <div className="flex flex-wrap gap-3 pt-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar descrição..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="paid">Paga</SelectItem>
              <SelectItem value="overdue">Atrasada</SelectItem>
              <SelectItem value="cancelled">Cancelada</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={classFilter} onValueChange={(v) => { onClassFilterChange(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Turma" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as turmas</SelectItem>
              <SelectItem value="school">Escola toda</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={monthFilter} onValueChange={(v) => { setMonthFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {availableMonths.map((m) => {
                const [y, mo] = m.split("-").map(Number);
                const label = new Date(y, mo - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
                return (
                  <SelectItem key={m} value={m}>
                    {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => handleSort("description")} className="h-auto p-0 font-semibold">
                    Descrição <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => handleSort("category")} className="h-auto p-0 font-semibold">
                    Categoria <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => handleSort("class")} className="h-auto p-0 font-semibold">
                    Turma <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => handleSort("amount")} className="h-auto p-0 font-semibold">
                    Valor <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => handleSort("status")} className="h-auto p-0 font-semibold">
                    Status <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => handleSort("due_date")} className="h-auto p-0 font-semibold">
                    Vencimento <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((expense) => {
                const isOverdue = isTuitionOverdue(expense.due_date, expense.status);
                const canMarkAsPaid = expense.status === "pending" || isOverdue;
                return (
                  <TableRow key={expense.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {expense.description}
                        {expense.recurring_expense_id && (
                          <Repeat className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {expense.category && (
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: expense.category.color }} />
                          {expense.category.name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{expense.className || "Escola toda"}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(expense.amount)}</TableCell>
                    <TableCell>{getStatusBadge(expense)}</TableCell>
                    <TableCell>{formatDate(expense.due_date)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canMarkAsPaid && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleMarkAsPaid(expense)}
                            className="text-green-600 hover:text-green-700"
                            title="Marcar como paga"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {expense.status !== "cancelled" && (
                          <Button size="sm" variant="outline" onClick={() => onEdit(expense)} title="Editar">
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {paginatedData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Nenhuma despesa encontrada
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <PaginationCompact
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredData.length}
          itemsPerPage={itemsPerPage}
        />
      </CardContent>
    </Card>
  );
}
