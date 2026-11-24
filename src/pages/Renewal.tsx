// src/pages/Renewal.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { BatchRenewalDialog } from '@/components/renewal/BatchRenewalDialog';
import { DecisionDialog } from '@/components/renewal/DecisionDialog';
import { RenewalTable } from '@/components/renewal/RenewalTable';
import { fetchRenewalData, type RenewalData } from '@/lib/renewalData';
import { setRenewalDecision } from '@/lib/renewalApi';
import {
  STATE_LABELS, renewalState, summarizeWindow,
  type DecisionReason, type RenewalContract, type RenewalState,
} from '@/lib/renewal';

const WINDOWS = [30, 60, 90, 180];
const PAGE_SIZE = 30;
const SUMMARY: RenewalState[] = ['renewed', 'will_renew', 'contacted', 'will_not_renew', 'none'];
const canSelect = (s: RenewalState) => s !== 'renewed' && s !== 'will_not_renew';

const Renewal = () => {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [windowDays, setWindowDays] = useState(90);
  const [data, setData] = useState<RenewalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [classFilter, setClassFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState<'all' | RenewalState>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [declining, setDeclining] = useState<RenewalContract | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const preselected = useRef(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!schoolId) return;
    const myId = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const d = await fetchRenewalData(schoolId, windowDays);
      if (myId !== requestId.current) return; // resposta de uma chamada superada
      setData(d);
      setSelected((prev) => {
        const ok = (id: string) => {
          const c = d.contracts.find((x) => x.id === id);
          return !!c && canSelect(renewalState(id, d.decisions, d.renewedIds));
        };
        if (!preselected.current) {
          preselected.current = true;
          return new Set(d.contracts.filter((c) => renewalState(c.id, d.decisions, d.renewedIds) === 'will_renew').map((c) => c.id));
        }
        return new Set([...prev].filter(ok)); // mantém a seleção, poda quem deixou de poder ser renovado
      });
    } catch {
      if (myId === requestId.current) setError(true);
    } finally {
      if (myId === requestId.current) setLoading(false);
    }
  }, [schoolId, windowDays]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [classFilter, stateFilter, search, windowDays]);

  const states = useMemo(() => {
    const m = new Map<string, RenewalState>();
    if (data) for (const c of data.contracts) m.set(c.id, renewalState(c.id, data.decisions, data.renewedIds));
    return m;
  }, [data]);

  const summary = useMemo(
    () => (data ? summarizeWindow(data.contracts, data.decisions, data.renewedIds) : null),
    [data],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.contracts
      .filter((c) => (classFilter === 'all' ? true : classFilter === 'none' ? c.class_id === null : c.class_id === classFilter))
      .filter((c) => (stateFilter === 'all' ? true : states.get(c.id) === stateFilter))
      .filter((c) => !q || c.student_name.toLowerCase().includes(q))
      .map((c) => ({ contract: c, state: states.get(c.id) ?? ('none' as RenewalState) }));
  }, [data, classFilter, stateFilter, search, states]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const selectedContracts = useMemo(
    () => (data ? data.contracts.filter((c) => selected.has(c.id)) : []),
    [data, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = (ids: string[], checked: boolean) =>
    setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => (checked ? n.add(id) : n.delete(id))); return n; });
  const selectAllWilling = () =>
    setSelected(new Set((data?.contracts ?? []).filter((c) => states.get(c.id) === 'will_renew').map((c) => c.id)));

  const changeState = async (c: RenewalContract, s: RenewalState) => {
    if (s === 'will_not_renew') { setDeclining(c); return; }
    try {
      await setRenewalDecision(c.id, s === 'none' ? 'none' : (s as 'contacted' | 'will_renew'));
      setSelected((prev) => { const n = new Set(prev); if (s === 'will_renew') n.add(c.id); else n.delete(c.id); return n; });
      await load();
    } catch (e) {
      toast({ title: 'Erro', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const confirmDecline = async (reason: DecisionReason, note: string) => {
    if (!declining) return;
    setSaving(true);
    try {
      await setRenewalDecision(declining.id, 'will_not_renew', reason, note.trim() || null);
      setSelected((prev) => { const n = new Set(prev); n.delete(declining.id); return n; });
      setDeclining(null);
      await load();
    } catch (e) {
      toast({ title: 'Erro', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rematrícula</h1>
          <p className="text-muted-foreground">Acompanhe a decisão das famílias e renove os contratos em lote</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={selectAllWilling} disabled={!data}>
            Selecionar todos que vão renovar
          </Button>
          <Button onClick={() => setBatchOpen(true)} disabled={selectedContracts.length === 0}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Renovar selecionados ({selectedContracts.length})
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {SUMMARY.map((s) => (
            <Card key={s} data-testid={`summary-${s}`}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{summary[s]}</div>
                <p className="text-sm text-muted-foreground">{STATE_LABELS[s]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="border-b p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar aluno..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
              <SelectTrigger className="w-[170px]" aria-label="Janela"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => <SelectItem key={w} value={String(w)}>Próximos {w} dias</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-[170px]" aria-label="Turma"><SelectValue placeholder="Turma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as turmas</SelectItem>
                <SelectItem value="none">Sem turma</SelectItem>
                {(data?.classes ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as 'all' | RenewalState)}>
              <SelectTrigger className="w-[170px]" aria-label="Estado"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os estados</SelectItem>
                {(Object.keys(STATE_LABELS) as RenewalState[]).map((s) => <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="font-medium">Não foi possível carregar a rematrícula.</p>
              <Button variant="outline" onClick={load}>Tentar de novo</Button>
            </div>
          ) : data && data.contracts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Nenhum contrato termina nesta janela.</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Nenhum contrato com esses filtros.</div>
          ) : (
            <>
              <RenewalTable rows={pageRows} selected={selected} onToggle={toggle} onTogglePage={togglePage} onChangeState={changeState} />
              <div className="flex items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
                <span>{filtered.length} contrato{filtered.length !== 1 ? 's' : ''}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                  <span>Página {page} de {pages}</span>
                  <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DecisionDialog contract={declining} saving={saving} onConfirm={confirmDecline} onCancel={() => setDeclining(null)} />

      {data && schoolId && (
        <BatchRenewalDialog
          open={batchOpen}
          onOpenChange={setBatchOpen}
          sources={selectedContracts}
          classes={data.classes}
          activeByClass={data.activeByClass}
          services={data.services}
          schoolId={schoolId}
          onDone={load}
        />
      )}
    </div>
  );
};

export default Renewal;
