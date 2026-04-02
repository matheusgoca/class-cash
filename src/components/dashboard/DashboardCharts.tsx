import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#F97316","#06B6D4","#84CC16","#EC4899","#14B8A6","#6366F1","#A78BFA"];

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export function DashboardCharts() {
  const [studentDist, setStudentDist]   = useState<any[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => { fetchChartData(); }, []);

  const fetchChartData = async () => {
    try {
      // ── 1. Student distribution per class ──────────────────
      const { data: classes } = await supabase.from("classes").select("id, name, color");
      const { data: enrollments } = await (supabase as any).from("enrollments").select("class_id");

      const countByClass: Record<string, number> = {};
      for (const e of enrollments || []) {
        countByClass[e.class_id] = (countByClass[e.class_id] || 0) + 1;
      }

      const dist = (classes || [])
        .map((c: any, i: number) => ({
          name: c.name,
          value: countByClass[c.id] || 0,
          color: c.color || COLORS[i % COLORS.length],
        }))
        .filter((c: any) => c.value > 0);

      setStudentDist(dist);

      // ── 2. Monthly revenue + cost trend (last 6 months) ────
      const now = new Date();
      const months: { key: string; name: string }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          name: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        });
      }

      // Paid tuitions (use final_amount when available)
      const { data: tuitions } = await (supabase as any)
        .from("tuitions")
        .select("final_amount, amount, paid_date")
        .eq("status", "paid")
        .not("paid_date", "is", null);

      const revenueByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m.key, 0]));
      for (const t of tuitions || []) {
        const key = t.paid_date?.slice(0, 7);
        if (key && key in revenueByMonth) {
          revenueByMonth[key] += Number(t.final_amount ?? t.amount ?? 0);
        }
      }

      // Monthly teacher salary cost (static — same every month)
      const { data: teachers } = await (supabase as any)
        .from("teachers")
        .select("salary")
        .eq("status", "active");

      const totalSalary = (teachers || []).reduce((s: number, t: any) => s + Number(t.salary || 0), 0);

      const trend = months.map(m => ({
        name: m.name,
        receita: revenueByMonth[m.key],
        custo: totalSalary,
      }));

      setMonthlyTrend(trend);
    } catch (err) {
      console.error("DashboardCharts error:", err);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Distribuição de alunos por turma */}
      <Card>
        <CardHeader>
          <CardTitle>Distribuição de Alunos por Turma</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={studentDist}
                cx="50%"
                cy="50%"
                outerRadius={90}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
                labelLine={false}
              >
                {studentDist.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v: any) => [`${v} alunos`]} />
            </PieChart>
          </ResponsiveContainer>
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
              <XAxis dataKey="name" />
              <YAxis tickFormatter={v => fmt(v)} width={90} />
              <Tooltip formatter={(v: any, name: string) => [fmt(Number(v)), name === "receita" ? "Receita" : "Custo"]} />
              <Legend formatter={v => v === "receita" ? "Receita" : "Custo (salários)"} />
              <Bar dataKey="receita" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="custo"   fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Evolução da receita */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Evolução da Receita Recebida (Últimos 6 Meses)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={v => fmt(v)} width={90} />
              <Tooltip formatter={(v: any) => [fmt(Number(v)), "Receita"]} />
              <Line
                type="monotone"
                dataKey="receita"
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
