// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const db = vi.hoisted(() => ({
  result: { data: [] as unknown[], error: null as unknown },
  eqCalls: [] as Array<[string, unknown]>,
  fromCalls: [] as string[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      db.fromCalls.push(table);
      return {
        select: () => ({
          eq: (c: string, v: unknown) => {
            db.eqCalls.push([c, v]);
            return {
              eq: (c2: string, v2: unknown) => {
                db.eqCalls.push([c2, v2]);
                return Promise.resolve(db.result);
              },
            };
          },
        }),
      };
    },
  },
}));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));

import { StudentTuitionInfo } from './StudentTuitionInfo';

const classes = [
  { id: 'c1', monthly_fee: 650 },
  { id: 'c2', monthly_fee: '800.00' },
  { id: 'c3', monthly_fee: null },
];
const contrato = (o: Record<string, unknown> = {}) => ({
  id: 'k1', student_id: 's1', status: 'active', start_date: '2026-03-01', end_date: '2027-02-28',
  final_amount: 540, discount: 10, ...o,
});
const renderInfo = (p: Partial<React.ComponentProps<typeof StudentTuitionInfo>> = {}) =>
  render(<MemoryRouter><StudentTuitionInfo studentId="s1" classId="c1" classes={classes} {...p} /></MemoryRouter>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0));
  db.result = { data: [], error: null };
  db.eqCalls = [];
  db.fromCalls = [];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('StudentTuitionInfo', () => {
  it('com contrato vigente: "Valor do contrato", valor com desconto, vigência e link; sem "Referência da turma"', async () => {
    db.result = { data: [contrato()], error: null };
    renderInfo();
    expect(await screen.findByText('Valor do contrato')).toBeTruthy();
    expect(screen.getByText(/R\$\s*540,00/)).toBeTruthy();
    expect(screen.getByText(/10% de desconto/)).toBeTruthy();
    expect(screen.getByText(/01\/03\/2026 a 28\/02\/2027/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ver contrato/ }).getAttribute('href')).toBe('/contratos');
    expect(screen.queryByText(/Referência da turma/)).toBeNull();
  });

  it('sem contrato e turma com mensalidade: "Referência da turma (meio período)" e a frase; sem "Valor do contrato"', async () => {
    renderInfo();
    expect(await screen.findByText('Referência da turma (meio período)')).toBeTruthy();
    expect(screen.getByText(/R\$\s*650,00/)).toBeTruthy();
    expect(screen.getByText(/Sem contrato ativo\. O valor definitivo é definido ao criar o contrato\./)).toBeTruthy();
    expect(screen.queryByText('Valor do contrato')).toBeNull();
    expect(screen.queryByRole('link', { name: /Ver contrato/ })).toBeNull();
  });

  it('trocar a turma no formulário muda a referência na hora', async () => {
    const { rerender } = renderInfo({ classId: 'c1' });
    expect(await screen.findByText(/R\$\s*650,00/)).toBeTruthy();
    rerender(<MemoryRouter><StudentTuitionInfo studentId="s1" classId="c2" classes={classes} /></MemoryRouter>);
    expect(await screen.findByText(/R\$\s*800,00/)).toBeTruthy();
    expect(screen.queryByText(/R\$\s*650,00/)).toBeNull();
  });

  it('sem turma ou turma sem mensalidade: "—" com o mesmo rótulo de referência', async () => {
    const { rerender } = renderInfo({ classId: null });
    expect(await screen.findByText('Referência da turma (meio período)')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    rerender(<MemoryRouter><StudentTuitionInfo studentId="s1" classId="c3" classes={classes} /></MemoryRouter>);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('aluno novo (sem id): não consulta contratos e mostra a referência da turma escolhida', async () => {
    renderInfo({ studentId: undefined });
    expect(await screen.findByText(/R\$\s*650,00/)).toBeTruthy();
    expect(db.fromCalls).toEqual([]);
  });

  it('a consulta de contratos filtra por school_id e por student_id', async () => {
    db.result = { data: [contrato()], error: null };
    renderInfo();
    await screen.findByText('Valor do contrato');
    expect(db.fromCalls).toEqual(['contracts']);
    expect(db.eqCalls).toContainEqual(['school_id', 'escola-1']);
    expect(db.eqCalls).toContainEqual(['student_id', 's1']);
  });

  it('o contrato vence a turma: com contrato ativo o preço da turma não aparece', async () => {
    db.result = { data: [contrato({ final_amount: 300, discount: 0 })], error: null };
    renderInfo({ classId: 'c2' });
    expect(await screen.findByText(/R\$\s*300,00/)).toBeTruthy();
    expect(screen.queryByText(/R\$\s*800,00/)).toBeNull();
    expect(screen.queryByText(/de desconto/)).toBeNull();
  });

  it('contrato cancelado não conta: volta para a referência da turma', async () => {
    db.result = { data: [contrato({ status: 'cancelled' })], error: null };
    renderInfo();
    expect(await screen.findByText('Referência da turma (meio período)')).toBeTruthy();
  });

  it('erro ao carregar contratos: não quebra, mostra a referência e o aviso', async () => {
    db.result = { data: [], error: { message: 'boom' } };
    renderInfo();
    await waitFor(() => expect(screen.getByText('Referência da turma (meio período)')).toBeTruthy());
    expect(screen.getByText(/Não foi possível verificar o contrato/)).toBeTruthy();
  });
});
