import { supabase } from '@/integrations/supabase/client';
import type { NotificationCategory, NotificationItem } from './notificationText';

export interface NotificationsPage {
  items: NotificationItem[];
  filteredTotal: number;
  total: number;
  unread: number;
}

interface RawPage {
  items: NotificationItem[];
  filtered_total: number;
  total: number;
  unread: number;
}

export function parseNotificationsPayload(raw: unknown): NotificationsPage {
  const p = raw as RawPage | null;
  if (!p || !Array.isArray(p.items) || typeof p.total !== 'number' || typeof p.unread !== 'number') {
    throw new Error('Resposta inesperada do servidor.');
  }
  return { items: p.items, filteredTotal: p.filtered_total ?? p.total, total: p.total, unread: p.unread };
}

// school_id nunca vai do cliente: os RPCs usam get_user_school_id().
export async function listNotifications(opts: {
  offset?: number;
  limit?: number;
  category?: NotificationCategory | null;
  unreadOnly?: boolean;
} = {}): Promise<NotificationsPage> {
  const { data, error } = await supabase.rpc('list_notifications', {
    p_offset: opts.offset ?? 0,
    p_limit: opts.limit ?? 20,
    p_category: opts.category ?? undefined,
    p_unread_only: opts.unreadOnly ?? false,
  });
  if (error) throw error;
  return parseNotificationsPayload(data);
}

/** `null`/omitido = todas do usuário. Devolve quantas foram marcadas. */
export async function markNotificationsRead(ids?: string[] | null): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? undefined });
  if (error) throw error;
  return data ?? 0;
}

/** Uma geração no meio da paginação desloca o offset: dedupe por id. */
export function mergeById(prev: NotificationItem[], next: NotificationItem[]): NotificationItem[] {
  const seen = new Set(prev.map((i) => i.id));
  return [...prev, ...next.filter((i) => !seen.has(i.id))];
}
