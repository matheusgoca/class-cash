// O texto das notificações vive em supabase/functions/_shared/ para ser o mesmo no
// e-mail (Edge Function, Deno) e na tela. Este arquivo só reexporta.
export * from '../../supabase/functions/_shared/notificationText.ts';
