-- ================================================================
-- Extends `invitations` to also track school-owner invites
-- (Painel Master → "Nova Escola"), so they show up as pending and
-- can be resent, same as staff invites already do.
-- school_id is null for owner invites — the school itself doesn't
-- exist yet at invite time (created lazily on first login, see
-- Onboarding.tsx), so there's nothing to point the FK at.
-- ================================================================

ALTER TABLE public.invitations
  ALTER COLUMN school_id DROP NOT NULL;

ALTER TABLE public.invitations
  DROP CONSTRAINT invitations_role_check;

ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('admin', 'financial', 'owner'));

ALTER TABLE public.invitations
  ADD COLUMN pending_school_name text,
  ADD COLUMN pending_school_segments jsonb,
  ADD COLUMN pending_school_plan text;

-- Master admin needs to see/resend/cancel owner invites regardless of
-- school_id (there's no school yet) — mirrors master_admin_bypass_schools.
CREATE POLICY "Master admin can manage all invitations"
  ON public.invitations FOR ALL
  USING (is_master_admin());
