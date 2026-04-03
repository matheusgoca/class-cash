/**
 * PÁGINA TEMPORÁRIA — remover após uso
 * Rota: /admin/gerar-mensalidades
 *
 * Gera mensalidades para todos os contratos ativos da escola.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateTuitions } from "@/lib/generateTuitions";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface Result {
  contractId: string;
  studentName: string;
  inserted: number;
  error?: string;
}

export default function AdminSyncTuitions() {
  const { schoolId } = useSchool();
  const [running, setRunning]   = useState(false);
  const [done, setDone]         = useState(false);
  const [total, setTotal]       = useState(0);
  const [processed, setProcessed] = useState(0);
  const [results, setResults]   = useState<Result[]>([]);

  const run = async () => {
    setRunning(true);
    setDone(false);
    setProcessed(0);
    setResults([]);

    // 1. Fetch all active contracts for this school
    const { data: contracts, error } = await (supabase as any)
      .from("contracts")
      .select("id, student_id, students(full_name)")
      .eq("school_id", schoolId)
      .eq("status", "active");

    if (error || !contracts) {
      setResults([{ contractId: "", studentName: "—", inserted: 0, error: error?.message ?? "Erro ao buscar contratos" }]);
      setRunning(false);
      return;
    }

    setTotal(contracts.length);

    const log: Result[] = [];

    // 2. Process one by one
    for (let i = 0; i < contracts.length; i++) {
      const c = contracts[i];
      const studentName = c.students?.full_name ?? c.student_id;
      const { inserted, error: genError } = await generateTuitions(c.id);

      log.push({ contractId: c.id, studentName, inserted, error: genError });
      setProcessed(i + 1);
      setResults([...log]);
    }

    setRunning(false);
    setDone(true);
  };

  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const errorCount    = results.filter(r => r.error).length;
  const progress      = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Geração em lote de mensalidades</CardTitle>
          <p className="text-sm text-muted-foreground">
            Executa <code>generateTuitions</code> para todos os contratos ativos da escola.
            Operação idempotente — meses já existentes são ignorados.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">

          {!running && !done && (
            <Button onClick={run} disabled={!schoolId}>
              Iniciar geração
            </Button>
          )}

          {(running || done) && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{processed} / {total} contratos processados</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>

              {done && (
                <div className="rounded-lg border p-4 space-y-1">
                  <p className="font-semibold">
                    {totalInserted} mensalidade{totalInserted !== 1 ? "s" : ""} gerada{totalInserted !== 1 ? "s" : ""}
                  </p>
                  {errorCount > 0 && (
                    <p className="text-sm text-destructive">{errorCount} contrato(s) com erro</p>
                  )}
                </div>
              )}

              <div className="max-h-72 overflow-y-auto rounded-md border text-sm">
                <table className="w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Aluno</th>
                      <th className="text-right px-3 py-2">Geradas</th>
                      <th className="text-left px-3 py-2">Obs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} className={r.error ? "bg-destructive/10" : ""}>
                        <td className="px-3 py-1">{r.studentName}</td>
                        <td className="px-3 py-1 text-right">{r.inserted}</td>
                        <td className="px-3 py-1 text-muted-foreground">
                          {r.error ?? (r.inserted === 0 ? "já em dia" : "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {done && (
                <Button variant="outline" onClick={run}>
                  Rodar novamente
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
