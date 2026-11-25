import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Info, SlidersHorizontal } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterAdmin } from '@/contexts/MasterAdminContext';
import { useToast } from '@/hooks/use-toast';
import { useRole } from '@/hooks/use-role';
import { isMasterViewingOtherSchool } from '@/lib/accountMenu';
import { listNotifications, markNotificationsRead, mergeById } from '@/lib/notifications';
import {
  CATEGORY_LABELS, describeNotification, formatRelativeTime, groupByDay,
  type NotificationCategory, type NotificationItem,
} from '@/lib/notificationText';

const PAGE = 20;
type Tab = 'all' | 'unread' | NotificationCategory;

const query = (t: Tab, offset: number) =>
  listNotifications({
    offset, limit: PAGE,
    unreadOnly: t === 'unread',
    category: t === 'all' || t === 'unread' ? null : t,
  });

const Notifications = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const { isMasterAdmin, viewingSchoolId } = useMasterAdmin();
  const { role } = useRole();
  // D4: os RPCs listam os avisos da escola de CASA do usuário (get_user_school_id()). Com o master
  // visualizando outra escola, esta tela não carrega nada (mesmo guard das preferências).
  // Sem profile, isMasterAdmin e homeSchoolId ainda não são confiáveis: não decide nada antes disso.
  const profileReady = profile !== null;
  const otherSchool = profileReady && isMasterViewingOtherSchool({
    role, isMasterAdmin, viewingSchoolId, homeSchoolId: profile?.school_id ?? null,
  });
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [counts, setCounts] = useState({ total: 0, unread: 0, filtered: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (t: Tab) => {
    setLoading(true);
    setError(false);
    try {
      const p = await query(t, 0);
      setItems(p.items);
      setCounts({ total: p.total, unread: p.unread, filtered: p.filteredTotal });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profileReady || otherSchool) return;
    load(tab);
  }, [tab, load, profileReady, otherSchool]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const p = await query(tab, items.length);
      setItems((prev) => mergeById(prev, p.items));
      setCounts({ total: p.total, unread: p.unread, filtered: p.filteredTotal });
    } catch {
      toast({ title: 'Não foi possível carregar mais avisos.', variant: 'destructive' });
    } finally {
      setLoadingMore(false);
    }
  };

  const markAll = async () => {
    try {
      await markNotificationsRead(null);
      await load(tab);
    } catch {
      toast({ title: 'Não foi possível marcar como lidas.', variant: 'destructive' });
    }
  };

  const openItem = async (n: NotificationItem, path: string) => {
    if (!n.read_at) { try { await markNotificationsRead([n.id]); } catch { /* segue */ } }
    navigate(path);
  };

  if (otherSchool) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notificações</h1>
          <p className="text-muted-foreground">Lembretes de cobrança, renegociação, despesas e rematrícula</p>
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Você está visualizando outra escola. Suas notificações são as da sua própria escola: volte ao painel master e acesse-a para vê-las.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const now = new Date();
  const groups = groupByDay(items, now);
  const filtered = tab !== 'all';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notificações</h1>
          <p className="text-muted-foreground">Lembretes de cobrança, renegociação, despesas e rematrícula</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {counts.unread > 0 && (
            <Button variant="outline" onClick={markAll}>
              <CheckCheck className="mr-2 h-4 w-4" />
              Marcar todas como lidas
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/notificacoes/preferencias">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Preferências
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="all">Todas · {counts.total}</TabsTrigger>
          <TabsTrigger value="unread">Não lidas · {counts.unread}</TabsTrigger>
          {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((c) => (
            <TabsTrigger key={c} value={c}>{CATEGORY_LABELS[c]}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Carregando…</CardContent></Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="font-medium">Não foi possível carregar as notificações.</p>
            <Button variant="outline" onClick={() => load(tab)}>Tentar de novo</Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Bell className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="font-medium">
              {filtered && counts.total > 0 ? 'Nenhuma notificação nesta categoria.' : 'Nenhuma notificação ainda.'}
            </p>
            {!(filtered && counts.total > 0) && (
              <p className="max-w-md text-sm text-muted-foreground">
                Os avisos aparecem aqui quando houver mensalidades, despesas ou contratos no prazo das suas preferências.
              </p>
            )}
            <Button variant="link" asChild>
              <Link to="/notificacoes/preferencias">Ajustar preferências</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{g.label}</h2>
              <Card>
                <ul className="divide-y">
                  {g.items.map((n) => {
                    const v = describeNotification(n);
                    const unread = !n.read_at;
                    return (
                      <li key={n.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex gap-3">
                          <span
                            aria-hidden="true"
                            className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`}
                          />
                          <div className="space-y-1">
                            <p className={unread ? 'font-semibold' : 'font-normal text-muted-foreground'}>
                              {unread && <span className="sr-only">Não lida: </span>}
                              {v.title}
                            </p>
                            <p className="text-sm text-muted-foreground">{v.subtitle}</p>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{v.categoryLabel}</Badge>
                              <span className="text-xs text-muted-foreground">{formatRelativeTime(n.created_at, now)}</span>
                            </div>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => openItem(n, v.actionPath)}>
                          {v.actionLabel}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}

          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Mostrando {items.length} de {counts.filtered} notificações
            </p>
            {items.length < counts.filtered && (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Notifications;
