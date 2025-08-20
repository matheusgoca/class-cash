import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  DollarSign,
  FileBarChart,
  Settings,
  ChevronDown,
  School,
  LogOut
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarHeader,
  useSidebar,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Gestão",
    icon: School,
    items: [
      { title: "Alunos", url: "/alunos", icon: Users },
      { title: "Professores", url: "/professores", icon: GraduationCap },
      { title: "Turmas", url: "/turmas", icon: BookOpen },
    ],
  },
  {
    title: "Financeiro",
    icon: DollarSign,
    items: [
      { title: "Mensalidades", url: "/mensalidades", icon: DollarSign },
      { title: "Relatórios", url: "/relatorios", icon: FileBarChart },
    ],
  },
  {
    title: "Configurações",
    url: "/configuracoes",
    icon: Settings,
  },
];

export function AppSidebar() {
  const { signOut, profile } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;
  const [openGroups, setOpenGroups] = useState<string[]>(["Gestão", "Financeiro"]);

  const isActive = (path: string) => currentPath === path;
  const getNavCls = (isActive: boolean) =>
    isActive
      ? "bg-primary text-primary-foreground font-medium"
      : "hover:bg-accent hover:text-accent-foreground";

  const toggleGroup = (groupTitle: string) => {
    setOpenGroups(prev =>
      prev.includes(groupTitle)
        ? prev.filter(g => g !== groupTitle)
        : [...prev, groupTitle]
    );
  };

  return (
    <Sidebar className={collapsed ? "w-16" : "w-64"} collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <School className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold">EduFinance</span>
              <span className="text-xs text-muted-foreground">{profile?.full_name || 'Usuário'}</span>
            </div>
          )}
        </div>
        {collapsed && <SidebarTrigger className="ml-auto" />}
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              {item.items ? (
                <Collapsible
                  open={openGroups.includes(item.title)}
                  onOpenChange={() => toggleGroup(item.title)}
                >
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="w-full justify-between">
                      <div className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </div>
                      {!collapsed && (
                        <ChevronDown className={`h-4 w-4 transition-transform ${
                          openGroups.includes(item.title) ? "rotate-180" : ""
                        }`} />
                      )}
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  {!collapsed && (
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton asChild>
                              <NavLink
                                to={subItem.url}
                                className={`flex items-center gap-2 ${getNavCls(isActive(subItem.url))}`}
                              >
                                <subItem.icon className="h-4 w-4" />
                                <span>{subItem.title}</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  )}
                </Collapsible>
              ) : (
                <SidebarMenuButton asChild>
                  <NavLink
                    to={item.url!}
                    className={`flex items-center gap-2 ${getNavCls(isActive(item.url!))}`}
                  >
                    <item.icon className="h-4 w-4" />
                    {!collapsed && <span>{item.title}</span>}
                  </NavLink>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        {/* Logout Button */}
        <SidebarMenu className="mt-auto border-t border-sidebar-border pt-4">
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sair</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  );
}