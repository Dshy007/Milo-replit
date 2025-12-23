import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, UserX, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useState } from 'react';

interface ExcludedDriver {
  id: string;
  name: string;
  reason: string;
  assignmentCount?: number;
  patternConfidence?: number;
}

interface AnalysisErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  excludedDrivers: ExcludedDriver[];
  onProceedWithoutExcluded: () => void;
  onManualAssign: (driverId: string) => void;
  isProceedingDisabled?: boolean;
}

export function AnalysisErrorModal({
  isOpen,
  onClose,
  excludedDrivers,
  onProceedWithoutExcluded,
  onManualAssign,
  isProceedingDisabled = false,
}: AnalysisErrorModalProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Group excluded drivers by reason
  const insufficientHistory = excludedDrivers.filter(d => d.reason === 'insufficient_history');
  const lowConfidence = excludedDrivers.filter(d => d.reason === 'low_confidence');
  const newDrivers = excludedDrivers.filter(d => d.reason === 'new_driver');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" />
            Pattern Analysis Incomplete
          </DialogTitle>
          <DialogDescription className="text-base">
            We couldn't generate reliable patterns for{' '}
            <strong>{excludedDrivers.length} driver{excludedDrivers.length !== 1 ? 's' : ''}</strong>.
            These drivers will be excluded from auto-matching.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Explanation */}
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-700 dark:text-blue-300">
                <p className="font-medium">Why does this happen?</p>
                <p className="mt-1 text-blue-600 dark:text-blue-400">
                  The AI needs at least 12 assignments over 12 weeks to build a reliable work pattern.
                  New or part-time drivers may not have enough history yet.
                </p>
              </div>
            </div>
          </div>

          {/* Summary badges */}
          <div className="flex flex-wrap gap-2">
            {insufficientHistory.length > 0 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                <UserX className="w-3 h-3 mr-1" />
                {insufficientHistory.length} insufficient history
              </Badge>
            )}
            {lowConfidence.length > 0 && (
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {lowConfidence.length} low confidence
              </Badge>
            )}
            {newDrivers.length > 0 && (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                <UserX className="w-3 h-3 mr-1" />
                {newDrivers.length} new drivers
              </Badge>
            )}
          </div>

          {/* Expandable driver list */}
          <div className="border rounded-lg overflow-hidden">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="text-sm font-medium">View Affected Drivers</span>
              {showDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {showDetails && (
              <div className="max-h-48 overflow-y-auto divide-y">
                {excludedDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    className="flex items-center justify-between px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm">{driver.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {driver.reason === 'insufficient_history' && (
                          <>Only {driver.assignmentCount || 0} assignments in 12 weeks</>
                        )}
                        {driver.reason === 'low_confidence' && (
                          <>Pattern confidence: {Math.round((driver.patternConfidence || 0) * 100)}%</>
                        )}
                        {driver.reason === 'new_driver' && (
                          <>New driver - no historical data</>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => onManualAssign(driver.id)}
                    >
                      Assign Manually
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onProceedWithoutExcluded}
            disabled={isProceedingDisabled}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            Proceed Without Excluded Drivers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
