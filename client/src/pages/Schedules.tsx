import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, addWeeks, addMonths, subWeeks, subMonths, isSameDay, isToday, parseISO, isSameMonth } from "date-fns";
import { Calendar, ChevronLeft, ChevronRight, Filter, User, AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Block, BlockAssignment, Driver } from "@shared/schema";

type BlockWithAssignment = Block & {
  assignment?: BlockAssignment & { driver?: Driver };
};

type ViewMode = "week" | "month";
type SoloTypeFilter = "all" | "solo1" | "solo2" | "team";
type StatusFilter = "all" | "valid" | "warning" | "violation" | "unassigned";

export default function Schedules() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedBlock, setSelectedBlock] = useState<BlockWithAssignment | null>(null);
  const [soloTypeFilter, setSoloTypeFilter] = useState<SoloTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedDrivers, setSelectedDrivers] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Fetch blocks
  const { data: blocks = [] } = useQuery<Block[]>({
    queryKey: ["/api/blocks"],
  });

  // Fetch block assignments with driver details
  const { data: assignments = [] } = useQuery<(BlockAssignment & { driver?: Driver })[]>({
    queryKey: ["/api/block-assignments"],
    select: (data: any) => data,
  });

  // Fetch drivers for filters
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Combine blocks with their assignments
  const blocksWithAssignments: BlockWithAssignment[] = useMemo(() => {
    return blocks.map(block => {
      const assignment = assignments.find(a => a.blockId === block.id);
      if (assignment) {
        const driver = drivers.find(d => d.id === assignment.driverId);
        return { ...block, assignment: { ...assignment, driver } };
      }
      return block;
    });
  }, [blocks, assignments, drivers]);

  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    if (viewMode === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn: 0 });
      const end = endOfWeek(currentDate, { weekStartsOn: 0 });
      return { start, end, days: eachDayOfInterval({ start, end }) };
    } else {
      // For month view, pad to full weeks with minimum 5 weeks (35 days) for consistent UI height
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      let start = startOfWeek(monthStart, { weekStartsOn: 0 });
      let end = endOfWeek(monthEnd, { weekStartsOn: 0 });
      
      // Ensure at least 5 weeks (35 days) are displayed for consistent grid height
      const days = eachDayOfInterval({ start, end });
      if (days.length < 35) {
        // Extend to 35 days by adding a week at the end
        end = addWeeks(end, 1);
      }
      
      return { start, end, days: eachDayOfInterval({ start, end }) };
    }
  }, [currentDate, viewMode]);

  // Filter blocks by date range and filters
  const filteredBlocks = useMemo(() => {
    return blocksWithAssignments.filter(block => {
      const blockDate = parseISO(block.startTimestamp as any);
      const inRange = blockDate >= dateRange.start && blockDate <= dateRange.end;
      if (!inRange) return false;

      // Solo type filter
      if (soloTypeFilter !== "all") {
        const normalizedSolo = block.soloType.toLowerCase().replace(/\s+/g, "");
        if (normalizedSolo !== soloTypeFilter) return false;
      }

      // Status filter
      if (statusFilter !== "all") {
        if (statusFilter === "unassigned" && block.assignment) return false;
        if (statusFilter !== "unassigned" && !block.assignment) return false;
        if (block.assignment && statusFilter !== "unassigned") {
          if (block.assignment.validationStatus !== statusFilter) return false;
        }
      }

      // Driver filter: If specific drivers selected, hide unassigned blocks
      if (selectedDrivers.size > 0) {
        if (!block.assignment) return false; // Hide unassigned blocks
        if (!selectedDrivers.has(block.assignment.driverId)) return false;
      }

      return true;
    });
  }, [blocksWithAssignments, dateRange, soloTypeFilter, statusFilter, selectedDrivers]);

  // Group blocks by day
  const blocksByDay = useMemo(() => {
    const grouped: Record<string, BlockWithAssignment[]> = {};
    dateRange.days.forEach(day => {
      const dayKey = format(day, "yyyy-MM-dd");
      grouped[dayKey] = filteredBlocks.filter(block => {
        const blockDate = parseISO(block.startTimestamp as any);
        return isSameDay(blockDate, day);
      }).sort((a, b) => {
        const aTime = parseISO(a.startTimestamp as any).getTime();
        const bTime = parseISO(b.startTimestamp as any).getTime();
        return aTime - bTime;
      });
    });
    return grouped;
  }, [dateRange.days, filteredBlocks]);

  // Navigation handlers
  const handlePrevious = () => {
    if (viewMode === "week") {
      setCurrentDate(subWeeks(currentDate, 1));
    } else {
      setCurrentDate(subMonths(currentDate, 1));
    }
  };

  const handleNext = () => {
    if (viewMode === "week") {
      setCurrentDate(addWeeks(currentDate, 1));
    } else {
      setCurrentDate(addMonths(currentDate, 1));
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Helper functions
  const getSoloTypeColor = (soloType: string) => {
    const normalized = soloType.toLowerCase().replace(/\s+/g, "");
    switch (normalized) {
      case "solo1":
        return "bg-blue-500/20 border-blue-500 text-blue-700 dark:text-blue-300";
      case "solo2":
        return "bg-purple-500/20 border-purple-500 text-purple-700 dark:text-purple-300";
      case "team":
        return "bg-green-500/20 border-green-500 text-green-700 dark:text-green-300";
      default:
        return "bg-gray-500/20 border-gray-500 text-gray-700 dark:text-gray-300";
    }
  };

  const getStatusIcon = (block: BlockWithAssignment) => {
    if (!block.assignment) {
      return <AlertCircle className="w-3 h-3 text-muted-foreground" />;
    }
    const status = block.assignment.validationStatus;
    switch (status) {
      case "valid":
        return <CheckCircle2 className="w-3 h-3 text-green-600" />;
      case "warning":
        return <AlertTriangle className="w-3 h-3 text-yellow-600" />;
      case "violation":
        return <AlertCircle className="w-3 h-3 text-red-600" />;
      default:
        return <AlertCircle className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const toggleDriverFilter = (driverId: string) => {
    setSelectedDrivers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(driverId)) {
        newSet.delete(driverId);
      } else {
        newSet.add(driverId);
      }
      return newSet;
    });
  };

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <Calendar className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
              Block Schedule
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
              {format(dateRange.start, "MMM d")} - {format(dateRange.end, "MMM d, yyyy")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>
          
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === "week" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("week")}
              className="rounded-r-none"
              data-testid="button-week-view"
            >
              Week
            </Button>
            <Button
              variant={viewMode === "month" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("month")}
              className="rounded-l-none"
              data-testid="button-month-view"
            >
              Month
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrevious}
              data-testid="button-previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              data-testid="button-today"
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              data-testid="button-next"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Solo Type Filter */}
              <div className="space-y-2">
                <Label>Solo Type</Label>
                <Select value={soloTypeFilter} onValueChange={(v: SoloTypeFilter) => setSoloTypeFilter(v)}>
                  <SelectTrigger data-testid="select-solo-type-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="solo1">Solo 1</SelectItem>
                    <SelectItem value="solo2">Solo 2</SelectItem>
                    <SelectItem value="team">Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status Filter */}
              <div className="space-y-2">
                <Label>Compliance Status</Label>
                <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
                  <SelectTrigger data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="valid">Valid</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="violation">Violation</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Driver Filter */}
            <div className="space-y-2">
              <Label>Drivers ({selectedDrivers.size} selected)</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto p-2 border rounded-md">
                {drivers.map(driver => (
                  <div key={driver.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`driver-${driver.id}`}
                      checked={selectedDrivers.has(driver.id)}
                      onCheckedChange={() => toggleDriverFilter(driver.id)}
                      data-testid={`checkbox-driver-${driver.id}`}
                    />
                    <Label htmlFor={`driver-${driver.id}`} className="text-sm cursor-pointer">
                      {driver.firstName} {driver.lastName}
                    </Label>
                  </div>
                ))}
              </div>
              {selectedDrivers.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDrivers(new Set())}
                  data-testid="button-clear-drivers"
                >
                  Clear Selection
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border bg-blue-500/20 border-blue-500"></div>
          <span className="text-muted-foreground">Solo 1 (14h)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border bg-purple-500/20 border-purple-500"></div>
          <span className="text-muted-foreground">Solo 2 (38h)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border bg-green-500/20 border-green-500"></div>
          <span className="text-muted-foreground">Team</span>
        </div>
        <div className="h-4 w-px bg-border"></div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <span className="text-muted-foreground">Valid</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          <span className="text-muted-foreground">Warning (90%+)</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <span className="text-muted-foreground">Violation</span>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto">
        <div className={`grid ${viewMode === "week" ? "grid-cols-7" : "grid-cols-7"} gap-2`}>
          {/* Day Headers - Fixed weekday order */}
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, idx) => (
            <div
              key={idx}
              className="text-center font-medium text-sm text-muted-foreground p-2 border-b"
              data-testid={`day-header-${idx}`}
            >
              {day}
            </div>
          ))}

          {/* Day Cells */}
          {dateRange.days.map((day) => {
            const dayKey = format(day, "yyyy-MM-dd");
            const dayBlocks = blocksByDay[dayKey] || [];
            const isCurrentDay = isToday(day);

            const isCurrentMonth = viewMode === "month" && isSameMonth(day, currentDate);
            const opacity = viewMode === "month" && !isCurrentMonth ? "opacity-40" : "";

            return (
              <Card
                key={dayKey}
                className={`min-h-32 ${isCurrentDay ? "ring-2 ring-primary" : ""} ${opacity}`}
                data-testid={`day-cell-${dayKey}`}
              >
                <CardHeader className="p-2">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${isCurrentDay ? "text-primary" : "text-foreground"}`}>
                      {format(day, "d")}
                    </span>
                    {dayBlocks.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {dayBlocks.length}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-2 space-y-1">
                  {dayBlocks.slice(0, 5).map((block) => (
                    <button
                      key={block.id}
                      onClick={() => setSelectedBlock(block)}
                      className={`w-full text-left p-2 rounded border text-xs hover-elevate transition-all ${getSoloTypeColor(block.soloType)}`}
                      data-testid={`block-${block.id}`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-medium truncate">{block.blockId}</span>
                        {getStatusIcon(block)}
                      </div>
                      <div className="text-xs opacity-80">
                        {format(parseISO(block.startTimestamp as any), "HH:mm")}
                      </div>
                      {block.assignment?.driver && (
                        <div className="flex items-center gap-1 mt-1 text-xs opacity-70">
                          <User className="w-3 h-3" />
                          <span className="truncate">
                            {block.assignment.driver.firstName} {block.assignment.driver.lastName}
                          </span>
                        </div>
                      )}
                    </button>
                  ))}
                  {dayBlocks.length > 5 && (
                    <div className="text-xs text-center text-muted-foreground">
                      +{dayBlocks.length - 5} more
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Block Detail Modal */}
      <Dialog open={!!selectedBlock} onOpenChange={(open) => !open && setSelectedBlock(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-block-detail">
          <DialogHeader>
            <DialogTitle>Block Details</DialogTitle>
            <DialogDescription>
              Viewing details for {selectedBlock?.blockId}
            </DialogDescription>
          </DialogHeader>

          {selectedBlock && (
            <div className="space-y-4">
              {/* Block Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Block ID</Label>
                  <div className="font-medium">{selectedBlock.blockId}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Solo Type</Label>
                  <div>
                    <Badge className={getSoloTypeColor(selectedBlock.soloType)}>
                      {selectedBlock.soloType.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Start Time</Label>
                  <div className="font-medium">
                    {format(parseISO(selectedBlock.startTimestamp as any), "MMM d, yyyy HH:mm")}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">End Time</Label>
                  <div className="font-medium">
                    {format(parseISO(selectedBlock.endTimestamp as any), "MMM d, yyyy HH:mm")}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Duration</Label>
                  <div className="font-medium">{selectedBlock.duration} hours</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Tractor</Label>
                  <div className="font-medium">{selectedBlock.tractorId}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div>
                    <Badge variant={selectedBlock.status === "assigned" ? "default" : "secondary"}>
                      {selectedBlock.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Assignment Info */}
              {selectedBlock.assignment ? (
                <div className="border-t pt-4 space-y-4">
                  <h3 className="font-semibold">Assignment Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Driver</Label>
                      <div className="font-medium">
                        {selectedBlock.assignment.driver
                          ? `${selectedBlock.assignment.driver.firstName} ${selectedBlock.assignment.driver.lastName}`
                          : "Unknown"}
                      </div>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Validation Status</Label>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(selectedBlock)}
                        <Badge
                          variant={
                            selectedBlock.assignment.validationStatus === "valid"
                              ? "default"
                              : selectedBlock.assignment.validationStatus === "warning"
                              ? "secondary"
                              : "destructive"
                          }
                        >
                          {selectedBlock.assignment.validationStatus}
                        </Badge>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-muted-foreground">Assigned At</Label>
                      <div className="font-medium">
                        {format(parseISO(selectedBlock.assignment.assignedAt as any), "MMM d, yyyy HH:mm")}
                      </div>
                    </div>
                  </div>

                  {/* Validation Summary */}
                  {selectedBlock.assignment.validationSummary && (
                    <div>
                      <Label className="text-muted-foreground">Compliance Summary</Label>
                      <div className="mt-2 p-3 bg-muted/50 rounded-md text-sm">
                        <pre className="whitespace-pre-wrap font-mono text-xs">
                          {JSON.stringify(JSON.parse(selectedBlock.assignment.validationSummary), null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {selectedBlock.assignment.notes && (
                    <div>
                      <Label className="text-muted-foreground">Notes</Label>
                      <div className="mt-1 text-sm">{selectedBlock.assignment.notes}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="border-t pt-4">
                  <p className="text-muted-foreground text-sm">This block has not been assigned to a driver yet.</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
