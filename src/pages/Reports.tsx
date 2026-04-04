import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, FileText, FileSpreadsheet, ArrowUpDown, AlertTriangle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ClassProfitability } from "@/components/reports/ClassProfitability";
import { PaginationCompact } from "@/components/ui/pagination-compact";
import { useSchool } from "@/contexts/SchoolContext";

interface TuitionReport {
  id: string;
  student_name: string;
  class_name: string | null;
  amount: number;
  status: "pending" | "paid" | "overdue";
  due_date: string;
  paid_date: string | null;
  description: string;
}

interface ClassOption {
  id: string;
  name: string;
}

interface ReportFilters {
  startDate: string;
  endDate: string;
  classId: string;
  status: string;
}

interface ReportSummary {
  total: number;
  pending: number;
  paid: number;
  overdue: number;
  totalAmount: number;
  pendingAmount: number;
  paidAmount: number;
  overdueAmount: number;
}

interface DefaulterRow {
  student_id: string;
  student_name: string;
  class_name: string | null;
  parcelas: number;
  valor_aberto: number;
  mais_antiga: string; // YYYY-MM-DD
}

const Reports = () => {
  const navigate = useNavigate();
  const { schoolId } = useSchool();
  const [data, setData] = useState<TuitionReport[]>([]);
  const [filteredData, setFilteredData] = useState<TuitionReport[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<keyof TuitionReport>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);
  const [defaultersPage, setDefaultersPage] = useState(1);
  const defaultersPerPage = 15;

  const [filters, setFilters] = useState<ReportFilters>({
    startDate: "",
    endDate: "",
    classId: "",
    status: ""
  });

  // Build defaulters list from already-fetched data (no extra query needed)
  const defaulters = useMemo((): DefaulterRow[] => {
    const map = new Map<string, DefaulterRow & { student_id: string }>();
    for (const item of data) {
      if (item.status !== 'overdue') continue;
      const existing = map.get(item.student_name);
      if (existing) {
        existing.parcelas += 1;
        existing.valor_aberto += item.amount;
        if (item.due_date < existing.mais_antiga) existing.mais_antiga = item.due_date;
        if (!existing.class_name && item.class_name) existing.class_name = item.class_name;
      } else {
        map.set(item.student_name, {
          student_id: item.student_name, // used as key only
          student_name: item.student_name,
          class_name: item.class_name,
          parcelas: 1,
          valor_aberto: item.amount,
          mais_antiga: item.due_date,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.valor_aberto - a.valor_aberto);
  }, [data]);

  // Inadimplência summary metrics
  const inadimplenciaSummary = useMemo(() => {
    const totalOverdue = defaulters.reduce((s, d) => s + d.valor_aberto, 0);
    const alunosCount  = defaulters.length;
    const totalEmitido = data.reduce((s, d) => s + d.amount, 0);
    const pctReceita   = totalEmitido > 0 ? (totalOverdue / totalEmitido) * 100 : 0;

    // Average months late across all overdue tuitions
    const today = new Date();
    const overdueItems = data.filter(d => d.status === 'overdue');
    let totalMonths = 0;
    for (const item of overdueItems) {
      const [y, m] = item.due_date.split('-').map(Number);
      const months = (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
      totalMonths += Math.max(0, months);
    }
    const mediaAtraso = overdueItems.length > 0 ? totalMonths / overdueItems.length : 0;

    return { totalOverdue, alunosCount, mediaAtraso, pctReceita };
  }, [defaulters, data]);

  useEffect(() => {
    fetchData();
    fetchClasses();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [data, filters]);

  const fetchData = async () => {
    try {
      setLoading(true);

      const [tuitionsRes, studentsRes, contractsRes] = await Promise.all([
        supabase
          .from('tuitions')
          .select('id, amount, status, due_date, paid_date, description, student_id, contract_id')
          .order('due_date', { ascending: false }),
        supabase.from('students').select('id, full_name'),
        (supabase as any).from('contracts').select('id, classes(name)'),
      ]);

      if (tuitionsRes.error) throw tuitionsRes.error;
      if (studentsRes.error) throw studentsRes.error;

      const studentMap = (studentsRes.data || []).reduce((acc: any, s: any) => {
        acc[s.id] = s.full_name;
        return acc;
      }, {});

      const contractClassMap = (contractsRes.data || []).reduce((acc: any, c: any) => {
        acc[c.id] = c.classes?.name ?? null;
        return acc;
      }, {});

      const formattedData: TuitionReport[] = (tuitionsRes.data || []).map((item: any) => {
        const isOverdue = new Date(item.due_date) < new Date() && item.status === "pending";
        return {
          id: item.id,
          student_name: studentMap[item.student_id] || 'N/A',
          class_name: contractClassMap[item.contract_id] ?? null,
          amount: Number(item.amount),
          status: isOverdue ? "overdue" : item.status as "pending" | "paid" | "overdue",
          due_date: item.due_date,
          paid_date: item.paid_date,
          description: item.description || ""
        };
      });

      setData(formattedData);
    } catch (error) {
      console.error('Error fetching tuitions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchClasses = async () => {
    try {
      const { data: classesData, error } = await supabase
        .from('classes')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setClasses(classesData || []);
    } catch (error) {
      console.error('Error fetching classes:', error);
    }
  };

  const applyFilters = () => {
    let filtered = [...data];

    // Date range filter
    if (filters.startDate) {
      filtered = filtered.filter(item => item.due_date >= filters.startDate);
    }
    if (filters.endDate) {
      filtered = filtered.filter(item => item.due_date <= filters.endDate);
    }

    // Class filter
    if (filters.classId) {
      filtered = filtered.filter(item => {
        const classId = classes.find(c => c.name === item.class_name)?.id;
        return classId === filters.classId;
      });
    }

    // Status filter
    if (filters.status) {
      filtered = filtered.filter(item => item.status === filters.status);
    }

    // Sort data
    filtered.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      
      if (sortField === "amount") {
        aVal = Number(aVal);
        bVal = Number(bVal);
      }
      
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    setFilteredData(filtered);
    setCurrentPage(1);
  };

  const calculateSummary = (): ReportSummary => {
    const summary = filteredData.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.totalAmount += item.amount;
        
        switch (item.status) {
          case "pending":
            acc.pending += 1;
            acc.pendingAmount += item.amount;
            break;
          case "paid":
            acc.paid += 1;
            acc.paidAmount += item.amount;
            break;
          case "overdue":
            acc.overdue += 1;
            acc.overdueAmount += item.amount;
            break;
        }
        return acc;
      },
      {
        total: 0,
        pending: 0,
        paid: 0,
        overdue: 0,
        totalAmount: 0,
        pendingAmount: 0,
        paidAmount: 0,
        overdueAmount: 0
      }
    );
    return summary;
  };

  const handleSort = (field: keyof TuitionReport) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (date: string) => {
    return format(new Date(date), "dd/MM/yyyy", { locale: ptBR });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500 text-slate-900">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-green-500 text-white">Pago</Badge>;
      case "overdue":
        return <Badge className="bg-red-500 text-white">Atrasado</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const exportToCSV = () => {
    const summary = calculateSummary();
    const csvData = [
      ...filteredData.map(item => ({
        "Nome do Aluno": item.student_name,
        "Turma": item.class_name || "N/A",
        "Valor": item.amount,
        "Status": item.status === "pending" ? "Pendente" : item.status === "paid" ? "Pago" : "Atrasado",
        "Data de Vencimento": formatDate(item.due_date),
        "Data de Pagamento": item.paid_date ? formatDate(item.paid_date) : "N/A",
        "Descrição": item.description
      })),
      {},
      {
        "Nome do Aluno": "RESUMO",
        "Turma": "",
        "Valor": "",
        "Status": "",
        "Data de Vencimento": "",
        "Data de Pagamento": "",
        "Descrição": ""
      },
      {
        "Nome do Aluno": "Total Geral",
        "Turma": `${summary.total} registros`,
        "Valor": summary.totalAmount,
        "Status": "",
        "Data de Vencimento": "",
        "Data de Pagamento": "",
        "Descrição": ""
      },
      {
        "Nome do Aluno": "Pendentes",
        "Turma": `${summary.pending} registros`,
        "Valor": summary.pendingAmount,
        "Status": "",
        "Data de Vencimento": "",
        "Data de Pagamento": "",
        "Descrição": ""
      },
      {
        "Nome do Aluno": "Pagos",
        "Turma": `${summary.paid} registros`,
        "Valor": summary.paidAmount,
        "Status": "",
        "Data de Vencimento": "",
        "Data de Pagamento": "",
        "Descrição": ""
      },
      {
        "Nome do Aluno": "Atrasados",
        "Turma": `${summary.overdue} registros`,
        "Valor": summary.overdueAmount,
        "Status": "",
        "Data de Vencimento": "",
        "Data de Pagamento": "",
        "Descrição": ""
      }
    ];

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `relatorio-financeiro-${format(new Date(), "yyyy-MM-dd")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToExcel = () => {
    const summary = calculateSummary();
    
    const worksheetData = [
      ["Nome do Aluno", "Turma", "Valor", "Status", "Data de Vencimento", "Data de Pagamento", "Descrição"],
      ...filteredData.map(item => [
        item.student_name,
        item.class_name || "N/A",
        item.amount,
        item.status === "pending" ? "Pendente" : item.status === "paid" ? "Pago" : "Atrasado",
        formatDate(item.due_date),
        item.paid_date ? formatDate(item.paid_date) : "N/A",
        item.description
      ]),
      [],
      ["RESUMO"],
      ["Total Geral", `${summary.total} registros`, summary.totalAmount],
      ["Pendentes", `${summary.pending} registros`, summary.pendingAmount],
      ["Pagos", `${summary.paid} registros`, summary.paidAmount],
      ["Atrasados", `${summary.overdue} registros`, summary.overdueAmount]
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Relatório Financeiro");
    XLSX.writeFile(workbook, `relatorio-financeiro-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  // Pagination
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const summary = calculateSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios Financeiros</h1>
        <p className="text-muted-foreground">
          Visualize e exporte relatórios detalhados das mensalidades
        </p>
      </div>

      {/* Rentabilidade por turma */}
      <ClassProfitability />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-medium text-sm text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
            <p className="text-muted-foreground text-sm">{formatCurrency(summary.totalAmount)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-medium text-sm text-muted-foreground flex items-center justify-between">
              Pendentes
              <Badge className="bg-yellow-500 text-white text-xs">{summary.pending}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.pendingAmount)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-medium text-sm text-muted-foreground flex items-center justify-between">
              Pagos
              <Badge className="bg-green-500 text-white text-xs">{summary.paid}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.paidAmount)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-medium text-sm text-muted-foreground flex items-center justify-between">
              Atrasados
              <Badge className="bg-red-500 text-white text-xs">{summary.overdue}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.overdueAmount)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Filtros</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={exportToCSV}>
                  <FileText className="h-4 w-4 mr-2" />
                  Exportar CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportToExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Exportar Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="startDate">Data Inicial</Label>
              <Input
                id="startDate"
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              />
            </div>
            
            <div>
              <Label htmlFor="endDate">Data Final</Label>
              <Input
                id="endDate"
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>
            
            <div>
              <Label>Turma</Label>
              <Select value={filters.classId} onValueChange={(value) => setFilters(prev => ({ ...prev, classId: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as turmas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as turmas</SelectItem>
                  {classes.map((classItem) => (
                    <SelectItem key={classItem.id} value={classItem.id}>
                      {classItem.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Status</Label>
              <Select value={filters.status} onValueChange={(value) => setFilters(prev => ({ ...prev, status: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="paid">Pago</SelectItem>
                  <SelectItem value="overdue">Atrasado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Inadimplência ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h2 className="text-xl font-bold tracking-tight">Inadimplência</h2>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total inadimplente</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(inadimplenciaSummary.totalOverdue)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Alunos com parcelas em atraso</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inadimplenciaSummary.alunosCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Média de atraso</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {inadimplenciaSummary.mediaAtraso.toFixed(1)} <span className="text-base font-normal text-muted-foreground">meses</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">% sobre receita emitida</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inadimplenciaSummary.pctReceita.toFixed(1)}%</div>
            </CardContent>
          </Card>
        </div>

        {/* Defaulters table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Alunos em atraso ({defaulters.length} {defaulters.length === 1 ? 'aluno' : 'alunos'})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : defaulters.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">Nenhum aluno inadimplente. 🎉</p>
            ) : (
              <>
              <div className="rounded-md border overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Aluno</TableHead>
                      <TableHead>Turma</TableHead>
                      <TableHead>Parcelas em atraso</TableHead>
                      <TableHead>Valor em aberto</TableHead>
                      <TableHead>Mês mais antigo</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {defaulters.slice((defaultersPage - 1) * defaultersPerPage, defaultersPage * defaultersPerPage).map((row) => {
                      const [y, m] = row.mais_antiga.split('-').map(Number);
                      const mesLabel = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
                      return (
                        <TableRow key={row.student_name}>
                          <TableCell className="font-medium">{row.student_name}</TableCell>
                          <TableCell>{row.class_name || '—'}</TableCell>
                          <TableCell>
                            <Badge className="bg-red-100 text-red-700 border-red-200">
                              {row.parcelas} {row.parcelas === 1 ? 'parcela' : 'parcelas'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-semibold text-red-600">{formatCurrency(row.valor_aberto)}</TableCell>
                          <TableCell className="capitalize">{mesLabel}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`/mensalidades?search=${encodeURIComponent(row.student_name)}`)}
                              className="gap-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Ver mensalidades
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <PaginationCompact
                currentPage={defaultersPage}
                totalPages={Math.max(1, Math.ceil(defaulters.length / defaultersPerPage))}
                onPageChange={setDefaultersPage}
                totalItems={defaulters.length}
                itemsPerPage={defaultersPerPage}
              />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Mensalidades ({filteredData.length} {filteredData.length === 1 ? 'registro' : 'registros'})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table className="min-w-[700px]">
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
                      <TableHead>Data de Pagamento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedData.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.student_name}</TableCell>
                        <TableCell>{item.class_name || "N/A"}</TableCell>
                        <TableCell>{formatCurrency(item.amount)}</TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell>{formatDate(item.due_date)}</TableCell>
                        <TableCell>
                          {item.paid_date ? formatDate(item.paid_date) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <PaginationCompact
                currentPage={currentPage}
                totalPages={Math.max(1, totalPages)}
                onPageChange={setCurrentPage}
                totalItems={filteredData.length}
                itemsPerPage={itemsPerPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;