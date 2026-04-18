import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'admin' | 'financial' | 'teacher';

export const useRole = () => {
  const { user } = useAuth();
  const { school } = useSchool();
  const [fetchedRole, setFetchedRole] = useState<AppRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);

  // Owner of the school is always admin — no user_roles entry required
  const isOwner = !!(user && school && school.owner_user_id === user.id);

  useEffect(() => {
    if (!user || isOwner) {
      setFetchedRole(null);
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setFetchedRole((data?.role as AppRole) ?? null);
        setRoleLoading(false);
      });
  }, [user?.id, isOwner]);

  const role: AppRole | null = isOwner ? 'admin' : fetchedRole;

  const isAdmin     = role === 'admin';
  const isFinancial = role === 'financial';
  const isTeacher   = role === 'teacher';

  // null role = let through for sidebar (avoids flicker); real guard is ProtectedRoute + roleLoading
  const hasRole = (...roles: AppRole[]): boolean =>
    role === null || role === 'admin' || roles.includes(role);

  return { role, isOwner, isAdmin, isFinancial, isTeacher, hasRole, roleLoading };
};
