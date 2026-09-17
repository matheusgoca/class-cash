import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/calculations";
import { computeClassCosts } from "@/lib/classCost";
import { toDateStr } from "@/lib/dateUtils";

interface ClassRow {
  id: string;
  name: string;
  level: string;
  studentCount: number;
  revenue: number;       // mensalidades pagas no período
  salaryCost: number;    // salário de professor, dividido entre as turmas dele
  expenseCost: number;   // despesas diretas + rateadas da turma
  cost: number;          // salaryCost + expenseCost
  profit: number;
  margin: number;        // %
}

export function ClassProfitability() {
  const { schoolId } = useSchool();
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (schoolId) fetchData();
  }, [schoolId]);

  const fetchData = async () => {
    try {
      // Custo de salário vem de teachers.salary, que é um valor MENSAL — sem
      // limitar receita/despesa/serviço ao mesmo mês, a comparação mistura
      // unidades (ex: 24 meses de mensalidade paga contra 1 mês de salário),
      // fazendo toda turma parecer cada vez mais lucrativa quanto mais tempo
      // a escola usa o sistema.
      const now = new Date();
      const monthStart = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
      const monthEnd = toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));

      const [
        { data: classes, error: classErr },
        { data: tuitions, error: tErr },
        { data: enrollments, error: eErr },
        { data: expensesData, error: expErr },
        { data: serviceCharges, error: scErr },
      ] = await Promise.all([
        // Classes with embedded teacher salary info
        (supabase as any)
          .from("classes")
          .select(`id, name, level, class_teachers ( teacher_id, weekly_hours, teachers ( salary ) )`)
          .eq("school_id", schoolId),
        // Paid tuitions joined to class via contracts — só o mês corrente,
        // pra bater com o salário (mensal) usado no custo
        (supabase as any)
          .from("tuitions")
          .select("final_amount, amount, contracts(class_id)")
          .eq("school_id", schoolId)
          .eq("status", "paid")
          .gte("paid_date", monthStart)
          .lte("paid_date", monthEnd),
        // Student counts per class, and student→class attribution for service
        // revenue below — enrollments has no school_id, scoped via class_id
        (supabase as any)
          .from("enrollments")
          .select("student_id, class_id"),
        // Paid expenses with allocation method for cost apportionment — só o mês corrente
        (supabase as any)
          .from("expenses")
          .select("amount, class_id, expense_categories(allocation_method)")
          .eq("school_id", schoolId)
          .eq("status", "paid")
          .gte("paid_date", monthStart)
          .lte("paid_date", monthEnd),
        // Paid service charges (alimentação, cursos extras...), attributed via
        // student's enrollment — só o mês corrente
        (supabase as any)
          .from("service_charges")
          .select("amount, student_id")
          .eq("school_id", schoolId)
          .eq("status", "paid")
          .gte("paid_date", monthStart)
          .lte("paid_date", monthEnd),
      ]);

      if (classErr) throw classErr;
      if (tErr) throw tErr;
      if (eErr) throw eErr;
      if (expErr) throw expErr;
      if (scErr) throw scErr;

      const revenueByClass: Record<string, number> = {};
      for (const t of tuitions || []) {
        const classId = t.contracts?.class_id;
        if (!classId) continue;
        const val = Number(t.final_amount ?? t.amount ?? 0);
        revenueByClass[classId] = (revenueByClass[classId] || 0) + val;
      }

      const studentsByClass: Record<string, number> = {};
      const classByStudent: Record<string, string> = {};
      for (const e of enrollments || []) {
        studentsByClass[e.class_id] = (studentsByClass[e.class_id] || 0) + 1;
        classByStudent[e.student_id] = e.class_id;
      }

      for (const sc of serviceCharges || []) {
        const classId = classByStudent[sc.student_id];
        if (!classId) continue;
        revenueByClass[classId] = (revenueByClass[classId] || 0) + Number(sc.amount || 0);
      }

      // One row per class-teacher link, for salary apportionment
      const teacherAssignments = (classes || []).flatMap((cls: any) =>
        (cls.class_teachers || [])
          .filter((ct: any) => ct.teacher_id)
          .map((ct: any) => ({
            classId: cls.id,
            teacherId: ct.teacher_id,
            salary: Number(ct.teachers?.salary || 0),
            weeklyHours: ct.weekly_hours ?? null,
          }))
      );

      const expenseInputs = (expensesData || []).map((e: any) => ({
        amount: Number(e.amount || 0),
        classId: e.class_id ?? null,
        allocationMethod: e.expense_categories?.allocation_method || 'school',
      }));

      const classInputs = (classes || []).map((cls: any) => ({
        id: cls.id,
        studentCount: studentsByClass[cls.id] || 0,
      }));

      const { salaryCost, expenseCost, totalCost } = computeClassCosts(
        classInputs,
        teacherAssignments,
        expenseInputs
      );

      const result: ClassRow[] = (classes || []).map((cls: any) => {
        const revenue = revenueByClass[cls.id] || 0;
        const cost = totalCost[cls.id] || 0;
        const profit = revenue - cost;
        // revenue=0 com custo>0 é prejuízo total (-100%), não "neutro" (0%)
        const margin = revenue > 0 ? (profit / revenue) * 100 : (cost > 0 ? -100 : 0);
        return {
          id: cls.id,
          name: cls.name,
          level: cls.level,
          studentCount: studentsByClass[cls.id] || 0,
          revenue,
          salaryCost: salaryCost[cls.id] || 0,
          expenseCost: expenseCost[cls.id] || 0,
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
            <CardTitle className="text-sm font-medium text-muted-foreground">Receita do Mês (paga)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-success">{formatCurrency(totRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Custo Total (salários + despesas)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-warning">{formatCurrency(totCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${totProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {formatCurrency(totProfit)}
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
                    <TableCell className="text-right">{formatCurrency(row.revenue)}</TableCell>
                    <TableCell className="text-right">
                      <div>{formatCurrency(row.cost)}</div>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(row.salaryCost)} salário + {formatCurrency(row.expenseCost)} despesas
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`flex items-center justify-end gap-1 font-semibold ${positive ? "text-success" : "text-destructive"}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {formatCurrency(row.profit)}
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
