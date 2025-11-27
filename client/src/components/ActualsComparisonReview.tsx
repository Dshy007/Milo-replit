import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle, UserMinus, UserPlus, Clock, XCircle, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Change {
  type: 'no_show' | 'driver_swap' | 'time_change' | 'new_block' | 'missing_block';
  blockId: string;
  serviceDate: string;
  expected?: {
    driverName: string | null;
    startTime: string;
  };
  actual?: {
    driverName: string | null;
    startTime: string;
  };
  description: string;
}

interface Summary {
  totalChanges: number;
  noShows: number;
  driverSwaps: number;
  timeChanges: number;
  newBlocks: number;
  missingBlocks: number;
  dateRange: {
    start: string;
    end: string;
  };
}

interface ActualsComparisonReviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: Summary | null;
  changes: Change[];
  onApply: () => void;
  onCancel: () => void;
  isApplying: boolean;
}

const getChangeIcon = (type: Change['type']) => {
  switch (type) {
    case 'no_show':
      return <UserMinus className="w-4 h-4 text-red-500" />;
    case 'driver_swap':
      return <UserPlus className="w-4 h-4 text-orange-500" />;
    case 'time_change':
      return <Clock className="w-4 h-4 text-yellow-500" />;
    case 'new_block':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'missing_block':
      return <XCircle className="w-4 h-4 text-gray-500" />;
  }
};

const getChangeLabel = (type: Change['type']) => {
  switch (type) {
    case 'no_show':
      return 'No-Show';
    case 'driver_swap':
      return 'Driver Change';
    case 'time_change':
      return 'Time Change';
    case 'new_block':
      return 'New Block';
    case 'missing_block':
      return 'Cancelled';
  }
};

const getChangeBadgeColor = (type: Change['type']) => {
  switch (type) {
    case 'no_show':
      return 'bg-red-500/20 text-red-700 dark:text-red-300';
    case 'driver_swap':
      return 'bg-orange-500/20 text-orange-700 dark:text-orange-300';
    case 'time_change':
      return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300';
    case 'new_block':
      return 'bg-green-500/20 text-green-700 dark:text-green-300';
    case 'missing_block':
      return 'bg-gray-500/20 text-gray-700 dark:text-gray-300';
  }
};

export function ActualsComparisonReview({
  open,
  onOpenChange,
  summary,
  changes,
  onApply,
  onCancel,
  isApplying,
}: ActualsComparisonReviewProps) {
  const [selectedTypes, setSelectedTypes] = useState<Set<Change['type']>>(new Set(['no_show', 'driver_swap', 'time_change', 'new_block', 'missing_block']));

  const toggleType = (type: Change['type']) => {
    setSelectedTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  const filteredChanges = changes.filter(c => selectedTypes.has(c.type));

  if (!summary) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Review Actuals Changes
          </DialogTitle>
        </DialogHeader>

        {/* Milo's summary */}
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div className="text-sm">
              <p className="font-medium text-foreground mb-1">Here's what I found:</p>
              <p className="text-muted-foreground">
                Comparing week of {format(new Date(summary.dateRange.start), "MMM d")} - {format(new Date(summary.dateRange.end), "MMM d")}.
                {summary.totalChanges === 0
                  ? " Everything matches! No changes detected."
                  : ` Found ${summary.totalChanges} difference${summary.totalChanges > 1 ? 's' : ''} between your schedule and what actually happened.`}
              </p>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {[
            { type: 'no_show' as const, count: summary.noShows, label: 'No-Shows' },
            { type: 'driver_swap' as const, count: summary.driverSwaps, label: 'Swaps' },
            { type: 'time_change' as const, count: summary.timeChanges, label: 'Time' },
            { type: 'new_block' as const, count: summary.newBlocks, label: 'New' },
            { type: 'missing_block' as const, count: summary.missingBlocks, label: 'Cancelled' },
          ].map(({ type, count, label }) => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`p-2 rounded-lg border text-center transition-all ${
                selectedTypes.has(type)
                  ? 'border-primary bg-primary/10'
                  : 'border-muted-foreground/20 opacity-50'
              }`}
            >
              <div className="flex items-center justify-center mb-1">
                {getChangeIcon(type)}
              </div>
              <div className="text-lg font-semibold">{count}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </button>
          ))}
        </div>

        {/* Changes list */}
        <ScrollArea className="flex-1 border rounded-lg">
          <div className="p-2 space-y-2">
            {filteredChanges.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {summary.totalChanges === 0 ? "No differences found!" : "No changes of selected types"}
              </div>
            ) : (
              filteredChanges.map((change, index) => (
                <div
                  key={`${change.blockId}-${change.serviceDate}-${index}`}
                  className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {getChangeIcon(change.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono font-medium">{change.blockId}</span>
                        <Badge className={getChangeBadgeColor(change.type)}>
                          {getChangeLabel(change.type)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(change.serviceDate), "EEE, MMM d")}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{change.description}</p>

                      {/* Show expected vs actual for swaps */}
                      {(change.type === 'no_show' || change.type === 'driver_swap') && change.expected && change.actual && (
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          <div className="px-2 py-1 rounded bg-muted">
                            <span className="text-muted-foreground">Scheduled: </span>
                            <span className="font-medium">{change.expected.driverName || 'Unassigned'}</span>
                          </div>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <div className="px-2 py-1 rounded bg-muted">
                            <span className="text-muted-foreground">Actual: </span>
                            <span className="font-medium">{change.actual.driverName || 'Unassigned'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Warning about applying changes */}
        {summary.totalChanges > 0 && (
          <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 p-3 rounded-lg mt-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Applying these changes will update your historical records. You can undo this action after applying.
            </span>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={onApply}
            disabled={isApplying || summary.totalChanges === 0}
          >
            {isApplying ? "Applying..." : `Apply ${summary.totalChanges} Change${summary.totalChanges !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
