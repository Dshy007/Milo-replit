import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Truck, Calendar, Users, Sparkles, Upload, FileSpreadsheet, Moon, Sun, Zap, Cpu } from "lucide-react";
import { ComplianceHeatmap } from "@/components/ComplianceHeatmap";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";

type DashboardStats = {
  totalDrivers: number;
  activeDrivers: number;
  activeTrucks: number;
  totalBlocks: number;
  totalAssignments: number;
  unassignedBlocks: number;
};

export default function Dashboard() {
  const { user } = useAuth();
  const { themeMode, setThemeMode } = useTheme();

  // Fetch dashboard stats
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  return (
    <div className="p-6">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-welcome">Welcome back, {user?.username}!</h2>
            <p className="text-muted-foreground" data-testid="text-subtitle">Manage your trucking operations with AI-powered intelligence</p>
          </div>

          {/* Theme Selector */}
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={themeMode === 'day' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setThemeMode('day')}
              data-testid="button-theme-day"
              title="Day theme"
            >
              <Sun className="w-4 h-4" />
            </Button>
            <Button
              variant={themeMode === 'night' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setThemeMode('night')}
              data-testid="button-theme-night"
              title="Night theme"
            >
              <Moon className="w-4 h-4" />
            </Button>
            <Button
              variant={themeMode === 'retro' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setThemeMode('retro')}
              data-testid="button-theme-retro"
              title="Retro theme"
            >
              <Zap className="w-4 h-4" />
            </Button>
            <Button
              variant={themeMode === 'cyberpunk' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setThemeMode('cyberpunk')}
              data-testid="button-theme-cyberpunk"
              title="Cyberpunk theme"
            >
              <Cpu className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-12">
          <Link href="/drivers">
            <Card className="hover-elevate transition-all duration-200 cursor-pointer" data-testid="card-drivers">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Drivers</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-driver-count">
                  {isLoading ? "..." : stats?.totalDrivers || 0}
                </div>
                <p className="text-xs text-muted-foreground" data-testid="text-driver-status">
                  {isLoading ? "Loading..." : stats?.activeDrivers 
                    ? `${stats.activeDrivers} active` 
                    : "No drivers added yet"}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/trucks">
            <Card className="hover-elevate transition-all duration-200 cursor-pointer" data-testid="card-trucks">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Trucks</CardTitle>
                <Truck className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-truck-count">
                  {isLoading ? "..." : stats?.activeTrucks || 0}
                </div>
                <p className="text-xs text-muted-foreground" data-testid="text-truck-status">
                  {isLoading ? "Loading..." : stats?.activeTrucks 
                    ? "Fleet operational" 
                    : "No trucks added yet"}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/schedules">
            <Card className="hover-elevate transition-all duration-200 cursor-pointer" data-testid="card-schedules">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Assignments</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-schedule-count">
                  {isLoading ? "..." : stats?.totalAssignments || 0}
                </div>
                <p className="text-xs text-muted-foreground" data-testid="text-schedule-status">
                  {isLoading ? "Loading..." : stats?.unassignedBlocks 
                    ? `${stats.unassignedBlocks} unassigned blocks` 
                    : "All blocks assigned"}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/chat">
            <Card className="hover-elevate transition-all duration-200 cursor-pointer" data-testid="card-ai">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Milo AI</CardTitle>
                <Sparkles className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary" data-testid="text-ai-status">Available</div>
                <p className="text-xs text-muted-foreground">Click to chat with Milo</p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Compliance Heatmap */}
        <div className="mb-6">
          <ComplianceHeatmap />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Getting Started</CardTitle>
              <CardDescription>Set up your trucking operations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link href="/drivers">
                <div className="flex items-start gap-3 p-4 border border-border rounded-lg hover-elevate active-elevate-2 transition-all cursor-pointer" data-testid="link-add-drivers">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground mb-1">Add Drivers</h3>
                    <p className="text-sm text-muted-foreground">Import your driver roster via CSV or add them manually</p>
                  </div>
                </div>
              </Link>

              <Link href="/trucks">
                <div className="flex items-start gap-3 p-4 border border-border rounded-lg hover-elevate active-elevate-2 transition-all cursor-pointer" data-testid="link-add-trucks">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Truck className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground mb-1">Configure Trucks</h3>
                    <p className="text-sm text-muted-foreground">Add your fleet vehicles and equipment details</p>
                  </div>
                </div>
              </Link>

              <Link href="/import">
                <div className="flex items-start gap-3 p-4 border border-border rounded-lg hover-elevate active-elevate-2 transition-all cursor-pointer" data-testid="link-import-schedules">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Upload className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground mb-1">Import Schedules</h3>
                    <p className="text-sm text-muted-foreground">Upload your weekly schedule via CSV or Excel file</p>
                  </div>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/drivers">
                <Button className="w-full justify-start" variant="outline" data-testid="button-add-driver">
                  <Users className="w-4 h-4 mr-2" />
                  Manage Drivers
                </Button>
              </Link>
              <Link href="/trucks">
                <Button className="w-full justify-start" variant="outline" data-testid="button-add-truck">
                  <Truck className="w-4 h-4 mr-2" />
                  Manage Trucks
                </Button>
              </Link>
              <Link href="/schedules">
                <Button className="w-full justify-start" variant="outline" data-testid="button-view-schedules">
                  <Calendar className="w-4 h-4 mr-2" />
                  View Schedules
                </Button>
              </Link>
              <Link href="/import">
                <Button className="w-full justify-start" variant="outline" data-testid="button-import-csv">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Import Schedule
                </Button>
              </Link>
              <Link href="/chat">
                <Button className="w-full justify-start" variant="default" data-testid="button-ai-chat">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Chat with Milo
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
    </div>
  );
}
