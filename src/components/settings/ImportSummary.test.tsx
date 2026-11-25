// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { IgnoredRowsAlert, ImportResultSummary } from './ImportSummary';
import type { ImportRowError } from '@/lib/import/types';

const err = (row: number, message: string, field = 'valor_mensalidade'): ImportRowError => ({ row, field, message });

afterEach(() => cleanup());

describe('IgnoredRowsAlert (prévia)', () => {
  it('destaca a CONTAGEM de linhas ignoradas e o motivo de cada uma', () => {
    render(
      <IgnoredRowsAlert
        validCount={5}
        errors={[err(3, 'A turma "5º A" tem dois valores. Informe "valor_mensalidade".'), err(7, 'Aluno "Zé" não encontrado.', 'aluno')]}
      />,
    );
    expect(screen.getByRole('heading', { name: /2 linhas ignoradas/ }) ?? screen.getByText(/2 linhas ignoradas/)).toBeTruthy();
    expect(screen.getByText(/Linha 3 \(valor_mensalidade\):/)).toBeTruthy();
    expect(screen.getByText(/tem dois valores/)).toBeTruthy();
    expect(screen.getByText(/Linha 7 \(aluno\):/)).toBeTruthy();
    expect(screen.getByText(/não encontrado/)).toBeTruthy();
  });

  it('diz que elas NÃO serão importadas e que as válidas seguem (com a contagem)', () => {
    render(<IgnoredRowsAlert validCount={5} errors={[err(3, 'x'), err(4, 'y')]} />);
    expect(screen.getByText(/Elas não serão importadas/i)).toBeTruthy();
    expect(screen.getByText(/as outras 5 linhas válidas seguem/i)).toBeTruthy();
  });

  it('singular: "1 linha ignorada" e "a outra linha válida"', () => {
    render(<IgnoredRowsAlert validCount={1} errors={[err(2, 'x')]} />);
    expect(screen.getByText(/1 linha ignorada/)).toBeTruthy();
    expect(screen.getByText(/Ela não será importada/)).toBeTruthy();
    expect(screen.getByText(/a outra linha válida segue/i)).toBeTruthy();
  });

  it('sem nenhuma válida: avisa que nada será importado', () => {
    render(<IgnoredRowsAlert validCount={0} errors={[err(2, 'x'), err(3, 'y')]} />);
    expect(screen.getByText(/nenhuma linha válida/i)).toBeTruthy();
  });

  it('sem erros: não renderiza nada', () => {
    const { container } = render(<IgnoredRowsAlert validCount={3} errors={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('ImportResultSummary (resultado final)', () => {
  it('repete o total importado e o total ignorado', () => {
    render(<ImportResultSummary imported={5} failed={0} ignored={[err(3, 'turma com dois valores'), err(7, 'aluno não encontrado', 'aluno')]} />);
    expect(screen.getByText('Importados: 5')).toBeTruthy();
    expect(screen.getByText('Ignorados: 2')).toBeTruthy();
    expect(screen.queryByText(/Falharam/)).toBeNull();
  });

  it('repete o motivo de cada linha ignorada', () => {
    render(<ImportResultSummary imported={5} failed={0} ignored={[err(3, 'turma com dois valores')]} />);
    expect(screen.getByText(/Linha 3 \(valor_mensalidade\):/)).toBeTruthy();
    expect(screen.getByText(/turma com dois valores/)).toBeTruthy();
  });

  it('mostra as falhas de gravação separadas das ignoradas', () => {
    render(<ImportResultSummary imported={4} failed={1} ignored={[]} />);
    expect(screen.getByText('Importados: 4')).toBeTruthy();
    expect(screen.getByText('Ignorados: 0')).toBeTruthy();
    expect(screen.getByText('Falharam ao gravar: 1')).toBeTruthy();
  });

  it('zero ignorados continua aparecendo (o total é sempre repetido)', () => {
    render(<ImportResultSummary imported={3} failed={0} ignored={[]} />);
    expect(screen.getByText('Ignorados: 0')).toBeTruthy();
  });
});
