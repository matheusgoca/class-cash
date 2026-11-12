import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { formatCurrency, isTuitionOverdue, getTuitionValue } from "@/lib/calculations";
import { calculateMonthlyBalance } from "@/lib/financialBalance";
import { parseLocalDate } from "@/lib/dateUtils";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Users, UserCheck, Calculator, Wallet, Sparkles } from "lucide-react";

export function FinancialMetrics() {
  const { schoolId } = useSchool();
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    monthlyPaidRevenue: 0,
    monthlyForecastRevenue: 0,
    monthlyOverdueRevenue: 0,
    monthlyDuedRevenue: 0,
    monthlyServiceRevenue: 0,
    totalStudents: 0,
    totalTeachers: 0,
    totalSalaries: 0,
    // Realizado (caixa, paid_date) é o Saldo principal; Previsto (competência,
    // due_date) é o apoio — ver docs/PLANO_SPRINTS_NOV2026.md, seção 1, item C.
    realizedBalance: 0,
    forecastBalance: 0,
    forecastExpenses: 0,
    previousRealizedBalance: 0,
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

      const [
        { data: students, error: studentsError },
        // teachers.salary é restrito a admin/financial no RLS — o Dashboard é
        // aberto a qualquer role, então a contagem vem da view sem salário, e
        // o total de salário vem de uma função que só retorna o agregado.
        { data: teachers, error: teachersError },
        { data: totalSalariesData, error: salaryError },
        { data: tuitions, error: tuitionsError },
        { data: expenses, error: expensesError },
        { data: serviceCharges, error: serviceChargesError },
      ] = await Promise.all([
        (supabase as any).from('students').select('id').eq('school_id', schoolId).eq('status', 'active'),
        (supabase as any).from('teachers_directory').select('id').eq('school_id', schoolId).eq('status', 'active'),
        (supabase as any).rpc('get_active_teachers_salary_sum', { p_school_id: schoolId }),
        (supabase as any).from('tuitions').select('amount, final_amount, status, due_date, paid_date').eq('school_id', schoolId),
        // Sem filtro de data: Realizado (paid_date) e Previsto (due_date) podem
        // cair em meses diferentes de quando a busca é feita (pagamento em
        // atraso), então não há uma janela de data única que cubra os dois.
        (supabase as any).from('expenses').select('amount, status, due_date, paid_date').eq('school_id', schoolId),
        (supabase as any).from('service_charges').select('amount, status, due_date, paid_date').eq('school_id', schoolId),
      ]);

      if (studentsError) throw studentsError;
      if (teachersError) throw teachersError;
      if (salaryError) throw salaryError;
      if (tuitionsError) throw tuitionsError;
      if (expensesError) throw expensesError;
      if (serviceChargesError) throw serviceChargesError;

      // Cancelled tuitions (e.g. replaced by a renegotiation) are not revenue —
      // exclude them everywhere, same as the expenses bucket below already does.
      const activeTuitions = tuitions?.filter((t: any) => t.status !== "cancelled") || [];

      // hasData check only — not a metric shown on screen (lifetime count is
      // meaningless once Receita Recebida/Inadimplência became monthly below)
      const totalRevenue = activeTuitions.reduce((sum: number, t: any) => sum + getTuitionValue(t), 0);

      const totalSalaries = Number(totalSalariesData || 0);

      // Regime do Saldo: Realizado (caixa, por paid_date) como número
      // principal, Previsto (competência, por due_date) como apoio —
      // decisão tomada em docs/PLANO_SPRINTS_NOV2026.md (seção 1, item C).
      const currentMonthBalance = calculateMonthlyBalance({
        tuitions: activeTuitions,
        serviceCharges: serviceCharges || [],
        expenses: expenses || [],
        monthlySalaries: totalSalaries,
        year: currentYear,
        month: currentMonth,
      });
      // Salary has no month-by-month history today — using the current total
      // as an approximation for the previous month is sufficient for a trend.
      const previousMonthBalance = calculateMonthlyBalance({
        tuitions: activeTuitions,
        serviceCharges: serviceCharges || [],
        expenses: expenses || [],
        monthlySalaries: totalSalaries,
        year: prevRef.getFullYear(),
        month: prevRef.getMonth(),
      });

      // Inadimplência do mês: entre as mensalidades com vencimento no mês
      // atual, quanto já está vencido e não pago. Denominador exclui
      // pendentes ainda dentro do prazo — não são inadimplência.
      let monthlyOverdueRevenue = 0;
      let monthlyDuedRevenue = 0;
      for (const t of activeTuitions) {
        const due = parseLocalDate(t.due_date);
        if (due.getFullYear() !== currentYear || due.getMonth() !== currentMonth) continue;
        const isOverdue = isTuitionOverdue(t.due_date, t.status);
        if (t.status === 'paid' || isOverdue) monthlyDuedRevenue += getTuitionValue(t);
        if (isOverdue) monthlyOverdueRevenue += getTuitionValue(t);
      }

      // "Receita de serviços" card: informativo, sempre competência (due_date)
      const activeServiceCharges = serviceCharges?.filter((s: any) => s.status !== "cancelled") || [];
      let monthlyServiceRevenue = 0;
      for (const s of activeServiceCharges) {
        const due = parseLocalDate(s.due_date);
        if (due.getFullYear() === currentYear && due.getMonth() === currentMonth) {
          monthlyServiceRevenue += Number(s.amount);
        }
      }

      setMetrics({
        totalRevenue,
        monthlyPaidRevenue: currentMonthBalance.realizedRevenue,
        monthlyForecastRevenue: currentMonthBalance.forecastRevenue,
        monthlyOverdueRevenue,
        monthlyDuedRevenue,
        monthlyServiceRevenue,
        totalStudents: students?.length || 0,
        totalTeachers: teachers?.length || 0,
        totalSalaries,
        realizedBalance: currentMonthBalance.realized,
        forecastBalance: currentMonthBalance.forecast,
        forecastExpenses: currentMonthBalance.forecastExpenses,
        previousRealizedBalance: previousMonthBalance.realized,
        loading: false
      });

    } catch (error) {
      console.error('Error fetching metrics:', error);
      setMetrics(prev => ({ ...prev, loading: false }));
    }
  };

  // Denominator: only tuitions whose due date has passed (paid + overdue);
  // pending within due date are excluded — not yet delinquent
  const defaultRate = metrics.monthlyDuedRevenue > 0
    ? (metrics.monthlyOverdueRevenue / metrics.monthlyDuedRevenue * 100).toFixed(1)
    : "0.0";

  // Trend vs previous month — only show when previous month had data
  const balanceTrend = metrics.previousRealizedBalance !== 0
    ? ((metrics.realizedBalance - metrics.previousRealizedBalance) / Math.abs(metrics.previousRealizedBalance)) * 100
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
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
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
              Saldo Realizado do Mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-6">
              <div className={`text-4xl font-bold ${metrics.realizedBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(metrics.realizedBalance)}
              </div>
              <div className="pb-1">
                <p className="text-xs text-muted-foreground">Previsto (com pendentes)</p>
                <p className={`text-lg font-semibold ${metrics.forecastBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(metrics.forecastBalance)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {balanceTrend !== null && (
                <span className={`flex items-center gap-1 text-sm font-medium ${balanceTrend >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {balanceTrend >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {Math.abs(balanceTrend).toFixed(1)}% vs mês anterior
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                {metrics.realizedBalance >= 0 ? 'Lucro' : 'Prejuízo'} — receita e despesas efetivamente pagas no mês; Previsto inclui o que ainda está pendente
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Receita Recebida no Mês</CardTitle>
              <div className="rounded-md p-2 bg-primary/10">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(metrics.monthlyPaidRevenue)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metrics.monthlyForecastRevenue > 0
                  ? `${((metrics.monthlyPaidRevenue / metrics.monthlyForecastRevenue) * 100).toFixed(1)}% do previsto no mês`
                  : "0% do previsto no mês"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Inadimplência do Mês</CardTitle>
              <div className="rounded-md p-2 bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{defaultRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(metrics.monthlyOverdueRevenue)} em atraso</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Faixa secundária — operacional, peso visual menor que o financeiro acima */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
            <p className="text-xs text-muted-foreground">Despesas previstas no mês</p>
            <p className="text-sm font-semibold">{formatCurrency(metrics.forecastExpenses)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="rounded-md p-2 bg-muted/50">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Receita de serviços</p>
            <p className="text-sm font-semibold">{formatCurrency(metrics.monthlyServiceRevenue)}</p>
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
