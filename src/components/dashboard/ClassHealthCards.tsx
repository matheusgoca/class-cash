import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Users, TrendingUp, DollarSign } from "lucide-react";

interface ClassHealth {
  id: string;
  name: string;
  color: string;
  teacher_name?: string;
  student_count: number;
  max_capacity: number;
  tuition_per_student: number;
  total_revenue: number;
  potential_revenue: number;
  capacity_percentage: number;
  revenue_percentage: number;
  paid_students: number;
  payment_percentage: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
}

const statusConfig = {
  excellent: {
    label: "Excelente",
    color: "bg-success",
    textColor: "text-success-foreground",
    badgeVariant: "default" as const,
  },
  good: {
    label: "Bom",
    color: "bg-success",
    textColor: "text-success-foreground",
    badgeVariant: "secondary" as const,
  },
  warning: {
    label: "Atenção",
    color: "bg-warning",
    textColor: "text-warning-foreground",
    badgeVariant: "secondary" as const,
  },
  critical: {
    label: "Crítico",
    color: "bg-destructive",
    textColor: "text-destructive-foreground",
    badgeVariant: "destructive" as const,
  },
};

interface ClassHealthCardProps {
  health: ClassHealth;
}

function ClassHealthCard({ health }: ClassHealthCardProps) {
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
            <CardTitle className="text-lg flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: health.color }}
              />
              {health.name}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {health.teacher_name ? `Prof. ${health.teacher_name}` : 'Sem professor'}
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
              de {formatCurrency(health.potential_revenue)}
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
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Eficiência financeira: <span className="font-medium">{health.revenue_percentage.toFixed(1)}%</span>
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
      // Simplified version - just show basic class info
      const { data: classData, error: classError } = await (supabase as any)
        .from('classes')
        .select(`
          id,
          name,
          level,
          color,
          class_teachers (
            teachers (
              id,
              full_name
            )
          )
        `)
        .eq('school_id', schoolId)
        .order('name');

      if (classError) throw classError;

      // Fetch enrollments to count students per class
      const { data: enrollmentsData, error: enrollmentsError } = await (supabase as any)
        .from('enrollments')
        .select('class_id, student_id');

      if (enrollmentsError) throw enrollmentsError;

      // Count students per class
      const classStudentCounts = (enrollmentsData || []).reduce((acc: any, enrollment: any) => {
        if (enrollment.class_id) {
          acc[enrollment.class_id] = (acc[enrollment.class_id] || 0) + 1;
        }
        return acc;
      }, {});

      // Fetch paid tuitions per class (via contracts)
      const { data: tuitionsData } = await (supabase as any)
        .from('tuitions')
        .select('final_amount, amount, contracts(class_id)')
        .eq('school_id', schoolId)
        .eq('status', 'paid');

      const revenueByClass: Record<string, number> = {};
      for (const t of tuitionsData || []) {
        const cid = t.contracts?.class_id;
        if (cid) revenueByClass[cid] = (revenueByClass[cid] || 0) + Number(t.final_amount ?? t.amount ?? 0);
      }

      const COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#F97316','#06B6D4','#84CC16'];

      const classesWithHealth: ClassHealth[] = (classData || []).map((cls: any, i: number) => {
        const studentCount       = classStudentCounts[cls.id] || 0;
        const maxCapacity        = 30;
        const capacityPercentage = (studentCount / maxCapacity) * 100;
        const totalRevenue       = revenueByClass[cls.id] || 0;

        let status: ClassHealth['status'] = 'critical';
        if (capacityPercentage >= 80) status = 'excellent';
        else if (capacityPercentage >= 60) status = 'good';
        else if (capacityPercentage >= 40) status = 'warning';

        const teacherName = cls.class_teachers?.[0]?.teachers?.full_name ?? undefined;

        return {
          id: cls.id,
          name: cls.name,
          color: cls.color || COLORS[i % COLORS.length],
          teacher_name: teacherName,
          student_count: studentCount,
          max_capacity: maxCapacity,
          tuition_per_student: 0,
          total_revenue: totalRevenue,
          potential_revenue: 0,
          capacity_percentage: Math.min(capacityPercentage, 100),
          revenue_percentage: capacityPercentage,
          paid_students: studentCount,
          payment_percentage: capacityPercentage,
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
