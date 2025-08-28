import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, TrendingUp, AlertTriangle, Users, UserCheck, Calculator } from "lucide-react";

export function FinancialMetrics() {
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    paidRevenue: 0,
    pendingRevenue: 0,
    overdueRevenue: 0,
    totalStudents: 0,
    totalTeachers: 0,
    totalSalaries: 0,
    financialBalance: 0,
    loading: true
  });

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      // Fetch all students with their tuition values
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, final_tuition_value, status')
        .eq('status', 'active');

      if (studentsError) throw studentsError;

      // Fetch all teachers with their salaries
      const { data: teachers, error: teachersError } = await supabase
        .from('teachers')
        .select('id, salary, status')
        .eq('status', 'active');

      if (teachersError) throw teachersError;

      // Fetch all tuition records
      const { data: tuitions, error: tuitionsError } = await supabase
        .from('tuitions')
        .select('amount, status, due_date, paid_date');

      if (tuitionsError) throw tuitionsError;

      const currentDate = new Date();
      
      // Calculate revenue metrics from tuition records
      const totalRevenue = tuitions?.reduce((sum, t) => sum + Number(t.amount), 0) || 0;
      const paidRevenue = tuitions?.filter(t => t.status === "paid")
        .reduce((sum, t) => sum + Number(t.amount), 0) || 0;
      
      const pendingRevenue = tuitions?.filter(t => t.status === "pending")
        .reduce((sum, t) => sum + Number(t.amount), 0) || 0;
      
      const overdueRevenue = tuitions?.filter(t => 
        t.status === "overdue" || (
          t.status === "pending" && new Date(t.due_date) < currentDate
        )
      ).reduce((sum, t) => sum + Number(t.amount), 0) || 0;

      // Calculate teacher salaries
      const totalSalaries = teachers?.reduce((sum, t) => sum + Number(t.salary), 0) || 0;

      // Calculate financial balance (revenue - salaries)
      const financialBalance = paidRevenue - totalSalaries;

      setMetrics({
        totalRevenue,
        paidRevenue,
        pendingRevenue,
        overdueRevenue,
        totalStudents: students?.length || 0,
        totalTeachers: teachers?.length || 0,
        totalSalaries,
        financialBalance,
        loading: false
      });

    } catch (error) {
      console.error('Error fetching metrics:', error);
      setMetrics(prev => ({ ...prev, loading: false }));
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const defaultRate = metrics.totalRevenue > 0 
    ? ((metrics.pendingRevenue + metrics.overdueRevenue) / metrics.totalRevenue * 100).toFixed(1)
    : "0.0";

  const metricsData = [
    {
      title: "Receita Recebida",
      value: formatCurrency(metrics.paidRevenue),
      description: metrics.totalRevenue > 0 
        ? `${((metrics.paidRevenue / metrics.totalRevenue) * 100).toFixed(1)}% do total`
        : "0% do total",
      icon: DollarSign,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Total de Professores",
      value: metrics.totalTeachers.toString(),
      description: "Professores ativos",
      icon: UserCheck,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Gastos com Salários",
      value: formatCurrency(metrics.totalSalaries),
      description: "Salários mensais",
      icon: Calculator,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
    {
      title: "Saldo Financeiro",
      value: formatCurrency(metrics.financialBalance),
      description: metrics.financialBalance >= 0 ? "Lucro" : "Prejuízo",
      icon: TrendingUp,
      color: metrics.financialBalance >= 0 ? "text-success" : "text-destructive",
      bgColor: metrics.financialBalance >= 0 ? "bg-success/10" : "bg-destructive/10",
    },
    {
      title: "Taxa de Inadimplência",
      value: `${defaultRate}%`,
      description: formatCurrency(metrics.overdueRevenue + metrics.pendingRevenue),
      icon: AlertTriangle,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
    {
      title: "Total de Alunos",
      value: metrics.totalStudents.toString(),
      description: "Alunos ativos",
      icon: Users,
      color: "text-muted-foreground",
      bgColor: "bg-muted/10",
    },
  ];

  if (metrics.loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-muted rounded w-24"></div>
              <div className="h-8 w-8 bg-muted rounded-md"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-muted rounded w-20 mb-1"></div>
              <div className="h-3 bg-muted rounded w-32"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {metricsData.map((metric, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <div className={`rounded-md p-2 ${metric.bgColor}`}>
                <metric.icon className={`h-4 w-4 ${metric.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metric.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Financial Health Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Visão Geral Financeira
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Receita vs Gastos</span>
                <span className="font-medium">
                  {metrics.totalSalaries > 0 
                    ? `${((metrics.paidRevenue / metrics.totalSalaries) * 100).toFixed(1)}%`
                    : '100%'
                  }
                </span>
              </div>
              <Progress 
                value={metrics.totalSalaries > 0 ? (metrics.paidRevenue / metrics.totalSalaries) * 100 : 100} 
                className="h-2" 
              />
              <p className="text-xs text-muted-foreground">
                Receita recebida vs salários pagos
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Eficiência de Pagamentos</span>
                <span className="font-medium">
                  {(100 - parseFloat(defaultRate)).toFixed(1)}%
                </span>
              </div>
              <Progress 
                value={100 - parseFloat(defaultRate)} 
                className="h-2" 
              />
              <p className="text-xs text-muted-foreground">
                Pagamentos em dia vs total
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-center p-4 rounded-lg border">
                <div className="text-2xl font-bold">
                  {metrics.totalStudents > 0 && metrics.totalTeachers > 0 
                    ? (metrics.totalStudents / metrics.totalTeachers).toFixed(1)
                    : '0'
                  }
                </div>
                <p className="text-sm text-muted-foreground">
                  Alunos por Professor
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}