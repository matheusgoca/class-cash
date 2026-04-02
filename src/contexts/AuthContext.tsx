import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role?: 'admin' | 'financial' | 'teacher';
}

export interface School {
  id: string;
  name: string;
  segments: string[];
  logo_url: string | null;
  owner_user_id: string;
}

/** 'loading' | 'found' | 'not_found' | 'error' */
type SchoolStatus = 'loading' | 'found' | 'not_found' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  school: School | null;
  schoolStatus: SchoolStatus;
  /** true once the school lookup has resolved (even when null = no school) */
  schoolLoaded: boolean;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshSchool: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser]               = useState<User | null>(null);
  const [session, setSession]         = useState<Session | null>(null);
  const [profile, setProfile]         = useState<Profile | null>(null);
  const [school, setSchool]             = useState<School | null>(null);
  const [schoolStatus, setSchoolStatus] = useState<SchoolStatus>('loading');
  const [schoolLoaded, setSchoolLoaded] = useState(false);
  const [loading, setLoading]           = useState(true);

  // ── fetch school ─────────────────────────────────────────────
  const fetchSchool = async (userId: string): Promise<void> => {
    try {
      const { data, error } = await (supabase as any)
        .from('schools')
        .select('id, name, segments, logo_url, owner_user_id')
        .eq('owner_user_id', userId)
        .maybeSingle();

      if (error) {
        // DB/schema error — do NOT treat as "no school", prevents bogus onboarding redirect
        console.error('fetchSchool DB error:', error.message);
        setSchoolStatus('error');
        setSchoolLoaded(true);
        return;
      }

      if (data) {
        setSchool({ ...data, segments: data.segments ?? [] });
        setSchoolStatus('found');
      } else {
        setSchool(null);
        setSchoolStatus('not_found');
      }
    } catch (err) {
      console.error('fetchSchool exception:', err);
      setSchoolStatus('error');
    } finally {
      setSchoolLoaded(true);
    }
  };

  // ── fetch profile + role ──────────────────────────────────────
  const fetchProfile = async (userId: string): Promise<void> => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profileData) return; // no profile row yet, skip silently

      // role from user_roles (used for non-owner users like teachers/financial)
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .order('role', { ascending: true })
        .limit(1)
        .maybeSingle();

      setProfile({
        ...profileData,
        role: (!roleError && roleData) ? roleData.role : undefined,
      } as Profile);
    } catch (error) {
      console.error('fetchProfile error:', error);
      setProfile(null);
    }
  };

  // ── init: fetch both, then release loading ───────────────────
  const initUser = async (userId: string) => {
    await Promise.all([fetchProfile(userId), fetchSchool(userId)]);
    setLoading(false);
  };

  const refreshSchool = async () => {
    if (user) await fetchSchool(user.id);
  };

  useEffect(() => {
    // onAuthStateChange fires on login / logout / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          initUser(session.user.id);
        } else {
          setProfile(null);
          setSchool(null);
          setSchoolStatus('loading');
          setSchoolLoaded(false);
          setLoading(false);
        }
      }
    );

    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        initUser(session.user.id);
      } else {
        setSchoolStatus('not_found');
        setSchoolLoaded(true);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      user, session, profile, school, schoolStatus, schoolLoaded, loading,
      signUp, signIn, signOut, refreshSchool,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
