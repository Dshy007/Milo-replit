import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User, Trash2, Check, X, Calendar, RefreshCw, Sparkles,
  ChevronDown, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import type { Driver, DriverDnaProfile } from "@shared/schema";
import { DNAPatternBadge } from "@/components/DNAPatternBadge";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";

const DAYS_OF_WEEK = [
  { value: "sunday", label: "Sun" },
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
];

export default function DriverProfiles() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Fetch drivers
  const { data: drivers = [], isLoading: driversLoading } = useQuery({
    queryKey: ["/api/drivers"],
    queryFn: async () => {
      const response = await fetch("/api/drivers", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch drivers");
      return response.json() as Promise<Driver[]>;
    },
  });

  // Fetch DNA profiles
  const { data: dnaProfiles = [], isLoading: profilesLoading } = useQuery({
    queryKey: ["/api/driver-dna"],
    queryFn: async () => {
      const response = await fetch("/api/driver-dna", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch DNA profiles");
      const data = await response.json();
      return data.profiles as DriverDnaProfile[];
    },
  });

  // Create map of driver ID to DNA profile
  const profileMap = new Map(dnaProfiles.map((p) => [p.driverId, p]));

  // Update driver active status mutation
  const updateDriverMutation = useMutation({
    mutationFn: async ({ driverId, isActive }: { driverId: string; isActive: boolean }) => {
      const response = await apiRequest("PATCH", `/api/drivers/${driverId}`, { isActive });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      toast({ title: "Driver updated", description: "Active status changed" });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  // Update driver days off mutation
  const updateDaysOffMutation = useMutation({
    mutationFn: async ({ driverId, daysOff }: { driverId: string; daysOff: string[] }) => {
      const response = await apiRequest("PATCH", `/api/drivers/${driverId}`, { daysOff });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  // Delete driver mutation
  const deleteDriverMutation = useMutation({
    mutationFn: async (driverId: string) => {
      const response = await apiRequest("DELETE", `/api/drivers/${driverId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      toast({ title: "Driver deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  // Handle analyze button - trigger XGBoost matching
  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const response = await apiRequest("POST", "/api/matching/deterministic/preview");
      const data = await response.json();

      if (data.success) {
        toast({
          title: "Analysis Complete",
          description: `Found ${data.stats?.assigned || 0} matches for ${data.stats?.totalBlocks || 0} blocks`,
        });
        // Navigate to schedules page to see results
        navigate("/schedules");
      } else {
        toast({
          title: "Analysis Failed",
          description: data.message || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Analysis Error",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Toggle day in days off array
  const toggleDayOff = (driverId: string, day: string, currentDaysOff: string[]) => {
    const newDaysOff = currentDaysOff.includes(day)
      ? currentDaysOff.filter((d) => d !== day)
      : [...currentDaysOff, day];
    updateDaysOffMutation.mutate({ driverId, daysOff: newDaysOff });
  };

  const isLoading = driversLoading || profilesLoading;
  const activeDrivers = drivers.filter((d) => (d as any).isActive !== false);
  const inactiveDrivers = drivers.filter((d) => (d as any).isActive === false);

  return (
    <div className="container mx-auto py-6 px-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <User className="w-6 h-6" />
              Driver Profiles
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Manage driver status and availability for XGBoost matching
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm">
              {activeDrivers.length} Active / {inactiveDrivers.length} Inactive
            </Badge>
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || activeDrivers.length === 0}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Analyze
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading drivers...
            </div>
          ) : drivers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No drivers found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Active</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>DNA Pattern</TableHead>
                  <TableHead>Contract</TableHead>
                  <TableHead>Days Off</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.map((driver) => {
                  const profile = profileMap.get(driver.id);
                  const isActive = (driver as any).isActive !== false;
                  const daysOff = (driver as any).daysOff || [];

                  return (
                    <TableRow
                      key={driver.id}
                      className={!isActive ? "opacity-50" : ""}
                    >
                      <TableCell>
                        <Switch
                          checked={isActive}
                          onCheckedChange={(checked) =>
                            updateDriverMutation.mutate({
                              driverId: driver.id,
                              isActive: checked,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">
                            {driver.firstName} {driver.lastName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {profile ? (
                          <DNAPatternBadge
                            pattern={profile.patternGroup}
                            size="sm"
                          />
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            No profile
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {profile ? (
                          <ContractTypeBadge
                            contractType={profile.preferredContractType}
                            size="sm"
                          />
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                            >
                              <Calendar className="w-3 h-3 mr-1" />
                              {daysOff.length > 0
                                ? `${daysOff.length} days`
                                : "None"}
                              <ChevronDown className="w-3 h-3 ml-1" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {DAYS_OF_WEEK.map((day) => (
                              <DropdownMenuCheckboxItem
                                key={day.value}
                                checked={daysOff.includes(day.value)}
                                onCheckedChange={() =>
                                  toggleDayOff(driver.id, day.value, daysOff)
                                }
                              >
                                {day.label}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Driver</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete{" "}
                                <strong>
                                  {driver.firstName} {driver.lastName}
                                </strong>
                                ? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-600 hover:bg-red-700"
                                onClick={() =>
                                  deleteDriverMutation.mutate(driver.id)
                                }
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Info about inactive drivers */}
          {inactiveDrivers.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {inactiveDrivers.length} inactive driver
                  {inactiveDrivers.length !== 1 ? "s" : ""} will be excluded
                  from XGBoost analysis
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
