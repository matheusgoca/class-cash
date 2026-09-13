# Ferramenta de debug/feedback — design

Data: 2026-09-13

## Objetivo

Permitir que usuários com papel `admin` ou `financial` reportem bugs direto do
app, anexando print, comentário, vídeo da tela e o histórico recente do
console — sem precisar descrever manualmente o que apareceu no console do
navegador. Só o master admin vê os relatórios, num painel central.

## Decisões (confirmadas com o usuário)

- Audiência de leitura: **só master admin**, via seção nova em `MasterAdmin.tsx`.
- Quem pode enviar: **admin e financial**, não teacher.
- Print: **automático ao abrir o painel** (html2canvas) + opção de trocar
  (colar ou anexar manualmente).
- Vídeo: **gravação de tela pelo navegador** (`getDisplayMedia` +
  `MediaRecorder`), sem upload de arquivo pronto.
- Console: captura **automática de log/warn/error/info**, sem ação do usuário.

## Fluxo

1. Usuário clica no ícone `Bug` no header, ao lado do `ThemeToggle`
   (`src/components/layout/Layout.tsx`). Ícone só renderiza se
   `hasRole('admin', 'financial')` (`src/hooks/use-role.ts`) — mesmo padrão
   usado no `AppSidebar` para itens de menu. Essa checagem é só UX; a
   garantia real fica na RLS de `debug_reports`.
2. Abre um `Sheet` (`src/components/ui/sheet.tsx`) lateral, "Reportar um
   problema":
   - Captura o print da tela atual via `html2canvas` assim que abre, mostra
     miniatura. Botão "Trocar print" permite colar (Ctrl+V) outra imagem ou
     escolher um arquivo.
   - Textarea de comentário, obrigatória (mínimo de caracteres).
   - Botão "Gravar tela": pede `getDisplayMedia({ video: true })`, inicia
     `MediaRecorder`, mostra indicador de gravação + tempo decorrido +
     "Parar gravação". Limite de 2 minutos (para automaticamente). Ao parar,
     mostra preview do vídeo com opção de regravar. Campo opcional.
3. Envio:
   - Gera um `id` (uuid) no cliente para o relatório.
   - Sobe print (`.png`) e vídeo (`.webm`, se houver) para o bucket
     `debug-reports` em `${school_id}/${report_id}/screenshot.png` e
     `${school_id}/${report_id}/video.webm`.
   - Insere uma linha em `debug_reports` com esse mesmo `id`.
   - Toast de sucesso, reset do form, fecha o Sheet.
   - Erros usam `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`).
4. Master admin abre a seção "Relatórios de Bug" em `MasterAdmin.tsx`: lista
   todos os relatórios de todas as escolas, mais recente primeiro. Cada linha
   expande para mostrar print, vídeo (se houver) e console log formatado, com
   botão para marcar como resolvido/reabrir. Anexos carregados via signed URL
   (`supabase.storage.from('debug-reports').createSignedUrl(...)`), já que o
   bucket é privado.

## Captura de console

Novo módulo `src/lib/consoleCapture.ts`, inicializado uma vez em `main.tsx`
antes da renderização do app:

- Substitui `console.log/info/warn/error` por wrappers que chamam o original
  (nunca engolir a call original) e também empurram
  `{ level, args: string[], timestamp }` num buffer circular em memória
  (últimas 100 entradas).
- Exporta `getConsoleBuffer(): ConsoleEntry[]`, chamada só no momento do
  envio do relatório — nada é persistido localmente nem enviado até o
  usuário clicar em enviar.
- `args` são serializados com segurança (objetos via `JSON.stringify` com
  fallback pra `String(arg)` se não for serializável, ex: referências
  circulares ou `Error`).

## Schema (nova migration)

Segue as convenções já usadas no projeto (ver `20260911_expenses.sql`):
`REFERENCES` (o projeto usa FK, diferente da regra genérica do toolkit
Spartan para o stack Kotlin, que não se aplica aqui), `TIMESTAMPTZ`,
`gen_random_uuid()`, RLS por `school_id`.

```sql
CREATE TABLE public.debug_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id),
  comment        text        NOT NULL,
  page_url       text        NOT NULL,
  user_agent     text,
  screenshot_path text,
  video_path     text,
  console_logs   jsonb       NOT NULL DEFAULT '[]',
  status         text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
```

Sem soft delete (`deleted_at`) — é um relatório efêmero, `status` já cobre o
ciclo de vida (`open` → `resolved`). Se um dia precisar de exclusão de
verdade, master admin apaga direto via SQL.

RLS:
- **INSERT**: `school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial') AND user_id = auth.uid()`
- **SELECT / UPDATE**: só master admin — checagem inline
  `EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_master_admin = true)`
  (confirmado: `profiles.user_id`, não `profiles.id`, é a coluna que casa com
  `auth.uid()` — ver `get_user_school_id()` em
  `20260418175018_fix_get_user_school_id.sql`).
  Não depende de nenhuma função `is_master_admin()` porque não existe
  nenhuma no histórico de migrations deste repo (mesmo tipo de drift de
  schema já documentado no `CLAUDE.md` — a policy real de `schools` que dá
  acesso cross-school ao master admin também não está nas migrations).
- Sem policy de DELETE.

Bucket de Storage `debug-reports` (privado):
- **INSERT** (`storage.objects`): usuário autenticado, path
  `(storage.foldername(name))[1] = public.get_user_school_id()::text`.
- **SELECT**: só master admin (mesma checagem inline).

## Componentes novos (frontend)

- `src/lib/consoleCapture.ts` — buffer de console.
- `src/lib/debugReport.ts` — orquestra captura de print/vídeo e upload+insert
  (mantém a lógica fora do componente de UI, testável isoladamente).
- `src/components/debug/DebugReportButton.tsx` — ícone + trigger do Sheet.
- `src/components/debug/DebugReportSheet.tsx` — formulário (print, comentário,
  gravação de vídeo).
- `src/components/master/DebugReportsSection.tsx` — listagem no Painel Master.
- Edita `src/components/layout/Layout.tsx` (monta o botão) e
  `src/main.tsx` (inicializa a captura de console) e `src/pages/MasterAdmin.tsx`
  (monta a seção nova).

Nova dependência: `html2canvas`.

## Fora de escopo (YAGNI)

- Notificação (email/Slack) quando um relatório novo chega — master admin só
  confere no painel por enquanto.
- Exclusão definitiva de relatórios pela UI.
- Anotações/desenho sobre o print.
- Suporte a gravação de vídeo em navegadores sem `getDisplayMedia` (Safari
  iOS, navegadores antigos) — nesses casos o botão de gravar fica
  desabilitado com uma dica, mas o resto do fluxo (print + comentário +
  console) funciona normalmente.

## Teste

Projeto não tem suite de testes automatizados (sem Vitest/Jest configurado).
Validação manual: rodar `yarn dev` (ou `npm run dev`), testar como
admin/financial (ícone aparece, print captura, gravação funciona, envio
sobe pro Storage e insere a linha) e como teacher (ícone não aparece) e como
master admin (relatório aparece no painel, anexos abrem via signed URL,
marcar como resolvido funciona). `yarn build` antes de considerar pronto,
por causa do `FRONTEND.md` (build check obrigatório).
