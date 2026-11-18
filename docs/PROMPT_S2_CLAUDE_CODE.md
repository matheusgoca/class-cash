# Prompt — Sprint S2 (Claude Code)

Cole o bloco abaixo no Claude Code, na raiz de `C:\dev\class-cash`.

---

Leia `CLAUDE.md`, `docs/PLANO_SPRINTS_NOV2026.md` (seções 4 e 5 e o bloco "Status"), `docs/mockups/README.md` e os mockups da S2 em `docs/mockups/`: `Historico-Owner.dc.html`, `Historico-Master.dc.html`, `Config-Escola.dc.html`, `Config-Notificacoes-Seguranca.dc.html`, `Master-Escolas.dc.html`. Vamos executar a **Sprint S2**: Histórico de alterações (telas), segmentos, segurança da conta em etapas (troca de senha + 2FA) e preferências de notificação (só a tela e a tabela, sem envio). Trabalhe como tech lead: passo a passo, diagnosticando antes de codar, e **pare e me pergunte** nos pontos marcados "DECISÃO".

## Regras
- Diagnosticar antes de codar. Não assuma schema a partir do histórico de migrations; me dê as queries SQL e espere eu colar o resultado quando precisar de produção.
- Toda query nova filtra por `school_id` explicitamente, mesmo com RLS.
- Erros do Postgres passam por `getFriendlyErrorMessage`.
- Migrations: entregue arquivos em `supabase/migrations/` e me diga como rodar e em que ordem. Funções PL/pgSQL grandes: dividir em partes menores ou indicar `supabase db push`.
- Os mockups são referência visual: use as variáveis do tema e os componentes de `src/components/ui/`, não copie hex.
- Um commit por item, mensagem em português descrevendo o porquê. Não faça push.
- Escrita em produção (seed, SQL direto) só com minha autorização explícita por ação.

## Fase 0 — Pendências da S1 e diagnóstico (sem alterar funcionalidade)
1. Corrigir o `CLAUDE.md`: `ClassHealthCards.tsx` **não** usa `classCost.ts` (calcula ocupação, receita e inadimplência). Ajuste o texto para refletir a realidade; atualize também a menção às convenções novas (`getTuitionValue`, `financialBalance.ts`, `audit_logs` e a coluna `source`).
2. **Teste de RLS do `audit_logs` com usuário não-master.** Me dê o roteiro (queries ou passos na UI) para eu validar que: (a) owner/admin da escola A vê os logs de A; (b) não vê os de B; (c) financeiro e professor não leem `audit_logs`; (d) nenhum usuário consegue UPDATE/DELETE. Use `SET LOCAL ROLE`/JWT simulado se for viável, ou indique o que preciso de credenciais. **Pare e espere o resultado antes das Fases 1 em diante.**
3. Confirme em produção (queries para eu rodar): colunas e constraints de `schools` e `audit_logs`; quais `source` existem; índices úteis para paginação por `school_id, created_at desc`.
4. Verifique no projeto Supabase se MFA TOTP está habilitado (`config.toml` e o que o painel permite) e me diga o que preciso ligar.
Resuma em uma tabela e **espere minha confirmação**.

## Fase 1 — Histórico de alterações (telas)
Mockups: `Historico-Owner.dc.html` e `Historico-Master.dc.html`.
1. **Owner/admin:** Configurações → aba "Histórico de alterações". Linha do tempo em português: "quem / quando / o quê", com diff antes → depois (ex.: valor da mensalidade R$ 500 → R$ 450). Filtros: pessoa, tela (tabela), período; paginação ("carregar mais") por cursor em `created_at`.
2. Ações com `is_master_action = true` aparecem como **"Suporte Class Cash"** (nome do master nunca exposto ao owner), com selo.
3. Por padrão ocultar `source = 'generated'` e `'import'` (mostrar um resumo agregado, ex.: "12 mensalidades geradas"); filtro "incluir geradas/importadas" opcional.
4. Um formatador único `src/lib/auditFormat.ts` que traduz `table_name`, `action` e `changed_fields` para frases em português, com testes Vitest. Campos desconhecidos caem num texto genérico, nunca quebram a tela.
5. **Privacidade:** `salary` e dados de `teachers` só aparecem para quem hoje já pode ver salário. Nunca exibir tokens, e-mails de convite completos de terceiros além do necessário, nem `old_data`/`new_data` brutos.
6. **Master:** em `MasterAdmin`, painel global com filtros de escola, usuário, tabela, ação e "só ações master"; mostra o nome real do ator e a escola. Exportar CSV só se for simples; senão deixe para depois.
7. Sem alterar a lógica de captura da S1, exceto se a Fase 0 apontar falha.
**DECISÃO:** se a formatação em português exigir dados que o trigger não guarda (por exemplo, nome do aluno em vez do id), me proponha a solução (resolver no client via join, ou enriquecer o log) antes de implementar.

## Fase 2 — Segmentos
Mockups: `Config-Escola.dc.html` e `Master-Escolas.dc.html`.
1. Migration: coluna `primary_segment` em `schools` e backfill a partir de `segments` (primeiro item; me diga o que será gravado para escolas com `segments` vazio). Novos valores de segmento: `infantil`, `fundamental_1`, `fundamental_2`, `medio`, `tecnico`, `idiomas`. **Antes**, me dê a query para ver quais valores existem hoje em `schools.segments` e proponha o mapeamento (`fundamental` → `fundamental_1` + `fundamental_2`?). **DECISÃO** minha sobre o mapeamento.
2. Onboarding e Configurações: nova seleção (marcar vários, um principal; técnico e idiomas aparecem como secundários) conforme o mockup. Reaproveite a constante compartilhada: hoje `SEGMENTS` está duplicada em `Onboarding.tsx` e `Settings.tsx`; extraia para `src/lib/segments.ts`.
3. `ClassForm.tsx`: o campo "Série/Ano" mostra só os grupos de `GRADE_GROUPS` dos segmentos da escola, mais "Outra série (digitar)". Se a escola não tem segmento definido, mostra todos. Turmas existentes com série fora da lista continuam exibindo o valor salvo.
4. **Painel master:** tela "Escolas" com a mistura de clientes por segmento (quantas escolas atendem cada segmento, quantas o marcam como principal) e filtro por segmento na lista. Consulta agregada acessível só a master admin.
5. Testes Vitest para o mapeamento de segmento → grupos de série.

## Fase 3 — Segurança da conta em etapas
Mockup: `Config-Notificacoes-Seguranca.dc.html` (card "Segurança da conta").
1. **Troca de senha em 3 passos:** confirmar senha atual (reautenticar com `signInWithPassword` sem trocar a sessão do usuário de forma visível), definir nova senha com checklist de requisitos (mínimo de 10 caracteres, número; símbolo recomendado), confirmar e encerrar as outras sessões (`signOut({ scope: 'others' })`). Erros amigáveis em português.
2. **2FA TOTP** com Supabase Auth MFA (`auth.mfa.enroll`, `challenge`, `verify`, `listFactors`, `unenroll`): ativação em 3 passos (instalar app, escanear QR code, digitar código de 6 dígitos). Exibir QR e a chave manual. Desativar exige o código atual.
3. Login: se o usuário tem fator verificado, pedir o código após a senha (nível AAL2), com mensagem clara em caso de erro.
4. **Política "exigir 2FA de owner e admin":** coluna `require_2fa` em `schools` (padrão `false`). **DECISÃO — pare e me proponha o desenho antes de implementar o bloqueio**, cobrindo: (a) como não trancar o owner para fora (período de carência e fluxo de ativação forçada na hora); (b) enforcement só no front (`ProtectedRoute`) ou também no banco (RLS exigindo `auth.jwt()->>'aal' = 'aal2'` nas tabelas sensíveis), com o risco e o custo de cada um; (c) recuperação de acesso se o usuário perder o aparelho (códigos de recuperação não existem no TOTP nativo do Supabase; qual é o plano: master admin remove o fator?).
5. O master admin também precisa de 2FA no login dele; me diga o que já existe.
Sem expor nenhum segredo TOTP em logs ou no console.

## Fase 4 — Preferências de notificação (só tela e dados)
Mockup: `Config-Notificacoes-Seguranca.dc.html` (card "Notificações").
1. Migration `notification_preferences` por usuário e escola: evento × canal (sistema/e-mail) × antecedência, mais resumo diário e horário. Eventos: `tuition_due`, `tuition_overdue`, `renegotiation_installment`, `expense_due`, `reenrollment`. Padrões razoáveis na criação. RLS: cada usuário lê e altera só as próprias preferências; master pode ler.
2. Tela conforme o mockup, salvando de verdade. **Não** crie envio de e-mail nem a rotina de geração de notificações (isso é S3 e S4). Deixe um texto discreto informando que os avisos serão ativados nas próximas versões, para o usuário não achar que está quebrado.
3. Registrar essas preferências no `audit_logs` não é necessário.

## Ao terminar
- Atualize `CHANGELOG.md` e escreva um resumo da sprint no mesmo formato da S1 (`claude/SPRINT_S1_RESUMO.md`) para eu levar ao Claude Project.
- Liste: o que foi feito, o que ficou pendente, migrations que preciso rodar e em que ordem, e um roteiro curto de QA manual: (1) ação de owner e de master aparecendo no histórico com os rótulos certos; (2) owner de uma escola não vê o histórico de outra; (3) ocultar geradas/importadas por padrão; (4) turma nova mostrando só as séries dos segmentos marcados; (5) painel master com a mistura de segmentos batendo com os dados; (6) troca de senha em etapas encerrando as outras sessões; (7) ativar e desativar 2FA com login pedindo o código; (8) preferências de notificação salvas e recarregadas.
