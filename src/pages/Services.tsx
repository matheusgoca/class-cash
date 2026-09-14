import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Repeat, ChevronDown } from "lucide-react";
import { ServiceCatalogSection } from "@/components/services/ServiceCatalogSection";
import { SubscribeServiceDialog } from "@/components/services/SubscribeServiceDialog";
import { ServiceChargeTable, type ServiceChargeRow } from "@/components/services/ServiceChargeTable";
import { cancelStudentService } from "@/lib/studentServices";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";
import { isTuitionOverdue } from "@/lib/calculations";

interface ActiveSubscriptionRow {
  id: string;
  price: number;
  due_day: number;
  studentName: string;
  serviceName: string;
}

const Services = () => {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [charges, setCharges] = useState<ServiceChargeRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<ActiveSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [showActive, setShowActive] = useState(false);

  useEffect(() => {
    if (schoolId) fetchAll();
  }, [schoolId]);

  const fetchAll = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: chargesData, error: chargesErr }, { data: subsData, error: subsErr }] = await Promise.all([
        (supabase as any)
          .from("service_charges")
          .select("id, description, amount, status, due_date, paid_date, payment_method, students(full_name), school_services(name)")
          .eq("school_id", schoolId)
          .order("due_date", { ascending: false }),
        (supabase as any)
          .from("student_services")
          .select("id, price, due_day, active, students(full_name), school_services(name)")
          .eq("school_id", schoolId)
          .eq("active", true)
          .order("created_at", { ascending: false }),
      ]);

      if (chargesErr) throw chargesErr;
      if (subsErr) throw subsErr;

      setCharges((chargesData || []).map((c: any) => ({
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

      setSubscriptions((subsData || []).map((s: any) => ({
        id: s.id,
        price: Number(s.price),
        due_day: s.due_day,
        studentName: s.students?.full_name ?? "N/A",
        serviceName: s.school_services?.name ?? "N/A",
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

  const handleCancel = async (subscriptionId: string) => {
    try {
      await cancelStudentService(subscriptionId);
      toast({ title: "Assinatura cancelada" });
      fetchAll();
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao cancelar assinatura"),
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const openCharges = charges.filter((c) => isTuitionOverdue(c.due_date, c.status) || c.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Serviços</h1>
          <p className="text-muted-foreground">
            Alimentação, cursos extras e qualquer assinatura mensal além da mensalidade
          </p>
        </div>
        <Button onClick={() => setShowSubscribe(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Assinatura
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

      <ServiceChargeTable data={charges} loading={loading} onRefresh={fetchAll} />

      <Card>
        <Collapsible open={showActive} onOpenChange={setShowActive}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Assinaturas ativas ({subscriptions.length})
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showActive ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {subscriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhuma assinatura ativa. Clique em "Nova Assinatura" pra começar.
                </p>
              ) : (
                <div className="space-y-2">
                  {subscriptions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 flex-wrap">
                      <div>
                        <span className="font-medium">{s.studentName}</span>
                        <Badge variant="outline" className="ml-2">{s.serviceName}</Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatCurrency(s.price)} · todo dia {s.due_day}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleCancel(s.id)}>
                        Cancelar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ServiceCatalogSection />

      {schoolId && (
        <SubscribeServiceDialog
          open={showSubscribe}
          onOpenChange={setShowSubscribe}
          schoolId={schoolId}
          onSuccess={fetchAll}
        />
      )}
    </div>
  );
};

export default Services;
