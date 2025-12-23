import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, Check, CheckSquare, Square, AlertTriangle,
  Sparkles, User, Calendar, Clock, Truck, ChevronDown, ChevronUp
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// Suggestion type from the deterministic matcher
export interface MatchSuggestion {
  blockId: string;
  driverId: string;
  driverName: string;
  score: number;
  confidence: number;
  matchType: string;
  ownershipPct: number;  // Already a percentage 0-100
  slotType: string;
  reasons: string[];
  blockInfo?: {
    serviceDate: string;
    startTime: string;
    tractorId: string;
    contractType: string;
    dayName: string;
  };
}

interface AutoMatchPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  suggestions: MatchSuggestion[];
  unassigned: string[];
  stats: {
    totalBlocks: number;
    assigned: number;
    unassigned: number;
  };
}

// Get color based on score/confidence
function getScoreColor(score: number): string {
  if (score >= 0.9) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.7) return "text-green-600 dark:text-green-400";
  if (score >= 0.5) return "text-amber-600 dark:text-amber-400";
  return "text-orange-600 dark:text-orange-400";
}

function getScoreBar(score: number): string {
  // Clamp score between 0 and 1, then calculate filled blocks
  const normalizedScore = Math.max(0, Math.min(1, score));
  const filled = Math.round(normalizedScore * 4);
  return "█".repeat(filled) + "░".repeat(4 - filled);
}

function getMatchTypeBadge(matchType: string): { label: string; className: string } {
  switch (matchType) {
    case "owner":
      return { label: "Owner", className: "bg-emerald-100 text-emerald-700 border-emerald-300" };
    case "shared":
      return { label: "Shared", className: "bg-blue-100 text-blue-700 border-blue-300" };
    case "available":
      return { label: "Available", className: "bg-amber-100 text-amber-700 border-amber-300" };
    case "fallback":
      return { label: "Fallback", className: "bg-orange-100 text-orange-700 border-orange-300" };
    default:
      return { label: matchType, className: "bg-gray-100 text-gray-700 border-gray-300" };
  }
}

// Parse block ID to extract info (e.g., "Solo1-T1-0630" -> { type: "Solo1", tractor: "T1", time: "06:30" })
function parseBlockId(blockId: string): { type: string; tractor: string; time: string } | null {
  const match = blockId.match(/^(Solo[12]|Team)-T(\d+)-(\d{4})$/i);
  if (!match) return null;

  const [, type, tractorNum, rawTime] = match;
  const hours = rawTime.slice(0, 2);
  const mins = rawTime.slice(2, 4);
  return {
    type: type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(),
    tractor: `T${tractorNum}`,
    time: `${hours}:${mins}`,
  };
}

export function AutoMatchPreviewModal({
  isOpen,
  onClose,
  suggestions,
  unassigned,
  stats,
}: AutoMatchPreviewModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(suggestions.map(s => s.blockId))
  );
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "driver" | "block">("score");
  const [sortAsc, setSortAsc] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Apply selected matches mutation
  const applyMatchesMutation = useMutation({
    mutationFn: async (assignments: Array<{ blockId: string; driverId: string }>) => {
      const response = await apiRequest("POST", "/api/matching/deterministic/apply", { assignments });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Assignments Applied",
          description: `Successfully assigned ${data.applied} blocks`,
        });
        onClose();
        queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      } else {
        toast({
          title: "Apply Failed",
          description: data.message || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Apply Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Sort suggestions
  const sortedSuggestions = useMemo(() => {
    const sorted = [...suggestions];
    switch (sortBy) {
      case "score":
        sorted.sort((a, b) => sortAsc ? a.score - b.score : b.score - a.score);
        break;
      case "driver":
        sorted.sort((a, b) => sortAsc
          ? a.driverName.localeCompare(b.driverName)
          : b.driverName.localeCompare(a.driverName)
        );
        break;
      case "block":
        sorted.sort((a, b) => sortAsc
          ? a.blockId.localeCompare(b.blockId)
          : b.blockId.localeCompare(a.blockId)
        );
        break;
    }
    return sorted;
  }, [suggestions, sortBy, sortAsc]);

  // Toggle selection
  const toggleSelection = (blockId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  // Select/deselect all
  const selectAll = () => setSelectedIds(new Set(suggestions.map(s => s.blockId)));
  const deselectAll = () => setSelectedIds(new Set());

  // Handle apply
  const handleApply = () => {
    const selectedSuggestions = suggestions.filter(s => selectedIds.has(s.blockId));
    const assignments = selectedSuggestions.map(s => ({
      blockId: s.blockId,
      driverId: s.driverId,
    }));
    applyMatchesMutation.mutate(assignments);
  };

  // Toggle sort
  const handleSort = (column: "score" | "driver" | "block") => {
    if (sortBy === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(column);
      setSortAsc(false);
    }
  };

  const selectedCount = selectedIds.size;
  const totalMatched = suggestions.length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/40 dark:to-violet-950/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold">
                  Auto-Match Preview
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Found {totalMatched} of {stats.totalBlocks} blocks
                  {stats.unassigned > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-2">
                      ({stats.unassigned} unmatched)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </DialogHeader>

        {/* Table Header */}
        <div className="px-6 py-2 border-b bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
            <div className="w-8 flex items-center justify-center">
              <Checkbox
                checked={selectedCount === totalMatched}
                onCheckedChange={(checked) => checked ? selectAll() : deselectAll()}
              />
            </div>
            <button
              className="w-40 flex items-center gap-1 hover:text-foreground transition-colors"
              onClick={() => handleSort("block")}
            >
              Block
              {sortBy === "block" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </button>
            <button
              className="flex-1 flex items-center gap-1 hover:text-foreground transition-colors"
              onClick={() => handleSort("driver")}
            >
              Driver
              {sortBy === "driver" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </button>
            <div className="w-24">Match Type</div>
            <button
              className="w-32 flex items-center gap-1 hover:text-foreground transition-colors"
              onClick={() => handleSort("score")}
            >
              Score
              {sortBy === "score" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </button>
          </div>
        </div>

        {/* Table Body */}
        <ScrollArea className="flex-1 px-6">
          <div className="py-2 space-y-1">
            {sortedSuggestions.map((suggestion) => {
              const isSelected = selectedIds.has(suggestion.blockId);
              const parsed = parseBlockId(suggestion.blockId);
              const matchTypeBadge = getMatchTypeBadge(suggestion.matchType);
              const scorePercent = Math.round(suggestion.score * 100);

              return (
                <div
                  key={suggestion.blockId}
                  className={cn(
                    "flex items-center gap-4 px-3 py-2 rounded-lg border transition-all cursor-pointer",
                    isSelected
                      ? "bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700"
                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-purple-300"
                  )}
                  onClick={() => toggleSelection(suggestion.blockId)}
                >
                  {/* Checkbox */}
                  <div className="w-8 flex items-center justify-center">
                    <Checkbox checked={isSelected} />
                  </div>

                  {/* Block Info */}
                  <div className="w-48">
                    {suggestion.blockInfo ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{suggestion.blockInfo.dayName}</span>
                          <span className="text-muted-foreground">{suggestion.blockInfo.serviceDate}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className={cn(
                            "px-1 py-0.5 rounded text-[10px] font-bold",
                            suggestion.blockInfo.contractType === "solo2"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400"
                              : "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-400"
                          )}>
                            {suggestion.blockInfo.contractType.toUpperCase()}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Truck className="w-3 h-3" />
                            {suggestion.blockInfo.tractorId}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-3 h-3" />
                            {suggestion.blockInfo.startTime}
                          </span>
                        </div>
                      </div>
                    ) : parsed ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={cn(
                          "px-1 py-0.5 rounded text-[10px] font-bold",
                          parsed.type === "Solo2"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400"
                            : "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-400"
                        )}>
                          {parsed.type}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Truck className="w-3 h-3" />
                          {parsed.tractor}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />
                          {parsed.time}
                        </span>
                      </div>
                    ) : (
                      <div className="font-mono text-xs text-muted-foreground truncate">
                        {suggestion.blockId.slice(0, 8)}...
                      </div>
                    )}
                  </div>

                  {/* Driver */}
                  <div className="flex-1 flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{suggestion.driverName}</span>
                    {suggestion.ownershipPct > 50 && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        ({suggestion.ownershipPct}% owner)
                      </span>
                    )}
                  </div>

                  {/* Match Type */}
                  <div className="w-24">
                    <Badge
                      variant="outline"
                      className={cn("text-xs", matchTypeBadge.className)}
                    >
                      {matchTypeBadge.label}
                    </Badge>
                  </div>

                  {/* Score */}
                  <div className="w-32 flex items-center gap-2">
                    <span className={cn("font-mono text-sm", getScoreColor(suggestion.score))}>
                      {getScoreBar(suggestion.score)}
                    </span>
                    <span className={cn("font-bold text-sm", getScoreColor(suggestion.score))}>
                      {scorePercent}%
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Unassigned Section */}
            {unassigned.length > 0 && (
              <div className="mt-4">
                <button
                  className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline"
                  onClick={() => setShowUnassigned(!showUnassigned)}
                >
                  <AlertTriangle className="w-4 h-4" />
                  {unassigned.length} Unmatched Blocks
                  {showUnassigned ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showUnassigned && (
                  <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                    <div className="flex flex-wrap gap-2">
                      {unassigned.map((blockId) => (
                        <Badge
                          key={blockId}
                          variant="outline"
                          className="bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-400 border-amber-300"
                        >
                          {blockId}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      These blocks could not be matched to any available driver.
                      You may need to manually assign them.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center justify-between">
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="text-emerald-600">████</span> Owner (90%+)
              </span>
              <span className="flex items-center gap-1">
                <span className="text-green-600">███░</span> High (70%+)
              </span>
              <span className="flex items-center gap-1">
                <span className="text-amber-600">██░░</span> Fair (50%+)
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={selectedCount === totalMatched ? deselectAll : selectAll}
              >
                {selectedCount === totalMatched ? (
                  <>
                    <Square className="w-4 h-4 mr-2" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Select All
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleApply}
                disabled={selectedCount === 0 || applyMatchesMutation.isPending}
              >
                {applyMatchesMutation.isPending ? (
                  "Applying..."
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Apply ({selectedCount})
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
