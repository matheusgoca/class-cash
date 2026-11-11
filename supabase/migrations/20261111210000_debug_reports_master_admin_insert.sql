-- Master admin navega escolas diferentes da própria (profiles.school_id),
-- mas as policies de INSERT em debug_reports e no bucket debug-reports só
-- aceitavam school_id == get_user_school_id() (a escola "de casa" do
-- usuário). Isso bloqueava o relatório de bug sempre que o master admin
-- reportava um problema visualizando a escola de outra pessoa — exatamente
-- o caso de uso mais comum da ferramenta. As policies de SELECT/UPDATE da
-- mesma tabela já tratavam is_master_admin; a de INSERT nunca tratou.

DROP POLICY IF EXISTS "Admin and financial can submit debug reports" ON public.debug_reports;

CREATE POLICY "Admin and financial can submit debug reports" ON public.debug_reports
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND (
    (school_id = public.get_user_school_id() AND public.get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_master_admin = true)
  )
);

DROP POLICY IF EXISTS "Users can upload their own school's debug attachments" ON storage.objects;

CREATE POLICY "Users can upload their own school's debug attachments" ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'debug-reports'
  AND (
    (storage.foldername(name))[1] = (public.get_user_school_id())::text
    OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_master_admin = true)
  )
);
