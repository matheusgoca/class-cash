# Status do projeto — passagem de bastão

**Atualizado em:** 2026-11-19. Atualize este arquivo ao final de cada sessão: ele é o que permite continuar em outra máquina, porque a memória local do Claude não vai junto com o git.

## Onde estamos

| Frente | Situação | Produção |
|---|---|---|
| S1: auditoria financeira, `audit_logs`, LP | ✅ concluída | ✅ |
| S2: histórico, segmentos, segurança (senha + 2FA) | ✅ concluída (PRs #1–#5); QA da Fase 3 parcial | ✅ |
| S3: preferências de notificação (tela + dados) | ✅ concluída (PR #6) | ✅ migration `20261118120000` |
| S3, etapa 1: gerador diário de notificações | ✅ concluída (PR #7) | ✅ migrations `20261118150000` e `20261118160000`; job `generate-daily-notifications` ativo às 08:00 UTC (05:00 Brasília) |
| S3, etapa 2: sino, central preenchida, card "Precisa da sua atenção" | ✅ mergeada (PR #9, 2026-11-19); **QA visual no navegador pendente**; migration `20261119120000` (`renewed_count`) | ✅ |
| S4a: e-mail por evento (Resend, fila, job horário) | ✅ código pronto na branch `feature/s4a-email-notificacoes`, **apagado**; depende de conta no Resend e domínio | ⬜ migrations `20261119130000`–`130300` não aplicadas; Edge Function não implantada |
| S4b: resumo diário, ciclo de rematrícula | ⬜ não iniciada | — |

Documentos de referência:
- Plano das sprints: `docs/PLANO_SPRINTS_NOV2026.md` (§3 tem as regras herdadas para o gerador e a S4).
- Spec do gerador e da etapa 2 (inclui o contrato dos RPCs que a UI vai consumir): `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`.
- Spec das preferências: `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md`.
- Mockups: `docs/mockups/` (README explica cada tela).
- Histórico do que foi entregue: `CHANGELOG.md`. Roteiros de QA: `QA_CHECKLIST.md`.

## O que fazer em seguida (em ordem)

1. **QA visual da etapa 2** (roteiro em `QA_CHECKLIST.md`, seção "S3, notificações etapa 2"). O PR #9 já foi mergeado sem esse QA; se achar bug, corrigir em PR novo.
   A 1ª execução real do gerador já foi conferida em 2026-11-19: `succeeded`, 3 avisos `tuition_overdue` na Colegio Teste (717 mensalidades vencidas; ainda não confirmado se são reais ou seed).
2. **Outras pendências** (listadas também no fim da spec do gerador):
   - Monitorar falhas do job (uma execução que falha perde os avisos de dia exato daquele dia).
   - Revogar `TRUNCATE` (e demais grants de escrita) de `anon`/`authenticated` nas tabelas — padrão do Supabase, não explorável via REST, endurecimento barato.
3. **QA pendente:** S2 Fase 3 (troca de senha, carência do admin, financeiro sem 2FA); S3 preferências (login como financeiro e professor; tela a 375 px). Ver `QA_CHECKLIST.md`.
4. **Lançar a S4a** (só com autorização; plano em `docs/superpowers/plans/2026-11-19-s4a-email-notificacoes.md`, Tasks 6 e 7). Passos do usuário:
   - Criar conta no Resend.
   - Gravar a chave de serviço no Vault, segredo `service_role_key` (sem ele o job recebe 401 e nada acontece).
   - Registrar o domínio de envio (DNS) e, depois de verificado, trocar `EMAIL_FROM`.
   - Ordem: implantar a Edge Function, depois aplicar as migrations, depois ligar o interruptor (testar antes com `EMAIL_ALLOWLIST`).
   Consultas de monitoramento depois do lançamento:
   ```bash
   npx supabase@2.117.0 db query --linked "select status, count(*), max(updated_at) from public.email_outbox where reference_date >= current_date - 1 group by 1"
   npx supabase@2.117.0 db query --linked "select event, last_error, updated_at from public.email_outbox where status = 'failed' order by updated_at desc limit 10"
   npx supabase@2.117.0 db query --linked "select status, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname='send-notification-emails') order by start_time desc limit 3"
   ```

## Setup em outra máquina

```bash
git clone https://github.com/matheusgoca/class-cash.git   # ou git pull, se já tiver
cd class-cash
npm install
```

1. **`.env`** (fora do git de propósito; copiar da outra máquina ou do painel do Supabase → Settings → API):
   ```
   VITE_SUPABASE_URL=https://rzkguvbdyaukfzgolpqi.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<chave anon/publishable do projeto>
   ```
2. **Supabase CLI** (não precisa instalar globalmente; o projeto usa a versão fixa via `npx`):
   ```bash
   npx supabase@2.117.0 login
   npx supabase@2.117.0 link --project-ref rzkguvbdyaukfzgolpqi
   npx supabase@2.117.0 migration list --linked   # deve mostrar todas aplicadas até 20261118160000
   ```
3. `npm run dev` (porta 8080), `npx vitest run` (112 testes), `npm run build`.

## Armadilhas já conhecidas (produção)

- **Drift de schema:** `update_updated_at_column()` **não existe** em produção — triggers usam `public.set_updated_at()`. `uuid_generate_v4()` **não está no search_path do `db push`** — usar `gen_random_uuid()` (padrão de todas as tabelas).
- **Matrizes SQL** (`supabase/tests/*.sql`) rodam contra produção dentro de `BEGIN … ROLLBACK` — nunca remover o `rollback;`. Não rodar `notifications_matrix.sql` perto das 08:00 UTC (travaria o job real).
- Saída do `db query --linked` é JSON precedido de linhas de log; parsear a partir do primeiro `{`.
- Escrita em produção (`db push`, DML, deploy de Edge Function) só com autorização explícita, mostrando o `--dry-run` antes.
- Recarregar a página perde a escola que o master está visualizando (volta ao `/master`) — comportamento antigo; navegar pela interface.
- Master admin precisa de 2FA sempre (Fase 3). Recuperação do master: remover o fator no painel do Supabase (ver `CLAUDE.md`).
