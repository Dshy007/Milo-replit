import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, TrendingUp, AlertCircle, CheckCircle2, User } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Block, Driver, Contract } from "@shared/schema";

type DriverSuggestion = {
  driver: Driver;
  confidenceScore: number;
  reason: string;
  patternMatch: boolean;
  estimatedBump: number;
  lastWorkedThisContract: string | null;
  streakCount: number;
  requiresReview: boolean;
};

type AssignmentSuggestionsResponse = {
  block: Block & { contract: Contract };
  suggestions: DriverSuggestion[];
};

interface DriverAssignmentModalProps {
  block: (Block & { contract: Contract | null }) | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DriverAssignmentModal({ block, isOpen, onClose }: DriverAssignmentModalProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  // Reset selection whenever block changes or modal opens
  useEffect(() => {
    setSelectedDriverId(null);
  }, [block?.id, isOpen]);

  // Fetch assignment suggestions
  const { data: suggestionsData, isLoading } = useQuery<AssignmentSuggestionsResponse>({
    queryKey: ["/api/schedules/assignment-suggestions", block?.id],
    enabled: isOpen && !!block,
  });

  // Assign driver mutation
  const assignMutation = useMutation({
    mutationFn: async (driverId: string) => {
      if (!block) throw new Error("No block selected");
      return await apiRequest("POST", "/api/schedules/assign-driver", {
        blockId: block.id,
        driverId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      onClose();
    },
  });

  const handleAssign = () => {
    if (selectedDriverId) {
      assignMutation.mutate(selectedDriverId);
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 90) return "text-green-600 dark:text-green-400";
    if (score >= 75) return "text-blue-600 dark:text-blue-400";
    if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getConfidenceBadgeVariant = (score: number): "default" | "secondary" | "outline" => {
    if (score >= 90) return "default";
    if (score >= 75) return "secondary";
    return "outline";
  };

  const formatBumpTime = (minutes: number) => {
    const hours = Math.floor(Math.abs(minutes) / 60);
    const mins = Math.abs(minutes) % 60;
    const sign = minutes > 0 ? "+" : "-";
    
    if (hours === 0) return `${sign}${mins}m`;
    if (mins === 0) return `${sign}${hours}h`;
    return `${sign}${hours}h${mins}m`;
  };

  const getDriverInitials = (driver: Driver) => {
    return `${driver.firstName[0]}${driver.lastName[0]}`.toUpperCase();
  };

  if (!block) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh]" data-testid="modal-driver-assignment">
        <DialogHeader>
          <DialogTitle data-testid="modal-title">Assign Driver to Block</DialogTitle>
          <DialogDescription data-testid="modal-description">
            {block.blockId} • {block.contract?.type.toUpperCase()} • {block.contract?.startTime}
            {block.patternGroup && (
              <Badge variant="outline" className="ml-2 text-xs">
                {block.patternGroup === "sunWed" ? "Sun-Wed" : "Wed-Sat"}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Finding best drivers...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Suggested Drivers List */}
            <div>
              <h3 className="text-sm font-semibold mb-2" data-testid="section-suggestions">
                Suggested Drivers
              </h3>
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-2">
                  {suggestionsData?.suggestions && suggestionsData.suggestions.length > 0 ? (
                    suggestionsData.suggestions.map((suggestion) => (
                      <button
                        key={suggestion.driver.id}
                        onClick={() => setSelectedDriverId(suggestion.driver.id)}
                        className={`w-full p-3 rounded-md border transition-colors text-left ${
                          selectedDriverId === suggestion.driver.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover-elevate"
                        }`}
                        data-testid={`driver-suggestion-${suggestion.driver.id}`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <Avatar className="w-10 h-10">
                            <AvatarFallback>{getDriverInitials(suggestion.driver)}</AvatarFallback>
                          </Avatar>

                          {/* Driver Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">
                                {suggestion.driver.firstName} {suggestion.driver.lastName}
                              </span>
                              <Badge 
                                variant={getConfidenceBadgeVariant(suggestion.confidenceScore)}
                                className="text-xs"
                              >
                                <span className={getConfidenceColor(suggestion.confidenceScore)}>
                                  {suggestion.confidenceScore}%
                                </span>
                              </Badge>
                            </div>

                            {/* Pattern & Bump Info */}
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {suggestion.patternMatch ? (
                                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-700 dark:text-green-300">
                                  <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                                  Pattern Match
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-700 dark:text-yellow-300">
                                  <AlertCircle className="w-2.5 h-2.5 mr-1" />
                                  Cross-Pattern
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                Bump: {formatBumpTime(suggestion.estimatedBump)}
                              </span>
                            </div>

                            {/* Historical Stats */}
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {suggestion.streakCount > 0 && (
                                <div className="flex items-center gap-1">
                                  <TrendingUp className="w-3 h-3" />
                                  <span>{suggestion.streakCount} streak</span>
                                </div>
                              )}
                              {suggestion.lastWorkedThisContract && (
                                <div>
                                  Last: {new Date(suggestion.lastWorkedThisContract).toLocaleDateString()}
                                </div>
                              )}
                            </div>

                            {/* Reason */}
                            <p className="text-xs text-muted-foreground mt-1">{suggestion.reason}</p>

                            {/* Review Warning */}
                            {suggestion.requiresReview && (
                              <Badge variant="outline" className="mt-2 text-xs bg-red-500/10 text-red-700 dark:text-red-300">
                                <AlertCircle className="w-2.5 h-2.5 mr-1" />
                                Requires Review
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No driver suggestions available</p>
                      <p className="text-xs mt-1">No suitable drivers found for this block</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={assignMutation.isPending}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAssign}
                disabled={!selectedDriverId || assignMutation.isPending}
                data-testid="button-assign"
              >
                {assignMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Assign Driver
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
