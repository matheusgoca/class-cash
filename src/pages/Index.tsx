import { FinancialMetrics } from "@/components/dashboard/FinancialMetrics";
import { ClassHealthCards } from "@/components/dashboard/ClassHealthCards";
import { FinancialKanban } from "@/components/dashboard/FinancialKanban";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";

const Index = () => {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard Financeiro</h1>
        <p className="text-muted-foreground">
          Visão geral da saúde financeira da escola
        </p>
      </div>

      <FinancialMetrics />

      <div>
        <h2 className="text-xl font-semibold mb-4">Análise de Dados</h2>
        <DashboardCharts />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Saúde Financeira das Turmas</h2>
        <ClassHealthCards />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Controle de Mensalidades</h2>
        <FinancialKanban />
      </div>
    </div>
  );
};

export default Index;
