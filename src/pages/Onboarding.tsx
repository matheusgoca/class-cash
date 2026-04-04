import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { School, BookOpen, GraduationCap, Building2, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const SEGMENTS = [
  { value: 'infantil',    label: 'Educação Infantil', icon: Lightbulb,     description: 'Berçário ao Pré' },
  { value: 'fundamental', label: 'Ensino Fundamental', icon: BookOpen,      description: '1º ao 9º Ano' },
  { value: 'medio',       label: 'Ensino Médio',       icon: GraduationCap, description: '1ª à 3ª Série' },
  { value: 'tecnico',     label: 'Curso Técnico',      icon: Building2,     description: 'Cursos profissionalizantes' },
];

const schema = z.object({
  name:     z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  segments: z.array(z.string()).min(1, 'Selecione pelo menos um segmento'),
});

type FormData = z.infer<typeof schema>;

export default function Onboarding() {
  const navigate    = useNavigate();
  const { toast }   = useToast();
  const { user } = useAuth();
  const { refetch: refreshSchool } = useSchool();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', segments: [] },
  });

  const selectedSegments = form.watch('segments');

  const toggleSegment = (value: string) => {
    const current = form.getValues('segments');
    const next = current.includes(value)
      ? current.filter(s => s !== value)
      : [...current, value];
    form.setValue('segments', next, { shouldValidate: true });
  };

  const handleSubmit = async (data: FormData) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data: school, error: schoolError } = await (supabase as any)
        .from('schools')
        .insert({
          name:          data.name,
          segments:      data.segments,
          owner_user_id: user.id,
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

      await refreshSchool();
      toast({ title: 'Escola criada!', description: `Bem-vindo ao ${data.name}` });
      navigate('/dashboard');
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

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
                  <p className="text-xs text-muted-foreground -mt-1">Selecione um ou mais</p>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    {SEGMENTS.map((seg) => {
                      const Icon   = seg.icon;
                      const active = selectedSegments.includes(seg.value);
                      return (
                        <button
                          key={seg.value}
                          type="button"
                          onClick={() => toggleSegment(seg.value)}
                          className={cn(
                            'flex flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all',
                            active
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border hover:border-primary/40 hover:bg-accent'
                          )}
                        >
                          <Icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} />
                          <span className={cn('text-sm font-semibold', active ? 'text-primary' : '')}>{seg.label}</span>
                          <span className="text-xs text-muted-foreground">{seg.description}</span>
                        </button>
                      );
                    })}
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
      </div>
    </div>
  );
}
