import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { School } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { SegmentPicker } from '@/components/settings/SegmentPicker';
import { normalizeSegments } from '@/lib/segments';

// accept-invite (chamada em Auth.tsx logo após definir a senha) já deveria
// marcar o convite como aceito e garantir a role de dono — mas ela tinha um
// bug que fazia isso falhar sempre para convites de dono (tentava gravar
// role='owner' em user_roles, que é um enum sem esse valor — só existe
// admin/financial/teacher; quem é dono de verdade vem de
// schools.owner_user_id, não desta coluna). Corrigido lá também, mas quem
// cria a escola com sucesso aqui é a garantia real de que esses dois
// registros ficam certos, mesmo se a edge function falhar de novo por outro
// motivo (rede, timing). Roda nos dois caminhos (auto-criação via metadado
// do convite, e o formulário manual — que foi o que rodou de fato quando o
// metadado não chegou no user_metadata a tempo).
// onConflict: 'user_id' é necessário porque a PK de user_roles é `id`, não
// `user_id` — sem isso um upsert sem conflito detectado vira um INSERT que
// esbarra na constraint UNIQUE(user_id) se a linha já existir.
async function ensureOwnerRoleAndInviteAccepted(userId: string, userEmail: string | undefined) {
  await supabase.from('user_roles').upsert({ user_id: userId, role: 'admin' }, { onConflict: 'user_id' });
  if (!userEmail) return;
  await (supabase as any)
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('email', userEmail)
    .eq('role', 'owner')
    .eq('status', 'pending');
}

const schema = z.object({
  name:            z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  segments:        z.array(z.string()).min(1, 'Selecione pelo menos um segmento'),
  primary_segment: z.string().nullable(),
});

type FormData = z.infer<typeof schema>;

export default function Onboarding() {
  const navigate    = useNavigate();
  const { toast }   = useToast();
  const { user } = useAuth();
  const { refetch: refreshSchool, schoolStatus } = useSchool();
  const [isLoading, setIsLoading] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);

  // If master invited this user with school metadata, auto-create the school on first login.
  // Guarded by schoolStatus === 'not_found' so revisiting /onboarding (back button, a stale
  // tab, or a reload right after this ran) never inserts a second school for the same owner —
  // user_metadata.pending_school_* is never cleared by Supabase itself, only by us below.
  useEffect(() => {
    const meta = user?.user_metadata;
    if (!meta?.pending_school_name || !user || schoolStatus !== 'not_found') return;
    setAutoCreating(true);
    (async () => {
      try {
        // user_metadata pode ter sido gravado antes desta sprint, com o valor
        // antigo 'fundamental' — normaliza pro schema novo (fundamental_1 +
        // fundamental_2) antes de gravar, senão o CHECK constraint recusa.
        const normalizedSegments = normalizeSegments(meta.pending_school_segments);
        const { data: school, error: schoolError } = await (supabase as any)
          .from('schools')
          .insert({
            name:            meta.pending_school_name,
            segments:        normalizedSegments,
            // Convite do master não escolhe principal; usa o primeiro na
            // ordem pedagógica (mesma regra do backfill da migration de
            // segments). O dono ajusta depois em Configurações se quiser outro.
            primary_segment: normalizedSegments[0] ?? null,
            plan:            meta.pending_school_plan ?? 'starter',
            owner_user_id:   user.id,
          })
          .select('id')
          .single();
        if (schoolError) throw schoolError;

        const { error: profileError } = await supabase
          .from('profiles')
          .update({ school_id: school.id })
          .eq('user_id', user.id);
        if (profileError) throw profileError;

        // Clear the metadata so this effect can never fire again for this user,
        // and mark the corresponding invite accepted so it drops off the Master
        // Admin pending list. Update (not delete) — the invitations DELETE policy
        // only allows school-scoped rows, but owner invites have no school_id yet;
        // the UPDATE policy already allows matching by the caller's own email.
        await supabase.auth.updateUser({
          data: { pending_school_name: null, pending_school_segments: null, pending_school_plan: null },
        });
        await ensureOwnerRoleAndInviteAccepted(user.id, user.email);

        await refreshSchool();
        toast({ title: 'Escola criada!', description: `Bem-vindo ao ${meta.pending_school_name}` });
        navigate('/dashboard');
      } catch (error: any) {
        toast({ title: 'Erro ao configurar escola', description: getFriendlyErrorMessage(error, error.message), variant: 'destructive' });
        setAutoCreating(false);
      }
    })();
  }, [user?.id, schoolStatus]);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', segments: [], primary_segment: null },
  });

  const selectedSegments = form.watch('segments');
  const primarySegment = form.watch('primary_segment');

  const handleSubmit = async (data: FormData) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data: school, error: schoolError } = await (supabase as any)
        .from('schools')
        .insert({
          name:            data.name,
          segments:        data.segments,
          primary_segment: data.primary_segment,
          owner_user_id:   user.id,
        })
        .select('id')
        .single();

      if (schoolError) throw schoolError;

      // Bind owner's profile to this school so all subsequent lookups use profiles.school_id
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ school_id: school.id })
        .eq('user_id', user.id);

      if (profileError) throw profileError;

      await ensureOwnerRoleAndInviteAccepted(user.id, user.email);

      await refreshSchool();
      toast({ title: 'Escola criada!', description: `Bem-vindo ao ${data.name}` });
      navigate('/dashboard');
    } catch (error: any) {
      toast({ title: 'Erro', description: getFriendlyErrorMessage(error, error.message), variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  if (autoCreating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        <p className="text-muted-foreground text-sm">Configurando sua escola...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-8">

        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <School className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Bem-vindo ao Class Cash</h1>
          <p className="text-muted-foreground">
            Vamos configurar sua escola para começar.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Nome da escola</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: Colégio São Paulo"
                      className="h-11 text-base"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="segments"
              render={() => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Segmentos atendidos</FormLabel>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Marque todos os que se aplicam. Depois indique qual é o principal.
                  </p>
                  <div className="mt-1">
                    <SegmentPicker
                      selected={selectedSegments}
                      primary={primarySegment}
                      onChange={(next, nextPrimary) => {
                        form.setValue('segments', next, { shouldValidate: true });
                        form.setValue('primary_segment', nextPrimary, { shouldValidate: true });
                      }}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full h-11 text-base" disabled={isLoading}>
              {isLoading ? 'Criando...' : 'Entrar no painel'}
            </Button>
          </form>
        </Form>

        <p className="text-center text-xs text-muted-foreground">
          Você pode editar essas informações depois em Configurações.
        </p>

        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="text-sm font-medium mb-2">Depois de entrar, o caminho é:</p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Cadastre as turmas</li>
            <li>Cadastre os professores e vincule às turmas</li>
            <li>Cadastre os alunos e matricule numa turma</li>
            <li>Crie o contrato de cada aluno</li>
            <li>Gere as mensalidades a partir do contrato (em Contratos ou em Configurações → gerador em lote)</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
