import React from 'react';
import { Sparkles, X, Check, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PreviewAssignment {
  driverId: string;
  driverName: string;
  score: number;
}

interface MatchReviewPanelProps {
  previewAssignments: Map<string, PreviewAssignment>;
  onCommit: () => void;
  onCancel: () => void;
  isCommitting: boolean;
}

export function MatchReviewPanel({
  previewAssignments,
  onCommit,
  onCancel,
  isCommitting
}: MatchReviewPanelProps) {
  const assignmentCount = previewAssignments.size;

  // Calculate statistics
  const assignments = Array.from(previewAssignments.values());
  const avgScore = assignments.length > 0
    ? assignments.reduce((sum, a) => sum + a.score, 0) / assignments.length
    : 0;
  const highConfidence = assignments.filter(a => a.score >= 0.7).length;
  const mediumConfidence = assignments.filter(a => a.score >= 0.4 && a.score < 0.7).length;
  const lowConfidence = assignments.filter(a => a.score < 0.4).length;

  // Group by driver to show distribution
  const driverCounts = new Map<string, number>();
  for (const assignment of assignments) {
    driverCounts.set(assignment.driverName, (driverCounts.get(assignment.driverName) || 0) + 1);
  }
  const topDrivers = Array.from(driverCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-slate-800 rounded-lg shadow-2xl z-50 w-96 border border-violet-300 dark:border-violet-700 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Sparkles className="w-5 h-5" />
            <h3 className="font-bold">Match Preview</h3>
          </div>
          <button
            onClick={onCancel}
            className="text-white/80 hover:text-white transition-colors"
            disabled={isCommitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-violet-100 text-sm mt-1">
          {assignmentCount} proposed assignments ready for review
        </p>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
            <div className="text-lg font-bold text-green-600 dark:text-green-400">{highConfidence}</div>
            <div className="text-[10px] text-green-600/80 dark:text-green-400/80">High (&gt;70%)</div>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-2">
            <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{mediumConfidence}</div>
            <div className="text-[10px] text-yellow-600/80 dark:text-yellow-400/80">Medium</div>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
            <div className="text-lg font-bold text-red-600 dark:text-red-400">{lowConfidence}</div>
            <div className="text-[10px] text-red-600/80 dark:text-red-400/80">Low (&lt;40%)</div>
          </div>
        </div>
        <div className="mt-2 text-center">
          <span className="text-sm text-muted-foreground">Average Score: </span>
          <span className="font-mono font-bold" style={{
            color: avgScore >= 0.7 ? '#16a34a' : avgScore >= 0.4 ? '#ca8a04' : '#dc2626'
          }}>
            {Math.round(avgScore * 100)}%
          </span>
        </div>
      </div>

      {/* Low confidence warnings */}
      {lowConfidence > 0 && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {lowConfidence} assignment{lowConfidence > 1 ? 's have' : ' has'} low confidence scores.
              Review these blocks carefully after committing.
            </p>
          </div>
        </div>
      )}

      {/* Top drivers */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">TOP DRIVERS</h4>
        <div className="space-y-1">
          {topDrivers.map(([name, count]) => (
            <div key={name} className="flex items-center justify-between text-sm">
              <span className="truncate">{name}</span>
              <Badge variant="secondary" className="text-xs">
                {count} block{count > 1 ? 's' : ''}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 bg-slate-50 dark:bg-slate-900/50">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isCommitting}
            className="flex-1"
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          <Button
            onClick={onCommit}
            disabled={isCommitting || assignmentCount === 0}
            className="flex-1 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
          >
            {isCommitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Committing...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Commit {assignmentCount}
              </>
            )}
          </Button>
        </div>
        <p className="text-[10px] text-center text-muted-foreground mt-2">
          This will save all preview assignments to the database
        </p>
      </div>
    </div>
  );
}
