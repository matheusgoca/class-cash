import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { ContractForm } from "@/components/contracts/ContractForm";
import { ContractTable } from "@/components/contracts/ContractTable";
import { useToast } from "@/hooks/use-toast";

interface ContractData {
  id: string;
  student_id: string;
  class_id: string | null;
  start_date: string;
  end_date: string;
  monthly_amount: number;
  discount: number;
  status: "active" | "suspended" | "cancelled";
  created_at: string;
  updated_at: string;
  students: { name: string } | null;
  classes: { name: string } | null;
}

interface ContractSummary {
  total: number;
  active: number;
  suspended: number;
  cancelled: number;
  totalRevenue: number;
  activeRevenue: number;
}

const Contracts = () => {
  const { toast } = useToast();
  const { schoolId } = useSchool();
  const [contracts, setContracts] = useState<ContractData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingContract, setEditingContract] = useState<ContractData | null>(null);

  useEffect(() => {
    if (schoolId) fetchContracts();
  }, [schoolId]);

  const fetchContracts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contracts')
        .select(`
          id, student_id, class_id, start_date, end_date,
          monthly_amount, discount, status, created_at, updated_at,
          students ( name ),
          classes ( name )
        `)
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const typedData: ContractData[] = (data || []).map(item => ({
        ...item,
        status: item.status as "active" | "suspended" | "cancelled",
        students: Array.isArray(item.students) ? item.students[0] || null : item.students,
        classes: Array.isArray(item.classes) ? item.classes[0] || null : item.classes,
      }));

      setContracts(typedData);
    } catch (error) {
      console.error('Error fetching contracts:', error);
      toast({ title: "Erro", description: "Erro ao carregar contratos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAddNew = () => {
    setEditingContract(null);
    setShowForm(true);
  };

  const handleEdit = (contract: ContractData) => {
    setEditingContract(contract);
    setShowForm(true);
  };

  const handleFormSubmit = () => {
    setShowForm(false);
    setEditingContract(null);
    fetchContracts();
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingContract(null);
  };

  const calculateSummary = (): ContractSummary => {
    return contracts.reduce(
      (acc, contract) => {
        acc.total += 1;
        const monthlyValue = contract.monthly_amount * (1 - contract.discount / 100);
        acc.totalRevenue += monthlyValue;
        switch (contract.status) {
          case "active":
            acc.active += 1;
            acc.activeRevenue += monthlyValue;
            break;
          case "suspended":
            acc.suspended += 1;
            break;
          case "cancelled":
            acc.cancelled += 1;
            break;
        }
        return acc;
      },
      { total: 0, active: 0, suspended: 0, cancelled: 0, totalRevenue: 0, activeRevenue: 0 }
    );
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const summary = calculateSummary();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão de Contratos</h1>
          <p className="text-muted-foreground">
            Controle os contratos dos alunos e geração automática de mensalidades
          </p>
        </div>
        <Button onClick={handleAddNew}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Contrato
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{summary.total}</div>
            <p className="text-muted-foreground text-sm">{formatCurrency(summary.totalRevenue)} mensais</p>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Ativos
              <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full">{summary.active}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{formatCurrency(summary.activeRevenue)}</div>
            <p className="text-muted-foreground text-sm">receita mensal</p>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Suspensos
              <span className="bg-yellow-500 text-slate-900 text-xs px-2 py-1 rounded-full">{summary.suspended}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{summary.suspended}</div>
            <p className="text-muted-foreground text-sm">contratos pausados</p>
          </CardContent>
        </Card>

        <Card className="bg-card border rounded-2xl shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-card-foreground font-medium text-sm flex items-center justify-between">
              Cancelados
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">{summary.cancelled}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{summary.cancelled}</div>
            <p className="text-muted-foreground text-sm">contratos encerrados</p>
          </CardContent>
        </Card>
      </div>

      <ContractTable
        data={contracts}
        loading={loading}
        onEdit={handleEdit}
        onRefresh={fetchContracts}
      />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingContract ? 'Editar Contrato' : 'Novo Contrato'}</DialogTitle>
          </DialogHeader>
          <ContractForm
            contract={editingContract}
            onSubmit={handleFormSubmit}
            onCancel={handleFormCancel}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Contracts;
