import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User, Calendar, CalendarDays, Play, Check, Loader2,
  ChevronDown, Truck, Clock, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Driver } from "@shared/schema";
import { format, startOfWeek, addDays } from "date-fns";

const DAYS_OF_WEEK = [
  { value: "sunday", label: "Sun" },
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
];

// Contract slot options - these should match your contracts table
const SOLO_TYPES = ["solo1", "solo2"];
const TRACTORS = Array.from({ length: 10 }, (_, i) => `Tractor_${i + 1}`);
const START_TIMES = [
  "00:30", "01:30", "08:30", "11:30", "15:30", "16:30",
  "17:30", "18:30", "20:30", "21:30", "23:30"
];

interface ScheduleMatch {
  blockId: string;
  date: string;
  soloType: string;
  tractorId: string;
  startTime: string;
  driverId: string | null;
  driverName: string | null;
  status: "matched" | "no_owner" | "day_off";
}

export default function SimpleSchedule() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    return startOfWeek(today, { weekStartsOn: 0 }); // Sunday
  });
  const [scheduleResults, setScheduleResults] = useState<ScheduleMatch[] | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);

  // Fetch drivers
  const { data: drivers = [], isLoading: driversLoading } = useQuery({
    queryKey: ["/api/drivers"],
    queryFn: async () => {
      const response = await fetch("/api/drivers", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch drivers");
      return response.json() as Promise<Driver[]>;
    },
  });

  // Fetch contracts for slot options
  const { data: contracts = [] } = useQuery({
    queryKey: ["/api/contracts"],
    queryFn: async () => {
      const response = await fetch("/api/contracts", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch contracts");
      return response.json();
    },
  });

  // Update driver slot ownership mutation
  const updateSlotMutation = useMutation({
    mutationFn: async ({
      driverId,
      ownedSlotType,
      ownedTractorId,
      ownedStartTime,
      workPattern
    }: {
      driverId: string;
      ownedSlotType?: string | null;
      ownedTractorId?: string | null;
      ownedStartTime?: string | null;
      workPattern?: string[];
    }) => {
      const response = await apiRequest("PATCH", `/api/drivers/${driverId}`, {
        ownedSlotType,
        ownedTractorId,
        ownedStartTime,
        workPattern
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      toast({ title: "Slot assignment updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  // Toggle work pattern day
  const toggleWorkDay = (driverId: string, day: string, currentPattern: string[]) => {
    const newPattern = currentPattern.includes(day)
      ? currentPattern.filter((d) => d !== day)
      : [...currentPattern, day];
    updateSlotMutation.mutate({ driverId, workPattern: newPattern });
  };

  // Build schedule from profiles
  const buildSchedule = async () => {
    setIsBuilding(true);
    try {
      const response = await apiRequest("POST", "/api/schedule/build-from-profiles", {
        weekStart: format(weekStart, "yyyy-MM-dd"),
      });
      const data = await response.json();
      setScheduleResults(data.matches);
      toast({
        title: "Schedule built",
        description: `${data.matches.filter((m: ScheduleMatch) => m.status === "matched").length} blocks matched`
      });
    } catch (error: any) {
      toast({ title: "Build failed", description: error.message, variant: "destructive" });
    } finally {
      setIsBuilding(false);
    }
  };

  // Apply schedule (create assignments)
  const applySchedule = async () => {
    if (!scheduleResults) return;

    const matchedBlocks = scheduleResults.filter(m => m.status === "matched" && m.driverId);

    try {
      for (const match of matchedBlocks) {
        await apiRequest("POST", "/api/block-assignments", {
          blockId: match.blockId,
          driverId: match.driverId,
        });
      }
      toast({
        title: "Schedule applied",
        description: `${matchedBlocks.length} assignments created`
      });
      setScheduleResults(null);
      queryClient.invalidateQueries({ queryKey: ["/api/block-assignments"] });
    } catch (error: any) {
      toast({ title: "Apply failed", description: error.message, variant: "destructive" });
    }
  };

  // Get unique slot options from contracts
  const slotOptions = contracts.map((c: any) => ({
    value: `${c.type}_${c.tractorId}_${c.startTime}`,
    label: `${c.type.toUpperCase()} ${c.tractorId} @ ${c.startTime}`,
    type: c.type,
    tractorId: c.tractorId,
    startTime: c.startTime,
  }));

  const activeDrivers = drivers.filter((d: any) => d.isActive !== false);
  const driversWithSlots = activeDrivers.filter((d: any) => d.ownedSlotType);

  // Week navigation
  const prevWeek = () => setWeekStart(addDays(weekStart, -7));
  const nextWeek = () => setWeekStart(addDays(weekStart, 7));
  const weekEnd = addDays(weekStart, 6);

  return (
    <div className="container mx-auto py-6 px-4 space-y-6">
      {/* Section 1: Driver Slot Assignments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-6 h-6" />
            Driver Slot Ownership
          </CardTitle>
          <CardDescription>
            Assign each driver to their owned slot and configure work days
          </CardDescription>
        </CardHeader>

        <CardContent>
          {driversLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading drivers...
            </div>
          ) : activeDrivers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No active drivers found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Owned Slot</TableHead>
                  <TableHead>Work Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeDrivers.map((driver: any) => {
                  const workPattern = driver.workPattern || [];
                  const hasSlot = driver.ownedSlotType && driver.ownedTractorId && driver.ownedStartTime;
                  const slotDisplay = hasSlot
                    ? `${driver.ownedSlotType.toUpperCase()} ${driver.ownedTractorId} @ ${driver.ownedStartTime}`
                    : null;

                  return (
                    <TableRow key={driver.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">
                            {driver.firstName} {driver.lastName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select
                            value={hasSlot ? `${driver.ownedSlotType}_${driver.ownedTractorId}_${driver.ownedStartTime}` : "none"}
                            onValueChange={(value) => {
                              if (value === "none") {
                                updateSlotMutation.mutate({
                                  driverId: driver.id,
                                  ownedSlotType: null,
                                  ownedTractorId: null,
                                  ownedStartTime: null,
                                });
                              } else {
                                const [type, tractor, time] = value.split("_");
                                updateSlotMutation.mutate({
                                  driverId: driver.id,
                                  ownedSlotType: type,
                                  ownedTractorId: `${tractor}_${value.split("_")[2]}`,
                                  ownedStartTime: value.split("_").slice(3).join("_") || time,
                                });
                              }
                            }}
                          >
                            <SelectTrigger className="w-[260px]">
                              <SelectValue placeholder="Select slot..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No slot assigned</SelectItem>
                              {slotOptions.map((slot: any) => (
                                <SelectItem key={slot.value} value={slot.value}>
                                  <div className="flex items-center gap-2">
                                    <Truck className="w-3 h-3" />
                                    {slot.label}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {hasSlot && (
                            <Badge variant="secondary" className="text-xs">
                              {slotDisplay}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8">
                              <CalendarDays className="w-3 h-3 mr-1" />
                              {workPattern.length > 0
                                ? workPattern.map((d: string) => d.substring(0, 3)).join(", ")
                                : "No days set"}
                              <ChevronDown className="w-3 h-3 ml-1" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {DAYS_OF_WEEK.map((day) => (
                              <DropdownMenuCheckboxItem
                                key={day.value}
                                checked={workPattern.includes(day.value)}
                                onCheckedChange={() =>
                                  toggleWorkDay(driver.id, day.value, workPattern)
                                }
                              >
                                {day.label}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">
                {driversWithSlots.length} of {activeDrivers.length} drivers have slots assigned
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Schedule Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-6 h-6" />
            Build Schedule
          </CardTitle>
          <CardDescription>
            Generate schedule for a week based on driver slot ownership
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Week selector */}
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={prevWeek}>
              &larr; Prev
            </Button>
            <div className="text-lg font-medium">
              Week of {format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")}
            </div>
            <Button variant="outline" size="sm" onClick={nextWeek}>
              Next &rarr;
            </Button>
          </div>

          {/* Build button */}
          <div className="flex gap-2">
            <Button
              onClick={buildSchedule}
              disabled={isBuilding || driversWithSlots.length === 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {isBuilding ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Building...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Build Schedule
                </>
              )}
            </Button>

            {scheduleResults && (
              <Button onClick={applySchedule} variant="default">
                <Check className="w-4 h-4 mr-2" />
                Apply {scheduleResults.filter(m => m.status === "matched").length} Matches
              </Button>
            )}
          </div>

          {/* Results table */}
          {scheduleResults && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">Schedule Preview</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Slot</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduleResults.map((match, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{match.date}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">
                            {match.soloType.toUpperCase()}
                          </Badge>
                          <span>{match.tractorId}</span>
                          <Clock className="w-3 h-3 ml-1" />
                          <span className="text-muted-foreground">{match.startTime}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {match.driverName || (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {match.status === "matched" ? (
                          <Badge className="bg-green-100 text-green-800">
                            <Check className="w-3 h-3 mr-1" />
                            Matched
                          </Badge>
                        ) : match.status === "day_off" ? (
                          <Badge variant="secondary">
                            <Calendar className="w-3 h-3 mr-1" />
                            Day Off
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            No Owner
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Summary */}
              <div className="mt-4 flex gap-4 text-sm">
                <span className="text-green-600">
                  {scheduleResults.filter(m => m.status === "matched").length} matched
                </span>
                <span className="text-amber-600">
                  {scheduleResults.filter(m => m.status === "day_off").length} day off
                </span>
                <span className="text-red-600">
                  {scheduleResults.filter(m => m.status === "no_owner").length} no owner
                </span>
              </div>
            </div>
          )}

          {!scheduleResults && (
            <div className="text-center py-8 text-muted-foreground border rounded-lg">
              Click "Build Schedule" to generate matches based on driver profiles
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
