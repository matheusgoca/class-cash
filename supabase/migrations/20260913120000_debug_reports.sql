-- ================================================================
-- MIGRATION: debug_reports (ferramenta de debug/feedback)
-- admin/financial reportam bugs com print, vídeo e console log;
-- só master admin lê. Ver
-- docs/superpowers/specs/2026-09-13-debug-report-tool-design.md
-- ================================================================

CREATE TABLE public.debug_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id),
  comment         text        NOT NULL,
  page_url        text        NOT NULL,
  user_agent      text,
  screenshot_path text,
  video_path      text,
  console_logs    jsonb       NOT NULL DEFAULT '[]',
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE INDEX ON public.debug_reports (school_id);
CREATE INDEX ON public.debug_reports (status);

ALTER TABLE public.debug_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and financial can submit debug reports"
  ON public.debug_reports FOR INSERT
  WITH CHECK (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial') AND
    user_id = auth.uid()
  );

CREATE POLICY "Master admin can view debug reports"
  ON public.debug_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  );

CREATE POLICY "Master admin can update debug reports"
  ON public.debug_reports FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  );

-- Bucket de Storage para os anexos (print/vídeo), privado
INSERT INTO storage.buckets (id, name, public)
VALUES ('debug-reports', 'debug-reports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own school's debug attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'debug-reports' AND
    (storage.foldername(name))[1] = public.get_user_school_id()::text
  );

CREATE POLICY "Master admin can read debug attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'debug-reports' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  );
