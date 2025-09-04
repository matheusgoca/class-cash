import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowUpDown, Edit, Trash2, CheckCircle } from "lucide-react";
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
    name: string;
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
  const [itemsPerPage] = useState(15);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (date: string) => {
    return format(new Date(date), "dd/MM/yyyy", { locale: ptBR });
  };

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
          payment_method: tuition.payment_method || 'Sistema'
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

  // Sort data
  const sortedData = [...data].sort((a, b) => {
    let aVal: any, bVal: any;

    switch (sortField) {
      case 'student_name':
        aVal = a.students?.name || '';
        bVal = b.students?.name || '';
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
  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
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
          Mensalidades ({data.length} {data.length === 1 ? 'registro' : 'registros'})
        </CardTitle>
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
                      {tuition.students?.name || 'N/A'}
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
              {Math.min(currentPage * itemsPerPage, data.length)} de{" "}
              {data.length} registros
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