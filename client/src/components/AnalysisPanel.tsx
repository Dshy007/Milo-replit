import { useState, useMemo } from "react";
import { X, BarChart3, Users, Shield, Loader2, ChevronRight, Check, Trash2, AlertTriangle, Undo2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

// Types for the calendar data we receive
interface ShiftOccurrence {
  id: string;
  blockId: string;
  driverId: string | null;
  driverName?: string | null;
  serviceDate: string;
  startTime: string;
  contractType: string;
  isRejectedLoad?: boolean;
}

interface AnalysisPanelProps {
  open: boolean;
  weekStart: Date;
  weekEnd: Date;
  blocks: ShiftOccurrence[];
  onAssignDriver: (blockId: string, driverId: string) => Promise<void>;
  onUnassignAll: () => Promise<void>;
  onClose: () => void;
}

// Coverage Analysis Component
function CoverageAnalysis({ weekStart, weekEnd }: { weekStart: Date; weekEnd: Date }) {
  const [isLoading, setIsLoading] = useState(false);
  const [coverage, setCoverage] = useState<{
    coverage_percentage: number;
    total_slots: number;
    filled_slots: number;
    gaps: Array<{
      block_id: string;
      date: string;
      contract_type: string;
      priority: string;
    }>;
    recommendations: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/analysis/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          weekStart: weekStart.toISOString().split("T")[0],
          weekEnd: weekEnd.toISOString().split("T")[0],
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to analyze coverage");
      }

      const data = await response.json();
      setCoverage(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {!coverage && !isLoading && (
        <div className="text-center py-8">
          <BarChart3 className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 mb-4">
            Analyze coverage for the selected week to see gaps and recommendations.
          </p>
          <Button onClick={handleAnalyze} disabled={isLoading}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Analyze Coverage
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
          <span className="text-gray-600">Analyzing coverage...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {coverage && (
        <div className="space-y-4">
          {/* Coverage Percentage Display */}
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Coverage</span>
              <span className="text-3xl font-bold text-blue-700">
                {coverage.coverage_percentage.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                style={{ width: `${coverage.coverage_percentage}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{coverage.filled_slots} filled</span>
              <span>{coverage.total_slots} total slots</span>
            </div>
          </div>

          {/* Gaps List */}
          {coverage.gaps.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                {coverage.gaps.length} Gap{coverage.gaps.length !== 1 ? "s" : ""} Found
              </h4>
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {coverage.gaps.map((gap, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
                    >
                      <div>
                        <span className="font-mono text-sm">{gap.block_id}</span>
                        <span className="text-gray-500 text-xs ml-2">{gap.date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">
                          {gap.contract_type}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            gap.priority === "high"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {gap.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Recommendations */}
          {coverage.recommendations.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Recommendations</h4>
              <ul className="space-y-1">
                {coverage.recommendations.map((rec, index) => (
                  <li key={index} className="text-sm text-gray-600 flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 text-blue-500" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button variant="outline" onClick={handleAnalyze} className="w-full">
            Refresh Analysis
          </Button>
        </div>
      )}
    </div>
  );
}

// Staged Assignment type - suggestions that haven't been committed yet
interface StagedAssignment {
  blockId: string;
  blockData: ShiftOccurrence;
  driverId: string;
  driverName: string;
  score: number;
  reasons: string[];
  status: "pending" | "accepted" | "rejected";
  matchType?: string; // 'holy_grail', 'strong', 'contract', 'weak'
}

// Stats from the API
interface PredictionStats {
  perfectMatches: number;
  strongMatches: number;
  totalBlocks: number;
}

// Assignment Suggestions Component with Staging Area
function AssignmentSuggestions({
  blocks,
  onAssign,
  onUnassignAll,
}: {
  blocks: ShiftOccurrence[];
  onAssign: (blockId: string, driverId: string) => Promise<void>;
  onUnassignAll: () => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [stagedAssignments, setStagedAssignments] = useState<StagedAssignment[]>([]);
  const [predictionStats, setPredictionStats] = useState<PredictionStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contractTab, setContractTab] = useState<"solo1" | "solo2" | "all">("all");
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false);
  const [autoAcceptPerfect, setAutoAcceptPerfect] = useState(true);

  const unassignedBlocks = blocks.filter((b) => !b.driverId && !b.isRejectedLoad);
  const assignedBlocks = blocks.filter((b) => b.driverId && !b.isRejectedLoad);

  // Filter staged assignments by contract type
  const filteredStaged = useMemo(() => {
    if (contractTab === "all") return stagedAssignments;
    return stagedAssignments.filter((s) =>
      s.blockData.contractType?.toLowerCase() === contractTab
    );
  }, [stagedAssignments, contractTab]);

  // Count by contract type and match type
  const solo1Count = stagedAssignments.filter(s => s.blockData.contractType?.toLowerCase() === "solo1").length;
  const solo2Count = stagedAssignments.filter(s => s.blockData.contractType?.toLowerCase() === "solo2").length;
  const acceptedCount = stagedAssignments.filter(s => s.status === "accepted").length;
  const pendingCount = stagedAssignments.filter(s => s.status === "pending").length;
  const perfectMatchCount = stagedAssignments.filter(s => s.score >= 1.0).length;
  const strongMatchCount = stagedAssignments.filter(s => s.score >= 0.70 && s.score < 1.0).length;

  const handleGetSuggestions = async () => {
    if (unassignedBlocks.length === 0) return;

    setIsLoading(true);
    setError(null);
    setStagedAssignments([]); // Clear previous staging
    setPredictionStats(null);

    try {
      const response = await fetch("/api/analysis/predict-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          blocks: unassignedBlocks.map((b) => {
            const date = new Date(b.serviceDate);
            const dayOfWeek = date.getDay();
            return {
              blockId: b.blockId,
              contractType: b.contractType,
              shiftStart: `${b.serviceDate}T${b.startTime}:00Z`,
              shiftEnd: `${b.serviceDate}T${b.startTime}:00Z`,
              dayOfWeek,
              startTime: b.startTime,
              serviceDate: b.serviceDate,
            };
          }),
          drivers: [],
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get assignment suggestions");
      }

      const data = await response.json();

      // Save stats from API
      if (data.stats) {
        setPredictionStats(data.stats);
      }

      // Convert to staged assignments (top recommendation only)
      const staged: StagedAssignment[] = [];
      for (const rec of data.recommendations || []) {
        if (rec.recommendations?.length > 0) {
          const topRec = rec.recommendations[0];
          const blockData = unassignedBlocks.find(b => b.blockId === rec.block_id);
          if (blockData) {
            // Auto-accept 100% matches if enabled
            const isPerfect = topRec.score >= 1.0;
            staged.push({
              blockId: rec.block_id,
              blockData,
              driverId: topRec.driver_id,
              driverName: topRec.driver_name,
              score: topRec.score,
              reasons: topRec.reasons || [],
              matchType: topRec.matchType || 'unknown',
              status: autoAcceptPerfect && isPerfect ? "accepted" : "pending",
            });
          }
        }
      }
      setStagedAssignments(staged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = (blockId: string) => {
    setStagedAssignments((prev) =>
      prev.map((s) =>
        s.blockId === blockId ? { ...s, status: "accepted" } : s
      )
    );
  };

  const handleReject = (blockId: string) => {
    setStagedAssignments((prev) =>
      prev.map((s) =>
        s.blockId === blockId ? { ...s, status: "rejected" } : s
      )
    );
  };

  const handleAcceptAll = () => {
    const targetBlocks = contractTab === "all"
      ? stagedAssignments
      : stagedAssignments.filter(s => s.blockData.contractType?.toLowerCase() === contractTab);

    setStagedAssignments((prev) =>
      prev.map((s) => {
        if (targetBlocks.some(t => t.blockId === s.blockId) && s.status === "pending") {
          return { ...s, status: "accepted" };
        }
        return s;
      })
    );
  };

  const handleRejectAll = () => {
    const targetBlocks = contractTab === "all"
      ? stagedAssignments
      : stagedAssignments.filter(s => s.blockData.contractType?.toLowerCase() === contractTab);

    setStagedAssignments((prev) =>
      prev.map((s) => {
        if (targetBlocks.some(t => t.blockId === s.blockId) && s.status === "pending") {
          return { ...s, status: "rejected" };
        }
        return s;
      })
    );
  };

  const handleClearStaging = () => {
    setStagedAssignments([]);
    setError(null);
  };

  const handleCommitChanges = async () => {
    const acceptedAssignments = stagedAssignments.filter(s => s.status === "accepted");
    if (acceptedAssignments.length === 0) {
      setError("No accepted assignments to commit. Accept some suggestions first.");
      return;
    }

    setIsCommitting(true);
    setError(null);

    try {
      for (const assignment of acceptedAssignments) {
        await onAssign(assignment.blockId, assignment.driverId);
      }
      // Remove committed assignments from staging
      setStagedAssignments((prev) =>
        prev.filter(s => s.status !== "accepted")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to commit assignments");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleUnassignAll = async () => {
    setIsUnassigning(true);
    try {
      await onUnassignAll();
      setShowUnassignConfirm(false);
      setStagedAssignments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unassign blocks");
    } finally {
      setIsUnassigning(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Unassign Confirmation Dialog */}
      {showUnassignConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
              <h3 className="text-lg font-semibold text-gray-900">Unassign All Blocks?</h3>
            </div>
            <p className="text-gray-600 mb-6">
              This will remove all {assignedBlocks.length} driver assignments for this week.
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowUnassignConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleUnassignAll}
                disabled={isUnassigning}
              >
                {isUnassigning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Unassigning...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Unassign All
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Initial State - No staging yet */}
      {stagedAssignments.length === 0 && !isLoading && (
        <div className="space-y-4">
          <div className="text-center py-4">
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="text-4xl font-bold text-amber-600">{unassignedBlocks.length}</span>
              <span className="text-lg text-gray-500">unassigned blocks</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              DNA-based matching uses driver preferences (day + time + contract type)
            </p>

            {/* Auto-accept toggle */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <input
                type="checkbox"
                id="autoAccept"
                checked={autoAcceptPerfect}
                onChange={(e) => setAutoAcceptPerfect(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300"
              />
              <label htmlFor="autoAccept" className="text-sm text-gray-600">
                Auto-accept 100% matches
              </label>
            </div>

            <Button
              onClick={handleGetSuggestions}
              disabled={unassignedBlocks.length === 0}
              className="bg-green-600 hover:bg-green-700"
              size="lg"
            >
              <Users className="w-5 h-5 mr-2" />
              Find Driver Matches
            </Button>
          </div>

          {assignedBlocks.length > 0 && (
            <div className="border-t pt-4">
              <Button
                variant="outline"
                className="w-full text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowUnassignConfirm(true)}
              >
                <Undo2 className="w-4 h-4 mr-2" />
                Unassign All ({assignedBlocks.length} blocks)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
          <span className="text-gray-600">Getting AI recommendations...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Staging Area */}
      {stagedAssignments.length > 0 && !isLoading && (
        <div className="space-y-3">
          {/* Match Quality Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
              <div className="text-2xl font-bold text-green-600">{perfectMatchCount}</div>
              <div className="text-[10px] text-green-700 uppercase font-medium">100% Match</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
              <div className="text-2xl font-bold text-amber-600">{strongMatchCount}</div>
              <div className="text-[10px] text-amber-700 uppercase font-medium">70%+ Match</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
              <div className="text-2xl font-bold text-gray-600">{stagedAssignments.length - perfectMatchCount - strongMatchCount}</div>
              <div className="text-[10px] text-gray-500 uppercase font-medium">Other</div>
            </div>
          </div>

          {/* Staging Header */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-800">
                📋 Review & Apply
              </span>
              <Button size="sm" variant="ghost" onClick={handleClearStaging}>
                <X className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-green-600 font-medium">✓ {acceptedCount} ready to apply</span>
              <span className="text-amber-600">○ {pendingCount} pending review</span>
              <span className="text-gray-500">✗ {stagedAssignments.filter(s => s.status === "rejected").length} rejected</span>
            </div>
          </div>

          {/* Contract Type Tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                contractTab === "all"
                  ? "bg-white shadow text-gray-900"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              onClick={() => setContractTab("all")}
            >
              All ({stagedAssignments.length})
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                contractTab === "solo1"
                  ? "bg-white shadow text-gray-900"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              onClick={() => setContractTab("solo1")}
            >
              Solo1 ({solo1Count})
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                contractTab === "solo2"
                  ? "bg-white shadow text-gray-900"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              onClick={() => setContractTab("solo2")}
            >
              Solo2 ({solo2Count})
            </button>
          </div>

          {/* Bulk Actions */}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleAcceptAll} className="flex-1">
              <Check className="w-3 h-3 mr-1" />
              Accept All
            </Button>
            <Button size="sm" variant="outline" onClick={handleRejectAll} className="flex-1">
              <X className="w-3 h-3 mr-1" />
              Reject All
            </Button>
          </div>

          {/* Staged Assignments List - Table Layout */}
          <ScrollArea className="h-[280px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b">
                <tr className="text-left text-gray-500">
                  <th className="py-1.5 px-2 font-medium">Day/Time</th>
                  <th className="py-1.5 px-2 font-medium">Block</th>
                  <th className="py-1.5 px-2 font-medium">Driver</th>
                  <th className="py-1.5 px-2 font-medium text-center">Match</th>
                  <th className="py-1.5 px-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaged.map((staged) => {
                  const d = new Date(staged.blockData.serviceDate + "T12:00:00");
                  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                  const dayTime = `${days[d.getDay()]} ${staged.blockData.startTime}`;

                  return (
                    <tr
                      key={staged.blockId}
                      className={`border-b transition-colors ${
                        staged.status === "accepted"
                          ? "bg-green-50"
                          : staged.status === "rejected"
                          ? "bg-gray-50 opacity-50"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      {/* Day/Time */}
                      <td className="py-2 px-2">
                        <div className="font-medium text-gray-900">{dayTime}</div>
                        <div className="text-[10px] text-gray-400">{staged.blockData.serviceDate.slice(5)}</div>
                      </td>

                      {/* Block ID + Type */}
                      <td className="py-2 px-2">
                        <div className="font-mono font-medium">{staged.blockId.replace("B-", "")}</div>
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 mt-0.5">
                          {staged.blockData.contractType}
                        </Badge>
                      </td>

                      {/* Driver + Reason */}
                      <td className="py-2 px-2">
                        <div className="font-medium text-gray-900">{staged.driverName}</div>
                        <div className="text-[10px] text-gray-500 max-w-[140px] truncate" title={staged.reasons[0]}>
                          {staged.reasons[0]}
                        </div>
                      </td>

                      {/* Score */}
                      <td className="py-2 px-2 text-center">
                        {staged.score >= 1.0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-green-500 text-white text-xs shadow-sm">
                            ★ 100%
                          </span>
                        ) : (
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${
                              staged.score >= 0.70
                                ? "bg-amber-100 text-amber-700"
                                : staged.score >= 0.50
                                ? "bg-gray-100 text-gray-600"
                                : "bg-red-50 text-red-600"
                            }`}
                          >
                            {(staged.score * 100).toFixed(0)}%
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2 px-2 text-right">
                        {staged.status === "pending" && (
                          <div className="flex gap-1 justify-end">
                            <button
                              className="p-1 rounded text-green-600 hover:bg-green-100"
                              onClick={() => handleAccept(staged.blockId)}
                              title="Accept"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              className="p-1 rounded text-red-600 hover:bg-red-100"
                              onClick={() => handleReject(staged.blockId)}
                              title="Reject"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        {staged.status === "accepted" && (
                          <span className="text-green-600 font-medium">✓</span>
                        )}
                        {staged.status === "rejected" && (
                          <span className="text-gray-400">✗</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>

          {/* Commit Button */}
          <div className="border-t pt-3 space-y-2">
            {acceptedCount > 0 && (
              <div className="text-center text-sm text-gray-600 mb-1">
                Remaining after apply: <strong className="text-amber-600">{unassignedBlocks.length - acceptedCount}</strong> blocks
              </div>
            )}
            <Button
              className="w-full bg-green-600 hover:bg-green-700 h-12 text-lg"
              onClick={handleCommitChanges}
              disabled={acceptedCount === 0 || isCommitting}
            >
              {isCommitting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Applying Assignments...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5 mr-2" />
                  Apply {acceptedCount} Assignment{acceptedCount !== 1 ? "s" : ""}
                </>
              )}
            </Button>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleGetSuggestions} className="flex-1">
                Refresh
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Accept all remaining pending
                  setStagedAssignments((prev) =>
                    prev.map((s) => s.status === "pending" ? { ...s, status: "accepted" } : s)
                  );
                }}
                className="flex-1"
                disabled={pendingCount === 0}
              >
                Accept All ({pendingCount})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Compliance Report Component
function ComplianceReport({ blocks }: { blocks: ShiftOccurrence[] }) {
  const [isLoading, setIsLoading] = useState(false);
  const [compliance, setCompliance] = useState<{
    isCompliant: boolean;
    violations: Array<{
      type: string;
      severity: "error" | "warning";
      message: string;
      details: {
        driverId?: string;
        blockId?: string;
        actualValue?: number;
        requiredValue?: number;
      };
    }>;
    stats: {
      tenHourRest: { passed: number; failed: number; percentage: number };
      fortyEightHourGaps: { passed: number; failed: number; percentage: number };
      maxSixDays: { passed: number; failed: number; percentage: number };
      weeklyMaximum: { passed: number; failed: number; percentage: number };
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/schedules/analyze-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          blocks: blocks.map((b) => ({
            blockId: b.blockId,
            driverId: b.driverId,
            serviceDate: b.serviceDate,
            startTime: b.startTime,
            contractType: b.contractType,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to analyze compliance");
      }

      const data = await response.json();
      setCompliance(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {!compliance && !isLoading && (
        <div className="text-center py-8">
          <Shield className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 mb-4">
            Check DOT compliance for all scheduled blocks.
          </p>
          <Button onClick={handleAnalyze} disabled={isLoading}>
            <Shield className="w-4 h-4 mr-2" />
            Check Compliance
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
          <span className="text-gray-600">Checking compliance...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {compliance && (
        <div className="space-y-4">
          {/* Overall Status */}
          <div
            className={`rounded-lg p-4 ${
              compliance.isCompliant
                ? "bg-green-50 border border-green-200"
                : "bg-red-50 border border-red-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <Shield
                className={`w-5 h-5 ${
                  compliance.isCompliant ? "text-green-600" : "text-red-600"
                }`}
              />
              <span
                className={`font-medium ${
                  compliance.isCompliant ? "text-green-700" : "text-red-700"
                }`}
              >
                {compliance.isCompliant ? "All Compliant" : "Violations Found"}
              </span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">10hr Rest (Solo1)</div>
              <div className="text-lg font-semibold">
                {compliance.stats.tenHourRest.percentage.toFixed(0)}%
              </div>
              <div className="text-xs text-gray-400">
                {compliance.stats.tenHourRest.passed} / {compliance.stats.tenHourRest.passed + compliance.stats.tenHourRest.failed}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">48hr Gap (Solo2)</div>
              <div className="text-lg font-semibold">
                {compliance.stats.fortyEightHourGaps.percentage.toFixed(0)}%
              </div>
              <div className="text-xs text-gray-400">
                {compliance.stats.fortyEightHourGaps.passed} / {compliance.stats.fortyEightHourGaps.passed + compliance.stats.fortyEightHourGaps.failed}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Max 6 Days</div>
              <div className="text-lg font-semibold">
                {compliance.stats.maxSixDays.percentage.toFixed(0)}%
              </div>
              <div className="text-xs text-gray-400">
                {compliance.stats.maxSixDays.passed} / {compliance.stats.maxSixDays.passed + compliance.stats.maxSixDays.failed}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Weekly Max</div>
              <div className="text-lg font-semibold">
                {compliance.stats.weeklyMaximum.percentage.toFixed(0)}%
              </div>
              <div className="text-xs text-gray-400">
                {compliance.stats.weeklyMaximum.passed} / {compliance.stats.weeklyMaximum.passed + compliance.stats.weeklyMaximum.failed}
              </div>
            </div>
          </div>

          {/* Violations List */}
          {compliance.violations.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                {compliance.violations.length} Violation{compliance.violations.length !== 1 ? "s" : ""}
              </h4>
              <ScrollArea className="h-[150px]">
                <div className="space-y-2">
                  {compliance.violations.map((violation, index) => (
                    <div
                      key={index}
                      className={`rounded-lg px-3 py-2 ${
                        violation.severity === "error"
                          ? "bg-red-50 border border-red-200"
                          : "bg-amber-50 border border-amber-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            violation.severity === "error"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {violation.severity === "error" ? "ERROR" : "WARNING"}
                        </span>
                        <span className="text-xs text-gray-500">{violation.type}</span>
                      </div>
                      <p className="text-sm text-gray-700">{violation.message}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <Button variant="outline" onClick={handleAnalyze} className="w-full">
            Refresh Compliance Check
          </Button>
        </div>
      )}
    </div>
  );
}

// Main Analysis Panel Component
export function AnalysisPanel({
  open,
  weekStart,
  weekEnd,
  blocks,
  onAssignDriver,
  onUnassignAll,
  onClose,
}: AnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<"coverage" | "assignments" | "compliance">(
    "coverage"
  );

  const unassignedCount = blocks.filter((b) => !b.driverId && !b.isRejectedLoad).length;
  const rejectedCount = blocks.filter((b) => b.isRejectedLoad).length;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <DialogTitle className="text-lg font-semibold text-gray-900">
            Analysis Panel
          </DialogTitle>
          <p className="text-sm text-gray-500">
            Week of {weekStart.toLocaleDateString()} - {weekEnd.toLocaleDateString()}
          </p>
        </DialogHeader>

        {/* Summary Stats */}
        <div className="flex gap-2 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <div className="flex-1 text-center">
            <div className="text-lg font-semibold text-gray-900">{blocks.length}</div>
            <div className="text-xs text-gray-500">Total</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-lg font-semibold text-green-600">
              {blocks.length - unassignedCount - rejectedCount}
            </div>
            <div className="text-xs text-gray-500">Assigned</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-lg font-semibold text-amber-600">{unassignedCount}</div>
            <div className="text-xs text-gray-500">Unassigned</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-lg font-semibold text-red-600">{rejectedCount}</div>
            <div className="text-xs text-gray-500">Rejected</div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-3 h-10 bg-gray-100 rounded-none border-b border-gray-200">
            <TabsTrigger
              value="coverage"
              className="flex items-center gap-1 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-none"
            >
              <BarChart3 className="w-4 h-4" />
              Coverage
            </TabsTrigger>
            <TabsTrigger
              value="assignments"
              className="flex items-center gap-1 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-none"
            >
              <Users className="w-4 h-4" />
              Assign
              {unassignedCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
                  {unassignedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="compliance"
              className="flex items-center gap-1 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-none"
            >
              <Shield className="w-4 h-4" />
              Compliance
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto max-h-[400px]">
            <TabsContent value="coverage" className="m-0 h-full">
              <CoverageAnalysis weekStart={weekStart} weekEnd={weekEnd} />
            </TabsContent>

          <TabsContent value="assignments" className="m-0 h-full">
            <AssignmentSuggestions blocks={blocks} onAssign={onAssignDriver} onUnassignAll={onUnassignAll} />
          </TabsContent>

            <TabsContent value="compliance" className="m-0 h-full">
              <ComplianceReport blocks={blocks} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
