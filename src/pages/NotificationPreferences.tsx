import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DigestSettings } from '@/components/notifications/DigestSettings';
import { PreferencesMatrix } from '@/components/notifications/PreferencesMatrix';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterAdmin } from '@/contexts/MasterAdminContext';
import { useToast } from '@/hooks/use-toast';
import { useRole } from '@/hooks/use-role';
import { isMasterViewingOtherSchool } from '@/lib/accountMenu';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { applyRecommendedEmails, canSave, type PreferencesState } from '@/lib/notificationEvents';
import { ensurePreferences, savePreferences } from '@/lib/notificationPreferences';

const NotificationPreferences = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { isMasterAdmin, viewingSchoolId } = useMasterAdmin();
  const { role } = useRole();

  const [saved, setSaved] = useState<PreferencesState | null>(null);
  const [draft, setDraft] = useState<PreferencesState | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // D4: o RPC grava na escola de casa; visualizando outra escola, não carrega nada.
  const otherSchool = isMasterViewingOtherSchool({
    role, isMasterAdmin, viewingSchoolId, homeSchoolId: profile?.school_id ?? null,
  });

  useEffect(() => {
    if (otherSchool) return;
    let cancelled = false;
    ensurePreferences()
      .then((loaded) => {
        if (cancelled) return;
        setSaved(loaded.state);
        setDraft(loaded.state);
        setConfirmedAt(loaded.confirmedAt);
      })
      .catch((err) => {
        if (cancelled) return;
        setSaved(null);
        setDraft(null);
        setLoadError(getFriendlyErrorMessage(err, 'Não foi possível carregar suas preferências.'));
      });
    return () => {
      cancelled = true;
    };
  }, [otherSchool]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const loaded = await savePreferences(draft, timezone);
      setSaved(loaded.state);
      setDraft(loaded.state);
      setConfirmedAt(loaded.confirmedAt);
      toast({ title: 'Preferências salvas' });
    } catch (err) {
      // o rascunho fica como está: o usuário não perde o que marcou
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(err, 'Não foi possível salvar suas preferências.'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/notificacoes">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Notificações
        </Link>
      </Button>
      <h1 className="text-3xl font-bold tracking-tight">Preferências de notificação</h1>
      <p className="text-muted-foreground">Escolha o que avisar, onde e com quanta antecedência. Vale para o seu usuário.</p>
    </div>
  );

  if (otherSchool) {
    return (
      <div className="space-y-6">
        {header}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Você está visualizando outra escola. Suas preferências de notificação valem para a sua própria escola: volte ao painel master e acesse-a para ajustá-las.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        {header}
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!saved || !draft) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="max-w-4xl">
          <CardContent className="space-y-3 pt-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const firstAccess = confirmedAt === null;
  const hasRecommended = draft.preferences.some((p) => p.emailRecommended && !p.email);

  return (
    <div className="space-y-6">
      {header}
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Notificações</CardTitle>
          <CardDescription>Avisos no sistema e por e-mail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {firstAccess && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Os e-mails estão desligados. Ative os que quiser e salve.</span>
                {hasRecommended && (
                  <Button size="sm" variant="outline" onClick={() => setDraft(applyRecommendedEmails(draft))} disabled={saving}>
                    Ativar e-mails recomendados
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <PreferencesMatrix
            preferences={draft.preferences}
            onChange={(preferences) => setDraft({ ...draft, preferences })}
            disabled={saving}
          />
          <DigestSettings digest={draft.digest} onChange={(digest) => setDraft({ ...draft, digest })} disabled={saving} />

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Os avisos serão ativados nas próximas versões. Suas escolhas já ficam salvas.
            </p>
            <Button onClick={handleSave} disabled={saving || !canSave(saved, draft, confirmedAt)}>
              {saving ? 'Salvando...' : 'Salvar preferências'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NotificationPreferences;
