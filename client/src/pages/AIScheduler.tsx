import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, addWeeks, subWeeks } from "date-fns";
import {
  Brain,
  RefreshCw,
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Zap,
  Target,
  TrendingUp,
  Filter,
  Play,
  Upload,
} from "lucide-react";
import { ImportWizard } from "@/components/ImportWizard";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
// Tabs removed - using single calendar view
import { cn } from "@/lib/utils";
import {
  DriverWorkloadChart,
  DriverWeekHeatmap,
  PatternDistributionChart,
  MatchQualityChart,
} from "@/components/DriverScheduleCharts";

// Types from the API
interface MatchSuggestion {
  blockId: string;
  driverId: string;
  driverName: string;
  confidence: number;
  matchType: string;
  preferredTime: string;
  actualTime: string;
  serviceDate?: string;
  day?: string;
  mlScore?: number | null;
  patternGroup?: string | null;
}

interface ScheduleStats {
  totalBlocks: number;
  totalDrivers: number;
  assigned: number;
  unassigned: number;
  solverStatus: string;
}

interface ScheduleResult {
  success: boolean;
  suggestions: MatchSuggestion[];
  unassigned: string[];
  stats: ScheduleStats;
}

// Gradient colors for match quality
const getMatchGradient = (matchType: string, mlScore?: number | null): string => {
  const score = mlScore ?? (matchType === "ml_excellent" ? 0.9 : matchType === "ml_good" ? 0.7 : matchType === "ml_fair" ? 0.5 : 0.3);

  if (score >= 0.8) {
    return "bg-gradient-to-r from-emerald-500 to-green-600 text-white"; // Excellent
  } else if (score >= 0.6) {
    return "bg-gradient-to-r from-teal-500 to-cyan-600 text-white"; // Good
  } else if (score >= 0.4) {
    return "bg-gradient-to-r from-amber-500 to-yellow-600 text-white"; // Fair
  } else {
    return "bg-gradient-to-r from-slate-500 to-gray-600 text-white"; // Assigned
  }
};

const getMatchBorderColor = (matchType: string, mlScore?: number | null): string => {
  const score = mlScore ?? (matchType === "ml_excellent" ? 0.9 : matchType === "ml_good" ? 0.7 : matchType === "ml_fair" ? 0.5 : 0.3);

  if (score >= 0.8) return "border-l-emerald-500";
  if (score >= 0.6) return "border-l-teal-500";
  if (score >= 0.4) return "border-l-amber-500";
  return "border-l-slate-400";
};

const getMatchLabel = (matchType: string): string => {
  switch (matchType) {
    case "ml_excellent": return "Excellent";
    case "ml_good": return "Good";
    case "ml_fair": return "Fair";
    case "ml_assigned": return "Assigned";
    case "optimal": return "History Match";
    case "assigned": return "Available";
    default: return matchType;
  }
};

// Pattern group badge colors
const getPatternBadge = (pattern: string | null | undefined) => {
  switch (pattern) {
    case "sunWed":
      return { label: "Sun-Wed", className: "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300" };
    case "wedSat":
      return { label: "Wed-Sat", className: "bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-900/30 dark:text-cyan-300" };
    case "mixed":
    default:
      return { label: "Mixed", className: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300" };
  }
};

// Day names for grouping
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Slider labels
const getSliderLabel = (value: number): string => {
  switch (value) {
    case 3: return "Flexible (3-7 days)";
    case 4: return "Balanced (4-6 days)";
    case 5: return "Strict (5-5 days)";
    default: return "Balanced";
  }
};

export default function AIScheduler() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [contractFilter, setContractFilter] = useState<"all" | "solo1" | "solo2">("all");
  const [minDays, setMinDays] = useState(3);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const { toast } = useToast();

  // Calculate week dates
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const selectedWeekStart = weekOffset === 0
    ? currentWeekStart
    : weekOffset > 0
      ? addWeeks(currentWeekStart, weekOffset)
      : subWeeks(currentWeekStart, Math.abs(weekOffset));
  const weekStartStr = format(selectedWeekStart, "yyyy-MM-dd");
  const weekEndStr = format(addWeeks(selectedWeekStart, 1), "yyyy-MM-dd");

  // Fetch schedule optimization - DISABLED auto-fetch, only runs on manual trigger
  const { data, isLoading, refetch, isFetching } = useQuery<ScheduleResult>({
    queryKey: ["/api/matching/calculate", weekStartStr, contractFilter, minDays],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/matching/calculate", {
        weekStart: weekStartStr,
        contractType: contractFilter === "all" ? undefined : contractFilter,
        minDays,
      });
      return res.json();
    },
    enabled: false, // Don't auto-fetch - user must click "Run Optimizer"
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Apply mutations
  const applyMutation = useMutation({
    mutationFn: async (assignments: Array<{ blockId: string; driverId: string }>) => {
      const res = await apiRequest("POST", "/api/matching/apply", { assignments });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/calculate"] });
      toast({
        title: "Schedule Applied",
        description: `Successfully assigned ${result.applied} blocks.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Apply",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle import wizard completion - navigate to imported week
  const handleImportComplete = async (dominantWeekStart?: Date) => {
    // Invalidate calendar queries
    await queryClient.invalidateQueries({
      queryKey: ["/api/schedules/calendar"],
      refetchType: "all",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });

    // Navigate to the dominant imported week
    if (dominantWeekStart) {
      const currentWeek = startOfWeek(new Date(), { weekStartsOn: 0 });
      const diff = Math.round((dominantWeekStart.getTime() - currentWeek.getTime()) / (7 * 24 * 60 * 60 * 1000));
      setWeekOffset(diff);
    }

    toast({
      title: "Import Complete",
      description: "Schedule imported successfully. Click 'Run Optimizer' to generate assignments.",
    });
  };

  // Group suggestions by day
  const suggestionsByDay = useMemo(() => {
    if (!data?.suggestions) return {};
    const groups: Record<string, MatchSuggestion[]> = {};

    for (const s of data.suggestions) {
      // Use serviceDate from API if available, fallback to parsing blockId
      let dateStr = s.serviceDate;
      if (!dateStr) {
        const blockParts = s.blockId.split("-");
        dateStr = blockParts.length >= 3 ? `${blockParts[0]}-${blockParts[1]}-${blockParts[2]}` : "";
      }

      if (dateStr) {
        const date = new Date(dateStr + "T00:00:00");
        // Validate the date is valid
        if (!isNaN(date.getTime())) {
          const dayName = DAY_NAMES[date.getDay()];
          const displayKey = `${dayName} (${format(date, "MMM d")})`;
          if (!groups[displayKey]) groups[displayKey] = [];
          groups[displayKey].push(s);
        }
      }
    }

    return groups;
  }, [data?.suggestions]);

  // Group suggestions by driver
  const suggestionsByDriver = useMemo(() => {
    if (!data?.suggestions) return {};
    const groups: Record<string, MatchSuggestion[]> = {};

    for (const s of data.suggestions) {
      const key = s.driverName;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }

    // Sort by number of assignments
    return Object.fromEntries(
      Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
    );
  }, [data?.suggestions]);

  // Group by pattern
  const suggestionsByPattern = useMemo(() => {
    if (!data?.suggestions) return {};
    const groups: Record<string, MatchSuggestion[]> = {
      sunWed: [],
      wedSat: [],
      mixed: [],
      new: [],  // Drivers without enough history to determine pattern
    };

    for (const s of data.suggestions) {
      const pattern = s.patternGroup;
      // null/undefined means insufficient data - put in "new"
      if (pattern && groups[pattern]) {
        groups[pattern].push(s);
      } else if (!pattern) {
        groups.new.push(s);
      } else {
        groups.mixed.push(s);
      }
    }

    return groups;
  }, [data?.suggestions]);

  // Stats calculations
  const stats = data?.stats;
  const matchTypeStats = useMemo(() => {
    if (!data?.suggestions) return { excellent: 0, good: 0, fair: 0, assigned: 0 };
    return data.suggestions.reduce((acc, s) => {
      if (s.matchType === "ml_excellent") acc.excellent++;
      else if (s.matchType === "ml_good") acc.good++;
      else if (s.matchType === "ml_fair") acc.fair++;
      else acc.assigned++;
      return acc;
    }, { excellent: 0, good: 0, fair: 0, assigned: 0 });
  }, [data?.suggestions]);

  const handleApplyAll = () => {
    if (!data?.suggestions || data.suggestions.length === 0) return;

    const assignments = data.suggestions.map(s => ({
      blockId: s.blockId,
      driverId: s.driverId,
    }));

    applyMutation.mutate(assignments);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">AI Scheduler</h1>
            <p className="text-sm text-muted-foreground">
              OR-Tools + ML Pattern Matching
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>

          <Button
            onClick={handleApplyAll}
            disabled={applyMutation.isPending || !data?.suggestions?.length}
            className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
          >
            {applyMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Apply All ({data?.suggestions?.length || 0})
          </Button>
        </div>
      </div>

      {/* Week Navigation + Controls */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
            {/* Week Navigation */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekOffset(weekOffset - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <div className="text-center min-w-[200px]">
                <div className="font-semibold text-foreground">
                  {format(selectedWeekStart, "MMMM d")} - {format(addWeeks(selectedWeekStart, 1), "MMMM d, yyyy")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {weekOffset === 0 ? "Current Week" : weekOffset > 0 ? `${weekOffset} week${weekOffset > 1 ? 's' : ''} ahead` : `${Math.abs(weekOffset)} week${Math.abs(weekOffset) > 1 ? 's' : ''} ago`}
                </div>
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekOffset(weekOffset + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>

              {weekOffset !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setWeekOffset(0)}
                  className="text-xs"
                >
                  Today
                </Button>
              )}
            </div>

            {/* Contract Type Filter */}
            <div className="flex items-center gap-3">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <div className="flex gap-2">
                {[
                  { value: "all", label: "All" },
                  { value: "solo1", label: "Solo1" },
                  { value: "solo2", label: "Solo2" },
                ].map((option) => (
                  <Button
                    key={option.value}
                    variant={contractFilter === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setContractFilter(option.value as any)}
                    className={cn(
                      contractFilter === option.value && option.value === "solo1" && "bg-blue-600 hover:bg-blue-700",
                      contractFilter === option.value && option.value === "solo2" && "bg-emerald-600 hover:bg-emerald-700"
                    )}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* MinDays Slider */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-4 bg-slate-100 dark:bg-slate-800 rounded-lg px-4 py-2 min-w-[240px]">
                    <Target className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Distribution</span>
                        <span className="font-medium text-violet-600 dark:text-violet-400">
                          {getSliderLabel(minDays)}
                        </span>
                      </div>
                      <Slider
                        value={[minDays]}
                        onValueChange={([value]) => setMinDays(value)}
                        min={3}
                        max={5}
                        step={1}
                        className="w-full"
                      />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="font-medium mb-1">Work Distribution</p>
                  <p className="text-xs">3 = Flexible (3-7 days per driver)</p>
                  <p className="text-xs">4 = Balanced (4-6 days per driver)</p>
                  <p className="text-xs">5 = Strict (exactly 5 days each)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      {/* Import & Run Section */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Upload className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Import & Optimize</h3>
                <p className="text-xs text-muted-foreground">Upload schedule file, preview blocks, then run optimizer</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setIsImportWizardOpen(true)}
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                Import Schedule
              </Button>
              <Button
                onClick={() => refetch()}
                disabled={isFetching}
                className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
              >
                {isFetching ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Brain className="w-4 h-4 mr-2" />
                )}
                Run Optimizer
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{stats.totalBlocks}</div>
              <div className="text-xs text-muted-foreground">Total Blocks</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{stats.totalDrivers}</div>
              <div className="text-xs text-muted-foreground">Drivers</div>
            </CardContent>
          </Card>
          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600">{matchTypeStats.excellent}</div>
              <div className="text-xs text-muted-foreground">Excellent</div>
            </CardContent>
          </Card>
          <Card className="border-teal-200 dark:border-teal-800">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-teal-600">{matchTypeStats.good}</div>
              <div className="text-xs text-muted-foreground">Good</div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-800">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{matchTypeStats.fair}</div>
              <div className="text-xs text-muted-foreground">Fair</div>
            </CardContent>
          </Card>
          <Card className={cn(
            stats.unassigned > 0 ? "border-red-200 dark:border-red-800" : ""
          )}>
            <CardContent className="p-4 text-center">
              <div className={cn(
                "text-2xl font-bold",
                stats.unassigned > 0 ? "text-red-600" : "text-foreground"
              )}>
                {stats.unassigned}
              </div>
              <div className="text-xs text-muted-foreground">Unassigned</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Solver Status Banner */}
      {stats?.solverStatus && stats.solverStatus !== "OPTIMAL" && stats.solverStatus !== "FEASIBLE" && (
        <Card className="mb-6 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <div>
              <span className="font-medium text-amber-800 dark:text-amber-200">Solver Status: {stats.solverStatus}</span>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                The optimizer may not have found the optimal solution. Consider adjusting constraints.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <Card className="mb-6">
          <CardContent className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-2">Running AI Optimizer...</h3>
            <p className="text-sm text-muted-foreground">
              Analyzing patterns and constraints with OR-Tools + scikit-learn
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results - Weekly Calendar View */}
      {!isLoading && data?.suggestions && (
        <div className="space-y-6">
          {/* Quick Stats Bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Quality:</span>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-xs">{matchTypeStats.excellent}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-teal-500" />
                <span className="text-xs">{matchTypeStats.good}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="text-xs">{matchTypeStats.fair}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-slate-500" />
                <span className="text-xs">{matchTypeStats.assigned}</span>
              </div>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Patterns:</span>
              <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 text-xs">
                Sun-Wed: {suggestionsByPattern.sunWed?.length || 0}
              </Badge>
              <Badge variant="outline" className="bg-cyan-100 text-cyan-700 border-cyan-300 text-xs">
                Wed-Sat: {suggestionsByPattern.wedSat?.length || 0}
              </Badge>
              <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 text-xs">
                Mixed: {suggestionsByPattern.mixed?.length || 0}
              </Badge>
            </div>
            {data.unassigned && data.unassigned.length > 0 && (
              <>
                <div className="h-4 w-px bg-border" />
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {data.unassigned.length} Unassigned
                </Badge>
              </>
            )}
          </div>

          {/* Weekly Calendar Grid - THE MAIN VIEW */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5 text-violet-600" />
                Weekly Schedule
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {format(selectedWeekStart, "MMM d")} - {format(addWeeks(selectedWeekStart, 1), "MMM d, yyyy")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {/* Day Headers */}
                {DAY_NAMES.map((day, index) => {
                  const dayDate = new Date(selectedWeekStart);
                  dayDate.setDate(dayDate.getDate() + index);
                  const dayKey = Object.keys(suggestionsByDay).find(k => k.startsWith(day));
                  const dayBlocks = dayKey ? suggestionsByDay[dayKey] : [];

                  return (
                    <div key={day} className="text-center">
                      <div className="font-semibold text-sm mb-1">{day.slice(0, 3)}</div>
                      <div className="text-xs text-muted-foreground mb-2">{format(dayDate, "MMM d")}</div>
                      <div className="text-lg font-bold text-violet-600">{dayBlocks.length}</div>
                      <div className="text-[10px] text-muted-foreground">blocks</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Detailed Day-by-Day Blocks */}
          <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
            {DAY_NAMES.map((day, index) => {
              const dayDate = new Date(selectedWeekStart);
              dayDate.setDate(dayDate.getDate() + index);
              const dayKey = Object.keys(suggestionsByDay).find(k => k.startsWith(day));
              const dayBlocks = dayKey ? suggestionsByDay[dayKey] : [];

              return (
                <Card key={day} className={cn(
                  "min-h-[200px]",
                  dayBlocks.length === 0 && "opacity-50"
                )}>
                  <CardHeader className="pb-2 px-3 pt-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{day.slice(0, 3)}</div>
                        <div className="text-xs text-muted-foreground">{format(dayDate, "M/d")}</div>
                      </div>
                      {dayBlocks.length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {dayBlocks.length}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-2 pb-2 space-y-1.5 max-h-[300px] overflow-y-auto">
                    {dayBlocks.length > 0 ? (
                      dayBlocks.map((s) => (
                        <div
                          key={s.blockId}
                          className={cn(
                            "p-2 rounded-md text-xs border-l-3",
                            getMatchBorderColor(s.matchType, s.mlScore),
                            "bg-card shadow-sm"
                          )}
                        >
                          <div className="font-medium text-foreground truncate" title={s.driverName}>
                            {s.driverName.split(" ")[0]} {s.driverName.split(" ")[1]?.[0]}.
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-muted-foreground">{s.actualTime}</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-medium",
                              s.mlScore && s.mlScore >= 0.8 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
                              s.mlScore && s.mlScore >= 0.6 ? "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" :
                              s.mlScore && s.mlScore >= 0.4 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                              "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            )}>
                              {s.mlScore ? `${Math.round(s.mlScore * 100)}%` : "-"}
                            </span>
                          </div>
                          {s.patternGroup && (
                            <div className={cn(
                              "mt-1 text-[9px] px-1 py-0.5 rounded w-fit",
                              s.patternGroup === "sunWed" ? "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" :
                              s.patternGroup === "wedSat" ? "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400" :
                              "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                            )}>
                              {s.patternGroup === "sunWed" ? "S-W" : s.patternGroup === "wedSat" ? "W-S" : "Mix"}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-muted-foreground py-6 text-xs">
                        No blocks
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Driver Summary - Compact horizontal list */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-violet-600" />
                Driver Assignments
                <Badge variant="secondary" className="ml-2">
                  {Object.keys(suggestionsByDriver).length} drivers
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {Object.entries(suggestionsByDriver).map(([driver, driverSuggestions]) => {
                  const avgScore = driverSuggestions.reduce((sum, s) => sum + (s.mlScore || 0.35), 0) / driverSuggestions.length;
                  const pattern = driverSuggestions[0]?.patternGroup;
                  const daysWorking = [...new Set(driverSuggestions.map(s => s.day || ""))].filter(Boolean);

                  return (
                    <div
                      key={driver}
                      className={cn(
                        "p-3 rounded-lg border bg-card hover:shadow-md transition-shadow",
                        avgScore >= 0.8 ? "border-emerald-200 dark:border-emerald-800" :
                        avgScore >= 0.6 ? "border-teal-200 dark:border-teal-800" :
                        avgScore >= 0.4 ? "border-amber-200 dark:border-amber-800" :
                        "border-slate-200 dark:border-slate-700"
                      )}
                    >
                      <div className="font-medium text-sm truncate" title={driver}>
                        {driver.split(" ")[0]} {driver.split(" ")[1]?.[0] || ""}.
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge variant="outline" className="text-[10px] px-1">
                          {driverSuggestions.length} days
                        </Badge>
                        <Badge variant="outline" className={cn(
                          "text-[10px] px-1",
                          avgScore >= 0.8 ? "text-emerald-600 border-emerald-300" :
                          avgScore >= 0.6 ? "text-teal-600 border-teal-300" :
                          avgScore >= 0.4 ? "text-amber-600 border-amber-300" :
                          "text-slate-600 border-slate-300"
                        )}>
                          {Math.round(avgScore * 100)}%
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-0.5 mt-2">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
                          const dayLower = DAY_NAMES[i].toLowerCase();
                          const hasDay = driverSuggestions.some(s =>
                            s.day?.toLowerCase() === dayLower ||
                            (s.serviceDate && new Date(s.serviceDate + "T00:00:00").getDay() === i)
                          );
                          return (
                            <span
                              key={d}
                              className={cn(
                                "w-5 h-5 rounded text-[9px] flex items-center justify-center font-medium",
                                hasDay
                                  ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                  : "bg-muted/50 text-muted-foreground/50"
                              )}
                            >
                              {d[0]}
                            </span>
                          );
                        })}
                      </div>
                      {pattern && (
                        <div className={cn(
                          "mt-2 text-[9px] px-1.5 py-0.5 rounded w-fit",
                          pattern === "sunWed" ? "bg-purple-100 text-purple-600" :
                          pattern === "wedSat" ? "bg-cyan-100 text-cyan-600" :
                          "bg-slate-100 text-slate-600"
                        )}>
                          {pattern === "sunWed" ? "Sun-Wed" : pattern === "wedSat" ? "Wed-Sat" : "Mixed"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Unassigned Blocks (if any) */}
          {data.unassigned && data.unassigned.length > 0 && (
            <Card className="border-red-200 dark:border-red-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-5 h-5" />
                  Unassigned Blocks
                  <Badge variant="destructive" className="ml-2">
                    {data.unassigned.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {data.unassigned.map((blockId) => (
                    <div
                      key={blockId}
                      className="px-2 py-1 rounded bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
                    >
                      <span className="text-xs font-mono text-red-700 dark:text-red-300">{blockId}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Visual Charts - Collapsible */}
          <details className="group">
            <summary className="flex items-center gap-2 cursor-pointer p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
              <TrendingUp className="w-4 h-4 text-violet-600" />
              <span className="font-medium">Visual Analytics</span>
              <span className="text-xs text-muted-foreground ml-2">(click to expand)</span>
            </summary>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <PatternDistributionChart suggestions={data.suggestions} />
              <MatchQualityChart suggestions={data.suggestions} />
              <div className="lg:col-span-2">
                <DriverWorkloadChart suggestions={data.suggestions} />
              </div>
            </div>
            <div className="mt-4">
              <DriverWeekHeatmap suggestions={data.suggestions} />
            </div>
          </details>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && (!data?.suggestions || data.suggestions.length === 0) && !stats && (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="w-12 h-12 text-violet-600/50 mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-2">No Data Available</h3>
            <p className="text-sm text-muted-foreground mb-4">
              No blocks found for the selected week. Import schedule data to get started.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* How It Works */}
      <Card className="mt-8 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 border-violet-200 dark:border-violet-800">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-2">How the AI Scheduler Works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">1. Pattern Analysis</span>
                  <p>scikit-learn K-Means clusters drivers into patterns (Sun-Wed, Wed-Sat, Mixed) based on 8 weeks of history.</p>
                </div>
                <div>
                  <span className="font-medium text-foreground">2. Fit Scoring</span>
                  <p>RandomForest predicts driver-block compatibility (0-100%) using day preferences and historical patterns.</p>
                </div>
                <div>
                  <span className="font-medium text-foreground">3. Constraint Solving</span>
                  <p>OR-Tools CP-SAT enforces: 1 block/driver/day, contract matching, and fair distribution based on slider.</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import Wizard - skipDriverAssignments=true so blocks import unassigned for AI optimization */}
      <ImportWizard
        open={isImportWizardOpen}
        onOpenChange={setIsImportWizardOpen}
        onImport={() => {
          // The wizard handles the import internally - just close it
          setIsImportWizardOpen(false);
        }}
        onImportComplete={handleImportComplete}
        currentWeekStart={selectedWeekStart}
        skipDriverAssignments={true}
      />
    </div>
  );
}
