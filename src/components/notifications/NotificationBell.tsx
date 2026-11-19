import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useShowNotifications } from '@/hooks/use-show-notifications';
import { listNotifications, markNotificationsRead, type NotificationsPage } from '@/lib/notifications';
import { describeNotification, formatRelativeTime } from '@/lib/notificationText';

export function NotificationBell() {
  const visible = useShowNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsPage | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await listNotifications({ offset: 0, limit: 4, unreadOnly: true }));
    } catch {
      setData(null); // falha: só o ícone, sem selo, sem quebrar o cabeçalho
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [visible, refresh]);

  if (!visible) return null;

  const unread = data?.unread ?? 0;
  const badge = unread > 9 ? '9+' : String(unread);
  const now = new Date();

  const markAll = async () => {
    try { await markNotificationsRead(null); } finally { await refresh(); }
  };
  const openItem = async (id: string, path: string) => {
    setOpen(false);
    try { await markNotificationsRead([id]); } catch { /* navegar mesmo assim */ }
    navigate(path);
    refresh();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações, ${unread} não lidas`}>
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
          {unread > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={markAll}>
              Marcar todas como lidas
            </Button>
          )}
        </div>
        {data && data.items.length > 0 ? (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {data.items.map((n) => {
              const v = describeNotification(n);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n.id, v.actionPath)}
                    className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="text-sm font-semibold">{v.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {v.subtitle} · {formatRelativeTime(n.created_at, now)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tudo em dia.</p>
        )}
        <div className="border-t px-4 py-2 text-center">
          <Link to="/notificacoes" onClick={() => setOpen(false)} className="text-sm font-medium text-primary hover:underline">
            Ver todas as notificações
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
