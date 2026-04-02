import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, DollarSign, User, CheckCircle } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

type PaymentStatus = 'pending' | 'paid' | 'overdue';

interface TuitionData {
  id: string;
  student_id: string;
  amount: number;
  due_date: string;
  paid_date?: string;
  description: string;
  status: PaymentStatus;
  payment_method?: string;
  students: {
    full_name: string;
  } | null;
}

const statusConfig = {
  pending: {
    title: "Pendentes",
    badgeClass: "bg-yellow-500 text-slate-900",
  },
  paid: {
    title: "Pagos",
    badgeClass: "bg-green-500 text-white",
  },
  overdue: {
    title: "Atrasados",
    badgeClass: "bg-red-500 text-white",
  },
};

interface TuitionCardProps {
  tuition: TuitionData;
  onStatusChange: (id: string, status: PaymentStatus) => void;
}

function TuitionCard({ tuition, onStatusChange }: TuitionCardProps) {
  const isOverdue = new Date(tuition.due_date) < new Date() && tuition.status === "pending";

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (date: string) => {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(date));
  };

  return (
    <Card className="mb-3 hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{tuition.students?.full_name || 'Aluno não encontrado'}</span>
          </div>
          <Badge className={statusConfig[tuition.status].badgeClass}>
            {tuition.status === "pending" && isOverdue ? "Atrasado" : statusConfig[tuition.status].title.slice(0, -1)}
          </Badge>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-lg">{formatCurrency(tuition.amount)}</span>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Venc: {formatDate(tuition.due_date)}</span>
          </div>

          <p className="text-sm text-muted-foreground">{tuition.description}</p>

          {tuition.paid_date && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span>Pago em {formatDate(tuition.paid_date)}</span>
            </div>
          )}
        </div>

        {tuition.status === "pending" && (
          <Button
            size="sm"
            className="w-full"
            onClick={() => onStatusChange(tuition.id, "paid")}
          >
            Marcar como Pago
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const date = new Date(new Date().getFullYear(), i, 1);
  return {
    value: format(date, 'yyyy-MM'),
    label: format(date, 'MMMM yyyy', { locale: ptBR }),
  };
});

export function FinancialKanban() {
  const [tuitions, setTuitions] = useState<TuitionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  useEffect(() => {
    fetchTuitions();
  }, [selectedMonth]);

  const fetchTuitions = async () => {
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      const start = format(startOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');
      const end = format(endOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');

      const { data: tuitionsData, error } = await supabase
        .from('tuitions')
        .select(`
          id,
          student_id,
          amount,
          due_date,
          paid_date,
          description,
          status,
          payment_method
        `)
        .gte('due_date', start)
        .lte('due_date', end)
        .order('due_date', { ascending: false });

      if (error) throw error;

      // Fetch students separately
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('id, full_name');

      if (studentsError) throw studentsError;

      // Create lookup map
      const studentMap = (studentsData || []).reduce((acc: any, student: any) => {
        acc[student.id] = student.full_name;
        return acc;
      }, {});
      
      // Merge the data
      const typedData: TuitionData[] = (tuitionsData || []).map(item => ({
        ...item,
        status: item.status as PaymentStatus,
        students: { full_name: studentMap[item.student_id] || 'N/A' }
      }));
      
      setTuitions(typedData);
    } catch (error) {
      console.error('Error fetching tuitions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: PaymentStatus) => {
    try {
      const updateData: any = { status: newStatus };
      if (newStatus === "paid") {
        updateData.paid_date = new Date().toISOString().split('T')[0];
        updateData.payment_method = "Sistema";
      } else {
        updateData.paid_date = null;
        updateData.payment_method = null;
      }

      const { error } = await supabase
        .from('tuitions')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      // Update local state
      setTuitions(prev => prev.map(tuition => {
        if (tuition.id === id) {
          return {
            ...tuition,
            status: newStatus,
            paid_date: newStatus === "paid" ? new Date().toISOString().split('T')[0] : undefined,
            payment_method: newStatus === "paid" ? "Sistema" : undefined,
          };
        }
        return tuition;
      }));
    } catch (error) {
      console.error('Error updating tuition status:', error);
    }
  };

  // Separate tuitions by status, but check for overdue ones
  const categorizedTuitions = {
    pending: tuitions.filter(t => {
      const isOverdue = new Date(t.due_date) < new Date();
      return t.status === "pending" && !isOverdue;
    }),
    overdue: tuitions.filter(t => {
      const isOverdue = new Date(t.due_date) < new Date();
      return (t.status === "pending" && isOverdue) || t.status === "overdue";
    }),
    paid: tuitions.filter(t => t.status === "paid"),
  };

  const getTotalAmount = (tuitionList: TuitionData[]) => {
    return tuitionList.reduce((sum, t) => sum + Number(t.amount), 0);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-6 bg-muted rounded w-24" />
              <div className="h-4 bg-muted rounded w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-20 bg-muted rounded" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Filtrar por mês:</span>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label.charAt(0).toUpperCase() + opt.label.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="space-y-4">
        <Card className="rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <span className="font-medium">Pendentes</span>
              <Badge className="bg-yellow-500 text-slate-900">
                {categorizedTuitions.pending.length}
              </Badge>
            </CardTitle>
            <p className="text-muted-foreground mt-2">
              Total: {formatCurrency(getTotalAmount(categorizedTuitions.pending))}
            </p>
          </CardHeader>
        </Card>
        
        <div className="space-y-3">
          {categorizedTuitions.pending.map(tuition => (
            <TuitionCard
              key={tuition.id}
              tuition={tuition}
              onStatusChange={handleStatusChange}
            />
          ))}
          {categorizedTuitions.pending.length === 0 && (
            <p className="text-center text-muted-foreground py-4">Nenhuma mensalidade pendente</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <Card className="rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <span className="font-medium">Atrasados</span>
              <Badge className="bg-red-500 text-white">
                {categorizedTuitions.overdue.length}
              </Badge>
            </CardTitle>
            <p className="text-muted-foreground mt-2">
              Total: {formatCurrency(getTotalAmount(categorizedTuitions.overdue))}
            </p>
          </CardHeader>
        </Card>
        
        <div className="space-y-3">
          {categorizedTuitions.overdue.map(tuition => (
            <TuitionCard
              key={tuition.id}
              tuition={tuition}
              onStatusChange={handleStatusChange}
            />
          ))}
          {categorizedTuitions.overdue.length === 0 && (
            <p className="text-center text-muted-foreground py-4">Nenhuma mensalidade atrasada</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <Card className="rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <span className="font-medium">Pagos</span>
              <Badge className="bg-green-500 text-white">
                {categorizedTuitions.paid.length}
              </Badge>
            </CardTitle>
            <p className="text-muted-foreground mt-2">
              Total: {formatCurrency(getTotalAmount(categorizedTuitions.paid))}
            </p>
          </CardHeader>
        </Card>
        
        <div className="space-y-3">
          {categorizedTuitions.paid.map(tuition => (
            <TuitionCard
              key={tuition.id}
              tuition={tuition}
              onStatusChange={handleStatusChange}
            />
          ))}
          {categorizedTuitions.paid.length === 0 && (
            <p className="text-center text-muted-foreground py-4">Nenhuma mensalidade paga</p>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}