-- Remove o conceito de segmento "principal" (S2, Fase 2): a tela de marcar
-- principal/secundário e o painel "mistura de clientes por segmento" saíram do
-- produto, e o valor de primary_segment era só derivado (o primeiro segmento na
-- ordem pedagógica), nunca usado por regra de negócio.
--
-- A coluna precisa sair JUNTO com a CHECK: schools_primary_segment_check exige
-- que primary_segment (quando preenchido) esteja em segments. Se só a tela
-- sumisse, o valor antigo ficaria "preso" e desmarcar esse segmento em
-- Configurações passaria a falhar na CHECK.
--
-- ORDEM DE ROLLOUT: aplicar DEPOIS do front novo estar no ar. O front antigo
-- ainda seleciona primary_segment no SchoolContext e quebraria o carregamento
-- da escola se a coluna sumisse antes.
--
-- Verificado em produção em 17/11/2026: nenhuma função, view, policy, índice ou
-- trigger depende da coluna. O backup dos valores antigos está em
-- docs/backups/schools_segments_2026-11-17.json (segments; os valores de
-- primary_segment eram 'infantil' nas 3 escolas).

alter table public.schools drop constraint if exists schools_primary_segment_check;
alter table public.schools drop column if exists primary_segment;
