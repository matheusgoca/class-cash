import { useState, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PaginationCompact } from "@/components/ui/pagination-compact";
import { ArrowUpDown, Edit, CheckCircle, Search, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { isTuitionOverdue, calculateTuitionWithPenalty } from "@/lib/calculations";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";
import { useSchool } from "@/contexts/SchoolContext";
import { PaymentConfirmModal, PaymentConfirmData } from "@/components/tuitions/PaymentConfirmModal";

interface TuitionData {
  id: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  description: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
  payment_method: string | null;
  student_id: string;
  contract_id: string | null;
  discount_applied: number;
  penalty_amount: number;
  final_amount: number;
  renegotiation_id: string | null;
  renegotiations?: {
    created_at: string;
    new_installment_amount: number;
    installments: number;
    total_renegotiated: number;
    notes: string | null;
  } | null;
  students: {
    name?: string | null;
    full_name?: string | null;
  } | null;
  contracts: {
    monthly_amount: number;
    discount: number;
    classes?: {
      name: string;
    } | null;
  } | null;
}

interface TuitionTableProps {
  data: TuitionData[];
  loading: boolean;
  onEdit: (tuition: TuitionData) => void;
  onRefresh: () => void;
  onRenegotiate?: (tuition: TuitionData) => void;
  initialSearch?: string;
}

type SortField = 'student_name' | 'class_name' | 'amount' | 'status' | 'due_date' | 'paid_date';

export function TuitionTable({ data, loading, onEdit, onRefresh, onRenegotiate, initialSearch = "" }: TuitionTableProps) {
  const { toast } = useToast();
  const { schoolId } = useSchool();
  const [sortField, setSortField] = useState<SortField>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(30);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [groupByClass, setGroupByClass] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState<TuitionData | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  // Parse YYYY-MM-DD as local time to avoid UTC offset shifting the day
  const parseLocalDate = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const formatDate = (date: string) => {
    return format(parseLocalDate(date), "dd/MM/yyyy", { locale: ptBR });
  };

  // Unique months from data for the month filter
  const availableMonths = useMemo(() => {
    const seen = new Set<string>();
    for (const t of data) {
      const [y, m] = t.due_date.split('-');
      seen.add(`${y}-${m}`);
    }
    return Array.from(seen).sort();
  }, [data]);

  // Unique class names from data for the turma filter, plus whether any tuition has no class
  const { availableClasses, hasNoClass } = useMemo(() => {
    const names = new Set<string>();
    let noClass = false;
    for (const t of data) {
      const className = t.contracts?.classes?.name;
      if (className) names.add(className);
      else noClass = true;
    }
    return { availableClasses: Array.from(names).sort((a, b) => a.localeCompare(b)), hasNoClass: noClass };
  }, [data]);

  const getClassName = (t: TuitionData) => t.contracts?.classes?.name || 'Sem turma';

  const getStatusBadge = (tuition: TuitionData) => {
    const isOverdue = isTuitionOverdue(tuition.due_date, tuition.status);
    const status = isOverdue ? "overdue" : tuition.status;

    switch (status) {
      case "pending":
        return <Badge className="bg-pending text-primary-foreground">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-paid text-success-foreground">Pago</Badge>;
      case "overdue":
        return <Badge className="bg-overdue text-danger-foreground">Atrasado</Badge>;
      case "cancelled":
        if (tuition.renegotiation_id && tuition.renegotiations) {
          const r = tuition.renegotiations;
          const dateLabel = format(new Date(r.created_at), "dd/MM/yyyy", { locale: ptBR });
          const fmtCurrency = (v: number) =>
            new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="bg-purple-600 text-white cursor-default">Renegociada</Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs space-y-1">
                  <p className="font-semibold">Renegociação em {dateLabel}</p>
                  <p>{r.installments}x de {fmtCurrency(r.new_installment_amount)} = {fmtCurrency(r.total_renegotiated)}</p>
                  {r.notes && <p className="text-muted-foreground">{r.notes}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }
        return <Badge variant="secondary">Cancelado</Badge>;
      default:
        return <Badge variant="secondary">{tuition.status}</Badge>;
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

  const handleConfirmPayment = async (tuition: TuitionData, data: PaymentConfirmData) => {
    try {
      const { error } = await supabase
        .from('tuitions')
        .update({
          status: 'paid',
          paid_date: data.paid_date,
          payment_method: data.payment_method || 'Não informado',
          final_amount: calculateTuitionWithPenalty(
            tuition.amount,
            tuition.discount_applied,
            tuition.penalty_amount,
          ),
        })
        .eq('id', tuition.id)
        .eq('school_id', schoolId);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Mensalidade marcada como paga!",
      });

      setConfirmingPayment(null);
      onRefresh();
    } catch (error) {
      console.error('Error marking as paid:', error);
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao marcar como paga"),
        variant: "destructive",
      });
    }
  };


  // Filter data
  const filteredData = data.filter(t => {
    const effectiveStatus = isTuitionOverdue(t.due_date, t.status) ? 'overdue' : t.status;
    const matchesSearch = !search || (t.students?.full_name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || effectiveStatus === statusFilter;
    const matchesMonth  = monthFilter === 'all' || t.due_date.startsWith(monthFilter);
    const matchesClass = classFilter === 'all'
      || (classFilter === 'no-class' && !t.contracts?.classes?.name)
      || t.contracts?.classes?.name === classFilter;
    return matchesSearch && matchesStatus && matchesMonth && matchesClass;
  });

  // Sort data — grouped mode forces turma as primary sort key so groups stay contiguous
  const sortedData = [...filteredData].sort((a, b) => {
    if (groupByClass) {
      const classCompare = getClassName(a).localeCompare(getClassName(b));
      if (classCompare !== 0) return classCompare;
      return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
    }

    let aVal: any, bVal: any;

    switch (sortField) {
      case 'student_name':
        aVal = a.students?.full_name || '';
        bVal = b.students?.full_name || '';
        break;
      case 'class_name':
        aVal = a.contracts?.classes?.name || '';
        bVal = b.contracts?.classes?.name || '';
        break;
      case 'amount':
        aVal = a.final_amount || a.amount;
        bVal = b.final_amount || b.amount;
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      case 'due_date':
        aVal = new Date(a.due_date);
        bVal = new Date(b.due_date);
        break;
      case 'paid_date':
        aVal = a.paid_date ? new Date(a.paid_date) : new Date(0);
        bVal = b.paid_date ? new Date(b.paid_date) : new Date(0);
        break;
      default:
        aVal = a.due_date;
        bVal = b.due_date;
    }

    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
  const paginatedData = sortedData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Per-turma count/subtotal across all filtered data (not just the current page)
  const groupTotals = groupByClass
    ? sortedData.reduce((acc: Record<string, { count: number; amount: number }>, t) => {
        const key = getClassName(t);
        const entry = acc[key] ?? { count: 0, amount: 0 };
        entry.count += 1;
        entry.amount += Number(t.final_amount || t.amount);
        acc[key] = entry;
        return acc;
      }, {})
    : {};

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Mensalidades</CardTitle>
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
    <>
    <Card>
      <CardHeader>
        <CardTitle>
          Mensalidades ({filteredData.length} {filteredData.length === 1 ? 'registro' : 'registros'})
        </CardTitle>
        <div className="flex flex-wrap gap-3 pt-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar aluno..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
              <SelectItem value="overdue">Atrasado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={monthFilter} onValueChange={v => { setMonthFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {availableMonths.map(m => {
                const [y, mo] = m.split('-').map(Number);
                const label = new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                return <SelectItem key={m} value={m}>{label}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <Select
            value={classFilter}
            onValueChange={v => {
              setClassFilter(v);
              setCurrentPage(1);
              if (v !== 'all') setGroupByClass(false);
            }}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Turma" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as turmas</SelectItem>
              {availableClasses.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
              {hasNoClass && <SelectItem value="no-class">Sem turma</SelectItem>}
            </SelectContent>
          </Select>
          {classFilter === 'all' && (
            <div className="flex items-center gap-2 px-1">
              <Switch id="group-by-class" checked={groupByClass} onCheckedChange={setGroupByClass} />
              <Label htmlFor="group-by-class" className="text-sm font-normal cursor-pointer">
                Agrupar por turma
              </Label>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("student_name")}
                    disabled={groupByClass}
                    className="h-auto p-0 font-semibold"
                  >
                    Aluno
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("class_name")}
                    disabled={groupByClass}
                    className="h-auto p-0 font-semibold"
                  >
                    Turma
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("amount")}
                    disabled={groupByClass}
                    className="h-auto p-0 font-semibold"
                  >
                    Valor
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("status")}
                    disabled={groupByClass}
                    className="h-auto p-0 font-semibold"
                  >
                    Status
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("due_date")}
                    disabled={groupByClass}
                    className="h-auto p-0 font-semibold"
                  >
                    Vencimento
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("paid_date")}
                    disabled={groupByClass}
                    className="h-auto p-0 font-semibold"
                  >
                    Data Pagamento
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>Forma Pagamento</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((tuition, index) => {
                const isOverdue = isTuitionOverdue(tuition.due_date, tuition.status);
                const canMarkAsPaid = tuition.status === "pending" || isOverdue;
                const turmaName = getClassName(tuition);
                const showGroupHeader = groupByClass && (index === 0 || getClassName(paginatedData[index - 1]) !== turmaName);
                const groupTotal = groupTotals[turmaName];

                return (
                  <Fragment key={tuition.id}>
                  {showGroupHeader && (
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={8} className="py-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold">{turmaName}</span>
                          <span className="text-muted-foreground">
                            {groupTotal?.count ?? 0} {groupTotal?.count === 1 ? 'registro' : 'registros'} · {formatCurrency(groupTotal?.amount || 0)}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell className="font-medium">
                      {tuition.students?.full_name || 'N/A'}
                    </TableCell>
                    <TableCell>
                      {tuition.contracts?.classes?.name || 'N/A'}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{formatCurrency(tuition.final_amount || tuition.amount)}</div>
                        {tuition.discount_applied > 0 && (
                          <div className="text-muted-foreground text-xs">
                            Base: {formatCurrency(tuition.amount)} | Desc: {formatCurrency(tuition.discount_applied)}
                          </div>
                        )}
                        {tuition.penalty_amount > 0 && (
                          <div className="text-red-600 text-xs">
                            Multa: {formatCurrency(tuition.penalty_amount)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(tuition)}</TableCell>
                    <TableCell>{formatDate(tuition.due_date)}</TableCell>
                    <TableCell>
                      {tuition.paid_date ? formatDate(tuition.paid_date) : '-'}
                    </TableCell>
                    <TableCell>
                      {tuition.payment_method || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canMarkAsPaid && tuition.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmingPayment(tuition)}
                            className="text-green-600 hover:text-green-700"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}

                        {isOverdue && onRenegotiate && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRenegotiate(tuition)}
                            className="text-purple-600 hover:text-purple-700 gap-1"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Renegociar
                          </Button>
                        )}

                        {tuition.status !== "paid" && tuition.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onEdit(tuition)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  </Fragment>
                );
              })}
              {paginatedData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Nenhuma mensalidade encontrada
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

    {confirmingPayment && (
      <PaymentConfirmModal
        studentName={confirmingPayment.students?.full_name || 'N/A'}
        description={confirmingPayment.description}
        amount={calculateTuitionWithPenalty(
          confirmingPayment.amount,
          confirmingPayment.discount_applied,
          confirmingPayment.penalty_amount,
        )}
        onConfirm={(data) => handleConfirmPayment(confirmingPayment, data)}
        onCancel={() => setConfirmingPayment(null)}
      />
    )}
    </>
  );
}