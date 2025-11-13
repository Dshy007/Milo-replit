import { Home, Users, Calendar, Route, Truck, FileText, Upload, Sparkles, Settings, LogOut, MessageSquare, Brain, FileSpreadsheet, CalendarCheck, GitBranch } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const navItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
    testId: "nav-dashboard",
  },
  {
    title: "Drivers",
    url: "/drivers",
    icon: Users,
    testId: "nav-drivers",
  },
  {
    title: "Schedules",
    url: "/schedules",
    icon: Calendar,
    testId: "nav-schedules",
  },
  {
    title: "Trucks",
    url: "/trucks",
    icon: Truck,
    testId: "nav-trucks",
  },
  {
    title: "Start Times",
    url: "/contracts",
    icon: FileText,
    testId: "nav-contracts",
  },
  {
    title: "Import Data",
    url: "/import",
    icon: Upload,
    testId: "nav-import",
  },
  {
    title: "CSV Import",
    url: "/csv-import",
    icon: FileSpreadsheet,
    testId: "nav-csv-import",
  },
  {
    title: "Excel Import",
    url: "/schedule-import",
    icon: FileSpreadsheet,
    testId: "nav-schedule-import",
  },
  {
    title: "AI Assistant",
    url: "/chat",
    icon: Sparkles,
    testId: "nav-chat",
  },
  {
    title: "Special Requests",
    url: "/special-requests",
    icon: MessageSquare,
    testId: "nav-special-requests",
  },
  {
    title: "Auto-Build",
    url: "/auto-build",
    icon: Brain,
    testId: "nav-auto-build",
  },
  {
    title: "Driver Availability",
    url: "/driver-availability",
    icon: CalendarCheck,
    testId: "nav-driver-availability",
  },
  {
    title: "Cascade Effect",
    url: "/cascade-effect",
    icon: GitBranch,
    testId: "nav-cascade-effect",
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const getUserInitials = () => {
    if (!user?.username) return "U";
    return user.username.substring(0, 2).toUpperCase();
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-primary" data-testid="sidebar-logo" />
          <div>
            <h2 className="text-lg font-bold text-foreground" data-testid="sidebar-title">Milo</h2>
            <p className="text-xs text-muted-foreground" data-testid="sidebar-subtitle">AI Operations</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={item.testId}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-border">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8" data-testid="sidebar-avatar">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {getUserInitials()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate" data-testid="text-user-name">
              {user?.username}
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
              {user?.email}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => logout()}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
