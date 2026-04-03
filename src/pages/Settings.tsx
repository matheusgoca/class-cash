import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { School, BookOpen, GraduationCap, Building2, Lightbulb, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const SEGMENTS = [
  { value: 'infantil',    label: 'Educação Infantil', icon: Lightbulb,     description: 'Berçário ao Pré' },
  { value: 'fundamental', label: 'Ensino Fundamental', icon: BookOpen,      description: '1º ao 9º Ano' },
  { value: 'medio',       label: 'Ensino Médio',       icon: GraduationCap, description: '1ª à 3ª Série' },
  { value: 'tecnico',     label: 'Curso Técnico',      icon: Building2,     description: 'Cursos profissionalizantes' },
];

const SEGMENT_LABELS: Record<string, string> = {
  infantil:    'Educação Infantil',
  fundamental: 'Ensino Fundamental',
  medio:       'Ensino Médio',
  tecnico:     'Curso Técnico',
};

const schoolSchema = z.object({
  name:     z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  segments: z.array(z.string()).min(1, 'Selecione pelo menos um segmento'),
});

type SchoolFormData = z.infer<typeof schoolSchema>;

function SchoolProfileSection() {
  const { school, refetch: refreshSchool } = useSchool();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const form = useForm<SchoolFormData>({
    resolver: zodResolver(schoolSchema),
    defaultValues: {
      name:     school?.name     ?? '',
      segments: school?.segments ?? [],
    },
  });

  // Sync when school loads
  useEffect(() => {
    if (school) {
      form.reset({ name: school.name, segments: school.segments });
    }
  }, [school]);

  const selectedSegments = form.watch('segments');

  const toggleSegment = (value: string) => {
    const current = form.getValues('segments');
    const next = current.includes(value)
      ? current.filter(s => s !== value)
      : [...current, value];
    form.setValue('segments', next, { shouldValidate: true });
  };

  const handleSubmit = async (data: SchoolFormData) => {
    if (!school) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('schools')
        .update({ name: data.name, segments: data.segments })
        .eq('id', school.id);

      if (error) throw error;

      await refreshSchool();
      toast({ title: 'Escola atualizada com sucesso!' });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
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
                    <p className="text-xs text-muted-foreground">Selecione um ou mais</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
                      {SEGMENTS.map((seg) => {
                        const Icon   = seg.icon;
                        const active = selectedSegments.includes(seg.value);
                        return (
                          <button
                            key={seg.value}
                            type="button"
                            onClick={() => toggleSegment(seg.value)}
                            className={cn(
                              'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                              active
                                ? 'border-primary bg-primary/5 shadow-sm'
                                : 'border-border hover:border-primary/40 hover:bg-accent'
                            )}
                          >
                            <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
                            <span className={cn('text-xs font-semibold leading-tight', active ? 'text-primary' : '')}>{seg.label}</span>
                            <span className="text-xs text-muted-foreground leading-tight">{seg.description}</span>
                          </button>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving} className="gap-2">
                  <Save className="h-4 w-4" />
                  {saving ? 'Salvando...' : 'Salvar alterações'}
                </Button>
                {selectedSegments.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedSegments.map(s => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {SEGMENT_LABELS[s] ?? s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

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

      <SchoolProfileSection />
    </div>
  );
};

export default Settings;
