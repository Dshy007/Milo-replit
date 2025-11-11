import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Truck, Calendar, Users, Sparkles } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="bg-background p-6">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-welcome">Welcome back, {user?.username}!</h2>
          <p className="text-muted-foreground" data-testid="text-subtitle">Manage your trucking operations with AI-powered intelligence</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-12">
          <Card className="hover-elevate transition-all duration-200" data-testid="card-drivers">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Drivers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-driver-count">0</div>
              <p className="text-xs text-muted-foreground" data-testid="text-driver-status">No drivers added yet</p>
            </CardContent>
          </Card>

          <Card className="hover-elevate transition-all duration-200" data-testid="card-trucks">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Trucks</CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-truck-count">0</div>
              <p className="text-xs text-muted-foreground" data-testid="text-truck-status">No trucks added yet</p>
            </CardContent>
          </Card>

          <Card className="hover-elevate transition-all duration-200" data-testid="card-schedules">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Schedules</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-schedule-count">0</div>
              <p className="text-xs text-muted-foreground" data-testid="text-schedule-status">No schedules created</p>
            </CardContent>
          </Card>

          <Card className="hover-elevate transition-all duration-200" data-testid="card-ai">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">AI Conversations</CardTitle>
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-ai-status">Coming Soon</div>
              <p className="text-xs text-muted-foreground">AI chat interface</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Getting Started</CardTitle>
              <CardDescription>Set up your trucking operations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 border border-border rounded-lg hover-elevate transition-all">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-foreground mb-1">Add Drivers</h3>
                  <p className="text-sm text-muted-foreground">Import your driver roster via CSV or add them manually</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 border border-border rounded-lg hover-elevate transition-all">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Truck className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-foreground mb-1">Configure Trucks</h3>
                  <p className="text-sm text-muted-foreground">Add your fleet vehicles and equipment details</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 border border-border rounded-lg hover-elevate transition-all">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-foreground mb-1">Create Schedules</h3>
                  <p className="text-sm text-muted-foreground">Build and manage driver schedules with AI assistance</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and features</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full justify-start" variant="outline" disabled data-testid="button-add-driver">
                <Users className="w-4 h-4 mr-2" />
                Add New Driver
              </Button>
              <Button className="w-full justify-start" variant="outline" disabled data-testid="button-add-truck">
                <Truck className="w-4 h-4 mr-2" />
                Add New Truck
              </Button>
              <Button className="w-full justify-start" variant="outline" disabled data-testid="button-create-schedule">
                <Calendar className="w-4 h-4 mr-2" />
                Create Schedule
              </Button>
              <Button className="w-full justify-start" variant="outline" disabled data-testid="button-ai-chat">
                <Sparkles className="w-4 h-4 mr-2" />
                Chat with Milo
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-2">
                Full dashboard coming in Phase 2
              </p>
            </CardContent>
          </Card>
        </div>
    </div>
  );
}
