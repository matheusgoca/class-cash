import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';

interface School {
  id: string;
  name: string;
}

interface SchoolContextType {
  school: School | null;
  schoolId: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

const SchoolContext = createContext<SchoolContextType | undefined>(undefined);

export const useSchool = () => {
  const context = useContext(SchoolContext);
  if (context === undefined) {
    throw new Error('useSchool must be used within a SchoolProvider');
  }
  return context;
};

export const SchoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  // undefined = ainda não buscou, null = buscou e não tem escola
  const [school, setSchool] = useState<School | null | undefined>(undefined);

  const fetchSchool = async () => {
    if (!user) {
      setSchool(null);
      return;
    }

    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('user_id', user.id)
        .single();

      if (profileError) {
        console.error('Profile fetch error:', profileError);
        setSchool(null);
        return;
      }

      if (!profileData?.school_id) {
        setSchool(null);
        return;
      }

      const { data: schoolData, error: schoolError } = await supabase
        .from('schools')
        .select('id, name')
        .eq('id', profileData.school_id)
        .single();

      if (schoolError) {
        console.error('School fetch error:', schoolError);
        setSchool(null);
        return;
      }

      setSchool(schoolData);
    } catch (error) {
      console.error('Unexpected error in fetchSchool:', error);
      setSchool(null);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    setSchool(undefined); // reset para "carregando" enquanto busca
    fetchSchool();
  }, [user, authLoading]);

  // loading = true enquanto auth carrega OU escola ainda não foi resolvida
  const loading = authLoading || school === undefined;

  const value = {
    school: school ?? null,
    schoolId: school?.id ?? null,
    loading,
    refetch: fetchSchool,
  };

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
};
