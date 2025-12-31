import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { User, Search, ChevronDown, ChevronRight, ChevronLeft, Sparkles, ExternalLink, Calendar, Clock, Truck, Dna, Filter, Sliders, Target, TrendingUp, Crown, Zap, Wand2, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { DNAPatternBadge } from "@/components/DNAPatternBadge";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";
import { AutoMatchPreviewModal, type MatchSuggestion } from "@/components/AutoMatchPreviewModal";
import { DriverCirclePacking, type MatchedBlock } from "@/components/charts/DriverCirclePacking";
import { useLocation } from "wouter";
import { getMatchColor, cn } from "@/lib/utils";
import type { Driver, DriverDnaProfile } from "@shared/schema";

// Match threshold (0-100) - higher = stricter matching
// 80-100: Strict (Day + Time + Contract must match)
// 40-79: Moderate (Contract + Day OR Time)
// 0-39: Flexible (Only Contract type)
const getThresholdLabel = (threshold: number): { label: string; description: string; color: string } => {
  if (threshold >= 80) {
    return {
      label: 'Strict',
      description: 'Day + Time + Contract must match',
      color: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700'
    };
  } else if (threshold >= 40) {
    return {
      label: 'Moderate',
      description: 'Contract + (Day OR Time) must match',
      color: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700'
    };
  } else {
    return {
      label: 'Flexible',
      description: 'Only Contract type must match',
      color: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
    };
  }
};

// Convert threshold to strictness level for matching logic
type StrictnessLevel = 'strict' | 'moderate' | 'flexible';
const thresholdToStrictness = (threshold: number): StrictnessLevel => {
  if (threshold >= 80) return 'strict';
  if (threshold >= 40) return 'moderate';
  return 'flexible';
};

// Schedule strategy presets
type ScheduleStrategy = 'cover' | 'overtime' | 'premium' | 'balanced';
const STRATEGY_OPTIONS: Record<ScheduleStrategy, {
  label: string;
  description: string;
  icon: typeof Target;
  color: string;
  threshold: number; // 0-100
  prioritize: 'coverage' | 'cost' | 'preference' | 'balance';
}> = {
  cover: {
    label: 'Cover Schedule',
    description: 'Fill all blocks, relax matching if needed',
    icon: Target,
    color: 'bg-blue-600 hover:bg-blue-700',
    threshold: 20,
    prioritize: 'coverage',
  },
  overtime: {
    label: 'Minimize Overtime',
    description: 'Spread blocks evenly, avoid driver overload',
    icon: TrendingUp,
    color: 'bg-amber-600 hover:bg-amber-700',
    threshold: 50,
    prioritize: 'cost',
  },
  premium: {
    label: 'Premium Match',
    description: 'Only assign perfect DNA matches',
    icon: Crown,
    color: 'bg-purple-600 hover:bg-purple-700',
    threshold: 90,
    prioritize: 'preference',
  },
  balanced: {
    label: 'Balanced',
    description: 'Best mix of coverage and driver preferences',
    icon: Zap,
    color: 'bg-emerald-600 hover:bg-emerald-700',
    threshold: 60,
    prioritize: 'balance',
  },
};

// Analysis Accuracy: 0-100% where 100% = most confident results (balanced threshold)
// User perspective: 100% = "I'm confident these are their true preferences"
function accuracyToThreshold(accuracy: number): number {
  const minThreshold = 0.25; // Best results (100% confidence)
  const maxThreshold = 0.80; // Strictest (0% confidence)
  return maxThreshold - (accuracy / 100) * (maxThreshold - minThreshold);
}

function getAccuracyLabel(accuracy: number): string {
  // Higher accuracy = lower threshold = more days captured = broader patterns
  // Lower accuracy = higher threshold = fewer days captured = stricter patterns
  if (accuracy >= 90) return "Broad (more days)";
  if (accuracy >= 70) return "Moderate";
  if (accuracy >= 50) return "Balanced";
  if (accuracy >= 30) return "Selective";
  return "Strict (fewer days)";
}

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (accuracy >= 70) return "text-blue-600 dark:text-blue-400";
  if (accuracy >= 50) return "text-sky-600 dark:text-sky-400";
  if (accuracy >= 30) return "text-amber-600 dark:text-amber-400";
  return "text-orange-600 dark:text-orange-400";
}

type ShiftOccurrence = {
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
};

type CalendarResponse = {
  range: { start: string; end: string };
  occurrences: ShiftOccurrence[];
};

// DNA Profile type from API
type DNAProfileResponse = {
  profiles: Record<string, DriverDnaProfile>;
};

// Matching block type for display
type MatchingBlock = {
  occurrence: ShiftOccurrence;
  matchScore: number;
};

interface DraggableDriverProps {
  driver: Driver;
  dnaProfile?: DriverDnaProfile | null;
  onHoverStart?: (driverId: string) => void;
  onHoverEnd?: () => void;
  onSelect?: (driverId: string) => void;
  isSelected?: boolean;
  matchingBlocks?: MatchingBlock[];
  onBlockClick?: (occurrenceId: string, driverId: string) => void;
  onApplyBlocks?: (blockIds: string[], driverId: string) => void;
  isApplyingBlocks?: boolean;
  totalBlocksAnalyzed?: number;
}

// Draggable driver flip card component
function DraggableDriver({ driver, dnaProfile, onHoverStart, onHoverEnd, onSelect, isSelected, matchingBlocks = [], onBlockClick, onApplyBlocks, isApplyingBlocks = false, totalBlocksAnalyzed = 0 }: DraggableDriverProps) {
  // Track blocks that are "floating away" after being assigned
  const [floatingAwayBlocks, setFloatingAwayBlocks] = useState<Set<string>>(new Set());
  const cardRef = useRef<HTMLDivElement>(null);

  // Card is flipped when this driver is selected - controlled by parent
  // This ensures the card stays open during data refreshes
  const isFlipped = isSelected || false;

  const matchingBlockCount = matchingBlocks.length - floatingAwayBlocks.size;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `driver-${driver.id}`,
    data: {
      type: 'driver',
      driver,
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    // Only trigger flip if not a drag action
    if (!isDragging) {
      // Toggle selection - if already selected, deselect (flip back)
      // If not selected, select (flip open)
      const newSelection = isSelected ? '' : driver.id;
      onSelect?.(newSelection);

      // Scroll the card into view when selected (with a small delay for flip animation)
      if (newSelection && cardRef.current) {
        setTimeout(() => {
          cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      }
    }
  };

  // Format day names for display (Sun-Sat order with proper abbreviations)
  const DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const DAY_ABBREV: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat",
  };
  const formatDays = (days: string[] | null | undefined) => {
    if (!days || days.length === 0) return "Any";
    // Sort by day order (Sun-Sat) and format to abbreviations
    const sorted = [...days].sort((a, b) =>
      DAY_ORDER.indexOf(a.toLowerCase()) - DAY_ORDER.indexOf(b.toLowerCase())
    );
    return sorted.map(d => DAY_ABBREV[d.toLowerCase()] || d.slice(0, 3)).join(", ");
  };

  // Transform matchingBlocks to CirclePacking format
  const circlePackingBlocks: MatchedBlock[] = useMemo(() => {
    return matchingBlocks.map(({ occurrence: occ, matchScore }) => {
      const date = new Date(occ.serviceDate + 'T00:00:00');
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return {
        blockId: occ.occurrenceId,
        serviceDate: occ.serviceDate,
        dayOfWeek: dayNames[date.getDay()],
        startTime: occ.startTime,
        contractType: occ.contractType || 'Solo1',
        score: matchScore,
        tractorId: occ.tractorId || undefined,
      };
    });
  }, [matchingBlocks]);

  // Handle apply blocks from CirclePacking
  const handleApplyBlocks = (blockIds: string[]) => {
    if (onApplyBlocks) {
      onApplyBlocks(blockIds, driver.id);
    }
  };

  // Calculate height based on whether it's flipped and if using CirclePacking
  const cardHeight = isFlipped
    ? (dnaProfile && matchingBlocks.length > 0 ? 380 : dnaProfile ? 120 : 100) // Taller for CirclePacking
    : 40;

  return (
    <div
      ref={cardRef}
      className="relative"
      data-driver-id={driver.id}
      style={{
        perspective: '1000px',
        height: `${cardHeight}px`,
        transition: 'height 0.3s ease-out',
      }}
      onMouseEnter={() => onHoverStart?.(driver.id)}
      onMouseLeave={() => onHoverEnd?.()}
    >
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="absolute inset-0 transition-transform duration-500 ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* FRONT FACE - Compact driver chip with match indicator */}
        <div
          className={`
            absolute inset-0 flex items-center gap-1.5 p-2 pr-1.5 rounded-lg
            transition-all duration-200 ease-out
            cursor-pointer
            ${isSelected
              ? 'bg-sky-100 dark:bg-sky-900/40 border-2 border-sky-500 shadow-[0_0_15px_rgba(14,165,233,0.4)] ring-2 ring-sky-500/30'
              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-purple-400 dark:hover:border-purple-500 shadow-sm hover:shadow-md'
            }
            ${isDragging ? 'opacity-50 scale-105' : 'opacity-100'}
          `}
          style={{ backfaceVisibility: 'hidden' }}
          onClick={handleClick}
        >
          <User className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-sky-600 dark:text-sky-400' : 'text-slate-600 dark:text-slate-400'}`} />
          <span className={`text-sm font-medium truncate flex-1 min-w-0 ${isSelected ? 'text-sky-900 dark:text-sky-100' : 'text-slate-900 dark:text-slate-100'}`}>
            {driver.firstName} {driver.lastName}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Match count badge - visible on front */}
            {matchingBlockCount !== undefined && matchingBlockCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 border-0">
                {matchingBlockCount}
              </Badge>
            )}
            {dnaProfile && (
              <>
                <DNAPatternBadge pattern={dnaProfile.patternGroup} size="sm" showIcon={false} />
                <ContractTypeBadge contractType={dnaProfile.preferredContractType} size="sm" showIcon={false} />
              </>
            )}
            {isSelected && (
              <div className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
            )}
          </div>
        </div>

        {/* BACK FACE - Matching Blocks */}
        <div
          className={`
            absolute inset-0 p-2.5 rounded-lg overflow-hidden cursor-pointer
            bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-950/40 dark:to-violet-950/40
            border-2 border-purple-400 dark:border-purple-600
            shadow-[0_0_20px_rgba(147,51,234,0.3)]
          `}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
          onClick={handleClick}
        >
          {dnaProfile ? (
            <>
              {/* Header with driver name + Back button */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect?.(''); // Deselect to flip back
                    }}
                    className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition-colors"
                    title="Flip back to front"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="text-xs font-semibold text-purple-900 dark:text-purple-100 truncate max-w-[160px]">
                    {driver.firstName} {driver.lastName}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <DNAPatternBadge pattern={dnaProfile.patternGroup} size="sm" showIcon={false} />
                  <ContractTypeBadge contractType={dnaProfile.preferredContractType} size="sm" showIcon={false} />
                </div>
              </div>

              {/* DNA preference row */}
              <div className="flex items-center gap-2 text-[9px] text-muted-foreground mb-1.5 pb-1 border-b border-purple-200 dark:border-purple-700">
                <span className="flex items-center gap-0.5">
                  <Calendar className="w-2.5 h-2.5" />
                  {formatDays(dnaProfile.preferredDays)}
                </span>
                <span className="flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {dnaProfile.preferredStartTimes?.length ? dnaProfile.preferredStartTimes.join(", ") : "Any"}
                </span>
              </div>

              {/* CirclePacking Visualization */}
              {matchingBlocks.length > 0 ? (
                <div className="flex-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <DriverCirclePacking
                    driverName={`${driver.firstName} ${driver.lastName}`}
                    matchedBlocks={circlePackingBlocks}
                    onApply={handleApplyBlocks}
                    isApplying={isApplyingBlocks}
                    height={280}
                  />
                </div>
              ) : (
                <div className="text-[10px] text-center text-muted-foreground py-2 italic">
                  No matching blocks available
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-2">
              <Dna className="w-6 h-6 text-slate-400 mb-1" />
              <span className="text-[10px] text-muted-foreground">No profile data</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DriverPoolSidebarProps {
  currentWeekStart: Date;
  currentWeekEnd: Date;
  onDriverHoverStart?: (driverId: string) => void;
  onDriverHoverEnd?: () => void;
  onDriverSelect?: (driverId: string) => void;
  hoveredDriverId?: string | null;
  selectedDriverId?: string | null;
  unassignedOccurrences?: ShiftOccurrence[];
  onBlockClick?: (occurrenceId: string, driverId: string) => void;
  onApplyBlocks?: (blockIds: string[], driverId: string) => void;
  onMatchingBlocksChange?: (matchingBlockIds: string[]) => void;
}

// Droppable zone for Available Drivers section
function DroppableAvailableSection({ children }: { children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'available-drivers-pool',
  });

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 rounded-lg transition-all p-2 ${
        isOver
          ? 'bg-green-50 dark:bg-green-950/20 ring-2 ring-green-400 dark:ring-green-600 shadow-[0_0_12px_rgba(34,197,94,0.4)]'
          : 'bg-slate-50/50 dark:bg-slate-900/30'
      }`}
      style={{ pointerEvents: 'auto' }}
      data-droppable="true"
    >
      {children}
    </div>
  );
}

// Helper to convert time string to minutes for comparison
function timeToMinutes(time: string | null | undefined): number {
  if (!time || typeof time !== 'string') return 0;
  const parts = time.split(':');
  if (parts.length < 2) return 0;
  const [hours, minutes] = parts.map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

// Result type for block matching - includes both score and time diff
type BlockMatchResult = {
  score: number;
  timeDiff: number;
  dayMatches: boolean;
  timeMatches: boolean;
};

// Calculate match score between a block and a DNA profile
// Strictness levels:
// - strict: Day + Time + Contract must ALL match (original "Holy Grail")
// - moderate: Contract + (Day OR Time) must match
// - flexible: Only Contract type must match
//
// Returns both match score AND time difference for sorting
function calculateBlockMatch(
  occurrence: ShiftOccurrence,
  dnaProfile: DriverDnaProfile,
  strictness: StrictnessLevel = 'strict',
  debug: boolean = false
): BlockMatchResult {
  const noMatch: BlockMatchResult = { score: 0, timeDiff: Infinity, dayMatches: false, timeMatches: false };

  // ALWAYS REQUIRED: Contract type must match
  const driverContract = dnaProfile.preferredContractType?.toLowerCase();
  const blockContract = occurrence.contractType?.toLowerCase();

  // Debug: Always log contract type info when debug is enabled
  if (debug) {
    console.log('[DNA MATCH] Contract check:', {
      blockId: occurrence.blockId,
      blockContract: blockContract || 'NULL/UNDEFINED',
      driverContract: driverContract || 'NULL/UNDEFINED',
      rawBlockContract: occurrence.contractType,
      rawDriverContract: dnaProfile.preferredContractType,
    });
  }

  // If driver has a contract preference and block has a contract type, they must match
  if (driverContract && blockContract && driverContract !== blockContract) {
    if (debug) {
      console.log('[DNA MATCH] Contract mismatch - block rejected');
    }
    return noMatch;
  }

  // ALSO reject if driver has a contract preference but block has NO contract type
  // This prevents solo2 drivers from matching blocks with undefined contract types
  if (driverContract && !blockContract) {
    if (debug) {
      console.log('[DNA MATCH] Block has no contract type, driver expects:', driverContract);
    }
    // Return noMatch to be strict about contract matching
    return noMatch;
  }

  // CRITICAL: Exclude drivers with empty preferences (must have BOTH days AND times set)
  // This matches the Python OR-Tools logic - empty preferences = ineligible, not "match anything"
  const preferredDays = dnaProfile.preferredDays || [];
  const preferredTimes = dnaProfile.preferredStartTimes || [];

  if (preferredDays.length === 0 || preferredTimes.length === 0) {
    if (debug) {
      console.log('[DNA MATCH] Driver has incomplete preferences - EXCLUDED:', {
        preferredDays,
        preferredTimes: preferredTimes.length > 0 ? preferredTimes : 'EMPTY',
      });
    }
    return noMatch;
  }

  // Get day of week from service date (lowercase full day names to match DB format)
  const date = new Date(occurrence.serviceDate + 'T00:00:00');
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = days[date.getDay()];

  // Check day match - since we already validated preferredDays is not empty above,
  // we can now require actual day matching (no wildcard for empty)
  const dayMatches = preferredDays.some(d => d.toLowerCase() === dayOfWeek);

  // HARD CONSTRAINT: Day preference is mandatory - if day doesn't match, reject immediately
  // This matches the Python OR-Tools behavior: drivers can ONLY be assigned to preferred days
  if (!dayMatches) {
    if (debug) {
      console.log('[DNA MATCH] HARD CONSTRAINT: Day mismatch - block rejected', {
        blockId: occurrence.blockId,
        blockDay: dayOfWeek,
        preferredDays,
      });
    }
    return noMatch;
  }

  // Check time match against ALL preferred times (not just the first one!)
  // This is critical: Firas with times [17:30, 16:30] should match blocks at BOTH times
  const blockTimeMinutes = timeToMinutes(occurrence.startTime);

  // Find the best (smallest) time difference across ALL preferred times
  let bestTimeDiff = Infinity;
  let timeMatches = false;
  for (const prefTime of preferredTimes) {
    const prefMinutes = timeToMinutes(prefTime);
    const diff = Math.abs(blockTimeMinutes - prefMinutes);
    // Handle wraparound for overnight times
    const wrappedDiff = Math.min(diff, 1440 - diff);
    if (wrappedDiff < bestTimeDiff) {
      bestTimeDiff = wrappedDiff;
    }
    if (wrappedDiff === 0) {
      timeMatches = true; // Exact match to ANY preferred time
    }
  }
  const timeDiff = bestTimeDiff;

  // Debug: Log day/time matching details
  if (debug) {
    console.log('[DNA MATCH] Day/Time check:', {
      blockId: occurrence.blockId,
      blockDate: occurrence.serviceDate,
      blockDayOfWeek: dayOfWeek,
      blockTime: occurrence.startTime,
      blockTimeMinutes,
      preferredDays,
      preferredTimes,
      dayMatches,
      timeMatches,
      timeDiff,
    });
  }

  // Apply strictness rules for TIME matching (day is already guaranteed via hard constraint above)
  if (strictness === 'strict') {
    // Strict mode: time must ALSO match exactly
    if (!timeMatches) {
      if (debug) {
        console.log('[DNA MATCH] STRICT: Time mismatch', {
          blockId: occurrence.blockId,
          timeMatches,
        });
      }
      return { score: 0, timeDiff, dayMatches, timeMatches };
    }
  }
  // 'moderate' and 'flexible' = day match is sufficient (already guaranteed above)

  // Calculate score based on time proximity (day is guaranteed to match at this point)
  let score = 0.7; // Base score for day match

  if (timeMatches) {
    // Perfect match - day AND exact time match
    score = 1.0;
  } else if (timeDiff <= 60) {
    // Day matches, time within 1 hour
    score = 0.9;
  } else if (timeDiff <= 120) {
    // Day matches, time within 2 hours
    score = 0.8;
  }

  if (debug) {
    console.log('[DNA MATCH] Match found', {
      blockId: occurrence.blockId,
      blockDay: dayOfWeek,
      blockTime: occurrence.startTime,
      strictness,
      dayMatches,
      timeMatches,
      score,
    });
  }

  return { score, timeDiff, dayMatches, timeMatches };
}

export function DriverPoolSidebar({
  currentWeekStart,
  currentWeekEnd,
  onDriverHoverStart,
  onDriverHoverEnd,
  onDriverSelect,
  hoveredDriverId,
  selectedDriverId,
  unassignedOccurrences = [],
  onBlockClick,
  onApplyBlocks,
  onMatchingBlocksChange,
}: DriverPoolSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAvailable, setShowAvailable] = useState(true);
  const [showAssigned, setShowAssigned] = useState(true);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [contractFilter, setContractFilter] = useState<'all' | 'solo1' | 'solo2'>('all');
  const [threshold, setThreshold] = useState(80); // 0-100, default strict
  const [showStrictnessSlider, setShowStrictnessSlider] = useState(false);
  const [strategy, setStrategy] = useState<ScheduleStrategy | null>(null);
  const [showStrategyOptions, setShowStrategyOptions] = useState(false);
  const [analysisAccuracy, setAnalysisAccuracy] = useState(75); // 0-100%, default 75% (confident)
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<{
    suggestions: MatchSuggestion[];
    unassigned: string[];
    stats: {
      totalBlocks: number;
      assigned: number;
      unassigned: number;
    };
  } | null>(null);

  // XGBoost analysis results - stores historical blocks per driver
  const [xgboostAnalysis, setXgboostAnalysis] = useState<{
    drivers: Array<{
      driverId: string;
      driverName: string;
      matchingBlocks: Array<{
        blockId: string;
        serviceDate: string;
        startTime: string;
        soloType: string;
        tractorId: string;
      }>;
      totalBlocks: number;
      pattern: {
        preferredDays: string[];
        preferredTimes: string[];
        contractType: string;
      } | null;
    }>;
    totalDrivers: number;
    totalBlocks: number;
  } | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Deterministic Auto-Match mutation (fast, no AI)
  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      const weekStart = currentWeekStart.toISOString().split('T')[0];
      const response = await apiRequest("POST", "/api/matching/deterministic", {
        weekStart,
        contractType: contractFilter !== 'all' ? contractFilter : undefined,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        // Open preview modal with suggestions
        setPreviewData({
          suggestions: data.suggestions,
          unassigned: data.unassigned || [],
          stats: data.stats,
        });
        setShowPreviewModal(true);
      } else {
        toast({
          title: "Matching Failed",
          description: data.message || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Auto-Match Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });


  // XGBoost Analysis mutation (Re-analyze all drivers using historical block data)
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analysis/drivers-xgboost", {});
      return res.json();
    },
    onSuccess: (result: any) => {
      // Store the XGBoost analysis results for flip card display
      if (result.success && result.drivers) {
        setXgboostAnalysis({
          drivers: result.drivers,
          totalDrivers: result.totalDrivers,
          totalBlocks: result.totalBlocks,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/driver-dna"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      toast({
        title: "Analysis Complete",
        description: `Analyzed ${result.totalDrivers} drivers with ${result.totalBlocks} blocks from last ${result.analysisWindow?.weeks || 12} weeks.`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Analysis Failed", description: error.message, variant: "destructive" });
    },
  });

  // Derive strictness from threshold for matching logic
  const strictness = thresholdToStrictness(threshold);

  // When a strategy is selected, update threshold accordingly
  const handleStrategySelect = (selectedStrategy: ScheduleStrategy) => {
    if (strategy === selectedStrategy) {
      // Deselect if clicking same strategy
      setStrategy(null);
    } else {
      setStrategy(selectedStrategy);
      setThreshold(STRATEGY_OPTIONS[selectedStrategy].threshold);
    }
  };

  // Fetch all drivers
  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Fetch current week's calendar to determine assigned drivers
  const { data: calendarData } = useQuery<CalendarResponse>({
    queryKey: ["/api/schedules/calendar", currentWeekStart.toISOString().split('T')[0], currentWeekEnd.toISOString().split('T')[0]],
  });

  // Fetch all DNA profiles
  const { data: dnaData } = useQuery<{ profiles: DriverDnaProfile[]; stats: any }>({
    queryKey: ["/api/driver-dna"],
  });

  // Convert profiles array to map for easy lookup
  const dnaProfileMap = new Map<string, DriverDnaProfile>();
  if (dnaData?.profiles) {
    for (const profile of dnaData.profiles) {
      dnaProfileMap.set(profile.driverId, profile);
    }
  }

  // Categorize drivers
  const assignedDriverIds = new Set(
    (calendarData?.occurrences || [])
      .filter(occ => occ.driverId)
      .map(occ => occ.driverId)
  );

  const availableDrivers = drivers.filter(d =>
    !assignedDriverIds.has(d.id) &&
    d.status === 'active' &&
    d.loadEligible
  );

  const assignedDrivers = drivers.filter(d => assignedDriverIds.has(d.id));

  const unavailableDrivers = drivers.filter(d =>
    !assignedDriverIds.has(d.id) &&
    (d.status !== 'active' || !d.loadEligible)
  );

  // Filter by search query and contract type
  const filterDrivers = (driverList: Driver[]) => {
    let filtered = driverList;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(d =>
        `${d.firstName} ${d.lastName}`.toLowerCase().includes(query)
      );
    }

    // Filter by contract type (based on DNA profile)
    if (contractFilter !== 'all') {
      filtered = filtered.filter(d => {
        const profile = dnaProfileMap.get(d.id);
        if (!profile) return false;
        return profile.preferredContractType?.toLowerCase() === contractFilter;
      });
    }

    return filtered;
  };

  const filteredAvailable = filterDrivers(availableDrivers);
  const filteredAssigned = filterDrivers(assignedDrivers);
  const filteredUnavailable = filterDrivers(unavailableDrivers);

  // Get assignment info for assigned driver
  const getAssignmentInfo = (driverId: string) => {
    const assignments = (calendarData?.occurrences || [])
      .filter(occ => occ.driverId === driverId)
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));

    return assignments;
  };

  // Get assignment counts by contract type
  const getAssignmentCounts = (driverId: string) => {
    const assignments = getAssignmentInfo(driverId);
    const solo1Count = assignments.filter(a => a.contractType === 'solo1').length;
    const solo2Count = assignments.filter(a => a.contractType === 'solo2').length;
    const teamCount = assignments.filter(a => a.contractType === 'team').length;

    return {
      total: assignments.length,
      solo1: solo1Count,
      solo2: solo2Count,
      team: teamCount,
    };
  };

  // Calculate matching blocks for a driver (Holy Grail: day + time + contract must match)
  //
  // DOT Compliance Rules:
  // - Both Solo1 and Solo2: 10 hours minimum rest between shifts
  // - After 6 consecutive days: 34 hours off required
  // - Weekly max: Solo2 = 3 blocks, Solo1 = 6 blocks
  const getMatchingBlocks = (driverId: string): MatchingBlock[] => {
    // If XGBoost analysis results are available, use them to show historical blocks
    if (xgboostAnalysis) {
      const driverAnalysis = xgboostAnalysis.drivers.find(d => d.driverId === driverId);
      if (driverAnalysis && driverAnalysis.matchingBlocks.length > 0) {
        // Convert XGBoost historical blocks to MatchingBlock format for flip card display
        return driverAnalysis.matchingBlocks.map(block => ({
          occurrence: {
            occurrenceId: `xgboost-${block.blockId}-${block.serviceDate}`,
            serviceDate: block.serviceDate,
            startTime: block.startTime,
            blockId: block.blockId,
            driverName: driverAnalysis.driverName,
            driverId: driverId,
            contractType: block.soloType,
            status: 'historical',
            tractorId: block.tractorId,
            assignmentId: null,
            bumpMinutes: 0,
            isCarryover: false,
          },
          matchScore: 1.0, // Historical blocks are 100% match (they actually happened)
        }));
      }
    }

    const profile = dnaProfileMap.get(driverId);
    if (!profile) {
      return [];
    }

    const contractType = profile.preferredContractType?.toLowerCase();
    const isSolo2 = contractType === 'solo2';

    // Get driver's EXISTING assigned blocks from calendar data (with full datetime)
    const existingAssignments = (calendarData?.occurrences || [])
      .filter(occ => occ.driverId === driverId)
      .map(occ => ({
        date: occ.serviceDate,
        time: occ.startTime,
        datetime: new Date(`${occ.serviceDate}T${occ.startTime}:00`),
      }));

    // Filter: only show UNASSIGNED blocks that match the driver's DNA
    // Include time difference for sorting by best match
    // Use current strictness level for matching
    const allMatches = unassignedOccurrences
      .map(occ => {
        const matchResult = calculateBlockMatch(occ, profile, strictness, false);
        return {
          occurrence: occ,
          matchScore: matchResult.score,
          timeDiff: matchResult.timeDiff,
          datetime: new Date(`${occ.serviceDate}T${occ.startTime}:00`),
          date: occ.serviceDate, // Keep the date string for easy comparison
        };
      })
      .filter(item => item.matchScore > 0);


    // DOT Compliance: Track OCCUPIED DATES (driver can only work ONE block per calendar day)
    // This is the fundamental rule - regardless of time gaps, only one block per day
    const occupiedDates = new Set<string>(existingAssignments.map(a => a.date));

    // DOT requires 10 hours minimum rest between shifts
    // Block durations vary by contract type:
    // - Solo1: 12hr block + 10hr rest = 22 hours from start to next start
    // - Solo2: 24hr block (leave Day 1, return Day 2) + 10hr rest = 34 hours from start to next start
    //   Amazon builds Solo2 for consistency: Wed 16:30 → Thu 16:30 return → 10hr rest → Fri 16:30 valid
    //   Example: Wed 16:30 + 24hr = Thu 16:30 return + 10hr rest = Fri 02:30 earliest, so Fri 16:30 works
    const SOLO1_BLOCK_HOURS = 12;
    const SOLO2_BLOCK_HOURS = 24; // Solo2 is 24hr (overnight route), allowing Wed/Fri pattern with 10hr rest between
    const REST_HOURS = 10;

    // Calculate min gap based on THIS driver's contract type
    const blockDurationHours = isSolo2 ? SOLO2_BLOCK_HOURS : SOLO1_BLOCK_HOURS;
    const minGapFromStartMs = (blockDurationHours + REST_HOURS) * 60 * 60 * 1000;

    // Build blocked time windows from existing assignments
    // A block starting at time T blocks new blocks from T to T+(blockDuration+rest) hours
    const blockedWindows: { start: Date; end: Date }[] = existingAssignments.map(a => ({
      start: a.datetime, // Can't start during this block
      end: new Date(a.datetime.getTime() + minGapFromStartMs), // Can't start until block ends + rest
    }));

    // Strategy: For each available date, pick the block closest to driver's preferred time
    // Group matches by date, then for each date pick the best time match
    const matchesByDate = new Map<string, typeof allMatches>();
    for (const match of allMatches) {
      if (!matchesByDate.has(match.date)) {
        matchesByDate.set(match.date, []);
      }
      matchesByDate.get(match.date)!.push(match);
    }

    // For each date, sort by time proximity (smallest diff = best match)
    for (const matches of matchesByDate.values()) {
      matches.sort((a, b) => a.timeDiff - b.timeDiff);
    }

    // Get all dates sorted chronologically, then pick best block per date
    const sortedDates = Array.from(matchesByDate.keys()).sort();

    const validBlocks: MatchingBlock[] = [];

    for (const date of sortedDates) {
      // Skip if this date is already occupied
      if (occupiedDates.has(date)) {
        continue;
      }

      const matchesForDate = matchesByDate.get(date)!;

      // Find the best block for this date that doesn't violate DOT time windows
      for (const match of matchesForDate) {
        const blockStart = match.datetime;

        // Check DOT time window compliance
        // Solo1: 12hr block + 10hr rest = 22hr from start to start
        // Solo2: 24hr block + 10hr rest = 34hr from start to start (allows Wed/Fri pattern)
        const isInBlockedWindow = blockedWindows.some(window =>
          blockStart >= window.start && blockStart <= window.end
        );

        if (isInBlockedWindow) {
          continue; // Try next best time for this date
        }

        // This block is valid - it's the best match for this date!
        validBlocks.push({ occurrence: match.occurrence, matchScore: match.matchScore });

        // Mark this date as occupied
        occupiedDates.add(date);

        // Add new blocked time window (block START to START + blockDuration + rest)
        blockedWindows.push({
          start: blockStart,
          end: new Date(blockStart.getTime() + minGapFromStartMs),
        });

        break; // Move to next date - we found the best block for this date
      }
    }

    // Weekly max caps (Solo2 can do 3 per week, Solo1 can do 5-6)
    const maxBlocksPerWeek = isSolo2 ? 3 : (contractType === 'team' ? 3 : 6);

    // Subtract existing assignments from max
    const remainingSlots = Math.max(0, maxBlocksPerWeek - existingAssignments.length);

    return validBlocks.slice(0, remainingSlots);
  };

  // Notify parent of matching block IDs when selected driver changes
  useEffect(() => {
    if (!selectedDriverId) {
      onMatchingBlocksChange?.([]);
      return;
    }

    // getMatchingBlocks already handles existing assignments and DOT compliance
    const matchingBlocks = getMatchingBlocks(selectedDriverId);
    const matchingIds = matchingBlocks.map(m => m.occurrence.occurrenceId);
    onMatchingBlocksChange?.(matchingIds);

  }, [selectedDriverId, unassignedOccurrences, calendarData, dnaProfileMap, strictness]);

  // Calculate block coverage stats: how many blocks have X driver matches
  const blockCoverageStats = useMemo(() => {
    if (unassignedOccurrences.length === 0 || dnaProfileMap.size === 0) {
      return { total: 0, coverage: [] as { minMatches: number; count: number }[] };
    }

    // For each block, count how many drivers match it
    const blockMatchCounts = new Map<string, number>();

    for (const occ of unassignedOccurrences) {
      let matchCount = 0;
      for (const [driverId, profile] of dnaProfileMap) {
        const result = calculateBlockMatch(occ, profile, strictness, false);
        if (result.score > 0) matchCount++;
      }
      blockMatchCounts.set(occ.occurrenceId, matchCount);
    }

    // Calculate coverage: how many blocks have at least 1, 2, 3, 4+ matches
    const coverage = [1, 2, 3, 4].map(minMatches => ({
      minMatches,
      count: Array.from(blockMatchCounts.values()).filter(c => c >= minMatches).length,
    }));

    return { total: unassignedOccurrences.length, coverage };
  }, [unassignedOccurrences, dnaProfileMap, strictness]);

  return (
    <div className="w-[360px] border-r bg-card flex flex-col h-full overflow-visible">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Driver Pool</h2>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => analyzeMutation.mutate()}
                  disabled={analyzeMutation.isPending}
                  className="h-8 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white border-0"
                >
                  {analyzeMutation.isPending ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Re-analyze driver patterns</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Analysis Accuracy Slider */}
        <div className="mb-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Settings2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground">Analysis Accuracy</span>
                <span className={cn("text-xs font-bold", getAccuracyColor(analysisAccuracy))}>
                  {analysisAccuracy}%
                </span>
              </div>
              <Slider
                value={[analysisAccuracy]}
                onValueChange={([value]) => setAnalysisAccuracy(value)}
                min={0}
                max={100}
                step={5}
                className="w-full"
              />
              <span className={cn("text-[9px] block text-center mt-0.5", getAccuracyColor(analysisAccuracy))}>
                {getAccuracyLabel(analysisAccuracy)}
              </span>
            </div>
          </div>
          {/* Re-analyze Button */}
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2 h-7 text-xs bg-blue-500 hover:bg-blue-600 text-white border-0"
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
          >
            {analyzeMutation.isPending ? (
              <>
                <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Re-analyze Driver Patterns
              </>
            )}
          </Button>
        </div>

        {/* Block Coverage Stats */}
        {blockCoverageStats.total > 0 && (
          <div className="mb-3 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <div className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
              <span>{blockCoverageStats.total} blocks</span>
              <span className={`font-semibold ${blockCoverageStats.coverage[0]?.count === blockCoverageStats.total ? 'text-green-600' : 'text-amber-600'}`}>
                {blockCoverageStats.coverage[0]?.count || 0}/{blockCoverageStats.total} matched
              </span>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search drivers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Contract Type Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex gap-1 flex-1">
            <Button
              variant={contractFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={() => setContractFilter('all')}
            >
              All
            </Button>
            <Button
              variant={contractFilter === 'solo1' ? 'default' : 'outline'}
              size="sm"
              className={`flex-1 h-7 text-xs ${contractFilter === 'solo1' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
              onClick={() => setContractFilter('solo1')}
            >
              Solo1
            </Button>
            <Button
              variant={contractFilter === 'solo2' ? 'default' : 'outline'}
              size="sm"
              className={`flex-1 h-7 text-xs ${contractFilter === 'solo2' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              onClick={() => setContractFilter('solo2')}
            >
              Solo2
            </Button>
          </div>
        </div>

        {/* Schedule Strategy Options */}
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setShowStrategyOptions(!showStrategyOptions)}
            className="flex items-center justify-between w-full text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-primary transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <span>Schedule Strategy</span>
            </div>
            {strategy && (
              <Badge
                variant="default"
                className={`text-xs ${STRATEGY_OPTIONS[strategy].color}`}
              >
                {STRATEGY_OPTIONS[strategy].label}
              </Badge>
            )}
          </button>

          {showStrategyOptions && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(Object.entries(STRATEGY_OPTIONS) as [ScheduleStrategy, typeof STRATEGY_OPTIONS[ScheduleStrategy]][]).map(([key, opt]) => {
                const Icon = opt.icon;
                const isActive = strategy === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleStrategySelect(key)}
                    className={`
                      flex flex-col items-start gap-1 p-2 rounded-lg border text-left transition-all
                      ${isActive
                        ? `${opt.color} text-white border-transparent shadow-lg`
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
                      }
                    `}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">{opt.label}</span>
                    </div>
                    <span className={`text-[10px] leading-tight ${isActive ? 'text-white/80' : 'text-muted-foreground'}`}>
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Match Strictness - DISABLED: Using Copy Last Week mode */}
        {false && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setShowStrictnessSlider(!showStrictnessSlider)}
            className="flex items-center justify-between w-full text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-primary transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              <span>Match Strictness</span>
            </div>
            <Badge
              variant="outline"
              className={`text-xs ${getThresholdLabel(threshold).color}`}
            >
              {getThresholdLabel(threshold).label}
            </Badge>
          </button>

          {showStrictnessSlider && (
            <div className="mt-3 space-y-3">
              {/* Threshold slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Flexible</span>
                  <span className="font-medium">{threshold}</span>
                  <span>Strict</span>
                </div>
                <Slider
                  value={[threshold]}
                  onValueChange={(values) => setThreshold(values[0])}
                  min={0}
                  max={100}
                  step={5}
                  className="w-full"
                />
              </div>

              {/* Description of current level */}
              <div className="text-xs text-muted-foreground bg-slate-100 dark:bg-slate-800 rounded-md p-2">
                <span className="font-medium">{getThresholdLabel(threshold).label}:</span>{' '}
                {getThresholdLabel(threshold).description}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Driver Lists */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* PINNED: Selected Driver - Always show at top while selected */}
          {selectedDriverId && (() => {
            const pinnedDriver = drivers.find(d => d.id === selectedDriverId);
            if (!pinnedDriver) return null;

            // Get this driver's assignments and remaining matches
            const assignments = getAssignmentInfo(selectedDriverId);
            const assignedDates = new Set(assignments.map(a => a.serviceDate));
            const remainingMatches = getMatchingBlocks(selectedDriverId).filter(
              match => !assignedDates.has(match.occurrence.serviceDate)
            );
            const isAssigned = assignedDriverIds.has(selectedDriverId);

            return (
              <div className="mb-2">
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-purple-700 dark:text-purple-400">
                  <Sparkles className="w-4 h-4" />
                  <span>ACTIVE</span>
                </div>
                <div className="space-y-1">
                  <DraggableDriver
                    driver={pinnedDriver}
                    dnaProfile={dnaProfileMap.get(pinnedDriver.id)}
                    onHoverStart={onDriverHoverStart}
                    onHoverEnd={onDriverHoverEnd}
                    onSelect={onDriverSelect}
                    isSelected={true}
                    matchingBlocks={remainingMatches}
                    onBlockClick={onBlockClick}
                    onApplyBlocks={onApplyBlocks}
                    totalBlocksAnalyzed={unassignedOccurrences.length}
                  />
                  {isAssigned && assignments.length > 0 && (
                    <div className="pl-6 space-y-0.5">
                      <div className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                        {assignments.length} shift{assignments.length !== 1 ? 's' : ''} assigned
                      </div>
                      {assignments.slice(0, 2).map(assignment => (
                        <div key={assignment.occurrenceId} className="text-xs text-muted-foreground">
                          → {assignment.serviceDate.split('-').slice(1).join('/')} {assignment.startTime} ({assignment.tractorId})
                        </div>
                      ))}
                      {assignments.length > 2 && (
                        <div className="text-xs text-muted-foreground">+{assignments.length - 2} more</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Available Drivers */}
          <div>
            <button
              onClick={() => setShowAvailable(!showAvailable)}
              className="flex items-center justify-between w-full mb-2 text-sm font-semibold hover:text-primary transition-colors"
            >
              <div className="flex items-center gap-2">
                {showAvailable ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span>AVAILABLE</span>
                <Badge variant="secondary" className="text-xs">
                  {filteredAvailable.filter(d => d.id !== selectedDriverId).length}
                </Badge>
              </div>
            </button>

            {showAvailable && (
              <DroppableAvailableSection>
                {driversLoading ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Loading drivers...
                  </div>
                ) : filteredAvailable.filter(d => d.id !== selectedDriverId).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {searchQuery ? 'No matching drivers' : 'No available drivers'}
                  </div>
                ) : (
                  filteredAvailable.filter(d => d.id !== selectedDriverId).map(driver => (
                    <DraggableDriver
                      key={driver.id}
                      driver={driver}
                      dnaProfile={dnaProfileMap.get(driver.id)}
                      onHoverStart={onDriverHoverStart}
                      onHoverEnd={onDriverHoverEnd}
                      onSelect={onDriverSelect}
                      isSelected={selectedDriverId === driver.id}
                      matchingBlocks={getMatchingBlocks(driver.id)}
                      onBlockClick={onBlockClick}
                      onApplyBlocks={onApplyBlocks}
                      totalBlocksAnalyzed={unassignedOccurrences.length}
                    />
                  ))
                )}
              </DroppableAvailableSection>
            )}
          </div>

          {/* Assigned Drivers */}
          <div>
            <button
              onClick={() => setShowAssigned(!showAssigned)}
              className="flex items-center justify-between w-full mb-2 text-sm font-semibold hover:text-primary transition-colors"
            >
              <div className="flex items-center gap-2">
                {showAssigned ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span>ASSIGNED</span>
                <Badge variant="secondary" className="text-xs">
                  {filteredAssigned.filter(d => d.id !== selectedDriverId).length}
                </Badge>
              </div>
            </button>

            {showAssigned && (
              <div className="space-y-2">
                {filteredAssigned.filter(d => d.id !== selectedDriverId).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {searchQuery ? 'No matching drivers' : 'No assigned drivers'}
                  </div>
                ) : (
                  filteredAssigned.filter(d => d.id !== selectedDriverId).map(driver => {
                    const assignments = getAssignmentInfo(driver.id);
                    const counts = getAssignmentCounts(driver.id);

                    // Get matching blocks for this assigned driver
                    // But exclude dates they're already assigned to (one block per day rule)
                    const assignedDates = new Set(assignments.map(a => a.serviceDate));
                    const remainingMatches = getMatchingBlocks(driver.id).filter(
                      match => !assignedDates.has(match.occurrence.serviceDate)
                    );

                    // Build contract type summary
                    const typeParts: string[] = [];
                    if (counts.solo1 > 0) typeParts.push(`${counts.solo1} SOLO1`);
                    if (counts.solo2 > 0) typeParts.push(`${counts.solo2} SOLO2`);
                    if (counts.team > 0) typeParts.push(`${counts.team} TEAM`);
                    const typeSummary = typeParts.join(', ');

                    return (
                      <div key={driver.id} className="space-y-1">
                        <DraggableDriver
                          driver={driver}
                          dnaProfile={dnaProfileMap.get(driver.id)}
                          onHoverStart={onDriverHoverStart}
                          onHoverEnd={onDriverHoverEnd}
                          onSelect={onDriverSelect}
                          isSelected={selectedDriverId === driver.id}
                          matchingBlocks={remainingMatches} // Show remaining matches (excluding assigned dates)
                          onBlockClick={onBlockClick}
                          onApplyBlocks={onApplyBlocks}
                          totalBlocksAnalyzed={unassignedOccurrences.length}
                        />
                        <div className="text-xs text-blue-700 dark:text-blue-300 font-medium pl-6">
                          {counts.total} shift{counts.total !== 1 ? 's' : ''} ({typeSummary})
                        </div>
                        <div className="pl-6 space-y-0.5">
                          {assignments.slice(0, 3).map(assignment => (
                            <div key={assignment.occurrenceId} className="text-xs text-muted-foreground">
                              → {assignment.serviceDate.split('-').slice(1).join('/')} {assignment.startTime} ({assignment.tractorId}) {assignment.contractType?.toUpperCase()}
                            </div>
                          ))}
                          {assignments.length > 3 && (
                            <div className="text-xs text-muted-foreground">
                              +{assignments.length - 3} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Unavailable Drivers */}
          <div>
            <button
              onClick={() => setShowUnavailable(!showUnavailable)}
              className="flex items-center justify-between w-full mb-2 text-sm font-semibold hover:text-primary transition-colors"
            >
              <div className="flex items-center gap-2">
                {showUnavailable ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span>UNAVAILABLE</span>
                <Badge variant="secondary" className="text-xs">
                  {filteredUnavailable.length}
                </Badge>
              </div>
            </button>

            {showUnavailable && (
              <div className="space-y-1.5">
                {filteredUnavailable.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {searchQuery ? 'No matching drivers' : 'No unavailable drivers'}
                  </div>
                ) : (
                  filteredUnavailable.map(driver => (
                    <div key={driver.id} className="flex items-center gap-2 p-2 rounded-md bg-gray-100 dark:bg-gray-800 opacity-60">
                      <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {driver.firstName} {driver.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {driver.status !== 'active' ? driver.status : 'Not load eligible'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Auto-Match Preview Modal */}
      {previewData && (
        <AutoMatchPreviewModal
          isOpen={showPreviewModal}
          onClose={() => {
            setShowPreviewModal(false);
            setPreviewData(null);
          }}
          suggestions={previewData.suggestions}
          unassigned={previewData.unassigned}
          stats={previewData.stats}
        />
      )}
    </div>
  );
}

// Export the matching function and types for use in Schedules.tsx
export { calculateBlockMatch, timeToMinutes };
export type { BlockMatchResult, StrictnessLevel };
