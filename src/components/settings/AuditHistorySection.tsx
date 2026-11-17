import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, Loader2 } from "lucide-react";
import { useSchool } from "@/contexts/SchoolContext";
import { useRole } from "@/hooks/use-role";
import { useAuditHistory } from "@/hooks/useAuditHistory";
import { AuditTimelineEntry } from "@/components/audit/AuditTimelineEntry";
import { getCategoryFilterOptions } from "@/lib/auditFormat";
import { fetchDistinctActors, type ActorOption, type AuditLogFilters } from "@/lib/auditLog";

const ALL = "__all__";

const PERIOD_OPTIONS = [
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "all", label: "Todo o período" },
];

function periodToDateFrom(period: string): string | undefined {
  if (period === "all") return undefined;
  const days = Number(period);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function AuditHistorySection() {
  const { school } = useSchool();
  const { isAdmin, isFinancial } = useRole();
  const canSeeSalary = isAdmin || isFinancial;

  const [actorId, setActorId] = useState(ALL);
  const [categoryLabel, setCategoryLabel] = useState(ALL);
  const [period, setPeriod] = useState("30");
  const [includeGeneratedImport, setIncludeGeneratedImport] = useState(false);
  const [actors, setActors] = useState<ActorOption[]>([]);

  const categoryOptions = useMemo(() => getCategoryFilterOptions(), []);

  useEffect(() => {
    if (!school?.id) return;
    fetchDistinctActors(school.id).then(setActors).catch(() => setActors([]));
  }, [school?.id]);

  const filters: AuditLogFilters = useMemo(
    () => ({
      schoolId: school?.id,
      actorUserId: actorId === ALL ? undefined : actorId,
      tableNames:
        categoryLabel === ALL
          ? undefined
          : categoryOptions.find((c) => c.label === categoryLabel)?.tableNames,
      includeGeneratedImport,
      dateFrom: periodToDateFrom(period),
    }),
    [school?.id, actorId, categoryLabel, includeGeneratedImport, period, categoryOptions],
  );

  const { items, loading, loadingMore, hasMore, loadMore, error, hiddenSummary } = useAuditHistory(filters, {
    canSeeSalary,
    showHiddenSummary: true,
  });

  if (!school) return null;

  const hiddenTotal = hiddenSummary.reduce((sum, r) => sum + Number(r.cnt), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <CardTitle>Histórico de alterações</CardTitle>
        </div>
        <CardDescription>
          Quem mudou o quê e quando. Os registros ficam guardados por 24 meses e não podem ser editados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Quem</label>
            <Select value={actorId} onValueChange={setActorId}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {actors.map((a) => (
                  <SelectItem key={a.userId} value={a.userId}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Onde</label>
            <Select value={categoryLabel} onValueChange={setCategoryLabel}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as telas</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Período</label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm pb-2">
            <Checkbox checked={includeGeneratedImport} onCheckedChange={(v) => setIncludeGeneratedImport(!!v)} />
            Incluir geradas/importadas
          </label>
        </div>

        {!includeGeneratedImport && hiddenTotal > 0 && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            {hiddenTotal} lançamento{hiddenTotal > 1 ? "s" : ""} gerado{hiddenTotal > 1 ? "s" : ""} ou importado
            {hiddenTotal > 1 ? "s" : ""} automaticamente ficou{hiddenTotal > 1 ? "ram" : ""} oculto
            {hiddenTotal > 1 ? "s" : ""} nesse período (
            {hiddenSummary.map((s) => `${s.cnt} em ${s.table_name}`).join(", ")}
            ). Marque "Incluir geradas/importadas" pra ver.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="border rounded-lg overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              Nenhuma alteração encontrada com esses filtros.
            </p>
          ) : (
            items.map((item) => <AuditTimelineEntry key={item.log.id} item={item} />)
          )}
        </div>

        {hasMore && !loading && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Carregar mais
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
