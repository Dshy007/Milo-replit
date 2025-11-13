import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, parseISO } from "date-fns";
import { 
  Calendar, ChevronLeft, ChevronRight, ArrowRightLeft, UserMinus, UserPlus,
  AlertTriangle, CheckCircle2, Info, TrendingUp, TrendingDown, Minus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Block, BlockAssignment, Driver } from "@shared/schema";

type CascadeAction = "swap" | "unassign" | "reassign";

interface CascadeAnalysisResult {
  canProceed: boolean;
  action: string;
  sourceAssignment: BlockAssignment & { block: Block; driver: Driver };
  targetDriver?: Driver;
  before: {
    sourceDriverWorkload: DriverWorkload;
    targetDriverWorkload?: DriverWorkload;
  };
  after: {
    sourceDriverWorkload: DriverWorkload;
    targetDriverWorkload?: DriverWorkload;
  };
  hasViolations: boolean;
  hasWarnings: boolean;
  blockingIssues: string[];
  warnings: string[];
}

interface DriverWorkload {
  driverId: string;
  driver: Driver;
  totalHours24h: number;
  totalHours48h: number;
  assignmentCount: number;
  complianceStatus: "valid" | "warning" | "violation";
  complianceMessages: string[];
}

type CalendarResponse = {
  dateRange: { start: string; end: string };
  blocks: Array<Block & {
    contract: { id: string; name: string; type: string } | null;
    assignment: (BlockAssignment & { driver: Driver | null }) | null;
  }>;
};

export default function CascadeEffect() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAssignment, setSelectedAssignment] = useState<BlockAssignment & { block: Block; driver: Driver } | null>(null);
  const [actionType, setActionType] = useState<CascadeAction | null>(null);
  const [targetDriverId, setTargetDriverId] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<CascadeAnalysisResult | null>(null);
  const { toast } = useToast();

  // Calculate date range for week view
  const dateRange = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    const end = endOfWeek(currentDate, { weekStartsOn: 0 });
    return { start, end, days: eachDayOfInterval({ start, end }) };
  }, [currentDate]);

  // Fetch calendar data
  const { data: calendarData, isLoading } = useQuery<CalendarResponse>({
    queryKey: ["/api/schedules/calendar", format(dateRange.start, "yyyy-MM-dd"), format(dateRange.end, "yyyy-MM-dd")],
    queryFn: async () => {
      const startDateStr = format(dateRange.start, "yyyy-MM-dd");
      const endDateStr = format(dateRange.end, "yyyy-MM-dd");
      const url = `/api/schedules/calendar?startDate=${startDateStr}&endDate=${endDateStr}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // Fetch all drivers for reassign dropdown
  const { data: allDrivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Analyze cascade effect
  const analyzeMutation = useMutation({
    mutationFn: async (request: { assignmentId: string; action: CascadeAction; targetDriverId?: string }): Promise<CascadeAnalysisResult> => {
      const response = await apiRequest("POST", "/api/schedules/cascade-analysis", request);
      return response as CascadeAnalysisResult;
    },
    onSuccess: (data: CascadeAnalysisResult) => {
      setAnalysisResult(data);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Analysis failed",
        description: error.message,
      });
    },
  });

  // Execute the schedule change
  const executeMutation = useMutation({
    mutationFn: async (request: { assignmentId: string; action: CascadeAction; targetDriverId?: string }) => {
      // This would call an endpoint to actually make the change
      // For now, we'll implement the logic based on action type
      if (request.action === "unassign") {
        return await apiRequest("DELETE", `/api/block-assignments/${request.assignmentId}`);
      } else if (request.action === "reassign" && request.targetDriverId) {
        return await apiRequest("PATCH", `/api/block-assignments/${request.assignmentId}`, {
          driverId: request.targetDriverId,
        });
      }
      throw new Error("Invalid action");
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/schedules/calendar"] });
      queryClient.refetchQueries({ queryKey: ["/api/block-assignments"] });
      toast({
        title: "Schedule updated",
        description: "The schedule change has been applied successfully",
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to update schedule",
        description: error.message,
      });
    },
  });

  const handleAssignmentClick = (assignment: BlockAssignment & { driver: Driver }, block: Block) => {
    setSelectedAssignment({ ...assignment, block, driver: assignment.driver });
    setActionType(null);
    setAnalysisResult(null);
    setTargetDriverId("");
  };

  const handleAnalyze = () => {
    if (!selectedAssignment || !actionType) return;

    const request: any = {
      assignmentId: selectedAssignment.id,
      action: actionType,
    };

    if ((actionType === "swap" || actionType === "reassign") && targetDriverId) {
      request.targetDriverId = targetDriverId;
    }

    analyzeMutation.mutate(request);
  };

  const handleExecute = () => {
    if (!selectedAssignment || !actionType || !analysisResult?.canProceed) return;

    const request: any = {
      assignmentId: selectedAssignment.id,
      action: actionType,
    };

    if ((actionType === "swap" || actionType === "reassign") && targetDriverId) {
      request.targetDriverId = targetDriverId;
    }

    executeMutation.mutate(request);
  };

  const handleClose = () => {
    setSelectedAssignment(null);
    setActionType(null);
    setAnalysisResult(null);
    setTargetDriverId("");
  };

  // Get assigned blocks grouped by day
  const blocksByDay = useMemo(() => {
    if (!calendarData) return new Map();

    const map = new Map<string, Array<Block & { assignment: BlockAssignment & { driver: Driver } | null }>>();

    calendarData.blocks.forEach(block => {
      const dayKey = format(parseISO(block.startTimestamp.toString()), "yyyy-MM-dd");
      if (!map.has(dayKey)) {
        map.set(dayKey, []);
      }
      if (block.assignment) {
        map.get(dayKey)!.push(block as Block & { assignment: BlockAssignment & { driver: Driver } });
      }
    });

    return map;
  }, [calendarData]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex-none border-b bg-background p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Cascade Effect Analysis</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Modify schedule assignments and see the ripple effects on driver workloads
            </p>
          </div>
        </div>

        {/* Week Navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
            data-testid="button-prev-week"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous Week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            data-testid="button-this-week"
          >
            <Calendar className="w-4 h-4 mr-2" />
            This Week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
            data-testid="button-next-week"
          >
            Next Week
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="ml-auto text-sm font-medium" data-testid="text-date-range">
            {format(dateRange.start, "MMM d")} - {format(dateRange.end, "MMM d, yyyy")}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12" data-testid="text-loading">
            Loading schedule...
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-4">
            {dateRange.days.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayBlocks = blocksByDay.get(dayKey) || [];

              return (
                <Card key={dayKey} className="min-h-[200px]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">
                      {format(day, "EEE")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {format(day, "MMM d")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {dayBlocks.map((block: Block & { assignment: BlockAssignment & { driver: Driver } | null }) => {
                      if (!block.assignment) return null;
                      const assignment = block.assignment;

                      return (
                        <button
                          key={block.id}
                          onClick={() => handleAssignmentClick(assignment, block)}
                          className="w-full text-left p-2 rounded-md bg-primary/10 hover-elevate active-elevate-2 border border-primary/20 transition-colors"
                          data-testid={`assignment-${block.blockId}`}
                        >
                          <div className="font-medium text-xs truncate">
                            {assignment.driver?.firstName} {assignment.driver?.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {format(parseISO(block.startTimestamp.toString()), "HH:mm")}
                          </div>
                          <Badge variant="outline" className="text-xs mt-1">
                            {block.soloType}
                          </Badge>
                        </button>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Cascade Analysis Dialog */}
      <Dialog open={!!selectedAssignment} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedAssignment && (
            <>
              <DialogHeader>
                <DialogTitle data-testid="dialog-title">
                  Modify Assignment: {selectedAssignment.driver.firstName} {selectedAssignment.driver.lastName}
                </DialogTitle>
                <DialogDescription>
                  Block {selectedAssignment.block.blockId} - {format(parseISO(selectedAssignment.block.startTimestamp.toString()), "EEE MMM d, HH:mm")}
                </DialogDescription>
              </DialogHeader>

              {/* Action Selection */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Select Action</label>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant={actionType === "unassign" ? "default" : "outline"}
                      onClick={() => {
                        setActionType("unassign");
                        setAnalysisResult(null);
                      }}
                      data-testid="button-action-unassign"
                      className="justify-start"
                    >
                      <UserMinus className="w-4 h-4 mr-2" />
                      Unassign
                    </Button>
                    <Button
                      variant={actionType === "reassign" ? "default" : "outline"}
                      onClick={() => {
                        setActionType("reassign");
                        setAnalysisResult(null);
                      }}
                      data-testid="button-action-reassign"
                      className="justify-start"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Reassign
                    </Button>
                    <Button
                      variant={actionType === "swap" ? "default" : "outline"}
                      onClick={() => {
                        setActionType("swap");
                        setAnalysisResult(null);
                      }}
                      data-testid="button-action-swap"
                      className="justify-start"
                    >
                      <ArrowRightLeft className="w-4 h-4 mr-2" />
                      Swap
                    </Button>
                  </div>
                </div>

                {/* Target Driver Selection */}
                {(actionType === "reassign" || actionType === "swap") && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      {actionType === "reassign" ? "Reassign to Driver" : "Swap with Driver"}
                    </label>
                    <Select
                      value={targetDriverId}
                      onValueChange={(value) => {
                        setTargetDriverId(value);
                        setAnalysisResult(null);
                      }}
                    >
                      <SelectTrigger data-testid="select-target-driver">
                        <SelectValue placeholder="Select a driver..." />
                      </SelectTrigger>
                      <SelectContent>
                        {allDrivers
                          .filter(d => d.id !== selectedAssignment.driverId)
                          .map(driver => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.firstName} {driver.lastName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Analyze Button */}
                <Button
                  onClick={handleAnalyze}
                  disabled={
                    !actionType ||
                    ((actionType === "reassign" || actionType === "swap") && !targetDriverId) ||
                    analyzeMutation.isPending
                  }
                  className="w-full"
                  data-testid="button-analyze"
                >
                  {analyzeMutation.isPending ? "Analyzing..." : "Analyze Cascade Effect"}
                </Button>

                {/* Analysis Results */}
                {analysisResult && (
                  <div className="space-y-4 mt-6">
                    <Separator />
                    
                    {/* Status Banner */}
                    {analysisResult.hasViolations && (
                      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                        <div className="flex items-center gap-2 text-destructive font-medium">
                          <AlertTriangle className="w-5 h-5" />
                          Cannot Proceed - DOT Violations Detected
                        </div>
                        <ul className="mt-2 space-y-1 text-sm">
                          {analysisResult.blockingIssues.map((issue, i) => (
                            <li key={i} className="text-destructive/90">• {issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!analysisResult.hasViolations && analysisResult.hasWarnings && (
                      <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                        <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-500 font-medium">
                          <Info className="w-5 h-5" />
                          Warnings Detected
                        </div>
                        <ul className="mt-2 space-y-1 text-sm">
                          {analysisResult.warnings.map((warning, i) => (
                            <li key={i} className="text-yellow-700/90 dark:text-yellow-500/90">• {warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!analysisResult.hasViolations && !analysisResult.hasWarnings && (
                      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-md">
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-500 font-medium">
                          <CheckCircle2 className="w-5 h-5" />
                          All Clear - No Compliance Issues
                        </div>
                      </div>
                    )}

                    {/* Workload Comparison */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Source Driver */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm">
                            {analysisResult.before.sourceDriverWorkload.driver.firstName}{" "}
                            {analysisResult.before.sourceDriverWorkload.driver.lastName}
                          </CardTitle>
                          <CardDescription className="text-xs">Source Driver</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <WorkloadComparison
                            before={analysisResult.before.sourceDriverWorkload}
                            after={analysisResult.after.sourceDriverWorkload}
                          />
                        </CardContent>
                      </Card>

                      {/* Target Driver */}
                      {analysisResult.targetDriver && analysisResult.before.targetDriverWorkload && analysisResult.after.targetDriverWorkload && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">
                              {analysisResult.targetDriver.firstName} {analysisResult.targetDriver.lastName}
                            </CardTitle>
                            <CardDescription className="text-xs">Target Driver</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <WorkloadComparison
                              before={analysisResult.before.targetDriverWorkload}
                              after={analysisResult.after.targetDriverWorkload}
                            />
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
                  Cancel
                </Button>
                {analysisResult && (
                  <Button
                    onClick={handleExecute}
                    disabled={!analysisResult.canProceed || executeMutation.isPending}
                    data-testid="button-execute"
                  >
                    {executeMutation.isPending ? "Applying..." : "Apply Changes"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Workload Comparison Component
function WorkloadComparison({ before, after }: { before: DriverWorkload; after: DriverWorkload }) {
  const getDelta = (beforeVal: number, afterVal: number) => {
    const delta = afterVal - beforeVal;
    return delta;
  };

  const hours24Delta = getDelta(before.totalHours24h, after.totalHours24h);
  const hours48Delta = getDelta(before.totalHours48h, after.totalHours48h);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">24h Hours:</span>
          <div className="flex items-center gap-2">
            <span className="font-mono">{before.totalHours24h.toFixed(1)}h</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-mono font-medium">{after.totalHours24h.toFixed(1)}h</span>
            {hours24Delta !== 0 && (
              <Badge variant={hours24Delta > 0 ? "destructive" : "secondary"} className="text-xs">
                {hours24Delta > 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {Math.abs(hours24Delta).toFixed(1)}h
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">48h Hours:</span>
          <div className="flex items-center gap-2">
            <span className="font-mono">{before.totalHours48h.toFixed(1)}h</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-mono font-medium">{after.totalHours48h.toFixed(1)}h</span>
            {hours48Delta !== 0 && (
              <Badge variant={hours48Delta > 0 ? "destructive" : "secondary"} className="text-xs">
                {hours48Delta > 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {Math.abs(hours48Delta).toFixed(1)}h
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Compliance Status */}
      <div className="pt-2 border-t">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Compliance:</span>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                before.complianceStatus === "violation" ? "destructive" :
                before.complianceStatus === "warning" ? "secondary" :
                "secondary"
              }
              className="text-xs"
            >
              {before.complianceStatus}
            </Badge>
            <Minus className="w-3 h-3 text-muted-foreground" />
            <Badge
              variant={
                after.complianceStatus === "violation" ? "destructive" :
                after.complianceStatus === "warning" ? "secondary" :
                "secondary"
              }
              className="text-xs"
            >
              {after.complianceStatus}
            </Badge>
          </div>
        </div>
        {after.complianceMessages.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            {after.complianceMessages.map((msg, i) => (
              <div key={i}>• {msg}</div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
