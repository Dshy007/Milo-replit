import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { User, Search, ChevronDown, ChevronRight, Sparkles, ExternalLink, Calendar, Clock, Truck, Dna } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DNAPatternBadge } from "@/components/DNAPatternBadge";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";
import { useLocation } from "wouter";
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

interface DraggableDriverProps {
  driver: Driver;
  dnaProfile?: DriverDnaProfile | null;
  onHoverStart?: (driverId: string) => void;
  onHoverEnd?: () => void;
  onSelect?: (driverId: string) => void;
  isSelected?: boolean;
  matchingBlockCount?: number;
}

// Draggable driver flip card component
function DraggableDriver({ driver, dnaProfile, onHoverStart, onHoverEnd, onSelect, isSelected, matchingBlockCount }: DraggableDriverProps) {
  const [isFlipped, setIsFlipped] = useState(false);
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

  // Format day names for display
  const formatDays = (days: string[] | null | undefined) => {
    if (!days || days.length === 0) return "Any";
    return days.map(d => d.slice(0, 3)).join(", ");
  };

  // Calculate height based on whether it's flipped
  const cardHeight = isFlipped ? (dnaProfile ? 160 : 100) : 40;

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
        {/* FRONT FACE - Compact driver chip */}
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

        {/* BACK FACE - Profile details */}
        <div
          className={`
            absolute inset-0 p-3 rounded-lg overflow-hidden
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
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                <User className="w-3 h-3 text-white" />
              </div>
              <span className="font-semibold text-xs truncate">{driver.firstName} {driver.lastName}</span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <DNAPatternBadge pattern={dnaProfile?.patternGroup} size="sm" showIcon={false} />
              <ContractTypeBadge contractType={dnaProfile?.preferredContractType} size="sm" showIcon={false} />
            </div>
          </div>

          {dnaProfile ? (
            <>
              {/* Quick Stats */}
              <div className="space-y-1 text-[10px] mb-2">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="w-3 h-3 text-purple-500 flex-shrink-0" />
                  <span className="truncate">{formatDays(dnaProfile.preferredDays)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3 h-3 text-purple-500 flex-shrink-0" />
                  <span className="truncate">{dnaProfile.preferredStartTimes?.slice(0, 2).join(", ") || "Any time"}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Truck className="w-3 h-3 text-purple-500 flex-shrink-0" />
                  <span className="truncate">{dnaProfile.preferredTractors?.slice(0, 2).join(", ") || "Any tractor"}</span>
                </div>
              </div>

              {/* AI Summary snippet */}
              {dnaProfile.aiSummary && (
                <div className="text-[9px] text-muted-foreground italic line-clamp-2 mb-1 border-t border-purple-200 dark:border-purple-800 pt-1">
                  {dnaProfile.aiSummary}
                </div>
              )}

              {/* Match count and score */}
              <div className="flex items-center justify-between text-[10px] border-t border-purple-200 dark:border-purple-800 pt-1">
                {matchingBlockCount !== undefined && matchingBlockCount > 0 ? (
                  <div className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                    <Sparkles className="w-3 h-3" />
                    <span className="font-medium">{matchingBlockCount} matches</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">No matches</span>
                )}
                <span className="font-bold text-purple-600">
                  {dnaProfile.consistencyScore ? `${Math.round(Number(dnaProfile.consistencyScore) * 100)}%` : "—"}
                </span>
              </div>
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
function calculateBlockMatch(
  occurrence: ShiftOccurrence,
  dnaProfile: DriverDnaProfile,
  debug: boolean = false
): number {
  let score = 0;

  // Get day of week from service date (lowercase full day names to match DB format)
  const date = new Date(occurrence.serviceDate + 'T00:00:00');
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = days[date.getDay()];

  // Day match (40% weight)
  const preferredDays = dnaProfile.preferredDays || [];
  // Check both exact match and case-insensitive match for robustness
  const dayMatches = preferredDays.some(d => d.toLowerCase() === dayOfWeek);
  if (dayMatches) {
    score += 0.4;
  }

  // Time match (35% weight) - check if within 2 hours of preferred
  const preferredTimes = dnaProfile.preferredStartTimes || [];
  const blockTimeMinutes = timeToMinutes(occurrence.startTime);
  const timeMatches = preferredTimes.some((prefTime: string) => {
    const prefMinutes = timeToMinutes(prefTime);
    const diff = Math.abs(blockTimeMinutes - prefMinutes);
    // Handle wraparound for overnight times
    const wrapDiff = Math.min(diff, 1440 - diff);
    return wrapDiff <= 120; // Within 2 hours
  });
  if (timeMatches) {
    score += 0.35;
  }

  // Tractor match (25% weight)
  const preferredTractors = dnaProfile.preferredTractors || [];
  const tractorMatches = occurrence.tractorId && preferredTractors.includes(occurrence.tractorId);
  if (tractorMatches) {
    score += 0.25;
  }

  // Contract type bonus (+10% if matches, capped at 100%)
  const contractMatches = dnaProfile.preferredContractType && occurrence.contractType &&
    dnaProfile.preferredContractType.toLowerCase() === occurrence.contractType.toLowerCase();
  if (contractMatches) {
    score = Math.min(1.0, score + 0.1);
  }

  // Debug logging - now includes all match results and final score
  if (debug) {
    console.log('[DNA MATCH DEBUG]', {
      blockId: occurrence.blockId,
      blockDate: occurrence.serviceDate,
      blockDay: dayOfWeek,
      blockTime: occurrence.startTime,
      blockTractor: occurrence.tractorId,
      blockContract: occurrence.contractType,
      profileDays: preferredDays,
      profileTimes: dnaProfile.preferredStartTimes,
      profileTractors: dnaProfile.preferredTractors,
      profileContract: dnaProfile.preferredContractType,
      matches: { dayMatches, timeMatches, tractorMatches, contractMatches },
      finalScore: score,
      scoreBreakdown: `Day(${dayMatches ? 0.4 : 0}) + Time(${timeMatches ? 0.35 : 0}) + Tractor(${tractorMatches ? 0.25 : 0}) + Contract(${contractMatches ? 0.1 : 0})`,
    });
  }

  return score;
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
}: DriverPoolSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAvailable, setShowAvailable] = useState(true);
  const [showAssigned, setShowAssigned] = useState(true);
  const [showUnavailable, setShowUnavailable] = useState(false);

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

  // Filter by search query
  const filterDrivers = (driverList: Driver[]) => {
    if (!searchQuery) return driverList;
    const query = searchQuery.toLowerCase();
    return driverList.filter(d =>
      `${d.firstName} ${d.lastName}`.toLowerCase().includes(query)
    );
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

  // Calculate matching block count for a driver
  const getMatchingBlockCount = (driverId: string): number => {
    const profile = dnaProfileMap.get(driverId);
    if (!profile) {
      console.log('[SIDEBAR MATCH] No profile for driver:', driverId);
      return 0;
    }

    console.log('[SIDEBAR MATCH] Calculating for driver:', driverId, {
      unassignedCount: unassignedOccurrences.length,
      profileDays: profile.preferredDays,
      profileTimes: profile.preferredStartTimes,
      profileTractors: profile.preferredTractors,
    });

    const matches = unassignedOccurrences.filter(occ => {
      const score = calculateBlockMatch(occ, profile, true); // Enable debug
      console.log('[SIDEBAR MATCH] Block:', occ.blockId, 'Score:', score);
      return score >= 0.5; // Count blocks with 50%+ match
    });

    console.log('[SIDEBAR MATCH] Total matches for', driverId, ':', matches.length);
    return matches.length;
  };

  return (
    <div className="w-[360px] border-r bg-card flex flex-col h-full overflow-visible">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold mb-3">Driver Pool</h2>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search drivers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
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
                      matchingBlockCount={getMatchingBlockCount(driver.id)}
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
