-- ================================================================
-- MIGRATION: invitations
-- Sprint 9 — Convite de staff por email
-- ================================================================

CREATE TABLE public.invitations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL,
  role       text        NOT NULL CHECK (role IN ('admin', 'financial')),
  school_id  uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  invited_by uuid        REFERENCES auth.users(id),
  status     text        NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School admins can manage invitations"
  ON public.invitations FOR ALL
  USING (school_id = public.get_user_school_id());

CREATE INDEX ON public.invitations (school_id, status);
CREATE INDEX ON public.invitations (email, status);
