import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';

export interface School {
  id: string;
  name: string;
  segments: string[];
  logo_url: string | null;
  owner_user_id: string;
}

type SchoolStatus = 'loading' | 'found' | 'not_found' | 'error';

interface SchoolContextType {
  school: School | null;
  schoolId: string | null;
  schoolStatus: SchoolStatus;
  loading: boolean;
  refetch: () => Promise<void>;
}

const SchoolContext = createContext<SchoolContextType | undefined>(undefined);

export const useSchool = () => {
  const context = useContext(SchoolContext);
  if (context === undefined) throw new Error('useSchool must be used within a SchoolProvider');
  return context;
};

export const SchoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [school, setSchool]           = useState<School | null>(null);
  const [schoolStatus, setSchoolStatus] = useState<SchoolStatus>('loading');

  const fetchSchool = async () => {
    if (!user) {
      setSchool(null);
      setSchoolStatus('not_found');
      return;
    }

    try {
      // 1. Try via profiles.school_id (staff invited to a school, or owner after onboarding)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('user_id', user.id)
        .maybeSingle();

      let schoolId: string | null = profile?.school_id ?? null;

      // 2. Fallback: owner lookup via schools.owner_user_id
      if (!schoolId) {
        const { data: owned, error: ownedError } = await (supabase as any)
          .from('schools')
          .select('id')
          .eq('owner_user_id', user.id)
          .maybeSingle();

        if (ownedError) {
          console.error('fetchSchool owner lookup error:', ownedError.message);
          setSchoolStatus('error');
          return;
        }

        schoolId = owned?.id ?? null;
      }

      if (!schoolId) {
        setSchool(null);
        setSchoolStatus('not_found');
        return;
      }

      // 3. Fetch full school data
      const { data: schoolData, error: schoolError } = await (supabase as any)
        .from('schools')
        .select('id, name, segments, logo_url, owner_user_id')
        .eq('id', schoolId)
        .single();

      if (schoolError) {
        console.error('fetchSchool data error:', schoolError.message);
        setSchoolStatus('error');
        return;
      }

      setSchool({ ...schoolData, segments: schoolData.segments ?? [] });
      setSchoolStatus('found');
    } catch (err) {
      console.error('fetchSchool exception:', err);
      setSchoolStatus('error');
    }
  };

  useEffect(() => {
    if (authLoading) return;
    setSchoolStatus('loading');
    fetchSchool();
  }, [user, authLoading]);

  const loading = authLoading || schoolStatus === 'loading';

  return (
    <SchoolContext.Provider value={{
      school,
      schoolId: school?.id ?? null,
      schoolStatus,
      loading,
      refetch: fetchSchool,
    }}>
      {children}
    </SchoolContext.Provider>
  );
};
