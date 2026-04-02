import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

export function DashboardCharts() {
  const { schoolId } = useSchool();
  const [revenueData, setRevenueData] = useState([]);
  const [studentDistribution, setStudentDistribution] = useState([]);
  const [monthlyTrend, setMonthlyTrend] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (schoolId) fetchChartData();
  }, [schoolId]);

  const fetchChartData = async () => {
    try {
      // Fetch classes with student counts and revenue
      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select(`id, name, tuition_per_student, color`)
        .eq('school_id', schoolId);

      if (classError) throw classError;

      // Fetch students per class
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('class_id, final_tuition_value, status, created_at')
        .eq('school_id', schoolId)
        .eq('status', 'active');

      if (studentsError) throw studentsError;

      // Fetch tuition payments for monthly trend
      const { data: tuitionsData, error: tuitionsError } = await supabase
        .from('tuitions')
        .select('amount, paid_date, status')
        .eq('school_id', schoolId)
        .eq('status', 'paid')
        .not('paid_date', 'is', null);

      if (tuitionsError) throw tuitionsError;

      // Calculate student distribution and revenue by class
      const classStats = classData.map(cls => {
        const classStudents = studentsData.filter(s => s.class_id === cls.id);
        const studentCount = classStudents.length;
        const revenue = classStudents.reduce((sum, s) => sum + (Number(s.final_tuition_value) || 0), 0);
        
        return {
          name: cls.name,
          students: studentCount,
          revenue: revenue,
          color: cls.color,
        };
      }).filter(cls => cls.students > 0);

      setStudentDistribution(classStats);

      // Prepare revenue data for bar chart
      const revenueChartData = classStats.map(cls => ({
        name: cls.name,
        receita: cls.revenue,
      }));
      setRevenueData(revenueChartData);

      // Calculate monthly revenue trend (last 6 months)
      const monthlyRevenue = {};
      const last6Months = [];
      const now = new Date();
      
      for (let i = 5; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthName = date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
        last6Months.push({ key: monthKey, name: monthName });
        monthlyRevenue[monthKey] = 0;
      }

      tuitionsData.forEach(tuition => {
        if (tuition.paid_date) {
          const date = new Date(tuition.paid_date);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (monthlyRevenue.hasOwnProperty(monthKey)) {
            monthlyRevenue[monthKey] += Number(tuition.amount);
          }
        }
      });

      const trendData = last6Months.map(month => ({
        name: month.name,
        receita: monthlyRevenue[month.key],
      }));

      setMonthlyTrend(trendData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching chart data:', error);
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#F97316', '#06B6D4', '#84CC16'];

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-6 bg-muted rounded w-48" />
            </CardHeader>
            <CardContent>
              <div className="h-64 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Revenue by Class */}
      <Card>
        <CardHeader>
          <CardTitle>Receita por Turma</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(value) => formatCurrency(value)} />
              <Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Receita']} />
              <Bar dataKey="receita" fill="#3B82F6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Student Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Distribuição de Alunos por Turma</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={studentDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="students"
              >
                {studentDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly Revenue Trend */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Evolução da Receita (Últimos 6 Meses)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(value) => formatCurrency(value)} />
              <Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Receita']} />
              <Line 
                type="monotone" 
                dataKey="receita" 
                stroke="#3B82F6" 
                strokeWidth={2}
                dot={{ fill: '#3B82F6' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}