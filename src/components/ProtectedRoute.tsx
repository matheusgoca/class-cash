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
  const { user, profile, loading: authLoading } = useAuth();
  const { schoolStatus, loading: schoolLoading } = useSchool();
  const { isMasterAdmin } = useMasterAdmin();
  const { role, isOwner } = useRole();
  const location = useLocation();

  // Wait for auth; if requireSchool, also wait for school lookup
  if (authLoading || (requireSchool && schoolLoading)) {
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

  // School not found: master admin → /master, others → /onboarding
  if (requireSchool && schoolStatus === 'not_found' && location.pathname !== '/onboarding') {
    if (isMasterAdmin) return <Navigate to="/master" replace />;
    return <Navigate to="/onboarding" replace />;
  }

  // Role guard — owner and master admin always bypass
  if (allowedRoles && !isOwner && !isMasterAdmin && role && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
