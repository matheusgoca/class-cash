// src/components/renewal/BatchRenewalDialog.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/calculations';
import { buildRenewalPlan, capacityWarnings, classKey, type RenewalClass, type RenewalContract } from '@/lib/renewal';
import { friendlyRenewalError, renewContracts, type RenewResult } from '@/lib/renewalApi';
import type { RenewalService } from '@/lib/renewalData';

export interface BatchRenewalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: RenewalContract[];
  classes: RenewalClass[];
  activeByClass: Record<string, number>;
  services: RenewalService[];
  schoolId: string;
  onDone: () => void;
}

type Stage = 'config' | 'preview' | 'running' | 'done';
const NO_CLASS = 'none';
const NO_FEE = 'none';

export function BatchRenewalDialog({ open, onOpenChange, sources, classes, activeByClass, services, schoolId, onDone }: BatchRenewalDialogProps) {
  const [stage, setStage] = useState<Stage>('config');
  const [pctText, setPctText] = useState('0');
  const [feeId, setFeeId] = useState<string>(NO_FEE);
  const [classMap, setClassMap] = useState<Record<string, string | null>>({});
  const [overrides, setOverrides] = useState<Record<string, { classId?: string | null; monthly?: number }>>({});
  const [result, setResult] = useState<RenewResult | null>(null);

  // Reabre limpo a cada abertura.
  useEffect(() => {
    if (open) { setStage('config'); setPctText('0'); setFeeId(NO_FEE); setClassMap({}); setOverrides({}); setResult(null); }
  }, [open]);

  const pct = Number(pctText.replace(',', '.'));
  const pctValid = pctText.trim() !== '' && Number.isFinite(pct) && pct > -100 && pct <= 200;
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const classNameOf = (id: string | null) => (id ? classes.find((c) => c.id === id)?.name ?? '—' : 'Sem turma');

  // Turmas de origem presentes na seleção (uma linha do mapa por turma).
  const origins = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const s of sources) seen.set(classKey(s.class_id), s.class_id);
    return [...seen.values()];
  }, [sources]);

  const plan = useMemo(
    () => buildRenewalPlan(sources, { pct: pctValid ? pct : 0, classMap, overrides, today }),
    [sources, pct, pctValid, classMap, overrides, today],
  );
  const warnings = useMemo(() => capacityWarnings(plan.rows, classes, activeByClass), [plan.rows, classes, activeByClass]);
  const hasError = plan.rows.some((r) => r.error);

  const running = useRef(false);
  const confirm = async () => {
    if (running.current) return;
    running.current = true;
    setStage('running');
    try {
      setResult(await renewContracts(schoolId, plan.items, feeId === NO_FEE ? null : feeId));
    } catch (e) {
      setResult({ renewed: 0, tuitions: 0, skipped: [], processed: 0, total: plan.items.length, error: friendlyRenewalError(e) });
    } finally {
      running.current = false;
      setStage('done');
    }
  };

  const close = () => {
    onOpenChange(false);
    if (result) onDone();
  };

  const setRowClass = (id: string, v: string) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], classId: v === NO_CLASS ? null : v } }));
  const setRowMonthly = (id: string, v: number | undefined) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], monthly: v ?? 0 } }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && stage !== 'running') close(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Renovar em lote</DialogTitle>
          <DialogDescription>
            {sources.length} contrato{sources.length !== 1 ? 's' : ''} selecionado{sources.length !== 1 ? 's' : ''}.
            O novo contrato começa no dia seguinte ao fim do atual e dura 12 meses.
          </DialogDescription>
        </DialogHeader>

        {stage === 'config' && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="batch-pct">Reajuste (%)</Label>
                <Input id="batch-pct" inputMode="decimal" value={pctText} onChange={(e) => setPctText(e.target.value)} />
                {!pctValid && <p className="text-xs text-destructive">Informe um percentual entre -99,99 e 200.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-fee">Taxa de rematrícula</Label>
                <Select value={feeId} onValueChange={setFeeId}>
                  <SelectTrigger id="batch-fee" aria-label="Taxa de rematrícula"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FEE}>Sem taxa</SelectItem>
                    {services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {formatCurrency(s.price)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Turma de destino</p>
              {origins.map((o) => {
                const key = classKey(o);
                const value = key in classMap ? classMap[key] : o;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-40 text-sm">{classNameOf(o)}</span>
                    <span aria-hidden="true">→</span>
                    <Select value={value ?? NO_CLASS} onValueChange={(v) => setClassMap((m) => ({ ...m, [key]: v === NO_CLASS ? null : v }))}>
                      <SelectTrigger className="w-[220px]" aria-label={`Vai para: ${classNameOf(o)}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CLASS}>Sem turma</SelectItem>
                        {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={() => setStage('preview')} disabled={!pctValid || sources.length === 0}>Ver prévia</Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'preview' && (
          <div className="space-y-4">
            {warnings.length > 0 && (
              <Alert role="alert">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Capacidade das turmas</AlertTitle>
                <AlertDescription>
                  {warnings.map((w) => `${w.className}: ${w.projected} alunos para ${w.max} vagas`).join(' · ')}. Você pode continuar mesmo assim.
                </AlertDescription>
              </Alert>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Turma</TableHead>
                  <TableHead>Valor atual → novo</TableHead>
                  <TableHead>Período novo</TableHead>
                  <TableHead>Mensalidades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.rows.map((r) => (
                  <TableRow key={r.contractId}>
                    <TableCell className="font-medium">{r.studentName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{classNameOf(r.fromClassId)} →</span>
                        <Select value={r.toClassId ?? NO_CLASS} onValueChange={(v) => setRowClass(r.contractId, v)}>
                          <SelectTrigger className="w-[150px]" aria-label={`Turma de destino de ${r.studentName}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CLASS}>Sem turma</SelectItem>
                            {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{formatCurrency(r.currentMonthly)} →</span>
                        <CurrencyInput className="w-[120px]" aria-label={`Novo valor de ${r.studentName}`} value={r.newMonthly} onChange={(v) => setRowMonthly(r.contractId, v)} />
                      </div>
                      {r.error === 'INVALID_AMOUNT' && <p className="mt-1 text-xs text-destructive">Valor inválido: informe um valor maior que zero.</p>}
                      {r.error === 'NO_TUITIONS' && <p className="mt-1 text-xs text-destructive">Nenhuma mensalidade seria gerada.</p>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(parseISO(r.start), 'dd/MM/yyyy')} a {format(parseISO(r.end), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>{r.tuitionCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">
              {plan.totals.contracts} contratos · {plan.totals.tuitions} mensalidades · {formatCurrency(plan.totals.monthlyTotal)} por mês
              {feeId !== NO_FEE ? ' · mais a taxa de rematrícula por contrato' : ''}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStage('config')}>Voltar</Button>
              <Button onClick={confirm} disabled={hasError || plan.items.length === 0}>
                Renovar {plan.items.length} contrato{plan.items.length !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'running' && <p role="status" aria-live="polite" className="py-8 text-center text-sm text-muted-foreground">Renovando contratos… não feche esta janela.</p>}

        {stage === 'done' && result && (
          <div className="space-y-3">
            {result.error ? (
              <p className="font-medium">Renovação interrompida</p>
            ) : (
              <p className="font-medium">
                {result.renewed} contrato{result.renewed !== 1 ? 's' : ''} renovado{result.renewed !== 1 ? 's' : ''} · {result.tuitions} mensalidade{result.tuitions !== 1 ? 's' : ''} criada{result.tuitions !== 1 ? 's' : ''}
              </p>
            )}
            {result.skipped.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {result.skipped.length === 1
                  ? '1 contrato já estava renovado e foi pulado.'
                  : `${result.skipped.length} contratos já estavam renovados e foram pulados.`}
              </p>
            )}
            {result.error && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>O lote parou</AlertTitle>
                <AlertDescription>
                  {result.renewed} contrato{result.renewed !== 1 ? 's' : ''} renovado{result.renewed !== 1 ? 's' : ''} antes do erro ({result.processed} de {result.total} processados), {result.tuitions} mensalidade{result.tuitions !== 1 ? 's' : ''} criada{result.tuitions !== 1 ? 's' : ''}: {result.error}
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter><Button onClick={close}>Fechar</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
