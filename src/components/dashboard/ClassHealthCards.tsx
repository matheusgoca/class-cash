import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { formatCurrency, isTuitionOverdue } from "@/lib/calculations";
import { parseLocalDate } from "@/lib/dateUtils";
import { Users, DollarSign, AlertTriangle } from "lucide-react";

interface ClassHealth {
  id: string;
  name: string;
  color: string;
  teacher_names: string[];
  student_count: number;
  max_capacity: number;
  tuition_per_student: number;
  total_revenue: number;
  potential_revenue: number;
  capacity_percentage: number;
  revenue_percentage: number;
  default_rate: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
}

const statusConfig = {
  excellent: {
    label: "Excelente",
    color: "bg-success",
    badgeVariant: "default" as const,
  },
  good: {
    label: "Bom",
    color: "bg-success",
    badgeVariant: "secondary" as const,
  },
  warning: {
    label: "Atenção",
    color: "bg-warning",
    badgeVariant: "secondary" as const,
  },
  critical: {
    label: "Crítico",
    color: "bg-destructive",
    badgeVariant: "destructive" as const,
  },
};

interface ClassHealthCardProps {
  health: ClassHealth;
}

function ClassHealthCard({ health }: ClassHealthCardProps) {
  const config = statusConfig[health.status];

  return (
    <Card className="overflow-hidden">
      <div className={`h-2 ${config.color}`} />

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: health.color }}
              />
              {health.name}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {health.teacher_names.length === 0
                ? 'Sem professor'
                : health.teacher_names.length <= 2
                  ? `Prof. ${health.teacher_names.join(', ')}`
                  : `Prof. ${health.teacher_names[0]} +${health.teacher_names.length - 1}`}
            </p>
          </div>
          <Badge variant={config.badgeVariant}>
            {config.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Ocupação da turma</span>
            <span className="font-medium">{health.capacity_percentage.toFixed(1)}%</span>
          </div>
          <Progress value={health.capacity_percentage} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>Alunos</span>
            </div>
            <p className="text-lg font-semibold">
              {health.student_count}/{health.max_capacity}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              <span>Receita</span>
            </div>
            <p className="text-lg font-semibold">
              {formatCurrency(health.total_revenue)}
            </p>
            <p className="text-xs text-muted-foreground">
              de {formatCurrency(health.potential_revenue)} possível
            </p>
          </div>
        </div>

        {health.potential_revenue > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Receita potencial</span>
              <span className="font-medium">{health.revenue_percentage.toFixed(1)}%</span>
            </div>
            <Progress value={health.revenue_percentage} className="h-2" />
          </div>
        )}

        <div className="pt-2 border-t">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle
              className={`h-4 w-4 ${
                health.default_rate >= 15
                  ? 'text-destructive'
                  : health.default_rate > 0
                    ? 'text-warning'
                    : 'text-muted-foreground'
              }`}
            />
            <span className="text-muted-foreground">
              Inadimplência da turma: <span className="font-medium">{health.default_rate.toFixed(1)}%</span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClassHealthCards() {
  const { schoolId } = useSchool();
  const [classes, setClasses] = useState<ClassHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (schoolId) fetchClassData();
  }, [schoolId]);

  const fetchClassData = async () => {
    try {
      // Limit tuition history to the last 12 months — older data doesn't affect
      // current health metrics but can be a large payload for mature schools.
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
      const cutoff = twelveMonthsAgo.toISOString().slice(0, 10);

      const [
        { data: classData, error: classError },
        { data: enrollmentsData, error: enrollmentsError },
        { data: tuitionsData },
        { data: teachersData },
      ] = await Promise.all([
        (supabase as any)
          .from('classes')
          .select(`id, name, level, color, max_capacity, monthly_fee,
            class_teachers ( teacher_id )`)
          .eq('school_id', schoolId)
          .order('name'),
        // enrollments has no school_id — scoped via class_id cross-reference
        (supabase as any)
          .from('enrollments')
          .select('class_id, student_id'),
        (supabase as any)
          .from('tuitions')
          .select('final_amount, amount, status, due_date, contracts(class_id)')
          .eq('school_id', schoolId)
          .gte('due_date', cutoff),
        // teachers.salary é restrito a admin/financial no RLS — o Dashboard é
        // aberto a qualquer role, então o nome vem da view sem salário.
        (supabase as any)
          .from('teachers_directory')
          .select('id, full_name')
          .eq('school_id', schoolId),
      ]);

      if (classError) throw classError;
      if (enrollmentsError) throw enrollmentsError;

      const teacherNameById: Record<string, string> = (teachersData || []).reduce(
        (acc: Record<string, string>, t: any) => {
          acc[t.id] = t.full_name;
          return acc;
        },
        {}
      );

      const classStudentCounts = (enrollmentsData || []).reduce((acc: Record<string, number>, e: any) => {
        if (e.class_id) acc[e.class_id] = (acc[e.class_id] || 0) + 1;
        return acc;
      }, {});

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      const revenueByClass: Record<string, number> = {};
      const overdueByClass: Record<string, number> = {};
      // Receita do MÊS atual, separada da janela de 12 meses acima — usada só
      // pra comparar com potentialRevenue (que é mensal). Reusar a soma de 12
      // meses ali fazia turma cheia e em dia parecer com 1200% de receita.
      const monthlyRevenueByClass: Record<string, number> = {};
      for (const t of tuitionsData || []) {
        const cid = t.contracts?.class_id;
        if (!cid) continue;
        const value = Number(t.final_amount ?? t.amount ?? 0);
        if (t.status === 'paid') {
          revenueByClass[cid] = (revenueByClass[cid] || 0) + value;
          const due = parseLocalDate(t.due_date);
          if (due.getFullYear() === currentYear && due.getMonth() === currentMonth) {
            monthlyRevenueByClass[cid] = (monthlyRevenueByClass[cid] || 0) + value;
          }
        } else if (isTuitionOverdue(t.due_date, t.status)) {
          overdueByClass[cid] = (overdueByClass[cid] || 0) + value;
        }
      }

      const COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#F97316','#06B6D4','#84CC16'];

      const classesWithHealth: ClassHealth[] = (classData || []).map((cls: any, i: number) => {
        const studentCount       = classStudentCounts[cls.id] || 0;
        const maxCapacity        = cls.max_capacity || 30;
        const capacityPercentage = (studentCount / maxCapacity) * 100;
        const totalRevenue       = revenueByClass[cls.id] || 0;
        const overdueRevenue     = overdueByClass[cls.id] || 0;
        const potentialRevenue   = maxCapacity * (cls.monthly_fee || 0);
        const monthlyRevenue     = monthlyRevenueByClass[cls.id] || 0;
        const revenuePercentage  = potentialRevenue > 0
          ? (monthlyRevenue / potentialRevenue) * 100
          : 0;
        // Denominator: only tuitions already due (paid + overdue);
        // pending within due date don't count against the class.
        const duedBase = totalRevenue + overdueRevenue;
        const defaultRate = duedBase > 0 ? (overdueRevenue / duedBase) * 100 : 0;

        // Status factors in both occupancy AND default rate — a full class with
        // many overdue tuitions should not appear as "Excelente".
        let status: ClassHealth['status'];
        if (capacityPercentage >= 80 && defaultRate < 5) status = 'excellent';
        else if (capacityPercentage >= 60 && defaultRate < 15) status = 'good';
        else if (capacityPercentage >= 40 && defaultRate < 30) status = 'warning';
        else status = 'critical';

        const teacherNames: string[] = (cls.class_teachers || [])
          .map((ct: any) => teacherNameById[ct.teacher_id])
          .filter(Boolean);

        return {
          id: cls.id,
          name: cls.name,
          color: cls.color || COLORS[i % COLORS.length],
          teacher_names: teacherNames,
          student_count: studentCount,
          max_capacity: maxCapacity,
          tuition_per_student: cls.monthly_fee || 0,
          total_revenue: totalRevenue,
          potential_revenue: potentialRevenue,
          capacity_percentage: Math.min(capacityPercentage, 100),
          revenue_percentage: revenuePercentage,
          default_rate: defaultRate,
          status,
        };
      });

      setClasses(classesWithHealth);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching class data:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <div className="h-2 bg-muted" />
            <CardHeader className="pb-3">
              <div className="h-6 bg-muted rounded w-32 mb-2" />
              <div className="h-4 bg-muted rounded w-24" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-4 bg-muted rounded w-full" />
              <div className="h-2 bg-muted rounded" />
              <div className="grid grid-cols-2 gap-4">
                <div className="h-12 bg-muted rounded" />
                <div className="h-12 bg-muted rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {classes.map(health => (
        <ClassHealthCard key={health.id} health={health} />
      ))}
    </div>
  );
}
