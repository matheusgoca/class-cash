-- ================================================================
-- Fix get_user_school_id() to handle school owners
-- Owners have profiles.school_id = null (linked via schools.owner_user_id).
-- Without this fix, the RLS on invitations blocks owners from reading
-- their own school's pending invitations.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_user_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT school_id FROM public.profiles WHERE user_id = auth.uid()),
    (SELECT id FROM public.schools WHERE owner_user_id = auth.uid())
  );
$$;
