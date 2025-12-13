import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, addWeeks, subWeeks, subDays } from "date-fns";
import {
  Brain,
  RefreshCw,
  Calendar,
  Users,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Zap,
  Target,
  Filter,
  Play,
  Upload,
  History,
  CheckCircle,
  Settings,
} from "lucide-react";
import { ImportWizard } from "@/components/ImportWizard";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DriverWorkloadChart,
  DriverWeekHeatmap,
  PatternDistributionChart,
  MatchQualityChart,
} from "@/components/DriverScheduleCharts";
import { ProgressRing } from "@/components/ui/ProgressRing";

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

interface HistoryRange {
  start: string;
  end: string;
  days: number;
  totalAssignments: number;
}

interface ScheduleResult {
  success: boolean;
  suggestions: MatchSuggestion[];
  unassigned: string[];
  stats: ScheduleStats;
  historyRange?: HistoryRange;
}

// Score color utilities
const getScoreColor = (score: number): "emerald" | "teal" | "amber" | "slate" => {
  if (score >= 0.8) return "emerald";
  if (score >= 0.6) return "teal";
  if (score >= 0.4) return "amber";
  return "slate";
};

const getMatchBorderColor = (matchType: string, mlScore?: number | null): string => {
  const score = mlScore ?? (matchType === "ml_excellent" ? 0.9 : matchType === "ml_good" ? 0.7 : matchType === "ml_fair" ? 0.5 : 0.3);
  if (score >= 0.8) return "border-l-emerald-500";
  if (score >= 0.6) return "border-l-teal-500";
  if (score >= 0.4) return "border-l-amber-500";
  return "border-l-slate-500";
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

// Lookback weeks slider label
const getLookbackLabel = (weeks: number): string => {
  if (weeks === 1) return "1 week (last week only)";
  return `${weeks} weeks`;
};

// Predictability slider label
const getPredictabilityLabel = (value: number): string => {
  switch (value) {
    case 20: return "Flexible Pattern";
    case 40: return "Somewhat Flexible";
    case 60: return "Balanced";
    case 80: return "Follow Pattern";
    case 100: return "Keep Pattern";
    default: return "Balanced";
  }
};

// Time flexibility slider label
const getTimeFlexLabel = (hours: number): string => {
  if (hours === 0) return "Exact Time";
  return `±${hours}hr`;
};

// Memory length slider label
const getMemoryLabel = (weeks: number): string => {
  return `${weeks} weeks`;
};

// Preset modes
type ScheduleMode = "auto" | "stable" | "flex" | "custom";

const PRESET_VALUES: Record<Exclude<ScheduleMode, "custom">, { predictability: number; timeFlex: number; memory: number }> = {
  auto: { predictability: 60, timeFlex: 2, memory: 7 },
  stable: { predictability: 100, timeFlex: 1, memory: 12 },
  flex: { predictability: 20, timeFlex: 4, memory: 3 },
};

// Calculate the number of days between two dates
const getDaysDiff = (start: Date, end: Date): number => {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
};

export default function AIScheduler() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [contractFilter, setContractFilter] = useState<"all" | "solo1" | "solo2">("all");
  const [minDays, setMinDays] = useState(3);
  // Lookback weeks slider (1-8 weeks, default 1 week for week-to-week matching)
  const [lookbackWeeks, setLookbackWeeks] = useState(1);
  // Custom date range for history lookback (computed from lookbackWeeks)
  const [historyStartDate, setHistoryStartDate] = useState<Date>(() => subDays(new Date(), 7));
  const [historyEndDate, setHistoryEndDate] = useState<Date>(() => subDays(new Date(), 1));
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);

  // New scheduling settings sliders
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("auto");
  const [predictability, setPredictability] = useState(60);  // 20, 40, 60, 80, 100
  const [timeFlex, setTimeFlex] = useState(2);               // 0, 1, 2, 3, 4 hours
  const [memoryLength, setMemoryLength] = useState(7);       // 3, 5, 7, 9, 12 weeks

  // Handle preset mode selection
  const handleModeChange = (mode: ScheduleMode) => {
    setScheduleMode(mode);
    if (mode !== "custom") {
      const preset = PRESET_VALUES[mode];
      setPredictability(preset.predictability);
      setTimeFlex(preset.timeFlex);
      setMemoryLength(preset.memory);
    }
  };

  // When sliders change manually, switch to custom mode
  const handleSliderChange = (
    setter: (value: number) => void,
    value: number
  ) => {
    setter(value);
    if (scheduleMode !== "custom") {
      setScheduleMode("custom");
    }
  };

  // Update history dates when lookbackWeeks changes
  const handleLookbackChange = (weeks: number) => {
    setLookbackWeeks(weeks);
    const today = new Date();
    setHistoryStartDate(subDays(today, weeks * 7));
    setHistoryEndDate(subDays(today, 1));
  };
  const { toast } = useToast();

  // Calculate week dates
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const selectedWeekStart = weekOffset === 0
    ? currentWeekStart
    : weekOffset > 0
      ? addWeeks(currentWeekStart, weekOffset)
      : subWeeks(currentWeekStart, Math.abs(weekOffset));
  const weekStartStr = format(selectedWeekStart, "yyyy-MM-dd");

  // Format dates for API
  const historyStartStr = format(historyStartDate, "yyyy-MM-dd");
  const historyEndStr = format(historyEndDate, "yyyy-MM-dd");

  // Schedule optimization state
  const [optimizerResult, setOptimizerResult] = useState<ScheduleResult | null>(null);

  // Optimizer mutation - always uses fresh parameters
  const optimizerMutation = useMutation({
    mutationFn: async (params: {
      weekStart: string;
      contractType: string;
      minDays: number;
      historyStart: string;
      historyEnd: string;
    }) => {
      console.log("[AIScheduler] Running optimizer with history:", params.historyStart, "to", params.historyEnd);
      const res = await apiRequest("POST", "/api/matching/calculate", {
        weekStart: params.weekStart,
        contractType: params.contractType === "all" ? undefined : params.contractType,
        minDays: params.minDays,
        historyStart: params.historyStart,
        historyEnd: params.historyEnd,
      });
      return res.json();
    },
    onSuccess: (result: ScheduleResult) => {
      setOptimizerResult(result);
    },
    onError: (error: Error) => {
      toast({
        title: "Optimizer Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Convenience accessors for backward compatibility
  const data = optimizerResult;
  const isFetching = optimizerMutation.isPending;
  const isLoading = optimizerMutation.isPending;

  // Run optimizer with current parameters
  const runOptimizer = () => {
    optimizerMutation.mutate({
      weekStart: weekStartStr,
      contractType: contractFilter,
      minDays,
      historyStart: historyStartStr,
      historyEnd: historyEndStr,
    });
  };

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

  // Handle import wizard completion
  const handleImportComplete = async (dominantWeekStart?: Date) => {
    await queryClient.invalidateQueries({
      queryKey: ["/api/schedules/calendar"],
      refetchType: "all",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });

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
      let dateStr = s.serviceDate;
      if (!dateStr) {
        const blockParts = s.blockId.split("-");
        dateStr = blockParts.length >= 3 ? `${blockParts[0]}-${blockParts[1]}-${blockParts[2]}` : "";
      }

      if (dateStr) {
        const date = new Date(dateStr + "T00:00:00");
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

    return Object.fromEntries(
      Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
    );
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

  // Calculate progress metrics
  const coveragePercent = stats ? Math.round((stats.assigned / stats.totalBlocks) * 100) || 0 : 0;
  const avgScore = useMemo(() => {
    if (!data?.suggestions?.length) return 0;
    const sum = data.suggestions.reduce((acc, s) => acc + (s.mlScore || 0.35), 0);
    return Math.round((sum / data.suggestions.length) * 100);
  }, [data?.suggestions]);
  const excellentPercent = stats ? Math.round((matchTypeStats.excellent / (data?.suggestions?.length || 1)) * 100) : 0;

  const handleApplyAll = () => {
    if (!data?.suggestions || data.suggestions.length === 0) return;
    const assignments = data.suggestions.map(s => ({
      blockId: s.blockId,
      driverId: s.driverId,
    }));
    applyMutation.mutate(assignments);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-100">AI Scheduler</h1>
              <p className="text-sm text-slate-400">OR-Tools + ML Pattern Matching</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={runOptimizer}
              disabled={isFetching}
              className="border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300"
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
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-purple-500/20"
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

        {/* Controls Row */}
        <div className="elegant-card p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
            {/* Week Navigation */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekOffset(weekOffset - 1)}
                className="border-slate-700 bg-slate-800/50 hover:bg-slate-700"
              >
                <ChevronLeft className="w-4 h-4 text-slate-300" />
              </Button>

              <div className="text-center min-w-[200px]">
                <div className="font-semibold text-slate-100">
                  {format(selectedWeekStart, "MMMM d")} - {format(addWeeks(selectedWeekStart, 1), "MMMM d, yyyy")}
                </div>
                <div className="text-xs text-slate-400">
                  {weekOffset === 0 ? "Current Week" : weekOffset > 0 ? `${weekOffset} week${weekOffset > 1 ? 's' : ''} ahead` : `${Math.abs(weekOffset)} week${Math.abs(weekOffset) > 1 ? 's' : ''} ago`}
                </div>
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekOffset(weekOffset + 1)}
                className="border-slate-700 bg-slate-800/50 hover:bg-slate-700"
              >
                <ChevronRight className="w-4 h-4 text-slate-300" />
              </Button>

              {weekOffset !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setWeekOffset(0)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Today
                </Button>
              )}
            </div>

            {/* Contract Type Filter */}
            <div className="flex items-center gap-3">
              <Filter className="w-4 h-4 text-slate-500" />
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
                    onClick={() => setContractFilter(option.value as "all" | "solo1" | "solo2")}
                    className={cn(
                      "border-slate-700",
                      contractFilter !== option.value && "bg-slate-800/50 text-slate-400 hover:bg-slate-700",
                      contractFilter === option.value && option.value === "solo1" && "bg-blue-600 hover:bg-blue-500",
                      contractFilter === option.value && option.value === "solo2" && "bg-emerald-600 hover:bg-emerald-500",
                      contractFilter === option.value && option.value === "all" && "bg-violet-600 hover:bg-violet-500"
                    )}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* MinDays Slider (keeping for now) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-4 bg-slate-800/50 rounded-lg px-4 py-2 min-w-[200px] border border-slate-700/50">
                    <Target className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-500">Distribution</span>
                        <span className="font-medium text-violet-400">
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
                <TooltipContent side="bottom" className="bg-slate-800 border-slate-700">
                  <p className="font-medium mb-1 text-slate-100">Work Distribution</p>
                  <p className="text-xs text-slate-400">3 = Flexible (3-7 days per driver)</p>
                  <p className="text-xs text-slate-400">4 = Balanced (4-6 days per driver)</p>
                  <p className="text-xs text-slate-400">5 = Strict (exactly 5 days each)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Scheduling Settings Panel */}
        <div className="elegant-card p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <Settings className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Scheduling Settings</h3>
                <p className="text-xs text-slate-500">Configure how the AI matches drivers to blocks</p>
              </div>
            </div>

            {/* Preset Mode Buttons */}
            <div className="flex gap-2">
              {[
                { value: "auto", label: "AUTO", color: "bg-blue-600 hover:bg-blue-500" },
                { value: "stable", label: "STABLE", color: "bg-emerald-600 hover:bg-emerald-500" },
                { value: "flex", label: "FLEX", color: "bg-amber-600 hover:bg-amber-500" },
                { value: "custom", label: "CUSTOM", color: "bg-slate-600 hover:bg-slate-500" },
              ].map((mode) => (
                <Button
                  key={mode.value}
                  variant={scheduleMode === mode.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleModeChange(mode.value as ScheduleMode)}
                  className={cn(
                    "border-slate-700 text-xs font-medium",
                    scheduleMode !== mode.value && "bg-slate-800/50 text-slate-400 hover:bg-slate-700",
                    scheduleMode === mode.value && mode.color
                  )}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 3 Sliders */}
          <div className="grid grid-cols-3 gap-4">
            {/* Predictability Slider */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="bg-slate-800/50 rounded-lg px-4 py-3 border border-slate-700/50">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-slate-500">Predictability</span>
                      <span className="font-medium text-amber-400">
                        {getPredictabilityLabel(predictability)}
                      </span>
                    </div>
                    <Slider
                      value={[predictability]}
                      onValueChange={([value]) => handleSliderChange(setPredictability, value)}
                      min={20}
                      max={100}
                      step={20}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                      <span>Flexible</span>
                      <span>Keep Pattern</span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-slate-800 border-slate-700">
                  <p className="font-medium mb-1 text-slate-100">How closely to follow driver patterns</p>
                  <p className="text-xs text-slate-400">20% = Allow flexible assignments</p>
                  <p className="text-xs text-slate-400">60% = Balanced approach</p>
                  <p className="text-xs text-slate-400">100% = Strictly follow established patterns</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Time Flexibility Slider */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="bg-slate-800/50 rounded-lg px-4 py-3 border border-slate-700/50">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-slate-500">Time Flexibility</span>
                      <span className="font-medium text-cyan-400">
                        {getTimeFlexLabel(timeFlex)}
                      </span>
                    </div>
                    <Slider
                      value={[timeFlex]}
                      onValueChange={([value]) => handleSliderChange(setTimeFlex, value)}
                      min={0}
                      max={4}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                      <span>Exact Time</span>
                      <span>±4 Hours</span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-slate-800 border-slate-700">
                  <p className="font-medium mb-1 text-slate-100">How far from original time is OK?</p>
                  <p className="text-xs text-slate-400">0 = Only exact time matches</p>
                  <p className="text-xs text-slate-400">±2hr = Standard bump tolerance</p>
                  <p className="text-xs text-slate-400">±4hr = Maximum flexibility</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Memory Length Slider */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="bg-slate-800/50 rounded-lg px-4 py-3 border border-slate-700/50">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-slate-500">Memory Length</span>
                      <span className="font-medium text-violet-400">
                        {getMemoryLabel(memoryLength)}
                      </span>
                    </div>
                    <Slider
                      value={[memoryLength]}
                      onValueChange={([value]) => handleSliderChange(setMemoryLength, value)}
                      min={3}
                      max={12}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                      <span>3 Weeks</span>
                      <span>12 Weeks</span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-slate-800 border-slate-700">
                  <p className="font-medium mb-1 text-slate-100">How much history to learn from</p>
                  <p className="text-xs text-slate-400">3 weeks = Recent patterns only</p>
                  <p className="text-xs text-slate-400">7 weeks = Balanced history</p>
                  <p className="text-xs text-slate-400">12 weeks = Full pattern analysis</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Import & Run Section */}
        <div className="elegant-card p-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Upload className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-100">Import & Optimize</h3>
                <p className="text-xs text-slate-400">Upload schedule file, then run optimizer</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setIsImportWizardOpen(true)}
                className="gap-2 border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-slate-300"
              >
                <Upload className="w-4 h-4" />
                Import Schedule
              </Button>
              <Button
                onClick={runOptimizer}
                disabled={isFetching}
                className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-purple-500/20"
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
        </div>

        {/* Stats Progress Rings */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="elegant-card p-5 flex flex-col items-center">
              <ProgressRing value={coveragePercent} color="teal" size="md" sublabel="Coverage" />
              <p className="text-xs text-slate-500 mt-2">{stats.assigned}/{stats.totalBlocks} blocks</p>
            </div>
            <div className="elegant-card p-5 flex flex-col items-center">
              <ProgressRing value={avgScore} color="violet" size="md" sublabel="Avg Score" />
              <p className="text-xs text-slate-500 mt-2">{data?.suggestions?.length || 0} matches</p>
            </div>
            <div className="elegant-card p-5 flex flex-col items-center">
              <ProgressRing value={excellentPercent} color="emerald" size="md" sublabel="Excellent" />
              <p className="text-xs text-slate-500 mt-2">{matchTypeStats.excellent} high scores</p>
            </div>
            <div className="elegant-card p-5 flex flex-col items-center">
              <ProgressRing
                value={stats.unassigned === 0 ? 100 : Math.max(0, 100 - (stats.unassigned / stats.totalBlocks * 100))}
                color={stats.unassigned === 0 ? "emerald" : "amber"}
                size="md"
                label={stats.unassigned.toString()}
                sublabel="Unassigned"
              />
              <p className="text-xs text-slate-500 mt-2">{stats.totalDrivers} drivers</p>
            </div>
          </div>
        )}

        {/* History Verification Banner - Shows what date range was analyzed */}
        {data?.historyRange && (
          <div className="elegant-card p-4 mb-6 border-l-4 border-l-cyan-500 bg-cyan-500/5">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-cyan-500 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-cyan-400">History Analyzed</span>
                  <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-xs">
                    {data.historyRange.days} day{data.historyRange.days > 1 ? 's' : ''} lookback
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">Date Range:</span>
                    <div className="font-medium text-slate-200">
                      {data.historyRange.start} → {data.historyRange.end}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Assignments Found:</span>
                    <div className="font-medium text-slate-200">{data.historyRange.totalAssignments}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Drivers Analyzed:</span>
                    <div className="font-medium text-emerald-400">{stats?.totalDrivers || 0}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Solver Status Banner */}
        {stats?.solverStatus && stats.solverStatus !== "OPTIMAL" && stats.solverStatus !== "FEASIBLE" && (
          <div className="elegant-card p-4 mb-6 border-l-4 border-l-amber-500">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <div>
                <span className="font-medium text-amber-400">Solver Status: {stats.solverStatus}</span>
                <p className="text-sm text-slate-400">
                  The optimizer may not have found the optimal solution.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="elegant-card p-12 text-center mb-6">
            <Loader2 className="w-10 h-10 animate-spin text-violet-500 mx-auto mb-4" />
            <h3 className="font-semibold text-slate-100 mb-2">Running AI Optimizer...</h3>
            <p className="text-sm text-slate-400">
              Analyzing patterns with OR-Tools + scikit-learn
            </p>
          </div>
        )}

        {/* Results */}
        {!isLoading && data?.suggestions && (
          <div className="space-y-6">
            {/* Charts Row - Prominent */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PatternDistributionChart suggestions={data.suggestions} />
              <MatchQualityChart suggestions={data.suggestions} />
            </div>

            {/* Heatmap - Full Width */}
            <DriverWeekHeatmap suggestions={data.suggestions} />

            {/* Workload Chart */}
            <DriverWorkloadChart suggestions={data.suggestions} />

            {/* Weekly Calendar Grid */}
            <div className="chart-container">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-violet-500" />
                <h3 className="text-sm font-medium text-slate-200">Weekly Schedule</h3>
                <span className="text-xs text-slate-500 ml-2">
                  {format(selectedWeekStart, "MMM d")} - {format(addWeeks(selectedWeekStart, 1), "MMM d, yyyy")}
                </span>
              </div>
              <div className="grid grid-cols-7 gap-3">
                {DAY_NAMES.map((day, index) => {
                  const dayDate = new Date(selectedWeekStart);
                  dayDate.setDate(dayDate.getDate() + index);
                  const dayKey = Object.keys(suggestionsByDay).find(k => k.startsWith(day));
                  const dayBlocks = dayKey ? suggestionsByDay[dayKey] : [];

                  return (
                    <div key={day} className="text-center p-3 rounded-lg bg-slate-800/30 border border-slate-700/50">
                      <div className="font-semibold text-sm text-slate-300">{day.slice(0, 3)}</div>
                      <div className="text-xs text-slate-500 mb-2">{format(dayDate, "MMM d")}</div>
                      <div className="text-2xl font-bold text-violet-400">{dayBlocks.length}</div>
                      <div className="text-[10px] text-slate-500">blocks</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Day-by-Day Detail Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
              {DAY_NAMES.map((day, index) => {
                const dayDate = new Date(selectedWeekStart);
                dayDate.setDate(dayDate.getDate() + index);
                const dayKey = Object.keys(suggestionsByDay).find(k => k.startsWith(day));
                const dayBlocks = dayKey ? suggestionsByDay[dayKey] : [];

                return (
                  <div key={day} className={cn(
                    "elegant-card min-h-[200px] p-3",
                    dayBlocks.length === 0 && "opacity-40"
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-semibold text-sm text-slate-200">{day.slice(0, 3)}</div>
                        <div className="text-xs text-slate-500">{format(dayDate, "M/d")}</div>
                      </div>
                      {dayBlocks.length > 0 && (
                        <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-[10px]">
                          {dayBlocks.length}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                      {dayBlocks.length > 0 ? (
                        dayBlocks.map((s) => (
                          <div
                            key={s.blockId}
                            className={cn(
                              "p-2 rounded-md text-xs border-l-2 bg-slate-800/50",
                              getMatchBorderColor(s.matchType, s.mlScore)
                            )}
                          >
                            <div className="font-medium text-slate-200 truncate" title={s.driverName}>
                              {s.driverName.split(" ")[0]} {s.driverName.split(" ")[1]?.[0]}.
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-slate-500">{s.actualTime}</span>
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-medium",
                                s.mlScore && s.mlScore >= 0.8 ? "bg-emerald-500/20 text-emerald-400" :
                                s.mlScore && s.mlScore >= 0.6 ? "bg-teal-500/20 text-teal-400" :
                                s.mlScore && s.mlScore >= 0.4 ? "bg-amber-500/20 text-amber-400" :
                                "bg-slate-500/20 text-slate-400"
                              )}>
                                {s.mlScore ? `${Math.round(s.mlScore * 100)}%` : "-"}
                              </span>
                            </div>
                            {s.patternGroup && (
                              <div className={cn(
                                "mt-1 text-[9px] px-1 py-0.5 rounded w-fit",
                                s.patternGroup === "sunWed" ? "bg-violet-500/20 text-violet-400" :
                                s.patternGroup === "wedSat" ? "bg-cyan-500/20 text-cyan-400" :
                                "bg-slate-500/20 text-slate-400"
                              )}>
                                {s.patternGroup === "sunWed" ? "S-W" : s.patternGroup === "wedSat" ? "W-S" : "Mix"}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-slate-600 py-6 text-xs">
                          No blocks
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Driver Summary */}
            <div className="chart-container">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-violet-500" />
                <h3 className="text-sm font-medium text-slate-200">Driver Assignments</h3>
                <Badge className="bg-slate-700 text-slate-300 border-slate-600 ml-2 text-xs">
                  {Object.keys(suggestionsByDriver).length} drivers
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Object.entries(suggestionsByDriver).map(([driver, driverSuggestions]) => {
                  const avgDriverScore = driverSuggestions.reduce((sum, s) => sum + (s.mlScore || 0.35), 0) / driverSuggestions.length;
                  const pattern = driverSuggestions[0]?.patternGroup;
                  const scoreColor = getScoreColor(avgDriverScore);

                  return (
                    <div
                      key={driver}
                      className={cn(
                        "p-3 rounded-lg border bg-slate-800/30 hover:bg-slate-800/50 transition-colors",
                        scoreColor === "emerald" ? "border-emerald-500/30" :
                        scoreColor === "teal" ? "border-teal-500/30" :
                        scoreColor === "amber" ? "border-amber-500/30" :
                        "border-slate-700"
                      )}
                    >
                      <div className="font-medium text-sm text-slate-200 truncate" title={driver}>
                        {driver.split(" ")[0]} {driver.split(" ")[1]?.[0] || ""}.
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge className="bg-slate-700/50 text-slate-300 border-slate-600 text-[10px] px-1">
                          {driverSuggestions.length} days
                        </Badge>
                        <Badge className={cn(
                          "text-[10px] px-1 border",
                          scoreColor === "emerald" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                          scoreColor === "teal" ? "bg-teal-500/20 text-teal-400 border-teal-500/30" :
                          scoreColor === "amber" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                          "bg-slate-500/20 text-slate-400 border-slate-500/30"
                        )}>
                          {Math.round(avgDriverScore * 100)}%
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
                                  ? "bg-violet-500/30 text-violet-300"
                                  : "bg-slate-800 text-slate-600"
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
                          pattern === "sunWed" ? "bg-violet-500/20 text-violet-400" :
                          pattern === "wedSat" ? "bg-cyan-500/20 text-cyan-400" :
                          "bg-slate-500/20 text-slate-400"
                        )}>
                          {pattern === "sunWed" ? "Sun-Wed" : pattern === "wedSat" ? "Wed-Sat" : "Mixed"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Unassigned Blocks */}
            {data.unassigned && data.unassigned.length > 0 && (
              <div className="elegant-card p-4 border-l-4 border-l-red-500">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h3 className="text-sm font-medium text-red-400">Unassigned Blocks</h3>
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 ml-2">
                    {data.unassigned.length}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.unassigned.map((blockId) => (
                    <div
                      key={blockId}
                      className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30"
                    >
                      <span className="text-xs font-mono text-red-400">{blockId}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && (!data?.suggestions || data.suggestions.length === 0) && !stats && (
          <div className="elegant-card p-12 text-center">
            <Brain className="w-12 h-12 text-violet-500/50 mx-auto mb-4" />
            <h3 className="font-semibold text-slate-200 mb-2">No Data Available</h3>
            <p className="text-sm text-slate-500 mb-4">
              No blocks found for the selected week. Import schedule data to get started.
            </p>
            <Button
              variant="outline"
              onClick={runOptimizer}
              className="border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-slate-300"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        )}

        {/* How It Works */}
        <div className="elegant-card p-6 mt-8 border-t-2 border-t-violet-500/30">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0 border border-violet-500/30">
              <Zap className="w-5 h-5 text-violet-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-200 mb-3">How the AI Scheduler Works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/50">
                  <span className="font-medium text-teal-400">1. Pattern Analysis</span>
                  <p className="text-slate-500 text-xs mt-1">scikit-learn K-Means clusters drivers into patterns (Sun-Wed, Wed-Sat, Mixed) based on 8 weeks of history.</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/50">
                  <span className="font-medium text-violet-400">2. Fit Scoring</span>
                  <p className="text-slate-500 text-xs mt-1">RandomForest predicts driver-block compatibility (0-100%) using day preferences and historical patterns.</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/50">
                  <span className="font-medium text-emerald-400">3. Constraint Solving</span>
                  <p className="text-slate-500 text-xs mt-1">OR-Tools CP-SAT enforces: 1 block/driver/day, contract matching, and fair distribution.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Import Wizard */}
        <ImportWizard
          open={isImportWizardOpen}
          onOpenChange={setIsImportWizardOpen}
          onImport={() => setIsImportWizardOpen(false)}
          onImportComplete={handleImportComplete}
          currentWeekStart={selectedWeekStart}
          skipDriverAssignments={true}
        />
      </div>
    </div>
  );
}
