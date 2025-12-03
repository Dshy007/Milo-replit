import type { ReactNode, CSSProperties } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Landing from "@/pages/Landing";
import Landing3DCSS from "@/components/Landing3DCSS";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Dashboard from "@/pages/Dashboard";
import Drivers from "@/pages/Drivers";
import Schedules from "@/pages/Schedules";
import Routes from "@/pages/Routes";
import Trucks from "@/pages/Trucks";
import Contracts from "@/pages/Contracts";
import Loads from "@/pages/Loads";
import Import from "@/pages/Import";
import Chat from "@/pages/Chat";
import SpecialRequests from "@/pages/SpecialRequests";
import ScheduleIntelligence from "@/pages/ScheduleIntelligence";
import AutoBuild from "@/pages/AutoBuild";
import DriverAvailability from "@/pages/DriverAvailability";
import NotFound from "@/pages/not-found";

function ProtectedLayout({ children }: { children: ReactNode }) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center gap-2 h-14 px-4 border-b border-border bg-card/50 backdrop-blur-sm">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing3DCSS} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/dashboard">
        <ProtectedRoute>
          <ProtectedLayout>
            <Dashboard />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/drivers">
        <ProtectedRoute>
          <ProtectedLayout>
            <Drivers />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/schedules">
        <ProtectedRoute>
          <ProtectedLayout>
            <Schedules />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/routes">
        <ProtectedRoute>
          <ProtectedLayout>
            <Routes />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/trucks">
        <ProtectedRoute>
          <ProtectedLayout>
            <Trucks />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/contracts">
        <ProtectedRoute>
          <ProtectedLayout>
            <Contracts />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/loads">
        <ProtectedRoute>
          <ProtectedLayout>
            <Loads />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/import">
        <ProtectedRoute>
          <ProtectedLayout>
            <Import />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/chat">
        <ProtectedRoute>
          <ProtectedLayout>
            <Chat />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/special-requests">
        <ProtectedRoute>
          <ProtectedLayout>
            <SpecialRequests />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/schedule-intelligence">
        <ProtectedRoute>
          <ProtectedLayout>
            <ScheduleIntelligence />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/auto-build">
        <ProtectedRoute>
          <ProtectedLayout>
            <AutoBuild />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/driver-availability">
        <ProtectedRoute>
          <ProtectedLayout>
            <DriverAvailability />
          </ProtectedLayout>
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;