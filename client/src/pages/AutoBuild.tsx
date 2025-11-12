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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Clock,
  TrendingUp,
  Brain,
  Play,
  Save,
} from "lucide-react";

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

function getConfidenceBadgeVariant(confidence: number): "default" | "secondary" | "destructive" {
  if (confidence >= 0.5) return "default"; // Green - high confidence
  if (confidence >= 0.35) return "secondary"; // Yellow - medium confidence
  return "destructive"; // Red - low confidence
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.5) return "High";
  if (confidence >= 0.35) return "Medium";
  return "Low";
}

export default function AutoBuild() {
  const { toast } = useToast();
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [currentPreview, setCurrentPreview] = useState<AutoBuildPreview | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Map<string, string>>(new Map()); // blockId → driverId

  // Query all drivers for manual reassignment
  const { data: allDrivers = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string }>>({
    queryKey: ["/api/drivers"],
  });

  // Query pattern stats
  const { data: patternStats, isLoading: statsLoading } = useQuery<PatternStats>({
    queryKey: ["/api/patterns/stats"],
  });

  // Recompute patterns mutation
  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/patterns/recompute");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Patterns Recomputed",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/patterns/stats"] });
    },
    onError: (error: any) => {
      toast({
        title: "Recompute Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Generate auto-build preview mutation
  const generatePreviewMutation = useMutation({
    mutationFn: async () => {
      const nextWeekStart = startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 0 });
      const res = await apiRequest("POST", "/api/auto-build/preview", {
        targetWeekStart: nextWeekStart.toISOString(),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setCurrentRunId(data.runId);
      setCurrentPreview(data.preview);
      setSelectedBlocks(new Set(data.preview.suggestions.map((s: BlockSuggestion) => s.blockId)));
      toast({
        title: "Auto-Build Preview Generated",
        description: `Generated ${data.preview.totalBlocks} block assignments for next week`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Preview Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Commit approved suggestions mutation
  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!currentRunId || !currentPreview) throw new Error("No run selected");
      
      // Apply manual overrides to suggestions before committing
      const finalAssignments = currentPreview.suggestions
        .filter(s => selectedBlocks.has(s.blockId))
        .map(s => ({
          blockId: s.blockId,
          driverId: manualOverrides.get(s.blockId) || s.driverId,
        }));

      // For backend compatibility, we'll create the assignments directly
      // Instead of using the run commit endpoint, we'll batch create assignments
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

      return {
        success: true,
        message: `Successfully created ${created} assignments${failed > 0 ? `, ${failed} failed` : ""}`,
        created,
        failed,
      };
    },
    onSuccess: (data: any) => {
      toast({
        title: "Assignments Created",
        description: data.message,
      });
      setCurrentPreview(null);
      setCurrentRunId(null);
      setSelectedBlocks(new Set());
      setManualOverrides(new Map());
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/block-assignments"] });
    },
    onError: (error: any) => {
      toast({
        title: "Commit Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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

  const getEffectiveDriverName = (suggestion: BlockSuggestion): string => {
    const driverId = getEffectiveDriverId(suggestion);
    const driver = allDrivers.find(d => d.id === driverId);
    return driver ? `${driver.firstName} ${driver.lastName}` : suggestion.driverName;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Auto-Build Next Week</h1>
          <p className="text-muted-foreground">
            AI-powered schedule generation using historical patterns and workload balance
          </p>
        </div>
      </div>

      {/* Pattern Stats Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Pattern Learning Status
          </CardTitle>
          <CardDescription>
            Historical assignment patterns analyzed for intelligent suggestions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <p className="text-muted-foreground">Loading pattern statistics...</p>
          ) : patternStats ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <div className="text-2xl font-bold">{patternStats.totalPatterns}</div>
                <div className="text-sm text-muted-foreground">Total Patterns</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{patternStats.uniqueDrivers}</div>
                <div className="text-sm text-muted-foreground">Drivers</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{patternStats.uniqueBlockSignatures}</div>
                <div className="text-sm text-muted-foreground">Block Types</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{patternStats.highConfidencePatterns}</div>
                <div className="text-sm text-muted-foreground">High Confidence</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-600">{patternStats.mediumConfidencePatterns}</div>
                <div className="text-sm text-muted-foreground">Medium Confidence</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{patternStats.lowConfidencePatterns}</div>
                <div className="text-sm text-muted-foreground">Low Confidence</div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No pattern data available</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={() => recomputeMutation.mutate()}
            disabled={recomputeMutation.isPending}
            variant="outline"
            data-testid="button-recompute-patterns"
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            {recomputeMutation.isPending ? "Recomputing..." : "Recompute Patterns"}
          </Button>
        </CardFooter>
      </Card>

      {/* Generate Auto-Build Card */}
      {!currentPreview && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="w-5 h-5" />
              Generate Auto-Build
            </CardTitle>
            <CardDescription>
              Create intelligent schedule suggestions for next week based on learned patterns
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => generatePreviewMutation.mutate()}
              disabled={generatePreviewMutation.isPending}
              data-testid="button-generate-autobuild"
            >
              <Brain className="w-4 h-4 mr-2" />
              {generatePreviewMutation.isPending ? "Generating..." : "Generate Next Week Schedule"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Auto-Build Preview */}
      {currentPreview && (
        <>
          {/* Summary Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Schedule Preview
                </span>
                <div className="text-sm font-normal text-muted-foreground">
                  {format(new Date(currentPreview.targetWeekStart), "MMM d")} -{" "}
                  {format(new Date(currentPreview.targetWeekEnd), "MMM d, yyyy")}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-2xl font-bold">{currentPreview.totalBlocks}</div>
                  <div className="text-sm text-muted-foreground">Total Blocks</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">{currentPreview.highConfidence}</div>
                  <div className="text-sm text-muted-foreground">High Confidence</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-600">{currentPreview.mediumConfidence}</div>
                  <div className="text-sm text-muted-foreground">Medium Confidence</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{currentPreview.lowConfidence}</div>
                  <div className="text-sm text-muted-foreground">Low Confidence</div>
                </div>
              </div>

              {/* Warnings */}
              {currentPreview.warnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">Warnings:</div>
                    <ul className="list-disc list-inside space-y-1">
                      {currentPreview.warnings.slice(0, 5).map((warning, i) => (
                        <li key={i} className="text-sm">{warning}</li>
                      ))}
                      {currentPreview.warnings.length > 5 && (
                        <li className="text-sm text-muted-foreground">
                          ...and {currentPreview.warnings.length - 5} more
                        </li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Unassignable Blocks */}
              {currentPreview.unassignable.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">
                      {currentPreview.unassignable.length} Unassignable Blocks:
                    </div>
                    <ul className="list-disc list-inside space-y-1">
                      {currentPreview.unassignable.map((block, i) => (
                        <li key={i} className="text-sm">
                          {block.blockDisplayId}: {block.rationale}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button
                onClick={selectAllSuggestions}
                variant="outline"
                data-testid="button-select-all"
              >
                Select All
              </Button>
              <Button
                onClick={deselectAll}
                variant="outline"
                data-testid="button-deselect-all"
              >
                Deselect All
              </Button>
              <Button
                onClick={() => commitMutation.mutate()}
                disabled={selectedBlocks.size === 0 || commitMutation.isPending}
                data-testid="button-commit-autobuild"
              >
                <Save className="w-4 h-4 mr-2" />
                {commitMutation.isPending
                  ? "Saving..."
                  : `Approve ${selectedBlocks.size} Assignments`}
              </Button>
              <Button
                onClick={() => {
                  setCurrentPreview(null);
                  setCurrentRunId(null);
                  setSelectedBlocks(new Set());
                  setManualOverrides(new Map());
                }}
                variant="ghost"
                data-testid="button-cancel-autobuild"
              >
                Cancel
              </Button>
            </CardFooter>
          </Card>

          {/* Suggestions Table */}
          <Card>
            <CardHeader>
              <CardTitle>Suggested Assignments</CardTitle>
              <CardDescription>
                Review and approve auto-generated block assignments
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                    <TableRow key={suggestion.blockId} data-testid={`row-suggestion-${suggestion.blockDisplayId}`}>
                      <TableCell>
                        <Checkbox
                          checked={selectedBlocks.has(suggestion.blockId)}
                          onCheckedChange={() => toggleBlockSelection(suggestion.blockId)}
                          data-testid={`checkbox-block-${suggestion.blockDisplayId}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-block-id-${suggestion.blockDisplayId}`}>
                        {suggestion.blockDisplayId}
                      </TableCell>
                      <TableCell data-testid={`text-suggested-driver-${suggestion.blockDisplayId}`}>
                        {suggestion.driverName}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={getEffectiveDriverId(suggestion)}
                          onValueChange={(value) => handleDriverChange(suggestion.blockId, value)}
                          disabled={suggestion.isProtectedAssignment}
                        >
                          <SelectTrigger className="w-[180px]" data-testid={`select-driver-${suggestion.blockDisplayId}`}>
                            <SelectValue>{getEffectiveDriverName(suggestion)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {allDrivers.map((driver) => (
                              <SelectItem key={driver.id} value={driver.id}>
                                {driver.firstName} {driver.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {manualOverrides.has(suggestion.blockId) && (
                          <Badge variant="outline" className="ml-2">
                            Override
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getConfidenceBadgeVariant(suggestion.confidence)} data-testid={`badge-confidence-${suggestion.blockDisplayId}`}>
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
