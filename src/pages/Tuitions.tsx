import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { TuitionForm } from "@/components/tuitions/TuitionForm";
import { TuitionTable } from "@/components/tuitions/TuitionTable";
import { useToast } from "@/hooks/use-toast";

interface TuitionData {
  id: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  description: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
  payment_method: string | null;
  student_id: string;
  contract_id: string | null;
  discount_applied: number;
  penalty_amount: number;
  final_amount: number;
  students: {
    name: string;
    classes?: {
      name: string;
    } | null;
  } | null;
  contracts: {
    monthly_amount: number;
    discount: number;
  } | null;
}

interface TuitionSummary {
  total: number;
  pending: number;
  paid: number;
  overdue: number;
  cancelled: number;
  totalAmount: number;
  pendingAmount: number;
  paidAmount: number;
  overdueAmount: number;
}

const Tuitions = () => {
  const { toast } = useToast();
  const [tuitions, setTuitions] = useState<TuitionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTuition, setEditingTuition] = useState<TuitionData | null>(null);

  useEffect(() => {
    fetchTuitions();
  }, []);

  const fetchTuitions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tuitions')
        .select(`
          id,
          student_id,
          contract_id,
          amount,
          due_date,
          paid_date,
          description,
          status,
          payment_method,
          discount_applied,
          penalty_amount,
          final_amount,
          students (
            name,
            classes (
              name
            )
          ),
          contracts (
            monthly_amount,
            discount
          )
        `)
        .order('due_date', { ascending: false });

      if (error) throw error;

      // Cast the data to ensure proper typing and handle overdue logic
      const typedData: TuitionData[] = (data || []).map(item => {
        const isOverdue = new Date(item.due_date) < new Date() && item.status === "pending";
        return {
          ...item,
          status: (isOverdue ? "overdue" : item.status) as "pending" | "paid" | "overdue" | "cancelled",
          students: Array.isArray(item.students) ? item.students[0] || null : item.students,
          contracts: Array.isArray(item.contracts) ? item.contracts[0] || null : item.contracts,
        };
      });
      
      setTuitions(typedData);
    } catch (error) {
      console.error('Error fetching tuitions:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar mensalidades",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddNew = () => {
    setEditingTuition(null);
    setShowForm(true);
  };

  const handleEdit = (tuition: TuitionData) => {
    setEditingTuition(tuition);
    setShowForm(true);
  };

  const handleFormSubmit = () => {
    setShowForm(false);
    setEditingTuition(null);
    fetchTuitions();
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingTuition(null);
  };

  const calculateSummary = (): TuitionSummary => {
    const summary = tuitions.reduce(
      (acc, tuition) => {
        const isOverdue = new Date(tuition.due_date) < new Date() && tuition.status === "pending";
        const status = isOverdue ? "overdue" : tuition.status;
        
        acc.total += 1;
        acc.totalAmount += Number(tuition.final_amount || tuition.amount);
        
        switch (status) {
          case "pending":
            acc.pending += 1;
            acc.pendingAmount += Number(tuition.final_amount || tuition.amount);
            break;
          case "paid":
            acc.paid += 1;
            acc.paidAmount += Number(tuition.final_amount || tuition.amount);
            break;
          case "overdue":
            acc.overdue += 1;
            acc.overdueAmount += Number(tuition.final_amount || tuition.amount);
            break;
          case "cancelled":
            acc.cancelled += 1;
            break;
        }
        return acc;
      },
      {
        total: 0,
        pending: 0,
        paid: 0,
        overdue: 0,
        cancelled: 0,
        totalAmount: 0,
        pendingAmount: 0,
        paidAmount: 0,
        overdueAmount: 0
      }
    );
    return summary;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const summary = calculateSummary();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão de Mensalidades</h1>
          <p className="text-muted-foreground">
            Controle as mensalidades geradas automaticamente pelos contratos
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{summary.total}</div>
            <p className="text-muted-foreground text-sm">{formatCurrency(summary.totalAmount)}</p>
          </CardContent>
        </Card>
        
        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Pendentes
              <span className="bg-yellow-500 text-slate-900 text-xs px-2 py-1 rounded-full">
                {summary.pending}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">
              {formatCurrency(summary.pendingAmount)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Pagos
              <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                {summary.paid}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">
              {formatCurrency(summary.paidAmount)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Atrasados
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                {summary.overdue}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">
              {formatCurrency(summary.overdueAmount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tuitions Table */}
      <TuitionTable 
        data={tuitions}
        loading={loading}
        onEdit={handleEdit}
        onRefresh={fetchTuitions}
      />

      {/* Form Dialog - Only for editing tuitions, not creating new ones */}
      {showForm && editingTuition && (
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar Mensalidade</DialogTitle>
            </DialogHeader>
            <TuitionForm
              tuition={editingTuition}
              onSubmit={handleFormSubmit}
              onCancel={handleFormCancel}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default Tuitions;