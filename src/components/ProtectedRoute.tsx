import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { useRole, type AppRole } from '@/hooks/use-role';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSchool?: boolean;
  allowedRoles?: AppRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireSchool, allowedRoles }) => {
  const { user, loading: authLoading } = useAuth();
  const { schoolStatus, loading: schoolLoading } = useSchool();
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

  // Only redirect to onboarding when school is definitively not found
  if (requireSchool && schoolStatus === 'not_found' && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Role guard — owner always bypasses
  if (allowedRoles && !isOwner && role && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
