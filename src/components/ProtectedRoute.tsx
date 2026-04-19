import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { useMasterAdmin } from '@/contexts/MasterAdminContext';
import { useRole, type AppRole } from '@/hooks/use-role';


interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSchool?: boolean;
  requireMasterAdmin?: boolean;
  allowedRoles?: AppRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireSchool, requireMasterAdmin, allowedRoles }) => {
  const { user, loading: authLoading } = useAuth();
  const { schoolStatus, loading: schoolLoading } = useSchool();
  const { isMasterAdmin, viewingSchoolId } = useMasterAdmin();
  const { role, isOwner, roleLoading } = useRole();
  const location = useLocation();

  console.log('[ProtectedRoute]', location.pathname, { authLoading, schoolStatus, schoolLoading, isMasterAdmin, viewingSchoolId });

  // Always wait for auth to finish
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  // Master admin guard
  if (requireMasterAdmin && !isMasterAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // Master admin with viewingSchoolId: wait for school to load, then let through
  if (requireSchool && isMasterAdmin && viewingSchoolId) {
    if (schoolLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      );
    }
    // School loaded or error — let through regardless (master always has access)
    return <>{children}</>;
  }

  // Master admin without viewingSchoolId: always redirect to /master
  // They only access school content when viewingSchoolId is set (handled above)
  if (requireSchool && isMasterAdmin && !viewingSchoolId) {
    return <Navigate to="/master" replace />;
  }

  // Regular user: wait for school lookup
  if (requireSchool && schoolLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // Regular user: school not found → onboarding
  if (requireSchool && schoolStatus === 'not_found' && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Role guard — owner and master admin always bypass
  if (allowedRoles && !isOwner && !isMasterAdmin) {
    if (roleLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      );
    }
    if (role && !allowedRoles.includes(role)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;
