import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeProvider";
import ProtectedRoute from "./components/ProtectedRoute";
import { Layout } from "@/components/layout/Layout";
import Index from "./pages/Index";
import Students from "./pages/Students";
import Teachers from "./pages/Teachers";
import Classes from "./pages/Classes";
import Contracts from "./pages/Contracts";
import Tuitions from "./pages/Tuitions";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="lovable-ui-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route 
                path="/" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Index />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/alunos" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Students />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/professores" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Teachers />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/turmas" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Classes />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/contratos" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Contracts />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/mensalidades" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Tuitions />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/relatorios" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Reports />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/configuracoes" 
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Settings />
                    </Layout>
                  </ProtectedRoute>
                } 
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
