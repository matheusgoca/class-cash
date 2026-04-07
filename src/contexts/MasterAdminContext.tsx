import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

interface MasterAdminContextType {
  isMasterAdmin: boolean;
  viewingSchoolId: string | null;
  viewingSchoolName: string | null;
  enterSchool: (id: string, name: string) => void;
  exitSchool: () => void;
}

const MasterAdminContext = createContext<MasterAdminContextType | undefined>(undefined);

export const useMasterAdmin = () => {
  const ctx = useContext(MasterAdminContext);
  if (!ctx) throw new Error('useMasterAdmin must be used within MasterAdminProvider');
  return ctx;
};

const STORAGE_KEY = 'master_viewing_school';

export const MasterAdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const isMasterAdmin = profile?.is_master_admin ?? false;

  const [viewingSchool, setViewingSchool] = useState<{ id: string; name: string } | null>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Clear viewing state if user is not (or no longer) master admin
  useEffect(() => {
    if (!isMasterAdmin && viewingSchool) {
      setViewingSchool(null);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [isMasterAdmin]);

  const enterSchool = (id: string, name: string) => {
    const val = { id, name };
    setViewingSchool(val);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  };

  const exitSchool = () => {
    setViewingSchool(null);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <MasterAdminContext.Provider value={{
      isMasterAdmin,
      viewingSchoolId: viewingSchool?.id ?? null,
      viewingSchoolName: viewingSchool?.name ?? null,
      enterSchool,
      exitSchool,
    }}>
      {children}
    </MasterAdminContext.Provider>
  );
};
