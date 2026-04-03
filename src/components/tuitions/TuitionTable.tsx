import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpDown, Edit, CheckCircle, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

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
  students: {
    full_name: string;
    classes?: {
      name: string;
    } | null;
  } | null;
  contracts: {
    monthly_amount: number;
    discount: number;
  } | null;
}

interface TuitionTableProps {
  data: TuitionData[];
  loading: boolean;
  onEdit: (tuition: TuitionData) => void;
  onRefresh: () => void;
}

type SortField = 'student_name' | 'class_name' | 'amount' | 'status' | 'due_date' | 'paid_date';

export function TuitionTable({ data, loading, onEdit, onRefresh }: TuitionTableProps) {
  const { toast } = useToast();
  const [sortField, setSortField] = useState<SortField>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(30);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");

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

  const getStatusBadge = (tuition: TuitionData) => {
    const isOverdue = new Date(tuition.due_date) < new Date() && tuition.status === "pending";
    const status = isOverdue ? "overdue" : tuition.status;

    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500 text-slate-900">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-green-500 text-white">Pago</Badge>;
      case "overdue":
        return <Badge className="bg-red-500 text-white">Atrasado</Badge>;
      case "cancelled":
        return <Badge className="bg-gray-500 text-white">Cancelado</Badge>;
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

  const handleMarkAsPaid = async (tuition: TuitionData) => {
    try {
      const { error } = await supabase
        .from('tuitions')
        .update({
          status: 'paid',
          paid_date: format(new Date(), 'yyyy-MM-dd'),
          payment_method: tuition.payment_method || 'Não informado',
          final_amount: tuition.amount,
        })
        .eq('id', tuition.id);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Mensalidade marcada como paga!",
      });

      onRefresh();
    } catch (error) {
      console.error('Error marking as paid:', error);
      toast({
        title: "Erro",
        description: "Erro ao marcar como paga",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (tuition: TuitionData) => {
    try {
      const { error } = await supabase
        .from('tuitions')
        .delete()
        .eq('id', tuition.id);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Mensalidade excluída com sucesso!",
      });

      onRefresh();
    } catch (error) {
      console.error('Error deleting tuition:', error);
      toast({
        title: "Erro",
        description: "Erro ao excluir mensalidade",
        variant: "destructive",
      });
    }
  };

  // Filter data
  const filteredData = data.filter(t => {
    const effectiveStatus = new Date(t.due_date) < new Date() && t.status === 'pending' ? 'overdue' : t.status;
    const matchesSearch = !search || (t.students?.full_name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || effectiveStatus === statusFilter;
    const matchesMonth  = monthFilter === 'all' || t.due_date.startsWith(monthFilter);
    return matchesSearch && matchesStatus && matchesMonth;
  });

  // Sort data
  const sortedData = [...filteredData].sort((a, b) => {
    let aVal: any, bVal: any;

    switch (sortField) {
      case 'student_name':
        aVal = a.students?.full_name || '';
        bVal = b.students?.full_name || '';
        break;
      case 'class_name':
        aVal = a.students?.classes?.name || '';
        bVal = b.students?.classes?.name || '';
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
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("student_name")}
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
              {paginatedData.map((tuition) => {
                const isOverdue = new Date(tuition.due_date) < new Date() && tuition.status === "pending";
                const canMarkAsPaid = tuition.status === "pending" || isOverdue;

                return (
                  <TableRow key={tuition.id}>
                    <TableCell className="font-medium">
                      {tuition.students?.full_name || 'N/A'}
                    </TableCell>
                    <TableCell>
                      {tuition.students?.classes?.name || 'N/A'}
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
                            onClick={() => handleMarkAsPaid(tuition)}
                            className="text-green-600 hover:text-green-700"
                          >
                            <CheckCircle className="h-4 w-4" />
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-2 py-4">
            <div className="text-sm text-muted-foreground">
              Mostrando {(currentPage - 1) * itemsPerPage + 1} a{" "}
              {Math.min(currentPage * itemsPerPage, filteredData.length)} de{" "}
              {filteredData.length} registros
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Anterior
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <Button
                    key={page}
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className="w-8"
                  >
                    {page}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}