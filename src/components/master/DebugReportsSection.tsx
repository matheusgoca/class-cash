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
import { ClickToZoomImage } from '@/components/debug/ClickToZoomImage';

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
                    <ClickToZoomImage
                      src={urls.screenshot}
                      alt="Print"
                      className="max-h-64 rounded border object-contain"
                    />
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
