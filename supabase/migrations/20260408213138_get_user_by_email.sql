-- ================================================================
-- MIGRATION: get_user_by_email RPC
-- Sprint 9 — Adicionar membro existente
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_user_by_email(p_email text)
RETURNS TABLE(id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, email::text FROM auth.users WHERE email = p_email;
$$;
