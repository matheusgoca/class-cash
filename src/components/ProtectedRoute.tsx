import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole, type AppRole } from '@/hooks/use-role';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, school, schoolStatus, schoolLoaded, loading } = useAuth();
  const { role, isOwner } = useRole();
  const location = useLocation();

  // Wait until both auth AND school lookup are fully resolved
  if (loading || !schoolLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // Not authenticated → login
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Only redirect to onboarding when school is definitively not found (not on DB errors)
  if (schoolStatus === 'not_found' && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Role-based route guard (owner bypasses — isOwner implies admin)
  if (allowedRoles && !isOwner && role && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
