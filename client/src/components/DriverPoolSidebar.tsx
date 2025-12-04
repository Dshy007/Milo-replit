import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { User, Search, ChevronDown, ChevronRight, Sparkles, ExternalLink, Calendar, Clock, Truck, Dna, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DNAPatternBadge } from "@/components/DNAPatternBadge";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";
import { useLocation } from "wouter";
import { getMatchColor } from "@/lib/utils";
import type { Driver, DriverDnaProfile } from "@shared/schema";

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
  onBlockClick?: (occurrenceId: string) => void;
}

// Draggable driver flip card component
function DraggableDriver({ driver, dnaProfile, onHoverStart, onHoverEnd, onSelect, isSelected, matchingBlocks = [], onBlockClick }: DraggableDriverProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const matchingBlockCount = matchingBlocks.length;
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
      setIsFlipped(!isFlipped);
      onSelect?.(driver.id);
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

  // Calculate height based on whether it's flipped and how many blocks to show
  const blocksToShow = Math.min(matchingBlocks.length, 4);
  const cardHeight = isFlipped
    ? (dnaProfile ? 120 + blocksToShow * 32 : 100) // Base height + blocks
    : 40;

  return (
    <div
      className="relative"
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
            absolute inset-0 p-2.5 rounded-lg overflow-hidden
            bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-950/40 dark:to-violet-950/40
            border-2 border-purple-400 dark:border-purple-600
            shadow-[0_0_20px_rgba(147,51,234,0.3)]
            cursor-pointer
          `}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
          onClick={handleClick}
        >
          {dnaProfile ? (
            <>
              {/* Compact header with DNA summary */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <DNAPatternBadge pattern={dnaProfile.patternGroup} size="sm" showIcon={false} />
                  <ContractTypeBadge contractType={dnaProfile.preferredContractType} size="sm" showIcon={false} />
                </div>
                <span className={`text-xs font-bold ${dnaProfile.consistencyScore ? getMatchColor(Math.round(Number(dnaProfile.consistencyScore) * 100)) : 'text-muted-foreground'}`}>
                  {dnaProfile.consistencyScore ? `${Math.round(Number(dnaProfile.consistencyScore) * 100)}%` : "—"}
                </span>
              </div>

              {/* DNA preference row */}
              <div className="flex items-center gap-2 text-[9px] text-muted-foreground mb-2 pb-1.5 border-b border-purple-200 dark:border-purple-700">
                <span className="flex items-center gap-0.5">
                  <Calendar className="w-2.5 h-2.5" />
                  {formatDays(dnaProfile.preferredDays)}
                </span>
                <span className="flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {dnaProfile.preferredStartTimes?.[0] || "Any"}
                </span>
              </div>

              {/* Matching Blocks List */}
              {matchingBlocks.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[9px] font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    Matching Blocks
                  </div>
                  {matchingBlocks.slice(0, 4).map(({ occurrence: occ, matchScore }) => {
                    const date = new Date(occ.serviceDate + 'T00:00:00');
                    const dayAbbrev = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
                    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
                    const scorePercent = Math.round(matchScore * 100);
                    const scoreColor = scorePercent >= 75 ? 'text-emerald-600 dark:text-emerald-400' :
                                       scorePercent >= 50 ? 'text-green-600 dark:text-green-400' :
                                       'text-lime-600 dark:text-lime-400';

                    return (
                      <button
                        key={occ.occurrenceId}
                        onClick={(e) => {
                          e.stopPropagation();
                          onBlockClick?.(occ.occurrenceId);
                        }}
                        className="w-full flex items-center justify-between px-1.5 py-1 rounded bg-white/60 dark:bg-slate-800/60 border border-purple-200 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors text-[10px]"
                      >
                        <span className="font-mono font-medium truncate">{occ.blockId}</span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span>{dayAbbrev} {dateStr}</span>
                          <span>@ {occ.startTime}</span>
                          <span className={`font-bold ${scoreColor}`}>{scorePercent}%</span>
                        </span>
                      </button>
                    );
                  })}
                  {matchingBlocks.length > 4 && (
                    <div className="text-[9px] text-center text-muted-foreground">
                      +{matchingBlocks.length - 4} more
                    </div>
                  )}
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
  onBlockClick?: (occurrenceId: string) => void;
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
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Calculate match score between a block and a DNA profile
// "Holy Grail" approach: Day + Time + Contract Type MUST all match
// Returns 1.0 (100%) if all match, 0 if any fails
function calculateBlockMatch(
  occurrence: ShiftOccurrence,
  dnaProfile: DriverDnaProfile,
  debug: boolean = false
): number {
  // REQUIRED: Contract type must match
  const driverContract = dnaProfile.preferredContractType?.toLowerCase();
  const blockContract = occurrence.contractType?.toLowerCase();

  if (driverContract && blockContract && driverContract !== blockContract) {
    if (debug) {
      console.log('[DNA MATCH] Contract mismatch - block rejected', {
        blockId: occurrence.blockId,
        blockContract: blockContract,
        driverContract: driverContract,
      });
    }
    return 0;
  }

  // Get day of week from service date (lowercase full day names to match DB format)
  const date = new Date(occurrence.serviceDate + 'T00:00:00');
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = days[date.getDay()];

  // REQUIRED: Day must match exactly
  const preferredDays = dnaProfile.preferredDays || [];
  const dayMatches = preferredDays.some(d => d.toLowerCase() === dayOfWeek);

  if (!dayMatches) {
    if (debug) {
      console.log('[DNA MATCH] Day mismatch - block rejected', {
        blockId: occurrence.blockId,
        blockDay: dayOfWeek,
        profileDays: preferredDays,
      });
    }
    return 0;
  }

  // REQUIRED: Time must be within ±2 hours of preferred start time
  const preferredTimes = dnaProfile.preferredStartTimes || [];
  const blockTimeMinutes = timeToMinutes(occurrence.startTime);

  let bestTimeDiff = Infinity;
  for (const prefTime of preferredTimes) {
    const prefMinutes = timeToMinutes(prefTime);
    const diff = Math.abs(blockTimeMinutes - prefMinutes);
    // Handle wraparound for overnight times
    const wrapDiff = Math.min(diff, 1440 - diff);
    bestTimeDiff = Math.min(bestTimeDiff, wrapDiff);
  }

  const timeMatches = bestTimeDiff <= 120; // Within 2 hours

  if (!timeMatches) {
    if (debug) {
      console.log('[DNA MATCH] Time mismatch - block rejected', {
        blockId: occurrence.blockId,
        blockTime: occurrence.startTime,
        profileTimes: preferredTimes,
        timeDiffMinutes: bestTimeDiff,
      });
    }
    return 0;
  }

  // All criteria match - valid match!
  if (debug) {
    console.log('[DNA MATCH] Valid match found!', {
      blockId: occurrence.blockId,
      blockDay: dayOfWeek,
      blockTime: occurrence.startTime,
      blockContract: blockContract,
      timeDiffMinutes: bestTimeDiff,
    });
  }

  return 1.0; // 100% match
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
}: DriverPoolSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAvailable, setShowAvailable] = useState(true);
  const [showAssigned, setShowAssigned] = useState(true);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [contractFilter, setContractFilter] = useState<'all' | 'solo1' | 'solo2'>('all');

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
  // Returns ONE block per preferred day (driver can only work one block per day)
  const getMatchingBlocks = (driverId: string): MatchingBlock[] => {
    const profile = dnaProfileMap.get(driverId);
    if (!profile) {
      return [];
    }

    const allMatches = unassignedOccurrences
      .map(occ => ({
        occurrence: occ,
        matchScore: calculateBlockMatch(occ, profile, false),
      }))
      .filter(item => item.matchScore > 0) // Only blocks that match all criteria
      .sort((a, b) => {
        // Sort by date first, then by how close to preferred time
        const dateCompare = a.occurrence.serviceDate.localeCompare(b.occurrence.serviceDate);
        if (dateCompare !== 0) return dateCompare;
        // For same date, prefer time closest to preferred start time
        const prefTimes = profile.preferredStartTimes || [];
        const prefMinutes = prefTimes.length > 0 ? timeToMinutes(prefTimes[0]) : 0;
        const aDiff = Math.abs(timeToMinutes(a.occurrence.startTime) - prefMinutes);
        const bDiff = Math.abs(timeToMinutes(b.occurrence.startTime) - prefMinutes);
        return aDiff - bDiff;
      });

    // ONE block per day - pick the best match for each unique date
    const seenDates = new Set<string>();
    const onePerDay: MatchingBlock[] = [];

    for (const match of allMatches) {
      const date = match.occurrence.serviceDate;
      if (!seenDates.has(date)) {
        seenDates.add(date);
        onePerDay.push(match);
      }
    }

    // Apply contract-type specific caps based on scheduling rules:
    // - Solo2: MAX 3 blocks per week (38hr reset rule within rolling 6-day period)
    // - Solo1: More flexible, but typically 4-5 per week
    // - Team: 3 per week
    const contractType = profile.preferredContractType?.toLowerCase();
    let maxBlocksPerWeek = 5; // Default for Solo1

    if (contractType === 'solo2') {
      maxBlocksPerWeek = 3; // Solo2 drivers: 38hr reset rule limits to 3 per week
    } else if (contractType === 'team') {
      maxBlocksPerWeek = 3;
    }

    return onePerDay.slice(0, maxBlocksPerWeek);
  };

  return (
    <div className="w-[360px] border-r bg-card flex flex-col h-full overflow-visible">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold mb-3">Driver Pool</h2>

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
      </div>

      {/* Driver Lists */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
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
                  {filteredAvailable.length}
                </Badge>
              </div>
            </button>

            {showAvailable && (
              <DroppableAvailableSection>
                {driversLoading ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Loading drivers...
                  </div>
                ) : filteredAvailable.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {searchQuery ? 'No matching drivers' : 'No available drivers'}
                  </div>
                ) : (
                  filteredAvailable.map(driver => (
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
                  {filteredAssigned.length}
                </Badge>
              </div>
            </button>

            {showAssigned && (
              <div className="space-y-2">
                {filteredAssigned.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {searchQuery ? 'No matching drivers' : 'No assigned drivers'}
                  </div>
                ) : (
                  filteredAssigned.map(driver => {
                    const assignments = getAssignmentInfo(driver.id);
                    const counts = getAssignmentCounts(driver.id);

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
                          matchingBlocks={[]} // Assigned drivers don't show matches
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
    </div>
  );
}

// Export the matching function for use in Schedules.tsx
export { calculateBlockMatch, timeToMinutes };
