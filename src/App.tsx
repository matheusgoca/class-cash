import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { MasterAdminProvider } from "./contexts/MasterAdminContext";
import { useMasterAdmin } from "./contexts/MasterAdminContext";
import { SchoolProvider } from "./contexts/SchoolContext";
import { ThemeProvider } from "./contexts/ThemeProvider";
import ProtectedRoute from "./components/ProtectedRoute";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "./contexts/AuthContext";
import Index from "./pages/Index";
import Students from "./pages/Students";
import Teachers from "./pages/Teachers";
import Classes from "./pages/Classes";
import Contracts from "./pages/Contracts";
import Tuitions from "./pages/Tuitions";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import AdminSyncTuitions from "./pages/AdminSyncTuitions";
import MasterAdmin from "./pages/MasterAdmin";
import Team from "./pages/Team";

const queryClient = new QueryClient();

// Rota raiz: landing para visitantes, /master para master admin, /dashboard para demais
function RootRoute() {
  const { user, loading } = useAuth();
  const { isMasterAdmin } = useMasterAdmin();
  if (loading) return null;
  if (user) return <Navigate to={isMasterAdmin ? "/master" : "/dashboard"} replace />;
  return <Landing />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="lovable-ui-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <MasterAdminProvider>
            <SchoolProvider>
              <Routes>
                <Route path="/" element={<RootRoute />} />
                <Route path="/auth" element={<Auth />} />
                <Route
                  path="/onboarding"
                  element={
                    <ProtectedRoute>
                      <Onboarding />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute requireSchool>
                      <Layout>
                        <Index />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/alunos"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial', 'teacher']}>
                      <Layout>
                        <Students />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/professores"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Teachers />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/turmas"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial', 'teacher']}>
                      <Layout>
                        <Classes />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/contratos"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Contracts />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mensalidades"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Tuitions />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/relatorios"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Reports />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/gerar-mensalidades"
                  element={
                    <ProtectedRoute requireSchool>
                      <AdminSyncTuitions />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/equipe"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin']}>
                      <Layout>
                        <Team />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/configuracoes"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin']}>
                      <Layout>
                        <Settings />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/master"
                  element={
                    <ProtectedRoute requireMasterAdmin>
                      <Layout>
                        <MasterAdmin />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </SchoolProvider>
            </MasterAdminProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
