import { useAuth } from '@/contexts/AuthContext';

export type AppRole = 'admin' | 'financial' | 'teacher';

export const useRole = () => {
  const { profile, school, user } = useAuth();

  // School owner is always admin — no user_roles entry required
  const isOwner = !!(user && school && school.owner_user_id === user.id);

  // Explicit role from user_roles (for non-owner staff invited by the admin)
  const explicitRole = (profile?.role ?? null) as AppRole | null;

  // Effective role: owner overrides everything
  const role: AppRole | null = isOwner ? 'admin' : explicitRole;

  const isAdmin     = role === 'admin';
  const isFinancial = role === 'financial';
  const isTeacher   = role === 'teacher';

  /**
   * Returns true if the current user has at least one of the given roles.
   * Admin always passes. When role is null (not yet resolved), let through
   * so the sidebar doesn't flicker — route-level ProtectedRoute guards access.
   */
  const hasRole = (...roles: AppRole[]): boolean =>
    role === null || role === 'admin' || roles.includes(role);

  return { role, isOwner, isAdmin, isFinancial, isTeacher, hasRole };
};
