import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAuditLogPage,
  fetchHiddenGeneratedSummary,
  resolveAuditLogNames,
  type AuditLogFilters,
  type HiddenSummaryRow,
} from "@/lib/auditLog";
import { formatAuditEntry, type AuditLogRow, type FormattedAuditEntry } from "@/lib/auditFormat";

export interface AuditTimelineItem {
  log: AuditLogRow;
  entry: FormattedAuditEntry;
}

interface UseAuditHistoryOptions {
  canSeeSalary: boolean;
  viewerIsMaster?: boolean;
  /** Só pra owner/admin: soma e mostra quantos eventos gerados/importados estão ocultos. */
  showHiddenSummary?: boolean;
}

export function useAuditHistory(filters: AuditLogFilters, options: UseAuditHistoryOptions) {
  const { canSeeSalary, viewerIsMaster = false, showHiddenSummary = false } = options;

  const [items, setItems] = useState<AuditTimelineItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenSummary, setHiddenSummary] = useState<HiddenSummaryRow[]>([]);

  // Evita aplicar a resposta de uma busca antiga se os filtros mudaram no meio do caminho.
  const requestId = useRef(0);

  const filtersKey = JSON.stringify(filters);

  const loadPage = useCallback(
    async (afterCursor: string | null, append: boolean) => {
      const myRequestId = ++requestId.current;
      append ? setLoadingMore(true) : setLoading(true);
      setError(null);
      try {
        const page = await fetchAuditLogPage(filters, afterCursor);
        const { names, actorNames } = await resolveAuditLogNames(page.rows);
        if (myRequestId !== requestId.current) return; // filtros mudaram enquanto buscava

        const newItems: AuditTimelineItem[] = page.rows.map((log) => ({
          log,
          entry: formatAuditEntry(log, {
            actorName: log.actor_user_id ? actorNames[log.actor_user_id] ?? null : null,
            names,
            canSeeSalary,
            viewerIsMaster,
          }),
        }));

        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
      } catch (err: any) {
        if (myRequestId === requestId.current) {
          setError(err?.message ?? "Erro ao carregar o histórico");
        }
      } finally {
        if (myRequestId === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtersKey, canSeeSalary, viewerIsMaster],
  );

  useEffect(() => {
    loadPage(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, canSeeSalary, viewerIsMaster]);

  useEffect(() => {
    if (!showHiddenSummary || !filters.schoolId || filters.includeGeneratedImport) {
      setHiddenSummary([]);
      return;
    }
    fetchHiddenGeneratedSummary(filters.schoolId, filters.dateFrom, filters.dateTo)
      .then(setHiddenSummary)
      .catch(() => setHiddenSummary([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, showHiddenSummary]);

  const loadMore = () => {
    if (cursor && !loadingMore) loadPage(cursor, true);
  };

  return { items, loading, loadingMore, hasMore, loadMore, error, hiddenSummary };
}
