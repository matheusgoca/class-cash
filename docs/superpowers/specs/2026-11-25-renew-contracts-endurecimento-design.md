# Endurecimento de `renew_contracts` e `set_renewal_decision` — desenho

**Data:** 2026-11-25. **Estado:** desenho para aprovação; **nenhuma migration escrita ainda**.
**Origem:** achados diferidos da revisão final da S4c etapa 1 (lista em `docs/STATUS.md`, seção "S4c — rematrícula").
**Base:** `supabase/migrations/20261119140200_renew_contracts.sql`; matriz `supabase/tests/renewal_matrix.sql` (82 verificações em 25/11).

## Objetivo e não-objetivos

Fechar as arestas em que um cliente hostil (ou um bug do front) consegue provocar erro cru, travamento ou lixo, **sem mudar o contrato com o front**: o que a UI manda hoje continua válido. Cada mudança abaixo só rejeita entradas que a UI legítima nunca produz.

Fora do escopo: `enrollments` (a S4c não a toca), remover o papel `teacher`, mudanças na UI.

## Dados de calibração (produção, 25/11)

`contracts.monthly_amount` é `numeric(10,2)`; maior valor hoje: R$ 1.350,00; maior desconto: 50%; maior número de mensalidades por contrato: 17; 327 contratos.

## Mudanças propostas

### H1. Teto de mensalidades por contrato: 25
O contrato novo dura no máximo 24 meses (já validado), então 24 ou 25 linhas mensais é o limite legítimo. Hoje nada impede centenas de datas distintas no período. Regra: `jsonb_array_length(it.tuitions) > 25` → `INVALID_ITEM`. Com o teto de 100 itens por lote, o pior caso fica em 2.500 mensalidades por chamada.

### H2. `overdue` só com vencimento passado
Hoje `overdue` é aceito com vencimento futuro. Regra: `status = 'overdue'` exige `due_date < current_date`; caso contrário `INVALID_ITEM`. O servidor roda em UTC, que está à frente de Brasília: uma data que o front considera vencida (ontem no Brasil) é sempre anterior ao `current_date` UTC, então a UI legítima nunca é barrada. O inverso (`pending` com data passada) continua aceito: o job diário converte.

### H3. Valor não numérico / data inválida vira `INVALID_ITEM`
Hoje `jsonb_to_recordset` com `"abc"` num campo numérico dá `22P02` cru. Duas camadas:
1. Pré-validação: cada elemento de `p_items` precisa ser objeto (`jsonb_typeof = 'object'`), senão `INVALID_ITEMS`; idem para cada elemento de `tuitions`.
2. Rede de segurança: um sub-bloco `begin … exception when sqlstate '22P02' or sqlstate '22007' or sqlstate '22008' or sqlstate '22003' then raise exception 'INVALID_ITEM' using errcode = '22023' end` em volta do `for it in …` e do `for t in …`. Como o erro propaga e a transação inteira é abortada, a atomicidade do lote não muda.

Atenção ao testar: a mensagem do `detail` não deve vazar o conteúdo do JSON.

### H4. Ordenar os itens para evitar deadlock
Dois lotes com os mesmos contratos em ordem inversa podem se travar nos `for update`. Regra: iterar `with ordinality` ordenado por `source_contract_id, ordinality`. O `ordinality` como segundo critério preserva o comportamento atual de duplicata (a primeira ocorrência vence e a segunda é pulada, caso 2i da matriz). Efeito colateral aceito: com vários itens inválidos, o erro reportado passa a ser o do menor `source_contract_id`, não o da primeira posição.

### H5. Teto de `monthly_amount`
Regra: `monthly_amount > 100000` → `INVALID_ITEM` (a coluna aceita até 99.999.999,99; o maior valor real é R$ 1.350). O teto é uma constante no SQL com comentário. Se uma escola real precisar de mais, sobe-se por migration. Ficou em aberto: **100.000 serve ou prefere 50.000?** (não muda o código, só a constante).

### H6. Nota: `set_renewal_decision`
Nenhum dos achados acima se aplica a ela (não recebe JSON de itens). Conferido: usa `v_school` (a escola do contrato) em todas as gravações, e a matriz seção 3 prova que o master em escola alheia grava na escola certa.

## Lacunas de teste a fechar junto

Casos novos na `renewal_matrix.sql`, em `BEGIN … ROLLBACK`, escolhendo personagens por consulta:

| # | Caso | Esperado |
|---|---|---|
| H1a/b | 25 mensalidades OK; 26 | `renewed=1` / `INVALID_ITEM` |
| H2a/b | `overdue` com vencimento ontem OK; `overdue` com vencimento amanhã | OK / `INVALID_ITEM` |
| H3a-d | `monthly_amount` `"abc"`; `due_date` `"2031-13-45"`; `p_items` objeto em vez de array; `p_items = [1]` | `INVALID_ITEM(S)` (nunca `22P02` cru) |
| H4 | lote com origem B,A e outro A,B na mesma transação: ambos terminam sem erro e na ordem determinística | contratos criados 1 por origem |
| H5a/b | `monthly_amount` 100000 OK; 100000,01 | OK / `INVALID_ITEM` |
| G1 | `class_id` nulo | contrato novo com `class_id` nulo |
| G2 | borda da tolerância: `amount` com diferença 0,01 e 0,02 | OK / `INVALID_ITEM` |
| G3 | arredondamento com desconto (ex.: 333,33 com 10%) | `amount` do cliente confere com `final_amount` |

O deadlock real (H4) precisa de duas sessões; dentro de uma transação só dá para provar a ordenação (resultado determinístico), não a ausência do deadlock. Registrar essa limitação em vez de fingir cobertura.

## Plano de execução

1. Aprovar este desenho (e a constante da H5).
2. Casos novos na matriz primeiro, vermelhos contra o schema atual (TDD).
3. Migration `create or replace function public.renew_contracts(...)` com H1-H5, **mantendo** `assert_mfa_gate()` como primeira instrução, o `set_config('app.audit_source', 'generated', true)` e os `revoke/grant`.
4. `db push --dry-run`, depois `db push` só com autorização; rodar a matriz inteira contra o schema aplicado; regenerar `types.ts` só se a assinatura mudar (não muda).
5. Tudo por PR; QA manual, se houver, só na Colegio Teste e no Colégio Estrela (nunca no Pensar).

## Riscos

- H2 e o fuso: coberto acima; se o front um dia mandar `overdue` para a data de hoje, passa a ser rejeitado (hoje ele não manda).
- H3 captura `22003`/`22007`/`22008` também de erros que não vêm do JSON do cliente; dentro desta função isso não existe, mas qualquer coluna nova com cast pode ser mascarada. Mitigação: o `detail` genérico e o caso de teste.
- H4 muda qual erro aparece primeiro em lotes com mais de um item inválido; a UI mostra um erro por lote, então o impacto é só na mensagem.
