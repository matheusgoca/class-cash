# S6, Blocos 0 a 3: diagnóstico do e-mail, interruptor por escola, Vault e QA automatizável

**Data:** 26/11/2026. **Status:** DIAGNÓSTICO e PROPOSTAS. **Nada foi alterado** (nenhuma migration, nenhuma escrita no Vault, nenhum deploy, nenhuma escrita no Pensar). Cada DECISÃO abaixo para a execução até a sua resposta.
**Nota:** o texto original do prompt S6 não estava no contexto desta sessão (só os nomes dos blocos); este documento parte desses nomes e do `docs/EMAIL_GO_LIVE.md`. Corrija o que eu tiver entendido errado.

## Bloco 0: diagnóstico do e-mail (leitura, 26/11)

| Item | Estado |
|---|---|
| Edge Function `send-notification-emails` | implantada (v3 em 25/11); **nenhum secret de e-mail configurado**: só existem os automáticos do Supabase. Faltam `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED`, `EMAIL_ALLOWLIST`, `APP_URL`, `EMAIL_REPLY_TO` |
| Vault | **0 segredos** (falta `service_role_key`) |
| Job `send-notification-emails` (`0 * * * *`) | ativo; as últimas respostas são **401 "Não autorizado"** (6 nas últimas 24 h), exatamente porque o Vault está vazio. Falha segura |
| Fila `email_outbox` | vazia |
| Preferências confirmadas (`notification_settings.confirmed_at`) | 0 usuários em todas as escolas hoje (Teste 2 usuários, Pensar 3, Estrela 0) |
| Freio por escola | **não existe** (`claim_notification_emails` só filtra por usuário confirmado, preferência de e-mail ligada, e-mail confirmado, dia e hora local, papel) |

Conclusão: o e-mail está desligado em três camadas independentes (sem Resend, sem Vault, sem preferências confirmadas). Antes de abrir para o Pensar falta, nesta ordem: domínio verificado no Resend, os secrets da função, o segredo do Vault e o freio por escola (portão obrigatório de 25/11).

## Bloco 1: interruptor de e-mail por escola (proposta, DECISÃO)

**Desenho.**
- `schools.email_enabled boolean not null default false` (todas as escolas nascem e ficam **desligadas**, inclusive as existentes).
- `claim_notification_emails`: acrescentar `and sc.email_enabled` ao CTE `cand` (a tabela `schools sc` já está no join). Escola desligada nunca tem aviso reivindicado, mesmo com tudo o mais aberto; a fila não acumula.
- **Quem liga:** só o master. Atenção: `schools_update` permite ao admin da escola atualizar a própria linha, então é preciso uma **guarda no molde de `schools_require_2fa_guard`** (trigger BEFORE UPDATE que barra mudança de `email_enabled` por quem não é master). Sem ela, o admin da escola ligaria o e-mail pela API.
- RPC `set_school_email_enabled(p_school_id, p_enabled)`: `SECURITY DEFINER`, `assert_mfa_gate()`, só master (aal2), grava `email_enabled_at`/`email_enabled_by` (colunas novas, nulas ao desligar) e a auditoria (`audit_trigger` já cobre `schools`).
- UI: interruptor por escola no Painel Master (a lista de escolas já existe), com confirmação e o aviso "só envia se o usuário tiver confirmado as preferências e a função estiver configurada".
- Testes: estender `email_outbox_matrix.sql` (escola desligada não reivindica; ligada reivindica; outra escola não é afetada; admin da escola e financeiro não ligam; master liga; 2FA) e Vitest do interruptor.

**DECISÕES:** (1) default `false` para todas, inclusive a Colegio Teste (ligo a Teste depois, com sua autorização, para o piloto)? Recomendo sim. (2) Só o master liga (recomendo) ou o dono da escola também? (3) Colunas de auditoria `email_enabled_at/by` ou só a auditoria genérica? Recomendo as colunas (consulta simples de "quem ligou e quando"). (4) Migration só com dry-run e autorização, como sempre.

## Bloco 2: Vault `service_role_key` (diagnóstico e proposta, DECISÃO)

**Estado:** o Vault está vazio, por isso o job leva 401 toda hora (inofensivo). **Não escrevo no Vault** e nenhuma chave passa por chat, commit ou PR.

**Proposta (você faz no painel, eu só verifico):**
1. Supabase, Project Settings, Vault: criar o segredo de nome `service_role_key` com o **JWT legado `service_role`** (o mesmo valor do `SUPABASE_SERVICE_ROLE_KEY` da função).
2. Eu confirmo em leitura: `select name from vault.secrets` (só o nome) e a resposta do job na hora seguinte.
3. **Ordem segura:** com o Vault preenchido mas sem `RESEND_API_KEY`/`EMAIL_FROM`, o job passa de 401 para 500 por hora (a função recusa e não reivindica nada); com `EMAIL_SENDING_ENABLED` ausente, vira `{"skipped":"disabled"}`. Nos dois casos nada sai. Só adicione o Vault junto com os secrets da função (ou depois), e **nunca** ligue `EMAIL_SENDING_ENABLED=true` antes de ter o interruptor por escola (Bloco 1) em produção.

**DECISÕES:** (1) quem cria o segredo (recomendo você, no painel) e quando (junto com o domínio verificado)? (2) mantenho o job ativo (recomendo, é inofensivo) ou o desagendo até o go-live (escrita no banco, exige autorização)?

## Bloco 3: QA automatizável (diagnóstico e proposta, DECISÃO)

**O que existe hoje:** Vitest com jsdom (381 testes nas branches mergeadas) que roda só localmente; 14 matrizes SQL em `BEGIN … ROLLBACK`, executadas à mão pelo CLI **contra a produção** (por isso não podem rodar sozinhas em CI); QA de navegador só manual (`QA_CHECKLIST.md`); **nenhum** GitHub Actions: o único check automático é o build da Vercel, que não roda testes nem tsc.

**Lacunas:** regressões de front só aparecem se alguém lembrar de rodar o Vitest; fluxos de tela (baixa, estorno, edição de contrato, importação) nunca são exercitados em navegador real; as matrizes dependem de pessoa.

**Proposta em fases (cada uma é um PR):**
- **Fase 1 (cerca de meio dia, sem risco):** GitHub Actions em todo PR: `vitest run`, `tsc` comparando com o baseline dos 6 erros antigos, `vite build`, `eslint`. Passa a ser check obrigatório da `main`.
- **Fase 2 (cerca de 3 dias):** Playwright de fumaça contra o preview da Vercel, com um **usuário de QA exclusivo na Colegio Teste** (papel admin, sem 2FA obrigatório): login, números do Dashboard contra SQL, dar baixa e estornar, editar valor de contrato e ver a propagação, selo de bolsa. Dados criados com prefixo `QA ` e removidos ao fim; credenciais só em variável de ambiente local e secret do GitHub (nunca no repositório).
- **Fase 3 (opcional, depende de decisão):** rodar as matrizes SQL em CI. Só faz sentido contra um **projeto Supabase de homologação** (hoje não existe); contra a produção, nem em `ROLLBACK`, recomendo manter manual.

**Riscos:** Playwright escreve na Teste (produção) mesmo que limpe depois; usuário de QA com senha; flakiness de Radix Select e do 2FA do master (o QA usa o admin da Teste, que não exige 2FA).

**DECISÕES:** (1) começo pela Fase 1 já (recomendo)? (2) autoriza criar o usuário de QA na Teste (você cria, ou eu preparo o roteiro e você cria, pois exige senha)? (3) vale criar um projeto Supabase de homologação para a Fase 3, ou fica manual?
