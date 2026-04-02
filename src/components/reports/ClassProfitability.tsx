import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ClassRow {
  id: string;
  name: string;
  level: string;
  studentCount: number;
  revenue: number;       // mensalidades pagas no período
  cost: number;          // soma dos salários dos professores da turma
  profit: number;
  margin: number;        // %
}

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export function ClassProfitability() {
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // 1. Classes with their teachers (via class_teachers)
      const { data: classes, error: classErr } = await supabase
        .from("classes")
        .select("id, name, level");
      if (classErr) throw classErr;

      // 2. class_teachers + teacher salaries
      const { data: ct, error: ctErr } = await (supabase as any)
        .from("class_teachers")
        .select("class_id, teachers(salary)");
      if (ctErr) throw ctErr;

      // 3. tuitions paid — join via contracts to get class_id
      const { data: tuitions, error: tErr } = await (supabase as any)
        .from("tuitions")
        .select("final_amount, amount, contract_id, contracts(class_id)")
        .eq("status", "paid");
      if (tErr) throw tErr;

      // 4. student count per class (from enrollments)
      const { data: enrollments, error: eErr } = await (supabase as any)
        .from("enrollments")
        .select("class_id");
      if (eErr) throw eErr;

      // Build maps
      const costByClass: Record<string, number> = {};
      for (const row of ct || []) {
        const salary = Number(row.teachers?.salary || 0);
        costByClass[row.class_id] = (costByClass[row.class_id] || 0) + salary;
      }

      const revenueByClass: Record<string, number> = {};
      for (const t of tuitions || []) {
        const classId = t.contracts?.class_id;
        if (!classId) continue;
        const val = Number(t.final_amount ?? t.amount ?? 0);
        revenueByClass[classId] = (revenueByClass[classId] || 0) + val;
      }

      const studentsByClass: Record<string, number> = {};
      for (const e of enrollments || []) {
        studentsByClass[e.class_id] = (studentsByClass[e.class_id] || 0) + 1;
      }

      const result: ClassRow[] = (classes || []).map((cls) => {
        const revenue = revenueByClass[cls.id] || 0;
        const cost = costByClass[cls.id] || 0;
        const profit = revenue - cost;
        const margin = cost > 0 ? (profit / cost) * 100 : revenue > 0 ? 100 : 0;
        return {
          id: cls.id,
          name: cls.name,
          level: cls.level,
          studentCount: studentsByClass[cls.id] || 0,
          revenue,
          cost,
          profit,
          margin,
        };
      });

      result.sort((a, b) => b.profit - a.profit);
      setRows(result);
    } catch (err) {
      console.error("ClassProfitability error:", err);
    } finally {
      setLoading(false);
    }
  };

  const totRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totCost    = rows.reduce((s, r) => s + r.cost, 0);
  const totProfit  = totRevenue - totCost;
  const maxProfit  = Math.max(...rows.map(r => Math.abs(r.profit)), 1);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Receita Total (paga)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-success">{fmt(totRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Custo Total (salários)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-warning">{fmt(totCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${totProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {fmt(totProfit)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Rentabilidade por Turma</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turma</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead className="text-right">Alunos</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
                <TableHead className="w-40">Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const positive = row.profit >= 0;
                const Icon = row.profit > 0 ? TrendingUp : row.profit < 0 ? TrendingDown : Minus;
                const progressVal = Math.min((Math.abs(row.profit) / maxProfit) * 100, 100);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{row.level}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{row.studentCount}</TableCell>
                    <TableCell className="text-right">{fmt(row.revenue)}</TableCell>
                    <TableCell className="text-right">{fmt(row.cost)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`flex items-center justify-end gap-1 font-semibold ${positive ? "text-success" : "text-destructive"}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {fmt(row.profit)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Progress
                          value={progressVal}
                          className={`h-2 ${positive ? "[&>div]:bg-green-500" : "[&>div]:bg-red-500"}`}
                        />
                        <p className={`text-xs ${positive ? "text-success" : "text-destructive"}`}>
                          {row.margin.toFixed(1)}%
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
