import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { useMasterAdmin } from './MasterAdminContext';

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
  const { isMasterAdmin, viewingSchoolId } = useMasterAdmin();
  const [school, setSchool]           = useState<School | null>(null);
  const [schoolStatus, setSchoolStatus] = useState<SchoolStatus>('loading');

  const fetchSchool = async () => {
    // Master admin without a viewing school — no school context, go to /master
    if (isMasterAdmin && !viewingSchoolId) {
      console.log('[SchoolContext] master admin, no viewingSchoolId — skipping lookup');
      setSchool(null);
      setSchoolStatus('not_found');
      return;
    }

    // Master admin viewing a specific school — bypass normal lookup
    if (isMasterAdmin && viewingSchoolId) {
      const { data: schoolData, error: schoolError } = await (supabase as any)
        .from('schools')
        .select('id, name, segments, logo_url, owner_user_id')
        .eq('id', viewingSchoolId)
        .maybeSingle();

      if (schoolError || !schoolData) {
        console.error('[SchoolContext] master viewing school error:', schoolError?.message);
        setSchoolStatus('error');
        return;
      }
      setSchool({ ...schoolData, segments: schoolData.segments ?? [] });
      setSchoolStatus('found');
      return;
    }

    if (!user) {
      setSchool(null);
      setSchoolStatus('not_found');
      return;
    }

    console.log('[SchoolContext] fetchSchool — user.id:', user.id);

    try {
      // 1. Try via profiles.school_id (staff invited to a school, or owner after onboarding)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('user_id', user.id)
        .maybeSingle();

      console.log('[SchoolContext] profiles query —', { profile, profileError });

      let schoolId: string | null = profile?.school_id ?? null;

      // 2. Fallback: owner lookup via schools.owner_user_id
      if (!schoolId) {
        console.log('[SchoolContext] school_id not in profile, trying owner_user_id fallback');
        const { data: owned, error: ownedError } = await (supabase as any)
          .from('schools')
          .select('id')
          .eq('owner_user_id', user.id)
          .maybeSingle();

        console.log('[SchoolContext] owner lookup —', { owned, ownedError });

        if (ownedError) {
          console.error('[SchoolContext] owner lookup error:', ownedError.message);
          setSchoolStatus('error');
          return;
        }

        schoolId = owned?.id ?? null;
      }

      console.log('[SchoolContext] resolved schoolId:', schoolId);

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
        .maybeSingle();

      console.log('[SchoolContext] school data —', { schoolData, schoolError });

      if (schoolError) {
        console.error('[SchoolContext] school data error:', schoolError.message);
        setSchoolStatus('error');
        return;
      }

      if (!schoolData) {
        console.error('[SchoolContext] school not accessible — RLS may be blocking SELECT on schools for this user');
        setSchoolStatus('error');
        return;
      }

      setSchool({ ...schoolData, segments: schoolData.segments ?? [] });
      setSchoolStatus('found');
    } catch (err) {
      console.error('[SchoolContext] exception:', err);
      setSchoolStatus('error');
    }
  };

  useEffect(() => {
    if (authLoading) return;
    setSchoolStatus('loading');
    fetchSchool();
  }, [user, authLoading, viewingSchoolId, isMasterAdmin]);

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
