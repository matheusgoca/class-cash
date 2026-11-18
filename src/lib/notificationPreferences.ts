import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { EventPreference, NotificationEvent, OffsetDirection, PreferencesState } from './notificationEvents';

export interface LoadedPreferences {
  state: PreferencesState;
  confirmedAt: string | null;
}

interface RawPreference {
  event: NotificationEvent;
  direction: OffsetDirection;
  in_app: boolean;
  email: boolean;
  offset_days: number;
  allowed_offsets: number[];
  email_recommended: boolean;
}

interface RawPayload {
  preferences: RawPreference[];
  settings: { digest_enabled: boolean; digest_time: string; timezone: string; confirmed_at: string | null };
}

const UNEXPECTED = 'Resposta inesperada do servidor.';

export function parsePreferencesPayload(raw: unknown): LoadedPreferences {
  const p = raw as RawPayload | null;
  if (!p || !Array.isArray(p.preferences) || !p.settings) throw new Error(UNEXPECTED);
  const preferences: EventPreference[] = p.preferences.map((r) => ({
    event: r.event,
    direction: r.direction,
    inApp: r.in_app,
    email: r.email,
    offsetDays: r.offset_days,
    options: r.allowed_offsets,
    emailRecommended: r.email_recommended,
  }));
  return {
    state: { preferences, digest: { enabled: p.settings.digest_enabled, time: p.settings.digest_time } },
    confirmedAt: p.settings.confirmed_at ?? null,
  };
}

// school_id nunca vai do cliente: o RPC usa get_user_school_id() (D4).
export async function ensurePreferences(): Promise<LoadedPreferences> {
  const { data, error } = await supabase.rpc('ensure_notification_preferences');
  if (error) throw error;
  return parsePreferencesPayload(data);
}

export async function savePreferences(draft: PreferencesState, timezone: string): Promise<LoadedPreferences> {
  // Tipado como Json: um array inferido como object[] não é aceito pelo tipo gerado
  // (mesmo erro de tsc que já existe em generateTuitions.ts).
  const p_prefs: Json = draft.preferences.map((p) => ({
    event: p.event,
    in_app: p.inApp,
    email: p.email,
    offset_days: p.offsetDays,
  }));
  const { data, error } = await supabase.rpc('save_notification_preferences', {
    p_prefs,
    p_digest_enabled: draft.digest.enabled,
    p_digest_time: draft.digest.time,
    p_timezone: timezone,
  });
  if (error) throw error;
  return parsePreferencesPayload(data);
}
