import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { School, Save, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { ImportSection } from '@/components/settings/ImportSection';
import { AuditHistorySection } from '@/components/settings/AuditHistorySection';
import { SegmentPicker } from '@/components/settings/SegmentPicker';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const schoolSchema = z.object({
  name:            z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  segments:        z.array(z.string()).min(1, 'Selecione pelo menos um segmento'),
  primary_segment: z.string().nullable(),
});

type SchoolFormData = z.infer<typeof schoolSchema>;

function SchoolProfileSection() {
  const { school, refetch: refreshSchool } = useSchool();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const form = useForm<SchoolFormData>({
    resolver: zodResolver(schoolSchema),
    defaultValues: {
      name:            school?.name            ?? '',
      segments:        school?.segments         ?? [],
      primary_segment: school?.primary_segment  ?? null,
    },
  });

  // Sync when school loads
  useEffect(() => {
    if (school) {
      form.reset({ name: school.name, segments: school.segments, primary_segment: school.primary_segment });
    }
  }, [school]);

  const selectedSegments = form.watch('segments');
  const primarySegment = form.watch('primary_segment');

  const handleSubmit = async (data: SchoolFormData) => {
    if (!school) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('schools')
        .update({ name: data.name, segments: data.segments, primary_segment: data.primary_segment })
        .eq('id', school.id);

      if (error) throw error;

      await refreshSchool();
      toast({ title: 'Escola atualizada com sucesso!' });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: getFriendlyErrorMessage(err, 'Erro ao salvar: ' + err.message), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <School className="h-5 w-5 text-primary" />
          <CardTitle>Perfil da Escola</CardTitle>
        </div>
        <CardDescription>
          Nome e segmentos atendidos pela instituição
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!school ? (
          <p className="text-sm text-muted-foreground">Nenhuma escola configurada.</p>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da escola</FormLabel>
                    <FormControl>
                      <Input className="max-w-md" {...field} />
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
                    <FormLabel>Segmentos atendidos</FormLabel>
                    <p className="text-xs text-muted-foreground">
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

              <Button type="submit" disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </Button>

            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

const Settings = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Gerencie as informações e preferências da escola</p>
      </div>

      <Tabs defaultValue="escola">
        <TabsList>
          <TabsTrigger value="escola">Escola</TabsTrigger>
          <TabsTrigger value="historico">Histórico de alterações</TabsTrigger>
        </TabsList>

        <TabsContent value="escola" className="space-y-6 mt-6">
          <SchoolProfileSection />
          <ImportSection />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="h-4 w-4" />
                Gerar mensalidades em lote
              </CardTitle>
              <CardDescription>
                Útil depois de importar vários contratos de uma vez — gera as mensalidades pendentes
                de todos os contratos ativos, sem precisar abrir um por um em Contratos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link to="/admin/gerar-mensalidades">Abrir gerador em lote</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historico" className="mt-6">
          <AuditHistorySection />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
