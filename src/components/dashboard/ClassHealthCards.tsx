import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
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
  const [classes, setClasses] = useState<ClassHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClassData();
  }, []);

  const fetchClassData = async () => {
    try {
      // Fetch classes with teacher info
      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select(`
          *,
          teachers:teacher_id (
            full_name,
            specialization
          )
        `)
        .order('name');

      if (classError) throw classError;

      // Fetch students with their tuition data
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('class_id, final_tuition_value, status')
        .eq('status', 'active');

      if (studentsError) throw studentsError;

      // Fetch tuition payments to calculate payment status
      const { data: tuitionsData, error: tuitionsError } = await supabase
        .from('tuitions')
        .select('student_id, status, amount');

      if (tuitionsError) throw tuitionsError;

      // Calculate financial data for each class
      const classFinancials = studentsData.reduce((acc, student) => {
        if (student.class_id) {
          if (!acc[student.class_id]) {
            acc[student.class_id] = {
              student_count: 0,
              total_revenue: 0,
              students: [],
            };
          }
          acc[student.class_id].student_count += 1;
          acc[student.class_id].total_revenue += Number(student.final_tuition_value) || 0;
          acc[student.class_id].students.push(student);
        }
        return acc;
      }, {});

      const classesWithHealth: ClassHealth[] = (classData || []).map(cls => {
        const classFinance = classFinancials[cls.id] || { student_count: 0, total_revenue: 0, students: [] };
        const studentCount = classFinance.student_count;
        const totalRevenue = classFinance.total_revenue;
        const capacityPercentage = (studentCount / cls.max_capacity) * 100;
        
        // Calculate potential revenue if class was full
        const potentialRevenue = (cls.tuition_per_student || 0) * cls.max_capacity;
        const revenuePercentage = potentialRevenue > 0 ? (totalRevenue / potentialRevenue) * 100 : 0;
        
        // Calculate payment status (simplified - using capacity as proxy for payments)
        const paymentPercentage = capacityPercentage;
        
        let status: ClassHealth['status'] = 'critical';
        if (revenuePercentage >= 80) status = 'excellent';
        else if (revenuePercentage >= 60) status = 'good';
        else if (revenuePercentage >= 40) status = 'warning';

        return {
          id: cls.id,
          name: cls.name,
          color: cls.color,
          teacher_name: cls.teachers?.full_name,
          student_count: studentCount,
          max_capacity: cls.max_capacity,
          tuition_per_student: cls.tuition_per_student || 0,
          total_revenue: totalRevenue,
          potential_revenue: potentialRevenue,
          capacity_percentage: capacityPercentage,
          revenue_percentage: revenuePercentage,
          paid_students: studentCount, // Simplified
          payment_percentage: paymentPercentage,
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