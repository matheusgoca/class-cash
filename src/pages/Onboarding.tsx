import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { School } from 'lucide-react';

const Onboarding = () => {
  const { user } = useAuth();
  const { refetch } = useSchool();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [schoolName, setSchoolName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !schoolName.trim()) return;

    setIsLoading(true);
    try {
      const { data: school, error: schoolError } = await supabase
        .from('schools')
        .insert([{ name: schoolName.trim(), owner_user_id: user.id }])
        .select()
        .single();

      if (schoolError) throw schoolError;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ school_id: school.id })
        .eq('user_id', user.id);

      if (profileError) throw profileError;

      await refetch();
      navigate('/');
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao criar escola',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary rounded-full p-3">
              <School className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl">Bem-vindo ao Class Cash</CardTitle>
          <CardDescription>
            Para começar, precisamos configurar a sua escola.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="schoolName">Nome da escola</Label>
              <Input
                id="schoolName"
                placeholder="Ex: Escola Estadual Dom Pedro"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading || !schoolName.trim()}>
              {isLoading ? 'Criando...' : 'Criar escola e continuar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;
