-- Add type to school_services: 'avulso' (one-time) or 'mensal' (recurring monthly)
ALTER TABLE public.school_services
  ADD COLUMN type text NOT NULL DEFAULT 'avulso'
  CHECK (type IN ('avulso', 'mensal'));
