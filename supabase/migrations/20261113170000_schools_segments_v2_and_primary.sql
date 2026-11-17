-- Sprint S2, Fase 2, item 1: novos valores de segmento (infantil,
-- fundamental_1, fundamental_2, medio, tecnico, idiomas) + coluna
-- primary_segment. Decisões do usuário (2026-11-13):
--   1) 'fundamental' (antigo) expande pra 'fundamental_1' + 'fundamental_2'.
--   2) primary_segment: NULL pra escola com segments vazio (não inventa
--      principal pra quem nunca declarou nenhum).
--   3) CHECK constraints entram nesta mesma migration, depois do backfill.
--   4) primary_segment segue a ordem pedagógica (infantil primeiro), não a
--      alfabética.
--
-- Verificado: invitations.pending_school_segments não tem nenhuma linha com
-- status='pending' e segments preenchido (só uma linha 'accepted', já
-- materializada como a escola "Colégio Pensar", cujo schools.segments já é
-- coberto pelo backfill abaixo) -- não há convite pendente de verdade pra
-- remapear aqui. O front (Onboarding.tsx) ganhou normalizeSegments() como
-- rede de segurança caso um user_metadata antigo apareça no futuro.
--
-- *** ATENÇÃO PRA QUEM FOR RODAR ISSO: o front hoje (Settings.tsx,
-- Onboarding.tsx) ainda grava o valor antigo 'fundamental' em schools.segments.
-- A partir do CHECK constraint abaixo, qualquer save que mande 'fundamental'
-- vai ser recusado pelo banco. Esta migration e o deploy do front da S2
-- (Fase 2, item 2 -- SEGMENTS novo em src/lib/segments.ts) têm que subir
-- JUNTOS. Rodar a migration sozinha e deixar o front antigo no ar quebra
-- o salvamento de Configurações/Onboarding pra qualquer escola. ***

begin;

-- 1) Backfill: expande 'fundamental' em 'fundamental_1' + 'fundamental_2',
-- mantém os demais valores como estão, dedup via array_agg(DISTINCT).
-- Escola com segments = '{}' continua '{}' (coalesce evita virar NULL).
update public.schools s
set segments = (
  select coalesce(array_agg(distinct mapped.val order by mapped.val), '{}'::text[])
  from unnest(s.segments) as orig(val)
  cross join lateral (
    select case orig.val
             when 'fundamental' then array['fundamental_1', 'fundamental_2']
             else array[orig.val]
           end as vals
  ) expanded
  cross join lateral unnest(expanded.vals) as mapped(val)
)
where s.segments is not null;

-- 2) Coluna nova: segmento principal. Nullable -- escola sem segmento
-- nenhum marcado fica sem principal, em vez de um palpite forçado.
alter table public.schools add column if not exists primary_segment text;

-- 3) Backfill de primary_segment: primeiro item na ORDEM PEDAGÓGICA (não a
-- alfabética do array armazenado) -- mesma ordem de SEGMENTS em
-- src/lib/segments.ts: infantil, fundamental_1, fundamental_2, medio,
-- tecnico, idiomas. NULL quando segments está vazio.
update public.schools s
set primary_segment = (
  select ordered.val
  from unnest(array['infantil', 'fundamental_1', 'fundamental_2', 'medio', 'tecnico', 'idiomas']) as ordered(val)
  where ordered.val = any(s.segments)
  order by array_position(array['infantil', 'fundamental_1', 'fundamental_2', 'medio', 'tecnico', 'idiomas'], ordered.val)
  limit 1
)
where s.primary_segment is null
  and s.segments is not null
  and array_length(s.segments, 1) > 0;

-- 4) Constraints -- só depois do backfill, senão os dados antigos quebram
-- a transação inteira.
alter table public.schools
  add constraint schools_segments_check
  check (segments <@ array['infantil', 'fundamental_1', 'fundamental_2', 'medio', 'tecnico', 'idiomas']::text[]);

alter table public.schools
  add constraint schools_primary_segment_check
  check (primary_segment is null or primary_segment = any(segments));

commit;
