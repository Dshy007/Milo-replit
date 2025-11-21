import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { User, Search, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Driver } from "@shared/schema";

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

// Draggable driver chip component
function DraggableDriver({ driver }: { driver: Driver }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `driver-${driver.id}`,
    data: {
      type: 'driver',
      driver,
    },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted cursor-grab active:cursor-grabbing transition-colors"
    >
      <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span className="text-sm font-medium truncate">
        {driver.firstName} {driver.lastName}
      </span>
    </div>
  );
}

interface DriverPoolSidebarProps {
  currentWeekStart: Date;
  currentWeekEnd: Date;
}

// Droppable zone for Available Drivers section
function DroppableAvailableSection({ children }: { children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'available-drivers-pool',
  });

  return (
    <div
      ref={setNodeRef}
      className={`space-y-1.5 rounded-md transition-all ${
        isOver
          ? 'bg-green-50 dark:bg-green-950/20 ring-2 ring-green-400 dark:ring-green-600 shadow-[0_0_12px_rgba(34,197,94,0.4)]'
          : ''
      }`}
    >
      {children}
    </div>
  );
}

export function DriverPoolSidebar({ currentWeekStart, currentWeekEnd }: DriverPoolSidebarProps) {
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

  return (
    <div className="w-80 border-r bg-card flex flex-col h-full">
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
        <div className="p-4 space-y-4">
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
                    <DraggableDriver key={driver.id} driver={driver} />
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
                        <div className="flex flex-col gap-1 p-2 rounded-md bg-blue-50 dark:bg-blue-950/30">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            <span className="text-sm font-medium truncate">
                              {driver.firstName} {driver.lastName}
                            </span>
                          </div>
                          <div className="text-xs text-blue-700 dark:text-blue-300 font-medium pl-6">
                            {counts.total} shift{counts.total !== 1 ? 's' : ''} ({typeSummary})
                          </div>
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
