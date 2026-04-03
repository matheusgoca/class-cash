import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useSchool } from "@/contexts/SchoolContext";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/alunos": "Gestão de Alunos",
  "/professores": "Gestão de Professores",
  "/turmas": "Gestão de Turmas",
  "/contratos": "Gestão de Contratos",
  "/mensalidades": "Mensalidades",
  "/relatorios": "Relatórios",
  "/configuracoes": "Configurações",
};

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { school } = useSchool();
  const pageTitle = PAGE_TITLES[location.pathname] ?? "EduFinance";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />

        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:px-6">
            <SidebarTrigger className="md:hidden" />
            <div className="flex-1 flex items-center gap-3">
              <h1 className="text-lg font-semibold">{pageTitle}</h1>
              {school && (
                <span className="hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {school.name}
                </span>
              )}
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}