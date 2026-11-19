import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { parseNotificationsPayload, mergeById } from './notifications';

const item = (id: string) => ({
  id, event: 'tuition_due', reference_date: '2026-11-19', offset_days: 3, item_count: 2,
  total_amount: 10, details: {}, read_at: null, created_at: '2026-11-19T08:00:00Z',
});

describe('parseNotificationsPayload', () => {
  it('converte o payload do RPC', () => {
    const p = parseNotificationsPayload({ items: [item('a')], filtered_total: 5, total: 7, unread: 3 });
    expect(p.items).toHaveLength(1);
    expect(p.filteredTotal).toBe(5);
    expect(p.total).toBe(7);
    expect(p.unread).toBe(3);
  });
  it('rejeita payload malformado', () => {
    expect(() => parseNotificationsPayload(null)).toThrow('Resposta inesperada do servidor.');
    expect(() => parseNotificationsPayload({ total: 1 })).toThrow();
  });
});

describe('mergeById', () => {
  it('não duplica ids já carregados e mantém a ordem', () => {
    const out = mergeById([item('a') as never, item('b') as never], [item('b') as never, item('c') as never]);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
