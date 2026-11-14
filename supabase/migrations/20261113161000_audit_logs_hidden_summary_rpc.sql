-- Sprint S2, Fase 1, item 3: a tela de Histórico (owner) esconde por padrão
-- os eventos source='generated'/'import' (lançamento em lote de mensalidades/
-- despesas, importação de planilha) e mostra um resumo agregado em vez de
-- centenas de linhas. GROUP BY não é exposto pelo PostgREST direto, daí a RPC.
--
-- security invoker (não definer): só agrega o que o próprio RLS de
-- audit_logs_select já deixaria o chamador ver -- não amplia acesso nenhum.
create or replace function public.audit_logs_hidden_summary(
  p_school_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns table (table_name text, cnt bigint)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select table_name, count(*) as cnt
  from public.audit_logs
  where school_id = p_school_id
    and source <> 'manual'
    and (p_date_from is null or created_at >= p_date_from)
    and (p_date_to is null or created_at <= p_date_to)
  group by table_name
  order by cnt desc;
$$;

comment on function public.audit_logs_hidden_summary is
  'Resumo agregado de quantos eventos gerados/importados (source != manual) estão ocultos na tela de Histórico de alterações, por tabela. Respeita a RLS de quem chama (security invoker).';
