import { useAuth } from '@/contexts/AuthContext';
import { useMasterAdmin } from '@/contexts/MasterAdminContext';
import { useRole } from '@/hooks/use-role';
import { showNotificationsItem } from '@/lib/accountMenu';

/** Mesma regra do item "Notificações" da barra lateral (G10). */
export function useShowNotifications(): boolean {
  const { profile } = useAuth();
  const { isMasterAdmin, viewingSchoolId } = useMasterAdmin();
  const { role } = useRole();
  return showNotificationsItem({ role, isMasterAdmin, viewingSchoolId, homeSchoolId: profile?.school_id ?? null });
}
