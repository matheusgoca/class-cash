import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { formatCurrency } from "@/lib/calculations";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, LineChart, Line, Legend, ReferenceLine,
} from "recharts";
import { Users } from "lucide-react";

const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#F97316","#06B6D4","#84CC16","#EC4899","#14B8A6","#6366F1","#A78BFA"];

export function DashboardCharts() {
  const { schoolId } = useSchool();
  const [studentDist, setStudentDist]   = useState<any[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (schoolId) fetchChartData();
  }, [schoolId]);

  const fetchChartData = async () => {
    try {
      // Build 6-month window once — used for both queries and bucketing
      const now = new Date();
      const months: { key: string; name: string }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          name: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        });
      }
      const sixMonthsAgo = months[0].key + "-01";

      const [
        { data: classes },
        { data: enrollments },
        { data: tuitions },
        { data: teachers },
        { data: expenses },
      ] = await Promise.all([
        supabase.from("classes").select("id, name, color, max_capacity").eq("school_id", schoolId).order("name"),
        // enrollments has no school_id — scoped implicitly via class_id cross-reference
        (supabase as any).from("enrollments").select("class_id"),
        supabase.from("tuitions").select("final_amount, amount, paid_date")
          .eq("school_id", schoolId).eq("status", "paid")
          .not("paid_date", "is", null).gte("paid_date", sixMonthsAgo),
        supabase.from("teachers").select("salary").eq("school_id", schoolId).eq("status", "active"),
        (supabase as any).from("expenses").select("amount, paid_date")
          .eq("school_id", schoolId).eq("status", "paid")
          .not("paid_date", "is", null).gte("paid_date", sixMonthsAgo),
      ]);

      // ── 1. Student distribution per class ──────────────────
      const countByClass: Record<string, number> = {};
      for (const e of enrollments || []) {
        countByClass[e.class_id] = (countByClass[e.class_id] || 0) + 1;
      }
      // Include all classes (even empty ones) so the admin sees gaps
      const dist = (classes || []).map((c: any, i: number) => ({
        name: c.name,
        alunos: countByClass[c.id] || 0,
        capacidade: c.max_capacity || 0,
        color: c.color || COLORS[i % COLORS.length],
      }));
      setStudentDist(dist);

      // ── 2. Monthly revenue + cost trend (last 6 months) ────
      const revenueByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m.key, 0]));
      for (const t of tuitions || []) {
        const d = new Date(t.paid_date!);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (key in revenueByMonth) revenueByMonth[key] += Number(t.final_amount ?? t.amount ?? 0);
      }

      // Salary has no month-by-month history today — same value repeated across months
      const totalSalary = (teachers || []).reduce((s: number, t: any) => s + Number(t.salary || 0), 0);

      const expensesByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m.key, 0]));
      for (const e of expenses || []) {
        const d = new Date(e.paid_date!);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (key in expensesByMonth) expensesByMonth[key] += Number(e.amount ?? 0);
      }

      const trend = months.map(m => {
        const custo = totalSalary + expensesByMonth[m.key];
        return {
          name: m.name,
          receita: revenueByMonth[m.key],
          custo,
          resultado: revenueByMonth[m.key] - custo,
        };
      });
      setMonthlyTrend(trend);
    } catch (err) {
      console.error("DashboardCharts error:", err);
    } finally {
      setLoading(false);
    }
  };

  const totalStudents = studentDist.reduce((s, c) => s + c.alunos, 0);
  const totalCapacity = studentDist.reduce((s, c) => s + c.capacidade, 0);

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3].map(i => (
          <Card key={i} className="animate-pulse">
            <CardHeader><div className="h-6 bg-muted rounded w-48" /></CardHeader>
            <CardContent><div className="h-64 bg-muted rounded" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Chart height scales with number of classes so bars don't get squished
  const distChartHeight = Math.max(200, studentDist.length * 52);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Distribuição de alunos por turma */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>Alunos por Turma</CardTitle>
            {totalCapacity > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {totalStudents}/{totalCapacity}
                <span className="text-xs">({Math.round(totalStudents / totalCapacity * 100)}% ocupado)</span>
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {studentDist.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <Users className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhuma turma cadastrada</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={distChartHeight}>
              <BarChart
                data={studentDist}
                layout="vertical"
                margin={{ left: 8, right: 32, top: 4, bottom: 4 }}
                barSize={18}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  formatter={(value: any, name: string) => [
                    `${value} alunos`,
                    name === "alunos" ? "Matriculados" : "Capacidade",
                  ]}
                />
                {/* Capacity shown as a faint background bar */}
                <Bar dataKey="capacidade" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} opacity={0.4} />
                <Bar dataKey="alunos" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "hsl(var(--muted-foreground))" }}>
                  {studentDist.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Receita vs Custo — últimos 6 meses */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Receita vs Custo (Últimos 6 Meses)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyTrend} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => formatCurrency(v)} width={90} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any, name: string) => [formatCurrency(Number(v)), name === "receita" ? "Receita" : "Custo"]} />
              <Legend formatter={v => v === "receita" ? "Receita" : "Custo (salários + despesas)"} />
              <Bar dataKey="receita" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="custo"   fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Evolução do resultado líquido */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Evolução do Resultado Líquido (Últimos 6 Meses)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => formatCurrency(v)} width={90} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => [formatCurrency(Number(v)), "Resultado (receita − custo)"]} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="resultado"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={{ fill: "#3B82F6", r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

    </div>
  );
}
