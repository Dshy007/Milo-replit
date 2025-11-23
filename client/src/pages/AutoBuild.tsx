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
  Clock,
  TrendingUp,
  Brain,
  Play,
  Save,
  Check,
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
  if (confidence >= 0.5) return "default";
  if (confidence >= 0.35) return "secondary";
  return "destructive";
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
  const [manualOverrides, setManualOverrides] = useState<Map<string, string>>(new Map());

  const { data: allDrivers = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string }>>({
    queryKey: ["/api/drivers"],
  });

  const { data: patternStats, isLoading: statsLoading } = useQuery<PatternStats>({
    queryKey: ["/api/patterns/stats"],
  });

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

  // Calculate current step
  const currentStep = currentPreview ? 3 : 1;
  const steps = [
    { number: 1, label: "Recompute Patterns", completed: true },
    { number: 2, label: "Generate Schedule", completed: currentPreview !== null },
    { number: 3, label: "Review & Adjust", completed: false },
    { number: 4, label: "Publish", completed: false },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header with Progress Stepper */}
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Auto-Build Next Week</h1>
          <p className="text-muted-foreground">
            AI-powered schedule generation using historical patterns and workload balance
          </p>
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
                <span
                  className={`text-sm font-medium whitespace-nowrap ${
                    step.number === currentStep
                      ? "text-foreground"
                      : step.completed
                      ? "text-muted-foreground"
                      : "text-muted-foreground"
                  }`}
                >
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

      {/* Summary Stats Grid */}
      {!currentPreview && patternStats && !statsLoading && (
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
      <div className="flex gap-4 items-center">
        <Button
          onClick={() => recomputeMutation.mutate()}
          disabled={recomputeMutation.isPending}
          variant="outline"
          className="shadow-md hover:shadow-lg transition-shadow"
          data-testid="button-recompute-patterns"
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          {recomputeMutation.isPending ? "Recomputing..." : "Recompute Patterns"}
        </Button>

        {!currentPreview && (
          <Button
            onClick={() => generatePreviewMutation.mutate()}
            disabled={generatePreviewMutation.isPending}
            className="shadow-md hover:shadow-lg transition-shadow"
            size="lg"
            data-testid="button-generate-autobuild"
          >
            <Brain className="w-4 h-4 mr-2" />
            {generatePreviewMutation.isPending ? "Generating..." : "Generate Next Week Schedule"}
          </Button>
        )}
      </div>

      {/* Preview Section */}
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

          {/* Warnings & Issues */}
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
                      {currentPreview.warnings.length > 5 && (
                        <li className="text-sm text-muted-foreground">
                          ...and {currentPreview.warnings.length - 5} more
                        </li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

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
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={selectAllSuggestions}
              variant="outline"
              className="shadow-md"
              data-testid="button-select-all"
            >
              Select All
            </Button>
            <Button
              onClick={deselectAll}
              variant="outline"
              className="shadow-md"
              data-testid="button-deselect-all"
            >
              Deselect All
            </Button>
            <Button
              onClick={() => commitMutation.mutate()}
              disabled={selectedBlocks.size === 0 || commitMutation.isPending}
              className="shadow-md hover:shadow-lg transition-shadow"
              size="lg"
              data-testid="button-commit-autobuild"
            >
              <Save className="w-4 h-4 mr-2" />
              {commitMutation.isPending
                ? "Publishing..."
                : `Publish ${selectedBlocks.size} Assignments`}
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
          </div>

          {/* Suggestions Table */}
          <Card>
            <CardHeader>
              <CardTitle>Review Assignments</CardTitle>
              <CardDescription>
                Review AI suggestions and make manual adjustments as needed
              </CardDescription>
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
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
