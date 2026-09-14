import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { ServiceCatalogSection } from "@/components/services/ServiceCatalogSection";
import { AddServiceChargeDialog } from "@/components/services/AddServiceChargeDialog";
import { ServiceChargeTable, type ServiceChargeRow } from "@/components/services/ServiceChargeTable";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";
import { isTuitionOverdue } from "@/lib/calculations";

const Services = () => {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [charges, setCharges] = useState<ServiceChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (schoolId) fetchCharges();
  }, [schoolId]);

  const fetchCharges = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("service_charges")
        .select("id, description, amount, status, due_date, paid_date, payment_method, students(full_name), school_services(name)")
        .eq("school_id", schoolId)
        .order("due_date", { ascending: false });

      if (error) throw error;

      setCharges((data || []).map((c: any) => ({
        id: c.id,
        description: c.description,
        amount: Number(c.amount),
        status: c.status,
        due_date: c.due_date,
        paid_date: c.paid_date,
        payment_method: c.payment_method,
        studentName: c.students?.full_name ?? "N/A",
        serviceName: c.school_services?.name ?? "N/A",
      })));
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao carregar serviços"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openCharges = charges.filter((c) => isTuitionOverdue(c.due_date, c.status) || c.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Serviços</h1>
          <p className="text-muted-foreground">
            Uniformes, materiais, atividades extras e outros pagamentos avulsos
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Cobrança
        </Button>
      </div>

      <Card className="w-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Cobranças em aberto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{openCharges.length}</div>
        </CardContent>
      </Card>

      <ServiceChargeTable data={charges} loading={loading} onRefresh={fetchCharges} />

      <ServiceCatalogSection />

      {schoolId && (
        <AddServiceChargeDialog
          open={showAdd}
          onOpenChange={setShowAdd}
          schoolId={schoolId}
          onSuccess={fetchCharges}
        />
      )}
    </div>
  );
};

export default Services;
