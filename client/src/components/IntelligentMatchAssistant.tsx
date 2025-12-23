import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Calendar, Clock, Truck, Sparkles, Loader2, Target, TrendingUp, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiRequest } from '@/lib/queryClient';
import { ContractTypeBadge } from '@/components/ContractTypeBadge';
import { getMatchColor } from '@/lib/utils';

// ShiftOccurrence type (matches the one in Schedules.tsx)
export type ShiftOccurrence = {
  occurrenceId: string;
  serviceDate: string;
  startTime: string;
  blockId: string;
  driverName: string | null;
  driverId: string | null;
  contractType: string | null;
  status: string;
  tractorId: string | null;
  assignmentId: string | null;
  bumpMinutes: number;
  isCarryover: boolean;
  isRejectedLoad?: boolean;
  source?: 'imported_block' | 'shift_occurrence';
};

// Match result from API
interface DriverMatch {
  driverId: string;
  driverName: string;
  score: number;
  ownershipPct: number;
  matchType: string;
  reasons: string[];
  patternConfidence: number;
  typicalDays: number;
  dayList: string[];
}

interface BlockMatchResponse {
  success: boolean;
  blockId: string;
  blockInfo: {
    serviceDate: string;
    startTime: string;
    contractType: string;
    tractorId: string;
    dayName: string;
  };
  matches: DriverMatch[];
  totalCandidates: number;
}

interface IntelligentMatchAssistantProps {
  selectedBlock: ShiftOccurrence | null;
  onAssignDriver?: (blockId: string, driverId: string) => void;
}

// Score bar visualization component
function ScoreBar({ score, label }: { score: number; label?: string }) {
  const percentage = Math.round(score * 100);
  const color = getMatchColor(score);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${percentage}%`,
            backgroundColor: color
          }}
        />
      </div>
      <span className="text-xs font-mono w-10 text-right" style={{ color }}>
        {percentage}%
      </span>
    </div>
  );
}

// Driver match card component
function DriverMatchCard({
  match,
  rank,
  onAssign,
  isAssigning
}: {
  match: DriverMatch;
  rank: number;
  onAssign?: () => void;
  isAssigning?: boolean;
}) {
  const isTopMatch = rank === 1;
  const isOwner = match.matchType === 'owner';

  return (
    <div
      className={`
        p-3 rounded-lg border transition-all
        ${isTopMatch
          ? 'bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/40 dark:to-violet-950/40 border-purple-300 dark:border-purple-700 shadow-sm'
          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-600'
        }
      `}
    >
      {/* Header: Rank + Name + Score */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`
            w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
            ${isTopMatch
              ? 'bg-purple-600 text-white'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
            }
          `}>
            {rank}
          </span>
          <div>
            <span className="font-medium text-sm">{match.driverName}</span>
            {isOwner && (
              <Badge variant="secondary" className="ml-2 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                OWNER
              </Badge>
            )}
          </div>
        </div>
        <div className="text-right">
          <span
            className="text-lg font-bold"
            style={{ color: getMatchColor(match.score) }}
          >
            {Math.round(match.score * 100)}%
          </span>
        </div>
      </div>

      {/* Score Bar */}
      <ScoreBar score={match.score} />

      {/* Pattern Info */}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Calendar className="w-3 h-3" />
        <span>
          {match.dayList.length > 0
            ? match.dayList.slice(0, 4).map(d => d.slice(0, 3)).join(', ')
            : 'Any day'
          }
          {match.dayList.length > 4 && ` +${match.dayList.length - 4}`}
        </span>
        <span className="text-slate-400">|</span>
        <span>{match.typicalDays}d pattern</span>
        <span className="text-slate-400">|</span>
        <span>{Math.round(match.patternConfidence * 100)}% conf</span>
      </div>

      {/* Reasons */}
      {match.reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {match.reasons.slice(0, 3).map((reason, i) => (
            <Badge
              key={i}
              variant="outline"
              className="text-[10px] px-1.5 py-0"
            >
              {reason}
            </Badge>
          ))}
        </div>
      )}

      {/* Assign Button */}
      {onAssign && (
        <Button
          size="sm"
          className="w-full mt-3 h-7"
          onClick={onAssign}
          disabled={isAssigning}
        >
          {isAssigning ? (
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
          ) : (
            <User className="w-3 h-3 mr-1" />
          )}
          Assign Driver
        </Button>
      )}
    </div>
  );
}

export function IntelligentMatchAssistant({ selectedBlock, onAssignDriver }: IntelligentMatchAssistantProps) {
  // Fetch matches for selected block
  const { data, isLoading, error } = useQuery<BlockMatchResponse>({
    queryKey: ['/api/matching/block', selectedBlock?.occurrenceId],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/matching/block/${selectedBlock!.occurrenceId}`);
      return response.json();
    },
    enabled: !!selectedBlock && !selectedBlock.driverId, // Only fetch for unassigned blocks
  });

  // Empty state - no block selected
  if (!selectedBlock) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
        <Target className="w-12 h-12 mb-4 text-slate-300 dark:text-slate-600" />
        <p className="text-center font-medium">Select a Block</p>
        <p className="text-center text-sm mt-1">
          Click an unassigned block on the calendar to see the top driver matches.
        </p>
      </div>
    );
  }

  // Block is already assigned
  if (selectedBlock.driverId) {
    return (
      <div className="p-4">
        <div className="mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            Block Details
          </h3>
        </div>

        {/* Block Info */}
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono font-semibold">{selectedBlock.startTime}</span>
            <span className="text-muted-foreground">on</span>
            <span className="font-medium">{selectedBlock.serviceDate}</span>
          </div>
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-muted-foreground" />
            <span>{selectedBlock.tractorId}</span>
            {selectedBlock.contractType && (
              <ContractTypeBadge contractType={selectedBlock.contractType} size="sm" />
            )}
          </div>
        </div>

        {/* Assigned Driver */}
        <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <User className="w-5 h-5" />
            <span className="font-semibold">Assigned to:</span>
          </div>
          <p className="mt-1 text-lg font-medium">{selectedBlock.driverName}</p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
        <Loader2 className="w-8 h-8 animate-spin mb-4 text-purple-500" />
        <p className="text-center font-medium">Finding Best Matches...</p>
        <p className="text-center text-sm mt-1">
          Analyzing driver patterns and availability
        </p>
      </div>
    );
  }

  // Error state
  if (error || !data?.success) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
        <AlertCircle className="w-8 h-8 mb-4 text-red-500" />
        <p className="text-center font-medium text-red-600">Failed to Load Matches</p>
        <p className="text-center text-sm mt-1">
          {(error as Error)?.message || 'Unknown error occurred'}
        </p>
      </div>
    );
  }

  const { matches, blockInfo, totalCandidates } = data;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          Intelligent Match
        </h3>

        {/* Block Info */}
        <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono font-semibold">{blockInfo.startTime}</span>
            <span className="text-muted-foreground">-</span>
            <span className="font-medium">{blockInfo.dayName}</span>
            <span className="text-muted-foreground text-sm">({blockInfo.serviceDate})</span>
          </div>
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-muted-foreground" />
            <span>{blockInfo.tractorId}</span>
            <ContractTypeBadge contractType={blockInfo.contractType} size="sm" />
          </div>
        </div>

        {/* Stats */}
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <TrendingUp className="w-3 h-3" />
          <span>Top {matches.length} of {totalCandidates} candidates</span>
        </div>
      </div>

      {/* Match List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {matches.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
              <p className="font-medium">No Matching Drivers</p>
              <p className="text-sm mt-1">
                No drivers match this block's requirements.
                <br />
                Try adjusting the analysis settings.
              </p>
            </div>
          ) : (
            matches.map((match, index) => (
              <DriverMatchCard
                key={match.driverId}
                match={match}
                rank={index + 1}
                onAssign={onAssignDriver ? () => onAssignDriver(selectedBlock.occurrenceId, match.driverId) : undefined}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* AI Insight Footer */}
      {matches.length > 0 && (
        <div className="p-4 border-t bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/20 dark:to-violet-950/20">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-purple-700 dark:text-purple-300">AI Insight</p>
              <p className="text-xs text-muted-foreground mt-1">
                {matches[0].matchType === 'owner'
                  ? `${matches[0].driverName} is the slot owner with ${matches[0].ownershipPct}% historical ownership. This is a strong match.`
                  : matches[0].score >= 0.8
                    ? `${matches[0].driverName} has a strong pattern match based on historical assignments.`
                    : `Multiple drivers can cover this slot. Consider workload balance when assigning.`
                }
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
