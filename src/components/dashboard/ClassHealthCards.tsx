import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { mockClasses, mockStudents, mockTuitions, mockTeachers } from "@/data/mockData";
import { FinancialHealth } from "@/types";
import { Users, TrendingUp, DollarSign } from "lucide-react";

function calculateClassHealth(classId: string): FinancialHealth {
  const classData = mockClasses.find(c => c.id === classId);
  if (!classData) throw new Error("Class not found");

  const classStudents = mockStudents.filter(s => s.classId === classId);
  const classTuitions = mockTuitions.filter(t => 
    classStudents.some(s => s.id === t.studentId)
  );
  
  const totalStudents = classStudents.length;
  const paidTuitions = classTuitions.filter(t => t.status === "paid");
  const paidStudents = new Set(paidTuitions.map(t => t.studentId)).size;
  
  const totalRevenue = classTuitions.reduce((sum, t) => sum + t.amount, 0);
  const paidRevenue = paidTuitions.reduce((sum, t) => sum + t.amount, 0);
  
  const percentage = totalStudents > 0 ? (paidStudents / totalStudents) * 100 : 0;
  
  let status: FinancialHealth["status"];
  if (percentage >= 90) status = "excellent";
  else if (percentage >= 70) status = "good";
  else if (percentage >= 50) status = "warning";
  else status = "critical";

  return {
    classId,
    percentage,
    status,
    totalStudents,
    paidStudents,
    totalRevenue,
    paidRevenue,
  };
}

const statusConfig = {
  excellent: {
    label: "Excelente",
    color: "bg-gradient-success",
    textColor: "text-success-foreground",
    badgeVariant: "default" as const,
    progressColor: "bg-success",
  },
  good: {
    label: "Bom",
    color: "bg-gradient-success",
    textColor: "text-success-foreground",
    badgeVariant: "secondary" as const,
    progressColor: "bg-success",
  },
  warning: {
    label: "Atenção",
    color: "bg-gradient-warning",
    textColor: "text-warning-foreground",
    badgeVariant: "secondary" as const,
    progressColor: "bg-warning",
  },
  critical: {
    label: "Crítico",
    color: "bg-gradient-danger",
    textColor: "text-danger-foreground",
    badgeVariant: "destructive" as const,
    progressColor: "bg-danger",
  },
};

interface ClassHealthCardProps {
  health: FinancialHealth;
}

function ClassHealthCard({ health }: ClassHealthCardProps) {
  const classData = mockClasses.find(c => c.id === health.classId);
  const teacher = mockTeachers.find(t => t.id === classData?.teacherId);
  const config = statusConfig[health.status];

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  return (
    <Card className="overflow-hidden">
      <div className={`h-2 ${config.color}`} />
      
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{classData?.name}</CardTitle>
            <p className="text-sm text-muted-foreground">Prof. {teacher?.name}</p>
          </div>
          <Badge variant={config.badgeVariant}>
            {config.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Pagamentos em dia</span>
            <span className="font-medium">{health.percentage.toFixed(1)}%</span>
          </div>
          <Progress value={health.percentage} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>Alunos</span>
            </div>
            <p className="text-lg font-semibold">
              {health.paidStudents}/{health.totalStudents}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              <span>Receita</span>
            </div>
            <p className="text-lg font-semibold">
              {formatCurrency(health.paidRevenue)}
            </p>
            <p className="text-xs text-muted-foreground">
              de {formatCurrency(health.totalRevenue)}
            </p>
          </div>
        </div>

        <div className="pt-2 border-t">
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Taxa de adimplência: <span className="font-medium">{health.percentage.toFixed(1)}%</span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClassHealthCards() {
  const classHealthData = mockClasses.map(c => calculateClassHealth(c.id));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {classHealthData.map(health => (
        <ClassHealthCard key={health.classId} health={health} />
      ))}
    </div>
  );
}