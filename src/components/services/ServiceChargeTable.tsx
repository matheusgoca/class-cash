import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaginationCompact } from "@/components/ui/pagination-compact";
import { ArrowUpDown, CheckCircle, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { isTuitionOverdue } from "@/lib/calculations";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";

export interface ServiceChargeRow {
  id: string;
  description: string;
  amount: number;
  status: "pending" | "paid" | "overdue" | "cancelled";
  due_date: string;
  paid_date: string | null;
  payment_method: string | null;
  studentName: string;
  serviceName: string;
}

interface ServiceChargeTableProps {
  data: ServiceChargeRow[];
  loading: boolean;
  onRefresh: () => void;
}

type SortField = "studentName" | "serviceName" | "amount" | "status" | "due_date";

export function ServiceChargeTable({ data, loading, onRefresh }: ServiceChargeTableProps) {
  const { toast } = useToast();
  const [sortField, setSortField] = useState<SortField>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(30);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const parseLocalDate = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const formatDate = (date: string) => format(parseLocalDate(date), "dd/MM/yyyy", { locale: ptBR });
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const getStatusBadge = (charge: ServiceChargeRow) => {
    const isOverdue = isTuitionOverdue(charge.due_date, charge.status);
    const status = isOverdue ? "overdue" : charge.status;
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
        return <Badge variant="secondary">{charge.status}</Badge>;
    }
  };

  const handleMarkAsPaid = async (charge: ServiceChargeRow) => {
    try {
      const { error } = await (supabase as any)
        .from("service_charges")
        .update({
          status: "paid",
          paid_date: format(new Date(), "yyyy-MM-dd"),
          payment_method: charge.payment_method || "Não informado",
        })
        .eq("id", charge.id);
      if (error) throw error;
      toast({ title: "Sucesso", description: "Cobrança marcada como paga!" });
      onRefresh();
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao marcar como paga"),
        variant: "destructive",
      });
    }
  };

  const filteredData = useMemo(() => {
    return data.filter((c) => {
      const isOverdue = isTuitionOverdue(c.due_date, c.status);
      const effectiveStatus = isOverdue ? "overdue" : c.status;
      const matchesSearch = !search
        || c.studentName.toLowerCase().includes(search.toLowerCase())
        || c.serviceName.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || effectiveStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [data, search, statusFilter]);

  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case "studentName": aVal = a.studentName; bVal = b.studentName; break;
        case "serviceName": aVal = a.serviceName; bVal = b.serviceName; break;
        case "amount": aVal = a.amount; bVal = b.amount; break;
        case "status": aVal = a.status; bVal = b.status; break;
        default: aVal = new Date(a.due_date); bVal = new Date(b.due_date);
      }
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection("asc"); }
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
  const paginatedData = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Cobranças</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobranças ({filteredData.length})</CardTitle>
        <div className="flex flex-wrap gap-3 pt-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar aluno ou serviço..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="paid">Paga</SelectItem>
              <SelectItem value="overdue">Atrasada</SelectItem>
              <SelectItem value="cancelled">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("studentName")} className="h-auto p-0 font-semibold">Aluno <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("serviceName")} className="h-auto p-0 font-semibold">Serviço <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("amount")} className="h-auto p-0 font-semibold">Valor <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("status")} className="h-auto p-0 font-semibold">Status <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("due_date")} className="h-auto p-0 font-semibold">Vencimento <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((charge) => {
                const isOverdue = isTuitionOverdue(charge.due_date, charge.status);
                const canMarkAsPaid = charge.status === "pending" || isOverdue;
                return (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">{charge.studentName}</TableCell>
                    <TableCell>{charge.serviceName}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(charge.amount)}</TableCell>
                    <TableCell>{getStatusBadge(charge)}</TableCell>
                    <TableCell>{formatDate(charge.due_date)}</TableCell>
                    <TableCell>
                      {canMarkAsPaid && (
                        <Button size="sm" variant="outline" onClick={() => handleMarkAsPaid(charge)}
                          className="text-green-600 hover:text-green-700" title="Marcar como paga">
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {paginatedData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhuma cobrança encontrada
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
