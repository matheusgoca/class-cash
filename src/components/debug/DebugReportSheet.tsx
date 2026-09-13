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
import { ClickToZoomImage } from './ClickToZoomImage';

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

  // Captura o print assim que o painel abre — sem isso o usuário teria que
  // lembrar de tirar print antes de reportar o bug.
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
          <label className="block text-sm font-medium">O que aconteceu?</label>
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
            <>
              <ClickToZoomImage
                src={screenshotUrl}
                alt="Print da tela"
                className="max-h-48 w-full rounded border object-contain"
              />
              <p className="text-xs text-muted-foreground">Clique no print para ver em tamanho real.</p>
            </>
          ) : (
            <div className="flex h-24 items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
              <Camera className="mr-2 h-4 w-4" /> Capturando print...
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Vídeo (opcional)</label>
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
