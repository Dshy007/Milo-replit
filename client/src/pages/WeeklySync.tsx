import React, { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks, parseISO } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  Loader2,
  Zap,
  ArrowRight,
  Clock,
  Users,
  Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { WeekComparisonGrid } from "@/components/sync/WeekComparisonGrid";
import { ExceptionCard } from "@/components/sync/ExceptionCard";

// Types matching server
interface TimeSlot {
  key: string;
  soloType: string;
  startTime: string;
  tractorId: string;
  patternGroup?: string;
}

interface SlotDay {
  date: string;
  dayOfWeek: string;
  blockId: string | null;
  driverId: string | null;
  driverName: string | null;
  status: "assigned" | "unassigned" | "no_block";
  startTimestamp?: string;
  bumpMinutes?: number;
}

interface SlotWeekData {
  slot: TimeSlot;
  days: SlotDay[];
  assignedDriver: string | null;
  assignedDriverId: string | null;
}

interface SlotMatch {
  slot: TimeSlot;
  lastWeek: SlotWeekData;
  thisWeek: SlotWeekData;
  matchType: "exact" | "time_bump" | "driver_unavailable" | "new_slot" | "removed_slot";
  suggestedDriverId?: string;
  suggestedDriverName?: string;
  confidence?: number;
  bumpMinutes?: number;
  reason?: string;
}

interface WeekComparison {
  lastWeekStart: string;
  thisWeekStart: string;
  exactMatches: SlotMatch[];
  timeBumps: SlotMatch[];
  driverUnavailable: SlotMatch[];
  newSlots: SlotMatch[];
  removedSlots: SlotMatch[];
  summary: {
    totalSlots: number;
    exactMatches: number;
    timeBumps: number;
    needsAttention: number;
    newSlots: number;
  };
  mode: {
    mode: "planning" | "review" | "urgent" | "locked" | "readonly";
    message: string;
    canEdit: boolean;
  };
}

const MODE_STYLES = {
  planning: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    icon: Calendar
  },
  review: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    icon: Clock
  },
  urgent: {
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-400",
    icon: AlertTriangle
  },
  locked: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: XCircle
  },
  readonly: {
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    text: "text-slate-400",
    icon: Clock
  }
};

export default function WeeklySync() {
  const { toast } = useToast();
  const [selectedWeek, setSelectedWeek] = useState(() => {
    // Default to next week (Sunday)
    return startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 0 });
  });

  const lastWeek = subWeeks(selectedWeek, 1);
  const lastWeekStr = format(lastWeek, "yyyy-MM-dd");
  const thisWeekStr = format(selectedWeek, "yyyy-MM-dd");

  // Fetch comparison data
  const { data: comparison, isLoading, error, refetch } = useQuery<WeekComparison>({
    queryKey: ["/api/sync/compare", lastWeekStr, thisWeekStr],
    queryFn: async () => {
      const res = await fetch(`/api/sync/compare?lastWeek=${lastWeekStr}&thisWeek=${thisWeekStr}`);
      if (!res.ok) throw new Error("Failed to fetch comparison");
      return res.json();
    }
  });

  // Apply last week's assignments mutation
  const applyMutation = useMutation({
    mutationFn: async (slotKeys?: string[]) => {
      return apiRequest("POST", "/api/sync/apply-last-week", {
        thisWeekStart: thisWeekStr,
        slotKeys
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Assignments Applied",
        description: `Applied ${data.applied} assignments, ${data.skipped} skipped`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/compare"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Auto-match mutation
  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sync/auto-match", {
        weekStart: thisWeekStr
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Auto-Match Complete",
        description: `Found ${data.matches?.length || 0} suggestions`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/compare"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Single assignment mutation
  const assignMutation = useMutation({
    mutationFn: async ({ blockId, driverId }: { blockId: string; driverId: string }) => {
      return apiRequest("POST", "/api/sync/assign-single", { blockId, driverId });
    },
    onSuccess: () => {
      toast({ title: "Assignment Created" });
      queryClient.invalidateQueries({ queryKey: ["/api/sync/compare"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const navigateWeek = (direction: "prev" | "next") => {
    setSelectedWeek(prev =>
      direction === "prev" ? subWeeks(prev, 1) : addWeeks(prev, 1)
    );
  };

  // Calculate exceptions that need attention
  const exceptions = useMemo(() => {
    if (!comparison) return [];
    return [
      ...comparison.timeBumps.map(m => ({ ...m, type: "bump" as const })),
      ...comparison.driverUnavailable.map(m => ({ ...m, type: "unavailable" as const })),
      ...comparison.newSlots.map(m => ({ ...m, type: "new" as const }))
    ];
  }, [comparison]);

  const modeStyle = comparison?.mode ? MODE_STYLES[comparison.mode.mode] : MODE_STYLES.planning;
  const ModeIcon = modeStyle.icon;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Weekly Sync</h1>
            <p className="text-slate-400">
              Compare schedules and match drivers week-over-week
            </p>
          </div>

          {/* Week Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigateWeek("prev")}
              className="border-slate-700 hover:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="px-4 py-2 bg-slate-800 rounded-lg border border-slate-700">
              <span className="text-white font-medium">
                {format(selectedWeek, "MMM d")} - {format(addWeeks(selectedWeek, 1), "MMM d, yyyy")}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigateWeek("next")}
              className="border-slate-700 hover:bg-slate-800"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              className="border-slate-700 hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mode Banner */}
        {comparison?.mode && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${modeStyle.bg} ${modeStyle.border}`}>
            <ModeIcon className={`h-5 w-5 ${modeStyle.text}`} />
            <span className={`font-medium ${modeStyle.text}`}>
              {comparison.mode.message}
            </span>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {comparison && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-700/50">
                  <Users className="h-5 w-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">
                    {comparison.summary.totalSlots}
                  </p>
                  <p className="text-xs text-slate-400">Total Slots</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-emerald-500/10 border-emerald-500/30">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-400">
                    {comparison.summary.exactMatches}
                  </p>
                  <p className="text-xs text-emerald-400/70">Exact Matches</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-amber-500/10 border-amber-500/30">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <Clock className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-400">
                    {comparison.summary.timeBumps}
                  </p>
                  <p className="text-xs text-amber-400/70">Time Bumps</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-red-500/10 border-red-500/30">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/20">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-400">
                    {comparison.summary.needsAttention}
                  </p>
                  <p className="text-xs text-red-400/70">Needs Attention</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-violet-500/10 border-violet-500/30">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/20">
                  <Plus className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-violet-400">
                    {comparison.summary.newSlots}
                  </p>
                  <p className="text-xs text-violet-400/70">New Slots</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Action Buttons */}
      {comparison?.mode?.canEdit && (
        <div className="flex items-center gap-3 mb-6">
          <Button
            onClick={() => applyMutation.mutate(undefined)}
            disabled={applyMutation.isPending || comparison.summary.exactMatches === 0}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {applyMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Apply All Exact Matches ({comparison?.summary.exactMatches || 0})
          </Button>

          <Button
            onClick={() => autoMatchMutation.mutate()}
            disabled={autoMatchMutation.isPending}
            variant="outline"
            className="border-violet-500/50 text-violet-400 hover:bg-violet-500/10"
          >
            {autoMatchMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            Auto-Fill Remaining
          </Button>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left: Comparison Grid */}
        <div className="col-span-2">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-white flex items-center gap-2">
                <div className="flex items-center gap-2 text-slate-400">
                  <span>Last Week</span>
                  <span className="text-xs bg-slate-700 px-2 py-0.5 rounded">
                    {format(lastWeek, "MMM d")}
                  </span>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500" />
                <div className="flex items-center gap-2 text-white">
                  <span>This Week</span>
                  <span className="text-xs bg-violet-600 px-2 py-0.5 rounded">
                    {format(selectedWeek, "MMM d")}
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {comparison && (
                <WeekComparisonGrid
                  exactMatches={comparison.exactMatches}
                  timeBumps={comparison.timeBumps}
                  driverUnavailable={comparison.driverUnavailable}
                  newSlots={comparison.newSlots}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Exceptions */}
        <div className="col-span-1">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-white flex items-center justify-between">
                <span>Exceptions ({exceptions.length})</span>
                {exceptions.length > 0 && comparison?.mode?.canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-violet-400 hover:text-violet-300"
                    onClick={() => applyMutation.mutate(exceptions.map(e => e.slot.key))}
                  >
                    Apply All
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[600px] overflow-y-auto">
              {exceptions.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No exceptions to handle!</p>
                  <p className="text-sm">All slots match last week.</p>
                </div>
              ) : (
                exceptions.map((exception, idx) => (
                  <ExceptionCard
                    key={exception.slot.key + idx}
                    match={exception}
                    type={exception.type}
                    onAssign={(blockId, driverId) => assignMutation.mutate({ blockId, driverId })}
                    canEdit={comparison?.mode?.canEdit || false}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
