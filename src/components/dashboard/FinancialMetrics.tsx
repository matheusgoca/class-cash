import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockTuitions } from "@/data/mockData";
import { DollarSign, TrendingUp, AlertTriangle, Users } from "lucide-react";

export function FinancialMetrics() {
  const totalRevenue = mockTuitions.reduce((sum, t) => sum + t.amount, 0);
  const paidRevenue = mockTuitions
    .filter(t => t.status === "paid")
    .reduce((sum, t) => sum + t.amount, 0);
  
  const pendingRevenue = mockTuitions
    .filter(t => t.status === "pending")
    .reduce((sum, t) => sum + t.amount, 0);
  
  const overdueRevenue = mockTuitions
    .filter(t => t.status === "overdue" || (
      t.status === "pending" && new Date(t.dueDate) < new Date()
    ))
    .reduce((sum, t) => sum + t.amount, 0);

  const totalStudents = new Set(mockTuitions.map(t => t.studentId)).size;
  const defaultRate = ((pendingRevenue + overdueRevenue) / totalRevenue * 100).toFixed(1);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const metrics = [
    {
      title: "Receita Total",
      value: formatCurrency(totalRevenue),
      description: "Valor total das mensalidades",
      icon: DollarSign,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Receita Recebida",
      value: formatCurrency(paidRevenue),
      description: `${((paidRevenue / totalRevenue) * 100).toFixed(1)}% do total`,
      icon: TrendingUp,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      title: "Taxa de Inadimplência",
      value: `${defaultRate}%`,
      description: formatCurrency(overdueRevenue + pendingRevenue),
      icon: AlertTriangle,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
    {
      title: "Total de Alunos",
      value: totalStudents.toString(),
      description: "Alunos com mensalidades",
      icon: Users,
      color: "text-muted-foreground",
      bgColor: "bg-muted/10",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map((metric, index) => (
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
  );
}