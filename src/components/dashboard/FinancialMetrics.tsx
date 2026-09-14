import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { formatCurrency, isTuitionOverdue } from "@/lib/calculations";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Users, UserCheck, Calculator, Wallet } from "lucide-react";

export function FinancialMetrics() {
  const { schoolId } = useSchool();
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    paidRevenue: 0,
    monthlyRevenue: 0,
    pendingRevenue: 0,
    overdueRevenue: 0,
    totalStudents: 0,
    totalTeachers: 0,
    totalSalaries: 0,
    monthlyExpenses: 0,
    financialBalance: 0,
    previousBalance: 0,
    loading: true
  });

  useEffect(() => {
    if (schoolId) fetchMetrics();
  }, [schoolId]);

  const fetchMetrics = async () => {
    try {
      const currentDate = new Date();
      const currentYear  = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth(); // 0-indexed
      const prevRef = new Date(currentYear, currentMonth - 1, 1);

      // Expenses only need the past 2 months for the balance calculation
      const twoMonthsAgo = new Date(currentYear, currentMonth - 1, 1).toISOString().slice(0, 10);

      const [
        { data: students, error: studentsError },
        { data: teachers, error: teachersError },
        { data: tuitions, error: tuitionsError },
        { data: expenses, error: expensesError },
      ] = await Promise.all([
        (supabase as any).from('students').select('id').eq('school_id', schoolId).eq('status', 'active'),
        (supabase as any).from('teachers').select('id, salary').eq('school_id', schoolId).eq('status', 'active'),
        (supabase as any).from('tuitions').select('amount, status, due_date').eq('school_id', schoolId),
        (supabase as any).from('expenses').select('amount, status, due_date').eq('school_id', schoolId).gte('due_date', twoMonthsAgo),
      ]);

      if (studentsError) throw studentsError;
      if (teachersError) throw teachersError;
      if (tuitionsError) throw tuitionsError;
      if (expensesError) throw expensesError;

      // Cancelled tuitions (e.g. replaced by a renegotiation) are not revenue —
      // exclude them everywhere, same as the expenses bucket below already does.
      const activeTuitions = tuitions?.filter((t: any) => t.status !== "cancelled") || [];

      const totalRevenue = activeTuitions.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      const paidRevenue = activeTuitions.filter((t: any) => t.status === "paid")
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      const pendingRevenue = activeTuitions.filter((t: any) => t.status === "pending")
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      const overdueRevenue = activeTuitions.filter((t: any) => isTuitionOverdue(t.due_date, t.status))
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

      // Bucket tuitions into current and previous month in a single pass
      let monthlyRevenue = 0;
      let previousMonthRevenue = 0;
      for (const t of activeTuitions) {
        const due = new Date(t.due_date);
        const y = due.getFullYear();
        const m = due.getMonth();
        if (y === currentYear && m === currentMonth) monthlyRevenue += Number(t.amount);
        else if (y === prevRef.getFullYear() && m === prevRef.getMonth()) previousMonthRevenue += Number(t.amount);
      }

      const totalSalaries = teachers?.reduce((sum: number, t: any) => sum + (Number(t.salary) || 0), 0) || 0;

      // Bucket expenses into current and previous month in a single pass
      let monthlyExpenses = 0;
      let previousMonthExpenses = 0;
      for (const e of expenses || []) {
        if (e.status === 'cancelled') continue;
        const due = new Date(e.due_date);
        const y = due.getFullYear();
        const m = due.getMonth();
        if (y === currentYear && m === currentMonth) monthlyExpenses += Number(e.amount);
        else if (y === prevRef.getFullYear() && m === prevRef.getMonth()) previousMonthExpenses += Number(e.amount);
      }

      const financialBalance = monthlyRevenue - totalSalaries - monthlyExpenses;
      // Salary has no month-by-month history today — using current total as an
      // approximation for the previous month is sufficient for a trend indicator.
      const previousBalance = previousMonthRevenue - totalSalaries - previousMonthExpenses;

      setMetrics({
        totalRevenue,
        paidRevenue,
        monthlyRevenue,
        pendingRevenue,
        overdueRevenue,
        totalStudents: students?.length || 0,
        totalTeachers: teachers?.length || 0,
        totalSalaries,
        monthlyExpenses,
        financialBalance,
        previousBalance,
        loading: false
      });

    } catch (error) {
      console.error('Error fetching metrics:', error);
      setMetrics(prev => ({ ...prev, loading: false }));
    }
  };

  // Denominator: only tuitions whose due date has passed (paid + overdue);
  // pending within due date are excluded — not yet delinquent
  const duedBase = metrics.paidRevenue + metrics.overdueRevenue;
  const defaultRate = duedBase > 0
    ? (metrics.overdueRevenue / duedBase * 100).toFixed(1)
    : "0.0";

  // Trend vs previous month — only show when previous month had data
  const balanceTrend = metrics.previousBalance !== 0
    ? ((metrics.financialBalance - metrics.previousBalance) / Math.abs(metrics.previousBalance)) * 100
    : null;

  const hasData = metrics.totalStudents > 0 || metrics.totalRevenue > 0;

  if (metrics.loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 animate-pulse">
            <CardHeader className="pb-2"><div className="h-4 bg-muted rounded w-40" /></CardHeader>
            <CardContent><div className="h-10 bg-muted rounded w-56 mb-2" /><div className="h-4 bg-muted rounded w-32" /></CardContent>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            {[1, 2].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="pb-2"><div className="h-4 bg-muted rounded w-24" /></CardHeader>
                <CardContent><div className="h-6 bg-muted rounded w-20" /></CardContent>
              </Card>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
        <DollarSign className="mx-auto h-10 w-10 mb-3 opacity-30" />
        <p className="text-base font-medium">Nenhum dado financeiro ainda</p>
        <p className="text-sm mt-1">Cadastre alunos, crie contratos e gere mensalidades para ver as métricas aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Saldo Financeiro em destaque — a pergunta nº 1 de quem abre o dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-2 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Saldo Financeiro do Mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-4xl font-bold ${metrics.financialBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(metrics.financialBalance)}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {balanceTrend !== null && (
                <span className={`flex items-center gap-1 text-sm font-medium ${balanceTrend >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {balanceTrend >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {Math.abs(balanceTrend).toFixed(1)}% vs mês anterior
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                {metrics.financialBalance >= 0 ? 'Lucro' : 'Prejuízo'} — receita do mês menos salários e despesas
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Receita Recebida</CardTitle>
              <div className="rounded-md p-2 bg-primary/10">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(metrics.paidRevenue)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metrics.totalRevenue > 0
                  ? `${((metrics.paidRevenue / metrics.totalRevenue) * 100).toFixed(1)}% do total`
                  : "0% do total"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Taxa de Inadimplência</CardTitle>
              <div className="rounded-md p-2 bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{defaultRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(metrics.overdueRevenue)} em atraso</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Faixa secundária — operacional, peso visual menor que o financeiro acima */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="rounded-md p-2 bg-muted/50">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Professores ativos</p>
            <p className="text-sm font-semibold">{metrics.totalTeachers}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="rounded-md p-2 bg-muted/50">
            <Calculator className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Salários mensais</p>
            <p className="text-sm font-semibold">{formatCurrency(metrics.totalSalaries)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="rounded-md p-2 bg-muted/50">
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Despesas do mês</p>
            <p className="text-sm font-semibold">{formatCurrency(metrics.monthlyExpenses)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="rounded-md p-2 bg-muted/50">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Alunos ativos</p>
            <p className="text-sm font-semibold">{metrics.totalStudents}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="rounded-md p-2 bg-muted/50">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Alunos por professor</p>
            <p className="text-sm font-semibold">
              {metrics.totalStudents > 0 && metrics.totalTeachers > 0
                ? (metrics.totalStudents / metrics.totalTeachers).toFixed(1)
                : '0'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
