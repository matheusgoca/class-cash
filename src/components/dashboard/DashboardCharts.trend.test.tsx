// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

let trendProp: any[] | null = null;
vi.mock('recharts', () => {
  const Pass = ({ children }: any) => <div>{children}</div>;
  return {
    ResponsiveContainer: Pass, BarChart: ({ data, children }: any) => { if (data && data[0] && 'receita' in data[0]) trendProp = data; return <div>{children}</div>; },
    LineChart: ({ data, children }: any) => { if (data && data[0] && 'receita' in data[0]) trendProp = data; return <div>{children}</div>; },
    ComposedChart: ({ data, children }: any) => { if (data && data[0] && 'receita' in data[0]) trendProp = data; return <div>{children}</div>; },
    AreaChart: ({ data, children }: any) => { if (data && data[0] && 'receita' in data[0]) trendProp = data; return <div>{children}</div>; },
    Bar: Pass, Line: Pass, Area: Pass, XAxis: Pass, YAxis: Pass, CartesianGrid: Pass, Tooltip: Pass, Legend: Pass, Cell: Pass, PieChart: Pass, Pie: Pass, ReferenceLine: Pass,
  };
});

const now = new Date();
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const dia = `${ym(now)}-02`;
const tables: Record<string, unknown[]> = {
  classes: [], enrollments: [],
  tuitions: [{ amount: 1000, final_amount: 985, status: 'paid', due_date: dia, paid_date: dia }],
  service_charges: [{ amount: 300, status: 'paid', due_date: dia, paid_date: dia }],
  expenses: [{ amount: 200, status: 'paid', due_date: dia, paid_date: dia }],
};
vi.mock('@/integrations/supabase/client', () => {
  const chain = (rows: unknown[]) => { const c: any = new Proxy({}, { get: (_t, p: string) => p === 'then' ? (res: (v: unknown) => unknown) => res({ data: rows, error: null }) : () => c }); return c; };
  return { supabase: { from: (t: string) => chain(tables[t] ?? []), rpc: () => Promise.resolve({ data: 1000, error: null }) } };
});
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));

import { DashboardCharts } from './DashboardCharts';

beforeEach(() => { trendProp = null; });
afterEach(() => cleanup());

describe('DashboardCharts: gráfico de 6 meses inclui serviços pagos (bloco F2)', () => {
  it('a receita do mês atual = mensalidade paga (985) + serviço pago (300); custo = salário (1000) + despesa (200)', async () => {
    render(<DashboardCharts />);
    await waitFor(() => expect(trendProp).not.toBeNull());
    const last = trendProp![trendProp!.length - 1];
    expect(last.receita).toBe(1285);
    expect(last.custo).toBe(1200);
    expect(last.resultado).toBe(85);
  });
});
