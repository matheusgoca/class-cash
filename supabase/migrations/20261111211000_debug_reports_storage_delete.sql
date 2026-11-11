-- Faltava policy de DELETE no bucket debug-reports: o trigger
-- storage.protect_delete() bloqueia DELETE direto via SQL (força uso da
-- Storage API), e a Storage API respeita RLS — sem nenhuma policy de
-- DELETE, os anexos (print/vídeo) nunca podiam ser removidos, mesmo que a
-- linha correspondente em debug_reports já tivesse sido apagada. Segue o
-- mesmo padrão de is_master_admin já usado nas policies de SELECT/UPDATE
-- da tabela debug_reports.

CREATE POLICY "Master admin can delete debug attachments" ON storage.objects
FOR DELETE
USING (
  bucket_id = 'debug-reports'
  AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_master_admin = true)
);
