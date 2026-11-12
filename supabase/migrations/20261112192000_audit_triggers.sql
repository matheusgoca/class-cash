-- Aplica audit_trigger_fn() nas 14 tabelas listadas em
-- docs/PLANO_SPRINTS_NOV2026.md (seção 4). Um DROP TRIGGER IF EXISTS antes
-- de cada CREATE torna o arquivo seguro para rodar de novo.

do $$
declare
  t text;
begin
  foreach t in array array[
    'students', 'teachers', 'classes', 'class_teachers', 'contracts',
    'tuitions', 'expenses', 'recurring_expenses', 'service_charges',
    'school_services', 'student_services', 'renegotiations', 'user_roles',
    'invitations', 'schools'
  ]
  loop
    execute format('drop trigger if exists audit_trigger on public.%I', t);
    execute format(
      'create trigger audit_trigger after insert or update or delete on public.%I
       for each row execute function public.audit_trigger_fn()',
      t
    );
  end loop;
end $$;
