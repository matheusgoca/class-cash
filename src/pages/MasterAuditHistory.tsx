import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuditHistory } from "@/hooks/useAuditHistory";
import { AuditTimelineEntry } from "@/components/audit/AuditTimelineEntry";
import { getCategoryFilterOptions } from "@/lib/auditFormat";
import type { AuditLogFilters } from "@/lib/auditLog";

const ALL = "__all__";

export default function MasterAuditHistory() {
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [schoolId, setSchoolId] = useState(ALL);
  const [categoryLabel, setCategoryLabel] = useState(ALL);
  const [onlyMasterActions, setOnlyMasterActions] = useState(false);

  const categoryOptions = useMemo(() => getCategoryFilterOptions(), []);

  useEffect(() => {
    (supabase as any)
      .from("schools")
      .select("id,name")
      .order("name")
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setSchools(data ?? []));
  }, []);

  const schoolNameById = useMemo(() => {
    const map = new Map(schools.map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [schools]);

  const filters: AuditLogFilters = useMemo(
    () => ({
      schoolId: schoolId === ALL ? undefined : schoolId,
      tableNames:
        categoryLabel === ALL
          ? undefined
          : categoryOptions.find((c) => c.label === categoryLabel)?.tableNames,
      onlyMasterActions,
      includeGeneratedImport: true, // painel master não esconde geração em lote por padrão
    }),
    [schoolId, categoryLabel, onlyMasterActions, categoryOptions],
  );

  // Master admin sempre pode ver salário (bypassa teachers_select via is_master_admin()).
  const { items, loading, loadingMore, hasMore, loadMore, error } = useAuditHistory(filters, {
    canSeeSalary: true,
    viewerIsMaster: true,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6 text-amber-600" />
          Histórico global de alterações
        </h1>
        <p className="text-muted-foreground">
          Todas as escolas · registros imutáveis · retenção de 24 meses
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Escola</label>
            <Select value={schoolId} onValueChange={setSchoolId}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as escolas</SelectItem>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Tabela</label>
            <Select value={categoryLabel} onValueChange={setCategoryLabel}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm pb-2">
            <Checkbox checked={onlyMasterActions} onCheckedChange={(v) => setOnlyMasterActions(!!v)} />
            Só ações master
          </label>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-hidden">
        <CardDescription className="px-6 pt-4 text-xs">
          Linhas destacadas são ações feitas pelo master em escolas de clientes; o owner vê o mesmo registro como
          "Suporte Class Cash".
        </CardDescription>
        <CardContent className="p-0 mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              Nenhuma alteração encontrada com esses filtros.
            </p>
          ) : (
            items.map((item) => (
              <AuditTimelineEntry key={item.log.id} item={item} schoolName={schoolNameById(item.log.school_id)} />
            ))
          )}
        </CardContent>
      </Card>

      {hasMore && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}
