import type { AppRole } from '@/hooks/use-role';

export interface AccountMenuInput {
  role: AppRole | null;
  isMasterAdmin: boolean;
  viewingSchoolId: string | null;
  homeSchoolId: string | null; // profiles.school_id: onde os RPCs gravam (get_user_school_id)
}

// O master visualizando outra escola gravaria preferências na escola de casa,
// não na que está na tela — por isso o item some (D4).
export function isMasterViewingOtherSchool(i: AccountMenuInput): boolean {
  return i.isMasterAdmin && !!i.viewingSchoolId && i.viewingSchoolId !== i.homeSchoolId;
}

export function showNotificationsItem(i: AccountMenuInput): boolean {
  if (i.isMasterAdmin && !i.viewingSchoolId) return false;
  if (isMasterViewingOtherSchool(i)) return false;
  return i.role === 'admin' || i.role === 'financial';
}
