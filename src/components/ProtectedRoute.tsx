import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSchool?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireSchool }) => {
  const { user, loading: authLoading } = useAuth();
  const { schoolId, loading: schoolLoading } = useSchool();

  if (authLoading || (requireSchool && schoolLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (requireSchool && !schoolId) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
