# Ferramenta de debug/feedback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão de "reportar bug" no header (ao lado do toggle de tema) que captura print, comentário, gravação de tela opcional e log do console, e envia pra um painel de revisão visível só ao master admin.

**Architecture:** Uma migration nova cria a tabela `debug_reports` + bucket de Storage `debug-reports` com RLS. No frontend: um módulo de captura de console iniciado no boot do app, helpers isolados de captura de print/vídeo, um `Sheet` de envio (gatilho `admin`/`financial` no header) e uma seção nova no Painel Master pra listar/revisar os relatórios.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + Storage + RLS), shadcn/ui (Sheet, Textarea, Badge, Card), html2canvas (novo).

**Spec:** `docs/superpowers/specs/2026-09-13-debug-report-tool-design.md`

## Global Constraints

- Projeto **não tem suite de testes automatizados** (sem Vitest/Jest configurado) — cada task verifica com `npx tsc --noEmit`, `npm run build`, e checagem manual no navegador (`npm run dev`), não com testes unitários.
- Tabelas usam `REFERENCES` (FK) e `TIMESTAMPTZ`, seguindo o padrão já usado em `20260911_expenses.sql` — não seguir a regra genérica "sem FK" do toolkit Spartan (é de outro stack).
- Toda query contra tabelas novas usa `(supabase as any)` até os tipos gerados serem atualizados — mesmo padrão já usado em `expenses`/`class_teachers` no código existente.
- `profiles.user_id` (não `profiles.id`) é a coluna que casa com `auth.uid()`.
- Migrations SQL são entregues pro usuário rodar manualmente no Supabase Studio (SQL Editor) ou `supabase db push` — Claude não tem acesso de execução SQL direto neste projeto.
- Erros mostrados ao usuário sempre passam por `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`), nunca `error.message` cru.

---

### Task 1: Captura de console + dependência html2canvas

**Files:**
- Modify: `package.json` (adicionar `html2canvas`)
- Create: `src/lib/consoleCapture.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `ConsoleLevel = 'log' | 'info' | 'warn' | 'error'`, `ConsoleEntry { level: ConsoleLevel; message: string; timestamp: string }`, `initConsoleCapture(): void`, `getConsoleBuffer(): ConsoleEntry[]`

- [ ] **Step 1: Instalar html2canvas**

Run: `npm install html2canvas`

Expected: `package.json` e `package-lock.json` (ou `bun.lockb`/`yarn.lock`, o que o projeto usa) atualizados com `html2canvas` em `dependencies`.

- [ ] **Step 2: Criar o módulo de captura de console**

Criar `src/lib/consoleCapture.ts`:

```typescript
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: string;
}

const BUFFER_LIMIT = 100;
const buffer: ConsoleEntry[] = [];
let initialized = false;

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function record(level: ConsoleLevel, args: unknown[]) {
  buffer.push({
    level,
    message: args.map(serializeArg).join(' '),
    timestamp: new Date().toISOString(),
  });
  if (buffer.length > BUFFER_LIMIT) {
    buffer.shift();
  }
}

export function initConsoleCapture(): void {
  if (initialized) return;
  initialized = true;

  (['log', 'info', 'warn', 'error'] as ConsoleLevel[]).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  });
}

export function getConsoleBuffer(): ConsoleEntry[] {
  return [...buffer];
}
```

- [ ] **Step 3: Inicializar no boot do app**

Modificar `src/main.tsx`:

```typescript
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initConsoleCapture } from './lib/consoleCapture'

initConsoleCapture();

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros relacionados a `consoleCapture.ts` ou `main.tsx`.

- [ ] **Step 5: Verificar manualmente**

Run: `npm run dev`, abrir o app no navegador, abrir o DevTools console, digitar `console.warn('teste')` — confirmar que a mensagem ainda aparece normalmente no console do navegador (o wrapper não pode engolir a call original).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/consoleCapture.ts src/main.tsx
git commit -m "Captura buffer de console (log/warn/error/info) para a ferramenta de debug"
```

---

### Task 2: Helpers de captura de print e gravação de tela

**Files:**
- Create: `src/lib/captureScreenshot.ts`
- Create: `src/lib/screenRecording.ts`

**Interfaces:**
- Consumes: `html2canvas` (npm, instalado na Task 1)
- Produces: `captureScreenshot(): Promise<Blob | null>`, `MAX_RECORDING_MS: number`, `ScreenRecordingHandle { stop: () => void }`, `startScreenRecording(onStop: (blob: Blob | null) => void): Promise<ScreenRecordingHandle>`

- [ ] **Step 1: Criar o helper de print**

Criar `src/lib/captureScreenshot.ts`:

```typescript
import html2canvas from 'html2canvas';

export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const canvas = await html2canvas(document.body, { logging: false, useCORS: true });
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Criar o helper de gravação de tela**

Criar `src/lib/screenRecording.ts`:

```typescript
export const MAX_RECORDING_MS = 2 * 60 * 1000;

export interface ScreenRecordingHandle {
  stop: () => void;
}

export async function startScreenRecording(
  onStop: (blob: Blob | null) => void
): Promise<ScreenRecordingHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    onStop(chunks.length > 0 ? new Blob(chunks, { type: 'video/webm' }) : null);
  };

  recorder.onstop = finish;
  // usuário também pode parar clicando em "Parar de compartilhar" na UI nativa do navegador
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (recorder.state !== 'inactive') recorder.stop();
  });

  recorder.start();

  const timeoutId = setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, MAX_RECORDING_MS);

  return {
    stop: () => {
      clearTimeout(timeoutId);
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. `MediaRecorder`/`getDisplayMedia` já têm tipos padrão do `lib.dom.d.ts` — não deve precisar de `@types` extra.

- [ ] **Step 4: Commit**

```bash
git add src/lib/captureScreenshot.ts src/lib/screenRecording.ts
git commit -m "Helpers isolados de captura de print e gravação de tela"
```

---

### Task 3: Migration SQL — tabela debug_reports + bucket + RLS

**Files:**
- Create: `supabase/migrations/20260913120000_debug_reports.sql`

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260913120000_debug_reports.sql`:

```sql
-- ================================================================
-- MIGRATION: debug_reports (ferramenta de debug/feedback)
-- admin/financial reportam bugs com print, vídeo e console log;
-- só master admin lê. Ver
-- docs/superpowers/specs/2026-09-13-debug-report-tool-design.md
-- ================================================================

CREATE TABLE public.debug_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id),
  comment         text        NOT NULL,
  page_url        text        NOT NULL,
  user_agent      text,
  screenshot_path text,
  video_path      text,
  console_logs    jsonb       NOT NULL DEFAULT '[]',
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE INDEX ON public.debug_reports (school_id);
CREATE INDEX ON public.debug_reports (status);

ALTER TABLE public.debug_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and financial can submit debug reports"
  ON public.debug_reports FOR INSERT
  WITH CHECK (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial') AND
    user_id = auth.uid()
  );

CREATE POLICY "Master admin can view debug reports"
  ON public.debug_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  );

CREATE POLICY "Master admin can update debug reports"
  ON public.debug_reports FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  );

-- Bucket de Storage para os anexos (print/vídeo), privado
INSERT INTO storage.buckets (id, name, public)
VALUES ('debug-reports', 'debug-reports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own school's debug attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'debug-reports' AND
    (storage.foldername(name))[1] = public.get_user_school_id()::text
  );

CREATE POLICY "Master admin can read debug attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'debug-reports' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_master_admin = true
    )
  );
```

- [ ] **Step 2: Entregar para o usuário rodar**

Esta migration não pode ser aplicada pelo Claude (sem acesso de execução SQL neste projeto). Ao chegar nesta task, avisar o usuário para rodar o arquivo `supabase/migrations/20260913120000_debug_reports.sql` no Supabase Studio (SQL Editor) ou via `supabase db push`, e confirmar antes de seguir para as tasks que dependem da tabela/bucket existirem (Task 4 em diante já podem ser escritas, mas só podem ser testadas manualmente depois que essa migration rodar).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260913120000_debug_reports.sql
git commit -m "Migration: tabela debug_reports + bucket de Storage + RLS"
```

---

### Task 4: Orquestração de envio (debugReport.ts)

**Files:**
- Create: `src/lib/debugReport.ts`

**Interfaces:**
- Consumes: `getConsoleBuffer()` (Task 1), `supabase` client (`src/integrations/supabase/client.ts`)
- Produces: `SubmitDebugReportParams { schoolId: string; userId: string; comment: string; screenshotBlob: Blob | null; videoBlob: Blob | null }`, `submitDebugReport(params: SubmitDebugReportParams): Promise<void>` (rejeita a Promise em caso de erro — quem chama trata com `getFriendlyErrorMessage`)

- [ ] **Step 1: Criar o módulo**

Criar `src/lib/debugReport.ts`:

```typescript
import { supabase } from '@/integrations/supabase/client';
import { getConsoleBuffer } from '@/lib/consoleCapture';

export interface SubmitDebugReportParams {
  schoolId: string;
  userId: string;
  comment: string;
  screenshotBlob: Blob | null;
  videoBlob: Blob | null;
}

const BUCKET = 'debug-reports';

export async function submitDebugReport(params: SubmitDebugReportParams): Promise<void> {
  const { schoolId, userId, comment, screenshotBlob, videoBlob } = params;
  const reportId = crypto.randomUUID();

  let screenshotPath: string | null = null;
  if (screenshotBlob) {
    screenshotPath = `${schoolId}/${reportId}/screenshot.png`;
    const { error } = await (supabase as any).storage
      .from(BUCKET)
      .upload(screenshotPath, screenshotBlob, { contentType: 'image/png' });
    if (error) throw error;
  }

  let videoPath: string | null = null;
  if (videoBlob) {
    videoPath = `${schoolId}/${reportId}/video.webm`;
    const { error } = await (supabase as any).storage
      .from(BUCKET)
      .upload(videoPath, videoBlob, { contentType: 'video/webm' });
    if (error) throw error;
  }

  const { error } = await (supabase as any).from('debug_reports').insert({
    id: reportId,
    school_id: schoolId,
    user_id: userId,
    comment,
    page_url: window.location.pathname,
    user_agent: navigator.userAgent,
    screenshot_path: screenshotPath,
    video_path: videoPath,
    console_logs: getConsoleBuffer(),
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/debugReport.ts
git commit -m "Orquestração de upload + insert do relatório de debug"
```

---

### Task 5: Formulário (DebugReportSheet.tsx)

**Files:**
- Create: `src/components/debug/DebugReportSheet.tsx`

**Interfaces:**
- Consumes: `captureScreenshot()` (Task 2), `startScreenRecording()` + `ScreenRecordingHandle` (Task 2), `submitDebugReport()` (Task 4), `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`), `useAuth()` (`src/contexts/AuthContext.tsx`, expõe `user.id`), `useSchool()` (`src/contexts/SchoolContext.tsx`, expõe `schoolId`), `useToast()` (`src/hooks/use-toast.ts`)
- Produces: `DebugReportSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })`

- [ ] **Step 1: Criar o componente**

Criar `src/components/debug/DebugReportSheet.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Camera, Video, Square, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { captureScreenshot } from '@/lib/captureScreenshot';
import { startScreenRecording, type ScreenRecordingHandle } from '@/lib/screenRecording';
import { submitDebugReport } from '@/lib/debugReport';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

interface DebugReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_COMMENT_LENGTH = 10;

export function DebugReportSheet({ open, onOpenChange }: DebugReportSheetProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { schoolId } = useSchool();

  const [comment, setComment] = useState('');
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const recordingHandleRef = useRef<ScreenRecordingHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setComment('');
    setScreenshotBlob(null);
    setScreenshotUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setVideoBlob(null);
    setVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setRecording(false);
    setRecordingSeconds(0);
  };

  // Captura o print assim que o painel abre (QA da própria feature: sem isso
  // o usuário teria que lembrar de tirar print antes de reportar o bug).
  useEffect(() => {
    if (!open) return;
    captureScreenshot().then((blob) => {
      if (!blob) return;
      setScreenshotBlob(blob);
      setScreenshotUrl(URL.createObjectURL(blob));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) return;
    resetForm();
    if (recordingHandleRef.current) {
      recordingHandleRef.current.stop();
      recordingHandleRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const replaceScreenshot = (blob: Blob) => {
    setScreenshotUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
    setScreenshotBlob(blob);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) replaceScreenshot(file);
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) replaceScreenshot(file);
  };

  const startRecording = async () => {
    try {
      const handle = await startScreenRecording((blob) => {
        setRecording(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (blob) {
          setVideoBlob(blob);
          setVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        }
      });
      recordingHandleRef.current = handle;
      setRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      toast({ title: 'Gravação cancelada', description: 'Nenhuma permissão de tela concedida.' });
    }
  };

  const stopRecording = () => {
    recordingHandleRef.current?.stop();
  };

  const handleSubmit = async () => {
    if (!schoolId || !user) return;
    if (comment.trim().length < MIN_COMMENT_LENGTH) {
      toast({
        title: 'Comentário muito curto',
        description: `Descreva o problema com pelo menos ${MIN_COMMENT_LENGTH} caracteres.`,
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);
    try {
      await submitDebugReport({
        schoolId,
        userId: user.id,
        comment: comment.trim(),
        screenshotBlob,
        videoBlob,
      });
      toast({ title: 'Relatório enviado', description: 'Obrigado! Vamos investigar.' });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Erro ao enviar',
        description: getFriendlyErrorMessage(error, 'Erro ao enviar relatório: ' + (error as Error)?.message),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Reportar um problema</SheetTitle>
          <SheetDescription>
            Descreva o que aconteceu. O print da tela atual e o log do console são anexados automaticamente.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium">O que aconteceu?</label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onPaste={handlePaste}
            placeholder="Ex: ao salvar a turma, apareceu um erro e a tela travou..."
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Print</label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Trocar print
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </div>
          </div>
          {screenshotUrl ? (
            <img src={screenshotUrl} alt="Print da tela" className="max-h-48 w-full rounded border object-contain" />
          ) : (
            <div className="flex h-24 items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
              <Camera className="mr-2 h-4 w-4" /> Capturando print...
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Vídeo (opcional)</label>
          {videoUrl ? (
            <video src={videoUrl} controls className="max-h-48 w-full rounded border" />
          ) : recording ? (
            <div className="flex items-center gap-2 rounded border border-dashed p-3">
              <Badge variant="destructive" className="animate-pulse">● Gravando</Badge>
              <span className="text-sm text-muted-foreground">{recordingSeconds}s / 120s</span>
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={stopRecording}>
                <Square className="mr-1 h-3 w-3" /> Parar
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={startRecording}>
              <Video className="mr-2 h-4 w-4" /> Gravar tela
            </Button>
          )}
        </div>

        <SheetFooter>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar relatório
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/debug/DebugReportSheet.tsx
git commit -m "Formulário de envio: print automático, comentário e gravação de tela"
```

---

### Task 6: Botão no header (DebugReportButton.tsx) + wiring no Layout

**Files:**
- Create: `src/components/debug/DebugReportButton.tsx`
- Modify: `src/components/layout/Layout.tsx:1-51` (import + render antes do `<ThemeToggle />`)

**Interfaces:**
- Consumes: `useRole()` → `hasRole(...roles): boolean` (`src/hooks/use-role.ts`), `DebugReportSheet` (Task 5)
- Produces: `DebugReportButton()` — componente sem props, se auto-oculta se o papel não for admin/financial

- [ ] **Step 1: Criar o botão**

Criar `src/components/debug/DebugReportButton.tsx`:

```tsx
import { useState } from 'react';
import { Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/use-role';
import { DebugReportSheet } from './DebugReportSheet';

export function DebugReportButton() {
  const { hasRole } = useRole();
  const [open, setOpen] = useState(false);

  if (!hasRole('admin', 'financial')) return null;

  return (
    <>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setOpen(true)}>
        <Bug className="h-4 w-4" />
        <span className="sr-only">Reportar um problema</span>
      </Button>
      <DebugReportSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
```

- [ ] **Step 2: Montar no header, ao lado do ThemeToggle**

Modificar `src/components/layout/Layout.tsx`. Adicionar o import junto aos outros:

```typescript
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DebugReportButton } from "@/components/debug/DebugReportButton";
```

E no JSX do header, trocar:

```tsx
            <ThemeToggle />
```

por:

```tsx
            <DebugReportButton />
            <ThemeToggle />
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificar manualmente (antes da migration rodar, o botão já deve aparecer/sumir certo por papel)**

Run: `npm run dev`. Logar como usuário com papel `admin` ou `financial` (ou owner, que sempre é admin) — o ícone de inseto deve aparecer ao lado do toggle de tema em toda página. Logar como `teacher` — o ícone não deve aparecer. (O envio em si só funciona depois que a Task 3 rodar em produção/dev.)

- [ ] **Step 5: Commit**

```bash
git add src/components/debug/DebugReportButton.tsx src/components/layout/Layout.tsx
git commit -m "Ícone de reportar bug no header, visível para admin/financial"
```

---

### Task 7: Painel de revisão no Master Admin (DebugReportsSection.tsx)

**Files:**
- Create: `src/components/master/DebugReportsSection.tsx`
- Modify: `src/pages/MasterAdmin.tsx` (import + render da seção)

**Interfaces:**
- Consumes: `supabase` client, `getFriendlyErrorMessage`, `useToast()`
- Produces: `DebugReportsSection()` — sem props, busca e lista os relatórios de todas as escolas

- [ ] **Step 1: Criar a seção**

Criar `src/components/master/DebugReportsSection.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

interface DebugReportRow {
  id: string;
  school_id: string;
  user_id: string;
  comment: string;
  page_url: string;
  user_agent: string | null;
  screenshot_path: string | null;
  video_path: string | null;
  console_logs: { level: string; message: string; timestamp: string }[];
  status: 'open' | 'resolved';
  created_at: string;
}

const BUCKET = 'debug-reports';

export function DebugReportsSection() {
  const { toast } = useToast();
  const [reports, setReports] = useState<DebugReportRow[]>([]);
  const [schoolNames, setSchoolNames] = useState<Record<string, string>>({});
  const [userLabels, setUserLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, { screenshot?: string; video?: string }>>({});

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const [
        { data: reportsData, error: reportsErr },
        { data: schools, error: schoolsErr },
        { data: profiles, error: profilesErr },
      ] = await Promise.all([
        (supabase as any).from('debug_reports').select('*').order('created_at', { ascending: false }),
        (supabase as any).from('schools').select('id, name'),
        (supabase as any).from('profiles').select('user_id, full_name, email'),
      ]);
      if (reportsErr) throw reportsErr;
      if (schoolsErr) throw schoolsErr;
      if (profilesErr) throw profilesErr;

      setReports(reportsData ?? []);
      setSchoolNames(Object.fromEntries((schools ?? []).map((s: any) => [s.id, s.name])));
      setUserLabels(Object.fromEntries((profiles ?? []).map((p: any) => [p.user_id, p.full_name || p.email])));
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao carregar relatórios: ' + (error as Error)?.message),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = async (report: DebugReportRow) => {
    if (expandedId === report.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(report.id);
    if (attachmentUrls[report.id]) return;

    const urls: { screenshot?: string; video?: string } = {};
    if (report.screenshot_path) {
      const { data } = await (supabase as any).storage.from(BUCKET).createSignedUrl(report.screenshot_path, 300);
      if (data?.signedUrl) urls.screenshot = data.signedUrl;
    }
    if (report.video_path) {
      const { data } = await (supabase as any).storage.from(BUCKET).createSignedUrl(report.video_path, 300);
      if (data?.signedUrl) urls.video = data.signedUrl;
    }
    setAttachmentUrls((prev) => ({ ...prev, [report.id]: urls }));
  };

  const toggleStatus = async (report: DebugReportRow) => {
    const newStatus = report.status === 'open' ? 'resolved' : 'open';
    try {
      const { error } = await (supabase as any)
        .from('debug_reports')
        .update({ status: newStatus, resolved_at: newStatus === 'resolved' ? new Date().toISOString() : null })
        .eq('id', report.id);
      if (error) throw error;
      setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: newStatus } : r)));
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao atualizar status: ' + (error as Error)?.message),
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Relatórios de Bug</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Carregando...</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Relatórios de Bug ({reports.filter((r) => r.status === 'open').length} abertos)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {reports.length === 0 && <p className="text-sm text-muted-foreground">Nenhum relatório enviado ainda.</p>}
        {reports.map((report) => {
          const expanded = expandedId === report.id;
          const urls = attachmentUrls[report.id];
          return (
            <div key={report.id} className="rounded border">
              <button
                type="button"
                onClick={() => toggleExpand(report)}
                className="flex w-full items-center gap-3 p-3 text-left"
              >
                <Badge variant={report.status === 'open' ? 'destructive' : 'secondary'}>
                  {report.status === 'open' ? 'Aberto' : 'Resolvido'}
                </Badge>
                <span className="text-sm font-medium">{schoolNames[report.school_id] ?? report.school_id}</span>
                <span className="text-sm text-muted-foreground">{userLabels[report.user_id] ?? report.user_id}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {format(new Date(report.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </span>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <p className="px-3 pb-3 text-sm">{report.comment}</p>
              {expanded && (
                <div className="space-y-3 border-t p-3">
                  <p className="text-xs text-muted-foreground">
                    {report.page_url} • {report.user_agent}
                  </p>
                  {urls?.screenshot && (
                    <img src={urls.screenshot} alt="Print" className="max-h-64 rounded border object-contain" />
                  )}
                  {urls?.video && (
                    <video src={urls.video} controls className="max-h-64 w-full rounded border" />
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium">
                      Console ({report.console_logs.length} entradas)
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2">
                      {report.console_logs.map((l) => `[${l.level}] ${l.timestamp} ${l.message}`).join('\n')}
                    </pre>
                  </details>
                  <Button type="button" size="sm" variant="outline" onClick={() => toggleStatus(report)}>
                    Marcar como {report.status === 'open' ? 'resolvido' : 'aberto'}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Montar no Painel Master**

Modificar `src/pages/MasterAdmin.tsx`. Adicionar o import junto aos demais:

```typescript
import { DebugReportsSection } from "@/components/master/DebugReportsSection";
```

E no JSX, logo depois do bloco que fecha a grade de escolas (depois do `)}` que fecha o `{loading ? (...) : schools.length === 0 ? (...) : (...)}` e antes do comentário `{/* Edit modal */}`), adicionar:

```tsx
      <DebugReportsSection />

```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/master/DebugReportsSection.tsx src/pages/MasterAdmin.tsx
git commit -m "Painel Master: seção de Relatórios de Bug com print/vídeo/console"
```

---

### Task 8: QA manual fim a fim + build

**Files:** nenhum (checagem, sem alteração de código a menos que algo quebre)

- [ ] **Step 1: Confirmar que a migration da Task 3 já rodou**

Perguntar ao usuário se já rodou `supabase/migrations/20260913120000_debug_reports.sql` em produção/dev antes de prosseguir com o QA — sem a tabela e o bucket, o envio vai falhar.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build completa sem erros de TypeScript (conforme `FRONTEND.md` — build check obrigatório antes de considerar pronto).

- [ ] **Step 3: QA como admin/financial**

Run: `npm run dev`, logar como admin (ou financial). Clicar no ícone de inseto no header:
- Print aparece automaticamente na prévia.
- Escrever um comentário curto (< 10 caracteres) e tentar enviar → toast de erro "Comentário muito curto".
- Escrever um comentário válido, clicar "Gravar tela", conceder permissão, aguardar alguns segundos, clicar "Parar" → preview de vídeo aparece.
- Clicar "Enviar relatório" → toast de sucesso, painel fecha.
- Verificar no Supabase Studio (Table Editor) que a linha foi criada em `debug_reports` com `screenshot_path` e `video_path` preenchidos, e que os arquivos existem no bucket `debug-reports`.

- [ ] **Step 4: QA como teacher**

Logar como usuário com papel `teacher`. Confirmar que o ícone de inseto **não aparece** no header em nenhuma página.

- [ ] **Step 5: QA como master admin**

Logar como master admin, ir ao Painel Master. Confirmar:
- A seção "Relatórios de Bug" lista o relatório enviado no Step 3, com nome da escola e do usuário corretos.
- Expandir o relatório mostra print, vídeo e o log do console (deve ter pelo menos as entradas geradas pelo próprio carregamento da página).
- Clicar "Marcar como resolvido" atualiza o badge para "Resolvido" sem reload da página.

- [ ] **Step 6: Commit final (se algo precisou de ajuste durante o QA)**

```bash
git add -A
git commit -m "Ajustes de QA na ferramenta de debug/feedback"
```

(Pular este commit se nenhum ajuste foi necessário.)
