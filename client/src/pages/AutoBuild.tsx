import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, addWeeks, startOfWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Combobox } from "@/components/ui/combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  Brain,
  Save,
  Check,
  Users,
  Truck,
  SkipForward,
  Calendar,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Types
type BuildMode = "all" | "solo1" | "solo2" | "by_driver";

interface BlockSuggestion {
  blockId: string;
  blockDisplayId: string;
  driverId: string;
  driverName: string;
  confidence: number;
  compositeScore: number;
  patternScore: number;
  workloadScore: number;
  complianceScore: number;
  rationale: string;
  isProtectedAssignment: boolean;
}

interface AutoBuildPreview {
  targetWeekStart: string;
  targetWeekEnd: string;
  suggestions: BlockSuggestion[];
  totalBlocks: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  unassignable: BlockSuggestion[];
  warnings: string[];
}

interface PatternStats {
  totalPatterns: number;
  uniqueBlockSignatures: number;
  uniqueDrivers: number;
  highConfidencePatterns: number;
  mediumConfidencePatterns: number;
  lowConfidencePatterns: number;
}

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  status?: string;
  loadEligible?: boolean;
}

interface DriverDnaProfile {
  preferredDays?: string[];
  preferredStartTimes?: string[];
  preferredTractors?: string[];
  consistencyScore?: string;
  patternGroup?: string;
}

interface DriverSuggestionsResponse {
  weekStart: string;
  suggestions: BlockSuggestion[];
  driverProfile: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    dnaProfile: DriverDnaProfile | null;
    currentWorkload: number;
    maxCapacity: number;
  };
  unassignable: BlockSuggestion[];
  warnings: string[];
}

// Helpers
function getConfidenceBadgeVariant(confidence: number): "default" | "secondary" | "destructive" {
  if (confidence >= 0.5) return "default";
  if (confidence >= 0.35) return "secondary";
  return "destructive";
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.5) return "High";
  if (confidence >= 0.35) return "Medium";
  return "Low";
}

function formatDay(day: string) {
  const map: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat",
  };
  return map[day.toLowerCase()] || day.slice(0, 3);
}

export default function AutoBuild() {
  const { toast } = useToast();

  // Build mode state
  const [buildMode, setBuildMode] = useState<BuildMode>("all");

  // Standard mode state
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [currentPreview, setCurrentPreview] = useState<AutoBuildPreview | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Map<string, string>>(new Map());

  // Driver-by-driver mode state
  const [driverBuildActive, setDriverBuildActive] = useState(false);
  const [driverQueue, setDriverQueue] = useState<Driver[]>([]);
  const [includedDrivers, setIncludedDrivers] = useState<Set<string>>(new Set());
  const [completedDrivers, setCompletedDrivers] = useState<Set<string>>(new Set());
  const [currentDriverIndex, setCurrentDriverIndex] = useState(0);
  const [currentDriverSuggestions, setCurrentDriverSuggestions] = useState<BlockSuggestion[]>([]);
  const [currentDriverProfile, setCurrentDriverProfile] = useState<DriverSuggestionsResponse["driverProfile"] | null>(null);
  const [selectedForDriver, setSelectedForDriver] = useState<Set<string>>(new Set());
  const [pendingAssignments, setPendingAssignments] = useState<Array<{ blockId: string; driverId: string; driverName: string; blockDisplayId: string }>>([]);
  const [assignedBlockIds, setAssignedBlockIds] = useState<Set<string>>(new Set());

  // Week selector - defaults to next week
  const [targetWeekOffset, setTargetWeekOffset] = useState(1);
  const targetWeekStart = startOfWeek(addWeeks(new Date(), targetWeekOffset), { weekStartsOn: 0 });

  // Queries
  const { data: allDrivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: patternStats, isLoading: statsLoading } = useQuery<PatternStats>({
    queryKey: ["/api/patterns/stats"],
  });

  // Filter to only active, load-eligible drivers
  const eligibleDrivers = allDrivers.filter(d => d.status === "active" && d.loadEligible !== false);

  // Mutations
  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/patterns/recompute");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Patterns Recomputed", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/patterns/stats"] });
    },
    onError: (error: any) => {
      toast({ title: "Recompute Failed", description: error.message, variant: "destructive" });
    },
  });

  const generatePreviewMutation = useMutation({
    mutationFn: async () => {
      const body: any = { targetWeekStart: targetWeekStart.toISOString() };
      if (buildMode === "solo1") body.soloTypeFilter = "solo1";
      if (buildMode === "solo2") body.soloTypeFilter = "solo2";

      const res = await apiRequest("POST", "/api/auto-build/preview", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      setCurrentRunId(data.runId);
      setCurrentPreview(data.preview);
      setSelectedBlocks(new Set(data.preview.suggestions.map((s: BlockSuggestion) => s.blockId)));
      toast({
        title: "Auto-Build Preview Generated",
        description: `Generated ${data.preview.totalBlocks} block assignments`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Preview Generation Failed", description: error.message, variant: "destructive" });
    },
  });

  const fetchDriverSuggestionsMutation = useMutation({
    mutationFn: async (driverId: string) => {
      const res = await apiRequest(
        "GET",
        `/api/auto-build/driver-suggestions/${driverId}?weekStart=${targetWeekStart.toISOString()}`
      );
      return res.json() as Promise<DriverSuggestionsResponse>;
    },
    onSuccess: (data) => {
      // Filter out blocks that have already been assigned in this session
      const availableSuggestions = data.suggestions.filter(s => !assignedBlockIds.has(s.blockId));
      setCurrentDriverSuggestions(availableSuggestions);
      setCurrentDriverProfile(data.driverProfile);
      setSelectedForDriver(new Set(availableSuggestions.map(s => s.blockId)));
    },
    onError: (error: any) => {
      toast({ title: "Failed to load driver suggestions", description: error.message, variant: "destructive" });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!currentRunId || !currentPreview) throw new Error("No run selected");

      const finalAssignments = currentPreview.suggestions
        .filter(s => selectedBlocks.has(s.blockId))
        .map(s => ({
          blockId: s.blockId,
          driverId: manualOverrides.get(s.blockId) || s.driverId,
        }));

      const results = await Promise.all(
        finalAssignments.map(async (assignment) => {
          try {
            await apiRequest("POST", "/api/block-assignments", {
              blockId: assignment.blockId,
              driverId: assignment.driverId,
            });
            return { success: true, blockId: assignment.blockId };
          } catch (error: any) {
            return { success: false, blockId: assignment.blockId, error: error.message };
          }
        })
      );

      const created = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return { success: true, message: `Successfully created ${created} assignments${failed > 0 ? `, ${failed} failed` : ""}`, created, failed };
    },
    onSuccess: (data: any) => {
      toast({ title: "Assignments Created", description: data.message });
      resetState();
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/block-assignments"] });
    },
    onError: (error: any) => {
      toast({ title: "Commit Failed", description: error.message, variant: "destructive" });
    },
  });

  const publishPendingMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.all(
        pendingAssignments.map(async (assignment) => {
          try {
            await apiRequest("POST", "/api/block-assignments", {
              blockId: assignment.blockId,
              driverId: assignment.driverId,
            });
            return { success: true, blockId: assignment.blockId };
          } catch (error: any) {
            return { success: false, blockId: assignment.blockId, error: error.message };
          }
        })
      );

      const created = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return { success: true, message: `Successfully created ${created} assignments${failed > 0 ? `, ${failed} failed` : ""}`, created, failed };
    },
    onSuccess: (data: any) => {
      toast({ title: "Schedule Published!", description: data.message });
      resetState();
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/block-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
    },
    onError: (error: any) => {
      toast({ title: "Publish Failed", description: error.message, variant: "destructive" });
    },
  });

  // Helper functions
  const resetState = () => {
    setCurrentPreview(null);
    setCurrentRunId(null);
    setSelectedBlocks(new Set());
    setManualOverrides(new Map());
    setDriverBuildActive(false);
    setDriverQueue([]);
    setIncludedDrivers(new Set());
    setCompletedDrivers(new Set());
    setCurrentDriverIndex(0);
    setCurrentDriverSuggestions([]);
    setCurrentDriverProfile(null);
    setSelectedForDriver(new Set());
    setPendingAssignments([]);
    setAssignedBlockIds(new Set());
  };

  const startDriverByDriverBuild = () => {
    // Initialize driver queue with all eligible drivers selected
    setDriverQueue(eligibleDrivers);
    setIncludedDrivers(new Set(eligibleDrivers.map(d => d.id)));
    setCompletedDrivers(new Set());
    setCurrentDriverIndex(0);
    setPendingAssignments([]);
    setAssignedBlockIds(new Set());
    setDriverBuildActive(true);

    // Load first driver's suggestions
    if (eligibleDrivers.length > 0) {
      fetchDriverSuggestionsMutation.mutate(eligibleDrivers[0].id);
    }
  };

  const toggleDriverIncluded = (driverId: string) => {
    const newSet = new Set(includedDrivers);
    if (newSet.has(driverId)) {
      newSet.delete(driverId);
    } else {
      newSet.add(driverId);
    }
    setIncludedDrivers(newSet);
  };

  const toggleBlockForDriver = (blockId: string) => {
    const newSet = new Set(selectedForDriver);
    if (newSet.has(blockId)) {
      newSet.delete(blockId);
    } else {
      newSet.add(blockId);
    }
    setSelectedForDriver(newSet);
  };

  const confirmAndNextDriver = () => {
    if (!currentDriverProfile) return;

    // Add selected blocks to pending assignments
    const newAssignments = currentDriverSuggestions
      .filter(s => selectedForDriver.has(s.blockId))
      .map(s => ({
        blockId: s.blockId,
        driverId: currentDriverProfile.id,
        driverName: currentDriverProfile.name,
        blockDisplayId: s.blockDisplayId,
      }));

    setPendingAssignments(prev => [...prev, ...newAssignments]);

    // Mark these blocks as assigned
    const newAssignedIds = new Set(assignedBlockIds);
    newAssignments.forEach(a => newAssignedIds.add(a.blockId));
    setAssignedBlockIds(newAssignedIds);

    // Mark driver as completed
    setCompletedDrivers(prev => new Set([...prev, currentDriverProfile.id]));

    // Move to next included driver
    moveToNextDriver();
  };

  const skipDriver = () => {
    if (!currentDriverProfile) return;
    setCompletedDrivers(prev => new Set([...prev, currentDriverProfile.id]));
    moveToNextDriver();
  };

  const moveToNextDriver = () => {
    // Find next included driver that hasn't been completed
    const includedList = driverQueue.filter(d => includedDrivers.has(d.id));
    const currentIdx = includedList.findIndex(d => d.id === currentDriverProfile?.id);
    const nextDriver = includedList.find((d, idx) => idx > currentIdx && !completedDrivers.has(d.id));

    if (nextDriver) {
      setCurrentDriverIndex(driverQueue.findIndex(d => d.id === nextDriver.id));
      fetchDriverSuggestionsMutation.mutate(nextDriver.id);
    } else {
      // All drivers processed - show summary
      setCurrentDriverProfile(null);
      setCurrentDriverSuggestions([]);
    }
  };

  const selectAllForDriver = () => {
    setSelectedForDriver(new Set(currentDriverSuggestions.map(s => s.blockId)));
  };

  const toggleBlockSelection = (blockId: string) => {
    const newSet = new Set(selectedBlocks);
    if (newSet.has(blockId)) {
      newSet.delete(blockId);
    } else {
      newSet.add(blockId);
    }
    setSelectedBlocks(newSet);
  };

  const selectAllSuggestions = () => {
    if (!currentPreview) return;
    setSelectedBlocks(new Set(currentPreview.suggestions.map(s => s.blockId)));
  };

  const deselectAll = () => {
    setSelectedBlocks(new Set());
  };

  const handleDriverChange = (blockId: string, newDriverId: string) => {
    const newOverrides = new Map(manualOverrides);
    newOverrides.set(blockId, newDriverId);
    setManualOverrides(newOverrides);
  };

  const getEffectiveDriverId = (suggestion: BlockSuggestion): string => {
    return manualOverrides.get(suggestion.blockId) || suggestion.driverId;
  };

  // Calculate progress for driver-by-driver mode
  const includedDriversList = driverQueue.filter(d => includedDrivers.has(d.id));
  const completedCount = includedDriversList.filter(d => completedDrivers.has(d.id)).length;
  const progressPercent = includedDriversList.length > 0 ? (completedCount / includedDriversList.length) * 100 : 0;
  const allDriversComplete = completedCount === includedDriversList.length && includedDriversList.length > 0;

  // Calculate current step
  const currentStep = currentPreview || driverBuildActive ? 3 : 1;
  const steps = [
    { number: 1, label: "Recompute Patterns", completed: true },
    { number: 2, label: "Generate Schedule", completed: currentPreview !== null || driverBuildActive },
    { number: 3, label: "Review & Adjust", completed: false },
    { number: 4, label: "Publish", completed: false },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Auto-Build Schedule</h1>
            <p className="text-muted-foreground">
              AI-powered schedule generation using historical patterns and workload balance
            </p>
          </div>

          {/* Week Selector */}
          {!currentPreview && !driverBuildActive && (
            <div className="flex items-center gap-3 bg-muted/50 p-3 rounded-lg">
              <span className="text-sm font-medium text-muted-foreground">Target Week:</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTargetWeekOffset(Math.max(0, targetWeekOffset - 1))}
                  disabled={targetWeekOffset <= 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="text-sm font-semibold min-w-[160px] text-center">
                  {format(targetWeekStart, "MMM d")} - {format(addWeeks(targetWeekStart, 1), "MMM d, yyyy")}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTargetWeekOffset(targetWeekOffset + 1)}
                  disabled={targetWeekOffset >= 4}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <Badge variant={targetWeekOffset === 0 ? "secondary" : targetWeekOffset === 1 ? "default" : "outline"}>
                {targetWeekOffset === 0 ? "This Week" : targetWeekOffset === 1 ? "Next Week" : `+${targetWeekOffset} weeks`}
              </Badge>
            </div>
          )}
        </div>

        {/* Progress Stepper */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold transition-colors ${
                    step.number === currentStep
                      ? "bg-primary text-primary-foreground"
                      : step.completed
                      ? "bg-green-600 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step.completed ? <Check className="w-4 h-4" /> : step.number}
                </div>
                <span className={`text-sm font-medium whitespace-nowrap ${step.number === currentStep ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`h-0.5 w-8 ${step.completed ? "bg-green-600" : "bg-muted"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Build Mode Selector - Only show when not in active build */}
      {!currentPreview && !driverBuildActive && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Build Mode</CardTitle>
            <CardDescription>Choose how to build the schedule</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant={buildMode === "all" ? "default" : "outline"}
                onClick={() => setBuildMode("all")}
                className="flex items-center gap-2"
              >
                <Brain className="w-4 h-4" />
                Build All
              </Button>
              <Button
                variant={buildMode === "solo1" ? "default" : "outline"}
                onClick={() => setBuildMode("solo1")}
                className="flex items-center gap-2"
              >
                <Truck className="w-4 h-4" />
                Solo1 Only
              </Button>
              <Button
                variant={buildMode === "solo2" ? "default" : "outline"}
                onClick={() => setBuildMode("solo2")}
                className="flex items-center gap-2"
              >
                <Truck className="w-4 h-4" />
                Solo2 Only
              </Button>
              <Button
                variant={buildMode === "by_driver" ? "default" : "outline"}
                onClick={() => setBuildMode("by_driver")}
                className="flex items-center gap-2"
              >
                <Users className="w-4 h-4" />
                By Driver
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats Grid */}
      {!currentPreview && !driverBuildActive && patternStats && !statsLoading && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Patterns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{patternStats.totalPatterns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Drivers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{patternStats.uniqueDrivers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Block Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{patternStats.uniqueBlockSignatures}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600">High Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{patternStats.highConfidencePatterns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-600">Medium Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{patternStats.mediumConfidencePatterns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600">Low Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{patternStats.lowConfidencePatterns}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Action Buttons */}
      {!currentPreview && !driverBuildActive && (
        <div className="flex gap-4 items-center">
          <Button
            onClick={() => recomputeMutation.mutate()}
            disabled={recomputeMutation.isPending}
            variant="outline"
            className="shadow-md hover:shadow-lg transition-shadow"
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            {recomputeMutation.isPending ? "Recomputing..." : "Recompute Patterns"}
          </Button>

          {buildMode === "by_driver" ? (
            <Button
              onClick={startDriverByDriverBuild}
              disabled={eligibleDrivers.length === 0}
              className="shadow-md hover:shadow-lg transition-shadow"
              size="lg"
            >
              <Users className="w-4 h-4 mr-2" />
              Start Driver-by-Driver Build ({eligibleDrivers.length} drivers)
            </Button>
          ) : (
            <Button
              onClick={() => generatePreviewMutation.mutate()}
              disabled={generatePreviewMutation.isPending}
              className="shadow-md hover:shadow-lg transition-shadow"
              size="lg"
            >
              <Brain className="w-4 h-4 mr-2" />
              {generatePreviewMutation.isPending
                ? "Generating..."
                : `Generate ${buildMode === "all" ? "Full" : buildMode.toUpperCase()} Schedule`}
            </Button>
          )}
        </div>
      )}

      {/* Driver-by-Driver Build Mode */}
      {driverBuildActive && (
        <div className="flex gap-6">
          {/* Left Panel - Driver Queue */}
          <Card className="w-80 flex-shrink-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" />
                Driver Queue
              </CardTitle>
              <CardDescription>
                {completedCount} of {includedDriversList.length} complete
              </CardDescription>
              <Progress value={progressPercent} className="mt-2" />
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="p-4 space-y-2">
                  {driverQueue.map((driver, idx) => {
                    const isIncluded = includedDrivers.has(driver.id);
                    const isCompleted = completedDrivers.has(driver.id);
                    const isCurrent = currentDriverProfile?.id === driver.id;

                    return (
                      <div
                        key={driver.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border transition-all",
                          isCurrent && "bg-sky-50 dark:bg-sky-950 border-sky-400 shadow-md",
                          isCompleted && !isCurrent && "bg-green-50 dark:bg-green-950/30 border-green-300",
                          !isIncluded && "opacity-50"
                        )}
                      >
                        <Checkbox
                          checked={isIncluded}
                          onCheckedChange={() => toggleDriverIncluded(driver.id)}
                          disabled={isCompleted}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {driver.firstName} {driver.lastName}
                          </div>
                        </div>
                        {isCompleted && (
                          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                        )}
                        {isCurrent && (
                          <Badge variant="default" className="flex-shrink-0">Current</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Right Panel - Current Driver Focus */}
          <div className="flex-1 space-y-4">
            {currentDriverProfile && !allDriversComplete ? (
              <>
                {/* Driver Header Card */}
                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-2xl flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-sky-100 dark:bg-sky-900 flex items-center justify-center">
                            <User className="w-6 h-6 text-sky-600" />
                          </div>
                          {currentDriverProfile.name}
                        </CardTitle>
                        <CardDescription className="mt-2">
                          Driver {completedCount + 1} of {includedDriversList.length}
                        </CardDescription>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Current Workload</div>
                        <div className="text-2xl font-bold">
                          {currentDriverProfile.currentWorkload} / {currentDriverProfile.maxCapacity}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  {currentDriverProfile.dnaProfile && (
                    <CardContent className="pt-0">
                      <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Preferred Days</div>
                          <div className="font-medium">
                            {currentDriverProfile.dnaProfile.preferredDays?.map(formatDay).join(", ") || "Any"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Preferred Times</div>
                          <div className="font-medium">
                            {currentDriverProfile.dnaProfile.preferredStartTimes?.slice(0, 2).join(", ") || "Any"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Consistency</div>
                          <div className="font-medium">
                            {currentDriverProfile.dnaProfile.consistencyScore
                              ? `${Math.round(parseFloat(currentDriverProfile.dnaProfile.consistencyScore) * 100)}%`
                              : "N/A"}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Recommended Blocks */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Recommended Blocks</CardTitle>
                    <CardDescription>
                      {currentDriverSuggestions.length} blocks recommended for this driver
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {fetchDriverSuggestionsMutation.isPending ? (
                      <div className="text-center py-8 text-muted-foreground">
                        Loading suggestions...
                      </div>
                    ) : currentDriverSuggestions.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No blocks available for this driver
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">Select</TableHead>
                              <TableHead>Block</TableHead>
                              <TableHead>Confidence</TableHead>
                              <TableHead>Rationale</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {currentDriverSuggestions.map(suggestion => (
                              <TableRow key={suggestion.blockId}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedForDriver.has(suggestion.blockId)}
                                    onCheckedChange={() => toggleBlockForDriver(suggestion.blockId)}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">{suggestion.blockDisplayId}</TableCell>
                                <TableCell>
                                  <Badge variant={getConfidenceBadgeVariant(suggestion.confidence)}>
                                    {Math.round(suggestion.confidence * 100)}%
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground max-w-xs">
                                  {suggestion.rationale}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex justify-between">
                    <Button variant="ghost" onClick={skipDriver}>
                      <SkipForward className="w-4 h-4 mr-2" />
                      Skip Driver
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={selectAllForDriver}>
                        Select All ({currentDriverSuggestions.length})
                      </Button>
                      <Button onClick={confirmAndNextDriver} disabled={selectedForDriver.size === 0}>
                        <Check className="w-4 h-4 mr-2" />
                        Confirm & Next ({selectedForDriver.size})
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              </>
            ) : allDriversComplete ? (
              /* Summary when all drivers complete */
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl flex items-center gap-3">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                    Build Complete!
                  </CardTitle>
                  <CardDescription>
                    All selected drivers have been processed
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8">
                    <div className="text-4xl font-bold text-green-600 mb-2">
                      {pendingAssignments.length}
                    </div>
                    <div className="text-muted-foreground">
                      assignments ready to publish
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-center gap-4">
                  <Button variant="outline" onClick={resetState}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => publishPendingMutation.mutate()}
                    disabled={pendingAssignments.length === 0 || publishPendingMutation.isPending}
                    size="lg"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {publishPendingMutation.isPending ? "Publishing..." : `Publish ${pendingAssignments.length} Assignments`}
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Select a driver from the queue to begin
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Floating Progress Bar for Driver-by-Driver Mode */}
      {driverBuildActive && pendingAssignments.length > 0 && !allDriversComplete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-background border rounded-lg shadow-lg p-4 flex items-center gap-6 z-50">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="font-medium">{pendingAssignments.length} blocks ready</span>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span className="text-muted-foreground">
              {includedDriversList.length - completedCount} drivers remaining
            </span>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <Button
            onClick={() => publishPendingMutation.mutate()}
            disabled={publishPendingMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Publish Now
          </Button>
        </div>
      )}

      {/* Standard Preview Section (for all/solo1/solo2 modes) */}
      {currentPreview && (
        <>
          {/* Summary Stats for Preview */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Week</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm font-semibold">
                  {format(new Date(currentPreview.targetWeekStart), "MMM d")} -{" "}
                  {format(new Date(currentPreview.targetWeekEnd), "MMM d")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Blocks</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{currentPreview.totalBlocks}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-green-600">High Confidence</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{currentPreview.highConfidence}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-yellow-600">Medium</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{currentPreview.mediumConfidence}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-red-600">Low</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{currentPreview.lowConfidence}</div>
              </CardContent>
            </Card>
          </div>

          {/* Warnings */}
          {(currentPreview.warnings.length > 0 || currentPreview.unassignable.length > 0) && (
            <div className="space-y-2">
              {currentPreview.warnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">Warnings:</div>
                    <ul className="list-disc list-inside space-y-1">
                      {currentPreview.warnings.slice(0, 5).map((warning, i) => (
                        <li key={i} className="text-sm">{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {currentPreview.unassignable.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">{currentPreview.unassignable.length} Unassignable Blocks:</div>
                    <ul className="list-disc list-inside space-y-1">
                      {currentPreview.unassignable.slice(0, 5).map((block, i) => (
                        <li key={i} className="text-sm">{block.blockDisplayId}: {block.rationale}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={selectAllSuggestions} variant="outline" className="shadow-md">
              Select All
            </Button>
            <Button onClick={deselectAll} variant="outline" className="shadow-md">
              Deselect All
            </Button>
            <Button
              onClick={() => commitMutation.mutate()}
              disabled={selectedBlocks.size === 0 || commitMutation.isPending}
              className="shadow-md hover:shadow-lg transition-shadow"
              size="lg"
            >
              <Save className="w-4 h-4 mr-2" />
              {commitMutation.isPending ? "Publishing..." : `Publish ${selectedBlocks.size} Assignments`}
            </Button>
            <Button onClick={resetState} variant="ghost">
              Cancel
            </Button>
          </div>

          {/* Suggestions Table */}
          <Card>
            <CardHeader>
              <CardTitle>Review Assignments</CardTitle>
              <CardDescription>Review AI suggestions and make manual adjustments as needed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Block ID</TableHead>
                      <TableHead>AI Suggestion</TableHead>
                      <TableHead>Manual Reassign</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Scores</TableHead>
                      <TableHead>Rationale</TableHead>
                      <TableHead>Protected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPreview.suggestions.map((suggestion) => (
                      <TableRow key={suggestion.blockId}>
                        <TableCell>
                          <Checkbox
                            checked={selectedBlocks.has(suggestion.blockId)}
                            onCheckedChange={() => toggleBlockSelection(suggestion.blockId)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{suggestion.blockDisplayId}</TableCell>
                        <TableCell>{suggestion.driverName}</TableCell>
                        <TableCell>
                          <Combobox
                            options={allDrivers.map((driver) => ({
                              value: driver.id,
                              label: `${driver.firstName} ${driver.lastName}`
                            }))}
                            value={getEffectiveDriverId(suggestion)}
                            onValueChange={(value) => handleDriverChange(suggestion.blockId, value)}
                            placeholder="Select driver"
                            searchPlaceholder="Search drivers..."
                            emptyText="No driver found."
                            disabled={suggestion.isProtectedAssignment}
                            className="w-[180px]"
                          />
                          {manualOverrides.has(suggestion.blockId) && (
                            <Badge variant="outline" className="ml-2">Override</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getConfidenceBadgeVariant(suggestion.confidence)}>
                            {getConfidenceLabel(suggestion.confidence)} ({(suggestion.confidence * 100).toFixed(0)}%)
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs space-y-1">
                            <div>Pattern: {(suggestion.patternScore * 100).toFixed(0)}%</div>
                            <div>Workload: {(suggestion.workloadScore * 100).toFixed(0)}%</div>
                            <div>Compliance: {(suggestion.complianceScore * 100).toFixed(0)}%</div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs text-sm text-muted-foreground">
                          {suggestion.rationale}
                        </TableCell>
                        <TableCell>
                          {suggestion.isProtectedAssignment && (
                            <Badge variant="outline">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Protected
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
