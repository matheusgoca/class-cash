import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';

export type AppRole = 'admin' | 'financial' | 'teacher';

export const useRole = () => {
  const { user } = useAuth();
  const { school } = useSchool();

  // Owner of the school is always admin — no user_roles entry required
  const isOwner = !!(user && school && school.owner_user_id === user.id);

  // For invited staff, role will come from user_roles in the future
  // For now, owner = admin, everyone else = null until role system is extended
  const role: AppRole | null = isOwner ? 'admin' : null;

  const isAdmin     = role === 'admin';
  const isFinancial = role === 'financial';
  const isTeacher   = role === 'teacher';

  // null role = let through (sidebar doesn't flicker); real guard is in ProtectedRoute
  const hasRole = (...roles: AppRole[]): boolean =>
    role === null || role === 'admin' || roles.includes(role);

  return { role, isOwner, isAdmin, isFinancial, isTeacher, hasRole };
};
