import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { MasterAdminProvider } from "./contexts/MasterAdminContext";
import { SchoolProvider } from "./contexts/SchoolContext";
import { MfaGateProvider } from "./contexts/MfaGateContext";
import { ThemeProvider } from "./contexts/ThemeProvider";
import ProtectedRoute from "./components/ProtectedRoute";
import Renewal from "./pages/Renewal";
import { Layout } from "@/components/layout/Layout";
import Index from "./pages/Index";
import Students from "./pages/Students";
import Teachers from "./pages/Teachers";
import Classes from "./pages/Classes";
import Contracts from "./pages/Contracts";
import Tuitions from "./pages/Tuitions";
import Expenses from "./pages/Expenses";
import Services from "./pages/Services";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import { RootRoute } from "./components/RootRoute";
import { HostGate } from "./components/HostGate";
import NotFound from "./pages/NotFound";
import AdminSyncTuitions from "./pages/AdminSyncTuitions";
import MasterAdmin from "./pages/MasterAdmin";
import MasterBugs from "./pages/MasterBugs";
import MasterAuditHistory from "./pages/MasterAuditHistory";
import Team from "./pages/Team";
import Security from "./pages/Security";
import Notifications from "./pages/Notifications";
import NotificationPreferences from "./pages/NotificationPreferences";
import { PrivacyPolicy, TermsOfUse } from "./pages/Legal";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HostGate>
      <BrowserRouter>
        <ThemeProvider defaultTheme="light" storageKey="lovable-ui-theme">
          <AuthProvider>
            <MasterAdminProvider>
            <SchoolProvider>
            <MfaGateProvider>
              <Routes>
                <Route path="/" element={<RootRoute />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/privacidade" element={<PrivacyPolicy />} />
                <Route path="/termos" element={<TermsOfUse />} />
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
                  path="/rematricula"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Renewal />
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
                  path="/despesas"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Expenses />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/servicos"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Services />
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
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <AdminSyncTuitions />
                      </Layout>
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
                  path="/seguranca"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Security />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/notificacoes"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Notifications />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/notificacoes/preferencias"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <NotificationPreferences />
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
                <Route
                  path="/master/bugs"
                  element={
                    <ProtectedRoute requireMasterAdmin>
                      <Layout>
                        <MasterBugs />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/master/historico"
                  element={
                    <ProtectedRoute requireMasterAdmin>
                      <Layout>
                        <MasterAuditHistory />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </MfaGateProvider>
            </SchoolProvider>
            </MasterAdminProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
      </HostGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
