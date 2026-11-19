# S4c — Rematrícula: página, renovação em lote e acompanhamento da decisão

**Data:** 2026-11-19 · **Status:** desenho aprovado em brainstorming (seções 1 a 3)
**Origem:** `docs/PLANO_SPRINTS_NOV2026.md` (linha S4: "ciclo de rematrícula") e G11 da spec `2026-11-18-gerador-notificacoes-design.md` (botão "Ver contratos" no lugar de "Abrir rematrícula", a reverter quando a tela existir).
**Depende de:** S3 (gerador de notificações e evento `reenrollment`) em produção. Independe da S4a/S4b.
**Mockups:** `docs/mockups/` não traz tela de rematrícula; o desenho visual segue os componentes de `src/components/ui/` e os padrões de `src/pages/Contracts.tsx`.

## Objetivo

Na época de rematrícula a escola precisa (1) saber quem já decidiu, (2) renovar de uma vez os contratos de quem vai ficar, com reajuste e promoção de turma, e (3) registrar quem não vai renovar e por quê. Hoje só existe a renovação **individual** (`ContractForm.handleRenew`) e um painel "Rematrícula — próximos 90 dias" dentro de Contratos.

## Divisão

Dois PRs, como na S3:

1. **Etapa 1 — banco:** tabela `renewal_decisions`, RPCs `set_renewal_decision` e `renew_contracts`, atualização de `generate_daily_notifications`, matrizes SQL. Sem mudança de tela.
2. **Etapa 2 — interface:** `src/lib/renewal.ts` (+ refatoração de `generateTuitions.ts` e do "Renovar" individual), página `/rematricula`, menu, painel-resumo em Contratos, texto do aviso. O texto novo do aviso só entra aqui (o link `/rematricula` precisa existir).

## Fora do escopo

- Entidade "ano letivo"/ciclo explícito (contratos seguem com `start_date`/`end_date` próprios).
- Promoção de série por regra automática (a promoção é o mapa de turmas escolhido na prévia).
- Relatório de evasão por motivo (os dados ficam gravados; o relatório é trabalho futuro).
- Mensagens ou e-mails às famílias; "desfazer" uma renovação em lote.

## Decisões (não reabrir)

| # | Decisão |
|---|---|
| R1 | Escopo = renovação **em lote** (A) + acompanhamento da **decisão da família** (C). |
| R2 | Reajuste: **percentual único** para o lote, com **edição do valor por linha** na prévia. Mudar o % recalcula só as linhas não editadas à mão. |
| R3 | Estados: *Sem resposta* (ausência de registro), *Contatado*, *Vai renovar*, *Não vai renovar* (com **motivo obrigatório** da lista `moved_city` / `price` / `changed_school` / `other` e observação opcional). *Renovado* é **derivado** (existe contrato sucessor), nunca gravado. |
| R4 | "Não vai renovar" **não cancela** o contrato: ele segue ativo até o `end_date`; só sai dos pendentes, do lote e da contagem "pendentes" do aviso. |
| R5 | **Página própria** `/rematricula` (não ampliar o painel de Contratos). |
| R6 | Acesso: **owner, admin e financeiro** podem tudo (consultar, mudar estado, renovar em lote). Professor não vê. O **aviso** de rematrícula continua só para owner/admin (`admin_only`). |
| R7 | **Mapa de turmas** na prévia: cada turma de origem tem um seletor "vai para…" (padrão = mesma turma), com troca por linha. Turma acima da capacidade (`classes.max_capacity`) só **avisa**, não bloqueia. |
| R8 | Arquitetura **A**: o cliente monta contratos e mensalidades com a **mesma função pura** (`buildTuitionRows`) usada pela geração individual; **um RPC atômico** (`renew_contracts`) valida e grava tudo. Não há segunda implementação da regra de mensalidades em SQL (padrão "molde → lançamento"). |
| R9 | Decisões numa tabela própria (`renewal_decisions`), sem colunas novas em `contracts`. |

## Etapa 1 — dados e RPCs

### Tabela `renewal_decisions`

| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `school_id` | uuid not null | FK `schools(id)` on delete cascade |
| `contract_id` | uuid not null | FK `contracts(id)` on delete cascade; **UNIQUE** |
| `status` | text not null | CHECK `contacted` / `will_renew` / `will_not_renew` |
| `reason` | text null | CHECK `moved_city` / `price` / `changed_school` / `other` |
| `note` | text null | CHECK `char_length(note) <= 500` |
| `decided_by` | uuid null | FK `auth.users(id)` on delete set null |
| `created_at`, `updated_at` | timestamptz not null default now() | trigger `public.set_updated_at()` |

CHECK composto: `(status = 'will_not_renew') = (reason is not null)`.

**RLS (padrão do projeto):** SELECT de `school_id = get_user_school_id()` ou `is_master_admin()`; policy RESTRICTIVE `mfa_gate`; **sem** policies de escrita (escrita só pelos RPCs). Trigger de auditoria: `create trigger audit_trigger after insert or update or delete … execute function public.audit_trigger_fn()` (`audit_logs.table_name` é texto livre, sem CHECK). `gen_random_uuid()` e `set_updated_at()` (nunca `uuid_generate_v4()` nem `update_updated_at_column()`).

**Drift de schema:** a RLS de `contracts` não está nas migrations do repositório. O plano deve **confirmar em produção** (`pg_policies`, `pg_constraint`) como `contracts`, `tuitions`, `service_charges` e `school_services` são protegidos e quais colunas/constraints existem, antes de escrever as migrations.

### RPC `set_renewal_decision(p_contract_id uuid, p_status text, p_reason text default null, p_note text default null) → void`

`SECURITY DEFINER`, `set search_path = public`, `perform public.assert_mfa_gate()` primeiro. `school_id` sempre de `get_user_school_id()`.

- Permitido a owner, admin e financeiro da escola (checagem por `mfa_is_admin_or_owner` ou papel `financial`); demais → `NOT_ALLOWED` (42501).
- O contrato precisa ser da escola, estar `active` e **não ter sucessor** (`renewed_from_id` apontando para ele, ignorando sucessores `cancelled`); senão `INVALID_CONTRACT` (22023).
- `p_status` ∈ {`contacted`, `will_renew`, `will_not_renew`, `none`}. `none` apaga o registro. `will_not_renew` sem `p_reason` válido → `REASON_REQUIRED` (22023). Upsert por `contract_id`; grava `decided_by = auth.uid()`.
- Concedida a `authenticated`; revogada de `public, anon`.

### RPC `renew_contracts(p_items jsonb, p_fee_service_id uuid default null) → jsonb`

`SECURITY DEFINER`, `set search_path = public`, `assert_mfa_gate()` primeiro, mesmo papel de `set_renewal_decision`. Dentro da transação: `select set_config('app.audit_source', 'generated'::text, true)` **antes** dos inserts (CLAUDE.md).

`p_items` é um array de até **100** itens:

```json
{ "source_contract_id": "uuid", "class_id": "uuid|null", "monthly_amount": 1234.56,
  "start_date": "2027-02-01", "end_date": "2028-01-31",
  "tuitions": [ { "due_date": "2027-02-05", "amount": 1135.80, "status": "pending", "description": "Mensalidade fevereiro de 2027" } ] }
```

Validação no servidor, por item (qualquer falha **aborta o lote inteiro** com erro que cita o `source_contract_id`):
- A origem é da escola, está `active`, e `class_id` de destino (se informado) é da escola.
- `start_date` = `end_date` da origem + 1 dia; `end_date` ≥ `start_date` e a duração ≤ 24 meses.
- Cada mensalidade: `due_date` dentro de `[start_date, end_date]`, sem duplicar `due_date`, `amount` igual ao `final_amount` do contrato novo (calculado no servidor a partir de `monthly_amount` e do `discount` herdado), `status` ∈ {`pending`, `overdue`}.
- `monthly_amount` > 0.

Origem que **já tem sucessor** não aborta: é **pulada** e listada em `skipped` (duas pessoas renovando ao mesmo tempo).

Para cada item válido: insere o contrato novo (copia `student_id`, `period`, `due_day`, `discount` da origem; `school_id` do servidor; `status = 'active'`; `renewed_from_id = source_contract_id`; turma e valor do item), insere as mensalidades (`contract_id`, `student_id`, `school_id`, `final_amount = null`) e, se `p_fee_service_id` vier, uma linha em `service_charges` (preço e nome lidos de `school_services` da escola, `due_date = start_date` do contrato novo). Devolve `{ renewed, tuitions, skipped: [ { source_contract_id, reason } ] }`. Concedida a `authenticated`; revogada de `public, anon`.

### Aviso de rematrícula (`generate_daily_notifications`)

Nova migration (só redefine a função, com `create or replace`, preservando grants; única mudança é o evento `reenrollment`):
- `details` ganha `declined_count`: contratos do conjunto com decisão `will_not_renew` **e sem sucessor não cancelado**.
- **Pendentes** = `item_count − renewed_count − declined_count`. O aviso só é gerado se pendentes > 0 (nenhum aviso quando tudo está resolvido). `item_count` continua sendo o total de contratos do conjunto.
- A cópia mais recente da função é a de `20261119120000_notifications_renewed_count_exclude_cancelled.sql`; a nova migration parte dela.

### Testes da etapa 1

- **`supabase/tests/renewal_matrix.sql`** (`BEGIN … ROLLBACK`, escola de teste e escola-isca, como as matrizes anteriores): papéis (admin e financeiro passam, professor é negado); contrato de outra escola; contrato inativo ou já renovado; `will_not_renew` sem motivo falha; `none` apaga; renovação cria contrato + mensalidades + taxa; mensalidade ou data incoerente aborta o lote inteiro (nada gravado); origem já renovada é pulada e listada; duração > 24 meses; mais de 100 itens; `audit_logs.source = 'generated'`; gate de 2FA; usuário comum não escreve direto na tabela.
- **`notifications_matrix.sql`:** casos de `declined_count`, pendentes e do aviso que não nasce quando tudo está resolvido.

## Etapa 2 — interface

### `src/lib/renewal.ts` (puro, Vitest)

- `buildTuitionRows(contract, today)`: a regra de meses de `generateTuitions.ts` (vencimento no último dia do mês quando `due_day` não existe; ignora mês cujo vencimento cai fora de `[início, fim]`; `overdue` se já passou). `generateTuitions` passa a usá-lo.
- `nextTerm(source)`: início = fim da origem + 1; fim = último dia do 12º mês (a regra atual de `handleRenew`, que passa a usar esta função).
- `applyAdjustment(value, pct)`: reajuste com arredondamento a centavos.
- `buildRenewalPlan(sources, { pct, classMap, rowOverrides, feeServiceId })` → itens para o RPC e totais da prévia; linhas editadas à mão ficam marcadas e não são recalculadas ao mudar o %.
- `renewalState(contract, decision, successorExists)`: estado derivado (`renewed` ou o gravado ou `none`).

### Página `/rematricula`

Rota protegida com `allowedRoles={['admin', 'financial']}` (o owner conta como admin); item "Rematrícula" no grupo *Gestão* da barra lateral, depois de Contratos, com os mesmos papéis.

- **Filtros:** janela (30 / 60 / 90 / 180 dias, padrão 90), turma, estado, busca por aluno.
- **Resumo:** na janela, renovados, vão renovar, contatados, não vão renovar, sem resposta.
- **Tabela:** seleção, aluno, turma, término, valor atual, estado, ação. O estado é um seletor na linha; "Não vai renovar" abre diálogo com motivo (obrigatório) e observação. "Renovado" é selo de texto, não selecionável. Estado nunca só por cor. Paginação com a seleção preservada entre páginas.
- **Seleção inicial:** contratos "Vai renovar" já marcados; "Não vai renovar" desabilitado; atalho "Selecionar todos que vão renovar".
- **Renovar em lote:** diálogo em duas partes. Configuração: reajuste em %, taxa de rematrícula opcional (serviço avulso, reaproveitando a lista do `ContractForm`) e o **mapa de turmas**. Prévia: por contrato, aluno, turma origem → destino (editável por linha), valor atual → novo (editável por linha), período novo, nº de mensalidades; totais no rodapé; aviso de capacidade. Confirmar envia em **chamadas de até 100 itens**, cada uma atômica; o resultado lista renovados, mensalidades criadas e contratos pulados; se uma chamada posterior falhar, mostra exatamente o que já foi renovado.
- **Estados:** carregando, vazio ("Nenhum contrato termina nesta janela"), erro com "Tentar de novo", resultado parcial, 375 px.

### Outras mudanças de tela

- **Contratos:** o painel "Rematrícula — próximos 90 dias" vira um resumo curto com link para `/rematricula`. O "Renovar" individual continua e usa `nextTerm`/`buildTuitionRows`.
- **Texto do aviso** (`supabase/functions/_shared/notificationText.ts`, usado pela tela e pelo e-mail): ação do `reenrollment` = "Abrir rematrícula" → `/rematricula` (reverte o desvio G11 da S3); subtítulo "6 já rematriculados · 3 não vão renovar · 9 pendentes" (o trecho "não vão renovar" só quando `declined_count` > 0).
- `src/integrations/supabase/types.ts` regenerado após aplicar as migrations.

### Testes da etapa 2

- **Vitest:** `renewal.ts` (meses, fim de fevereiro, `overdue`/`pending`, reajuste e arredondamento, mapa de turmas, linhas editadas, estado derivado) e o texto novo do aviso (atualizar os testes existentes do `reenrollment`).
- **Renderização (jsdom + Testing Library):** seleção inicial, "não vai renovar" desabilitado, prévia com totais, mapa de turmas e edição por linha, resultado com contratos pulados.
- **Manual no navegador** numa escola de teste, após a etapa 1 em produção.

## Rollout

Cada passo que grava em produção só com autorização, mostrando `--dry-run` antes do `db push`:
1. Etapa 1: confirmar o schema real (drift) → migrations → matrizes em `BEGIN … ROLLBACK` → `db push` → `gen types` → PR.
2. Etapa 2: front → QA → PR (requer a etapa 1 em produção).

## Riscos e avisos

- **Sem "desfazer":** a prévia e a confirmação com a contagem são a proteção; um contrato errado se corrige pelo formulário individual (ou cancelando).
- **O RPC confia em dados calculados no cliente:** por isso a validação rígida no servidor (datas encadeadas, valor e vencimento de cada mensalidade). O que o servidor não revalida é a regra fina de meses; um cliente adulterado só consegue criar mensalidades dentro do período e do valor corretos do **próprio** contrato.
- **Financeiro renova em lote** (R6): a auditoria registra o autor.
- **Lote grande:** limite de 100 por chamada; chamadas independentes (a falha de uma não desfaz as anteriores, e o resultado diz o que passou).
- **Drift de schema** (ver etapa 1): a RLS de `contracts` precisa ser confirmada em produção antes de escrever o plano.

## Notas para depois

- Relatório de evasão por motivo usa `renewal_decisions` (`reason`, `updated_at`).
- Se a escola passar a precisar de "ano letivo" explícito (opção B do brainstorming), `renewal_decisions` e o plano de renovação continuam válidos; o ciclo seria uma camada por cima.
