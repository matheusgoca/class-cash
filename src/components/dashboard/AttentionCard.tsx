import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useShowNotifications } from '@/hooks/use-show-notifications';
import { listNotifications, markNotificationsRead } from '@/lib/notifications';
import { describeNotification, type NotificationItem } from '@/lib/notificationText';

const pad = (n: number) => String(n).padStart(2, '0');

export function AttentionCard() {
  const visible = useShowNotifications();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    listNotifications({ offset: 0, limit: 20 })
      .then((p) => {
        if (cancelled) return;
        // "Hoje" = reference_date mais recente (fuso salvo do usuário no servidor, G1).
        const latest = p.items[0]?.reference_date;
        setItems(latest ? p.items.filter((n) => n.reference_date === latest) : []);
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [visible]);

  if (!visible || items === null) return null;

  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // Se o aviso mais recente não é de hoje (geração ainda não rodou), não finge que é.
  const shown = items[0]?.reference_date === todayLocal ? items : [];

  const go = async (n: NotificationItem, path: string) => {
    if (!n.read_at) { try { await markNotificationsRead([n.id]); } catch { /* segue */ } }
    navigate(path);
  };

  const generatedAt = shown.length
    ? new Date(shown.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at)
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Precisa da sua atenção hoje</CardTitle>
        {shown.length > 0 && <Badge variant="secondary">{shown.length} {shown.length === 1 ? 'item' : 'itens'}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada pendente para hoje.</p>
        ) : (
          <>
            <ul className="space-y-3">
              {shown.map((n, i) => {
                const v = describeNotification(n);
                return (
                  <li key={n.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{v.title}</p>
                      <p className="text-sm text-muted-foreground">{v.subtitle}</p>
                    </div>
                    <Button size="sm" variant={i === 0 ? 'default' : 'outline'} onClick={() => go(n, v.actionPath)}>
                      {v.actionLabel}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {generatedAt && (
              <p className="text-xs text-muted-foreground">
                Gerado hoje às {pad(generatedAt.getHours())}:{pad(generatedAt.getMinutes())}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
