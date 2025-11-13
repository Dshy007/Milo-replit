import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, addWeeks, addMonths, subWeeks, subMonths, isSameDay, isToday, parseISO, isSameMonth, differenceInHours, differenceInMinutes } from "date-fns";
import { Calendar, ChevronLeft, ChevronRight, Filter, User, AlertTriangle, CheckCircle2, AlertCircle, GripVertical, X, Search, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Block, BlockAssignment, Driver, Contract } from "@shared/schema";

type BlockWithAssignment = Block & {
  assignment?: BlockAssignment & { driver?: Driver };
  contract?: Contract;
};

type ViewMode = "week" | "month" | "tally";
type DisplayMode = "calendar" | "list";
type SoloTypeFilter = "all" | "solo1" | "solo2" | "team";
type StatusFilter = "all" | "valid" | "warning" | "violation" | "unassigned";

// Calendar API response type
type CalendarResponse = {
  dateRange: { start: string; end: string };
  blocks: Array<Block & {
    contract: Contract | null;
    assignment: (BlockAssignment & { driver: Driver | null }) | null;
  }>;
  drivers: Record<string, Driver>;
  contracts: Record<string, Contract>;
};

// Hook for fetching calendar data from new combined endpoint
function useCalendarData(startDate: Date, endDate: Date, enabled: boolean = true) {
  const startDateStr = format(startDate, "yyyy-MM-dd");
  const endDateStr = format(endDate, "yyyy-MM-dd");
  
  return useQuery<CalendarResponse>({
    queryKey: ["/api/schedules/calendar", startDateStr, endDateStr],
    queryFn: async () => {
      const url = `/api/schedules/calendar?startDate=${startDateStr}&endDate=${endDateStr}`;
      const res = await fetch(url, { credentials: "include" });
      
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      
      return await res.json();
    },
    enabled,
  });
}

// Hook for countdown timer that updates every minute
function useCountdown(targetDate: Date) {
  const [countdown, setCountdown] = useState("");
  
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const diffMs = targetDate.getTime() - now.getTime();
      
      if (diffMs < 0) {
        setCountdown("Started");
        return;
      }
      
      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        setCountdown(`Starts in ${days}d ${remainingHours}h`);
      } else if (hours > 0) {
        setCountdown(`Starts in ${hours}h ${minutes}m`);
      } else {
        setCountdown(`Starts in ${minutes}m`);
      }
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute
    
    return () => clearInterval(interval);
  }, [targetDate]);
  
  return countdown;
}

// Block List View Component
function BlockListView({ 
  blocks, 
  drivers,
  onBlockSelect,
  getBlockCompliance
}: { 
  blocks: BlockWithAssignment[],
  drivers: Driver[],
  onBlockSelect: (block: BlockWithAssignment) => void,
  getBlockCompliance: (block: BlockWithAssignment) => { status: string; hoursRemaining: number } | null
}) {
  // Sort blocks chronologically
  const sortedBlocks = useMemo(() => {
    return [...blocks].sort((a, b) => 
      new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime()
    );
  }, [blocks]);

  if (sortedBlocks.length === 0) {
    return (
      <Card className="flex items-center justify-center py-12">
        <CardContent>
          <p className="text-muted-foreground">No blocks found for the selected filters.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {sortedBlocks.map(block => (
        <BlockListItem 
          key={block.id} 
          block={block} 
          drivers={drivers}
          onSelect={() => onBlockSelect(block)}
          compliance={getBlockCompliance(block)}
        />
      ))}
    </div>
  );
}

// Individual block list item component
function BlockListItem({ 
  block, 
  drivers,
  onSelect,
  compliance
}: { 
  block: BlockWithAssignment,
  drivers: Driver[],
  onSelect: () => void,
  compliance: { status: string; hoursRemaining: number } | null
}) {
  const countdown = useCountdown(new Date(block.startTimestamp));
  const startTime = new Date(block.startTimestamp);
  const endTime = new Date(block.endTimestamp);
  const durationHours = differenceInHours(endTime, startTime);
  const durationMinutes = differenceInMinutes(endTime, startTime) % 60;
  
  // Determine block type color
  const getBlockTypeColor = (soloType: string) => {
    const normalized = soloType.toLowerCase().replace(/\s+/g, "");
    if (normalized === "solo1") return "bg-blue-500/20 border-blue-500";
    if (normalized === "solo2") return "bg-purple-500/20 border-purple-500";
    if (normalized === "team") return "bg-green-500/20 border-green-500";
    return "bg-gray-500/20 border-gray-500";
  };
  
  // Compliance status icon
  const ComplianceIcon = () => {
    if (!compliance) return null;
    
    if (compliance.status === "valid") {
      return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    } else if (compliance.status === "warning") {
      return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    } else if (compliance.status === "violation") {
      return <AlertCircle className="w-4 h-4 text-red-600" />;
    }
    return null;
  };

  return (
    <Card 
      className="hover-elevate cursor-pointer" 
      onClick={onSelect}
      data-testid={`block-list-item-${block.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Block Details */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`${getBlockTypeColor(block.soloType)} font-medium`}>
                {block.soloType}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs">
                {block.locationCode}
              </Badge>
              {block.assignment?.driver && (
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {block.assignment.driver.firstName} {block.assignment.driver.lastName}
                  </span>
                  <ComplianceIcon />
                </div>
              )}
              {!block.assignment && (
                <Badge variant="secondary">Unassigned</Badge>
              )}
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                <span>{format(startTime, "MMM d, yyyy")}</span>
              </div>
              <div>
                {format(startTime, "h:mm a")} - {format(endTime, "h:mm a")}
              </div>
              <div>
                {durationHours}h {durationMinutes > 0 ? `${durationMinutes}m` : ""}
              </div>
            </div>
            
            {block.contract && (
              <p className="text-xs text-muted-foreground">
                Contract: {block.contract.customerName}
              </p>
            )}
          </div>
          
          {/* Right: Countdown */}
          <div className="text-right">
            <div className="text-sm font-semibold text-primary">
              {countdown}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Block #{block.id.slice(0, 8)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Schedules() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    // Load from localStorage (guard against SSR/non-browser contexts)
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem("schedules-display-mode");
      return (saved === "list" || saved === "calendar") ? saved : "calendar";
    }
    return "calendar";
  });
  const [selectedBlock, setSelectedBlock] = useState<BlockWithAssignment | null>(null);
  const [soloTypeFilter, setSoloTypeFilter] = useState<SoloTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedDrivers, setSelectedDrivers] = useState<Set<string>>(new Set());
  const [draggedBlock, setDraggedBlock] = useState<BlockWithAssignment | null>(null);
  const [dragOverDriver, setDragOverDriver] = useState<string | null>(null);
  const [validationFeedback, setValidationFeedback] = useState<{ status: string; messages: string[] } | null>(null);
  const [reassignDriverId, setReassignDriverId] = useState<string>("");
  const [driverSearch, setDriverSearch] = useState<string>("");
  const { toast } = useToast();

  // Save displayMode to localStorage (guard against SSR/non-browser contexts)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem("schedules-display-mode", displayMode);
    }
  }, [displayMode]);

  // Calculate date range based on view mode (needed early for data fetching)
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

  // For week view, use the new combined calendar endpoint
  const { data: calendarData } = useCalendarData(
    dateRange.start, 
    dateRange.end, 
    viewMode === "week"
  );

  // For month/tally views, use legacy separate queries
  const { data: blocks = [] } = useQuery<Block[]>({
    queryKey: ["/api/blocks"],
    enabled: viewMode !== "week",
  });

  const { data: assignments = [] } = useQuery<(BlockAssignment & { driver?: Driver })[]>({
    queryKey: ["/api/block-assignments"],
    select: (data: any) => data,
    enabled: viewMode !== "week",
  });

  // Always fetch drivers for filters dropdown
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Fetch compliance heatmap data for calendar views
  const { data: heatmapData } = useQuery<{
    drivers: Array<{
      id: string;
      name: string;
      compliance: Array<{
        timestamp: string;
        status: "compliant" | "warning" | "violation";
        hoursRemaining: number;
      }>;
    }>;
  }>({
    queryKey: ["/api/compliance/heatmap", format(dateRange.start, "yyyy-MM-dd"), format(dateRange.end, "yyyy-MM-dd")],
    queryFn: async () => {
      const startStr = format(dateRange.start, "yyyy-MM-dd");
      const endStr = format(dateRange.end, "yyyy-MM-dd");
      const res = await fetch(`/api/compliance/heatmap/${startStr}/${endStr}`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to fetch compliance heatmap");
      return await res.json();
    },
    enabled: viewMode !== "tally",
  });

  // Update assignment mutation with cache invalidation
  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ assignmentId, driverId }: { assignmentId: string; driverId?: string | null }) => {
      const res = await apiRequest("PATCH", `/api/block-assignments/${assignmentId}`, {
        driverId: driverId === null ? undefined : driverId,
      });
      return await res.json();
    },
    onSuccess: () => {
      // Invalidate all relevant caches
      const startDateStr = format(dateRange.start, "yyyy-MM-dd");
      const endDateStr = format(dateRange.end, "yyyy-MM-dd");
      
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar", startDateStr, endDateStr] });
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/block-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workload-summary/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/compliance/heatmap"] });
      
      toast({
        title: "Assignment updated",
        description: "Block assignment has been updated successfully.",
      });
      
      setDraggedBlock(null);
      setDragOverDriver(null);
      setValidationFeedback(null);
    },
    onError: (error: any) => {
      const errorData = typeof error === "string" ? { message: error } : error;
      toast({
        title: "Assignment failed",
        description: errorData.message || "Failed to update assignment. Please check DOT compliance rules.",
        variant: "destructive",
      });
      
      setDraggedBlock(null);
      setDragOverDriver(null);
      setValidationFeedback(null);
    },
  });

  // Delete assignment mutation (for unassign)
  const deleteAssignmentMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      await apiRequest("DELETE", `/api/block-assignments/${assignmentId}`, undefined);
    },
    onSuccess: () => {
      const startDateStr = format(dateRange.start, "yyyy-MM-dd");
      const endDateStr = format(dateRange.end, "yyyy-MM-dd");
      
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar", startDateStr, endDateStr] });
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/block-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workload-summary/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/compliance/heatmap"] });
      
      toast({
        title: "Assignment removed",
        description: "Block has been unassigned successfully.",
      });
      
      setSelectedBlock(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to unassign",
        description: error.message || "Failed to remove assignment.",
        variant: "destructive",
      });
    },
  });

  // Calculate tally date range (6 weeks from current week)
  const tallyDateRange = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    const end = addWeeks(start, 5); // Current week + 5 more = 6 weeks total
    return { start, end };
  }, [currentDate]);

  // Fetch workload summaries for tally view (only when in tally mode)
  const { data: workloadData = [] } = useQuery<Array<{
    driverId: string;
    driverName: string;
    weekStartIso: string;
    daysWorked: number;
    workloadLevel: string;
    totalHours: number;
    blockIds: string[];
  }>>({
    queryKey: ["/api/workload-summary/range", { 
      start: format(tallyDateRange.start, "yyyy-MM-dd"), 
      end: format(tallyDateRange.end, "yyyy-MM-dd") 
    }],
    enabled: viewMode === "tally",
  });

  // Fetch approved special requests for tally view (only when in tally mode)
  const { data: approvedRequests = [] } = useQuery<Array<any>>({
    queryKey: ["/api/special-requests", "approved"],
    enabled: viewMode === "tally",
    select: (data: any[]) => data.filter((r: any) => r.status === "approved"),
  });

  // Combine blocks with their assignments
  // For week view, use calendar data; for month/tally, use legacy queries
  const blocksWithAssignments: BlockWithAssignment[] = useMemo(() => {
    if (viewMode === "week" && calendarData) {
      // Transform calendar API response to BlockWithAssignment format
      return calendarData.blocks.map(block => ({
        ...block,
        assignment: block.assignment ? {
          ...block.assignment,
          driver: block.assignment.driver || undefined,
        } : undefined,
        contract: block.contract || undefined,
      }));
    }
    
    // Legacy path for month/tally views
    return blocks.map(block => {
      const assignment = assignments.find(a => a.blockId === block.id);
      if (assignment) {
        const driver = drivers.find(d => d.id === assignment.driverId);
        return { ...block, assignment: { ...assignment, driver } };
      }
      return block;
    });
  }, [viewMode, calendarData, blocks, assignments, drivers]);

  // Fetch workload data for calendar views (week/month only)
  const { data: calendarWorkloadData = [] } = useQuery<Array<{
    driverId: string;
    driverName: string;
    weekStartIso: string;
    daysWorked: number;
    workloadLevel: string;
    totalHours: number;
    blockIds: string[];
  }>>({
    queryKey: ["/api/workload-summary/range", {
      start: viewMode !== "tally" ? format(dateRange.start, "yyyy-MM-dd") : "",
      end: viewMode !== "tally" ? format(dateRange.end, "yyyy-MM-dd") : "",
    }],
    enabled: viewMode !== "tally",
  });

  // Build workload lookup: workloadMap[driverId][weekStartIso] => workloadData
  const workloadMap = useMemo(() => {
    const map: Record<string, Record<string, typeof calendarWorkloadData[0]>> = {};
    calendarWorkloadData.forEach(w => {
      if (!map[w.driverId]) map[w.driverId] = {};
      // Normalize weekStartIso to yyyy-MM-dd format to match frontend lookup keys
      const normalizedWeekKey = w.weekStartIso.includes('T') 
        ? format(new Date(w.weekStartIso), "yyyy-MM-dd")
        : w.weekStartIso;
      map[w.driverId][normalizedWeekKey] = w;
    });
    return map;
  }, [calendarWorkloadData]);

  // Filter blocks by date range and filters
  const filteredBlocks = useMemo(() => {
    return blocksWithAssignments.filter(block => {
      const blockDate = new Date(block.startTimestamp);
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
        const blockDate = new Date(block.startTimestamp);
        return isSameDay(blockDate, day);
      }).sort((a, b) => {
        const aTime = new Date(a.startTimestamp).getTime();
        const bTime = new Date(b.startTimestamp).getTime();
        return aTime - bTime;
      });
    });
    return grouped;
  }, [dateRange.days, filteredBlocks]);

  // Group blocks by Solo Type for driver-row layout
  const blocksBySoloType = useMemo(() => {
    const solo1Blocks = filteredBlocks.filter(b => {
      const normalized = b.soloType.toLowerCase().replace(/\s+/g, "");
      return normalized === "solo1";
    });
    const solo2Blocks = filteredBlocks.filter(b => {
      const normalized = b.soloType.toLowerCase().replace(/\s+/g, "");
      return normalized === "solo2";
    });
    
    // Filter by driver search if provided
    const filterByDriver = (blocks: BlockWithAssignment[]) => {
      if (!driverSearch.trim()) return blocks;
      return blocks.filter(block => {
        if (!block.assignment?.driver) return false;
        const driverName = `${block.assignment.driver.firstName} ${block.assignment.driver.lastName}`.toLowerCase();
        return driverName.includes(driverSearch.toLowerCase());
      });
    };
    
    return {
      solo1: filterByDriver(solo1Blocks),
      solo2: filterByDriver(solo2Blocks),
    };
  }, [filteredBlocks, driverSearch]);

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

  const getWorkloadBadgeVariant = (workloadLevel: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (workloadLevel) {
      case "ideal":
        return "outline"; // Green (4 days)
      case "warning":
        return "secondary"; // Yellow (5 days)
      case "critical":
        return "destructive"; // Red (6+ days)
      case "underutilized":
        return "outline"; // Blue (<4 days)
      default:
        return "outline";
    }
  };

  const getWorkloadBadgeColor = (workloadLevel: string): string => {
    switch (workloadLevel) {
      case "ideal":
        return "text-green-700 dark:text-green-400 border-green-500";
      case "warning":
        return "text-yellow-700 dark:text-yellow-400 border-yellow-500";
      case "critical":
        return "text-red-700 dark:text-red-400 border-red-500";
      case "underutilized":
        return "text-blue-700 dark:text-blue-400 border-blue-500";
      default:
        return "";
    }
  };

  const getDriverWorkload = (driverId: string, day: Date) => {
    const weekStart = startOfWeek(day, { weekStartsOn: 0 });
    const weekKey = format(weekStart, "yyyy-MM-dd");
    return workloadMap[driverId]?.[weekKey];
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

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent, block: BlockWithAssignment) => {
    setDraggedBlock(block);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", block.id);
  };

  const handleDragOver = (e: React.DragEvent, driverId?: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDriver(driverId || null);
  };

  const handleDragEnd = () => {
    setDraggedBlock(null);
    setDragOverDriver(null);
  };

  const handleDrop = (e: React.DragEvent, targetDriverId?: string) => {
    e.preventDefault();
    
    if (!draggedBlock?.assignment) {
      toast({
        title: "Cannot reassign",
        description: "Block must have an existing assignment to move it.",
        variant: "destructive",
      });
      return;
    }

    // If dropping on same driver, do nothing
    if (targetDriverId === draggedBlock.assignment.driverId) {
      setDraggedBlock(null);
      setDragOverDriver(null);
      return;
    }

    // Update assignment
    updateAssignmentMutation.mutate({
      assignmentId: draggedBlock.assignment.id,
      driverId: targetDriverId || null,
    });
  };

  const handleUnassign = () => {
    if (!selectedBlock?.assignment) return;
    
    deleteAssignmentMutation.mutate(selectedBlock.assignment.id);
  };

  const handleReassign = (newDriverId: string) => {
    if (!selectedBlock?.assignment) return;
    
    updateAssignmentMutation.mutate({
      assignmentId: selectedBlock.assignment.id,
      driverId: newDriverId,
    });
  };

  // Memoized compliance lookup map - nested structure to avoid UUID delimiter issues
  const complianceMap = useMemo(() => {
    if (!heatmapData) return new Map<string, Map<string, { status: string; hoursRemaining: number }>>();
    
    const map = new Map<string, Map<string, { status: string; hoursRemaining: number }>>();
    
    heatmapData.drivers.forEach(driver => {
      const driverMap = new Map<string, { status: string; hoursRemaining: number }>();
      if (driver.compliance) {
        driver.compliance.forEach(c => {
          const timestamp = new Date(c.timestamp).toISOString();
          driverMap.set(timestamp, { status: c.status, hoursRemaining: c.hoursRemaining });
        });
      }
      map.set(driver.id, driverMap);
    });
    
    return map;
  }, [heatmapData]);

  // Get compliance status for a block (memoized lookup)
  const getBlockCompliance = (block: BlockWithAssignment) => {
    if (!block.assignment?.driver) return null;
    
    const blockTime = new Date(block.startTimestamp);
    const driverId = block.assignment.driverId;
    
    const driverCompliance = complianceMap.get(driverId);
    if (!driverCompliance) return null;
    
    // Try to find exact match first
    const exactMatch = driverCompliance.get(blockTime.toISOString());
    if (exactMatch) {
      return exactMatch;
    }
    
    // Find closest compliance timestamp within 1 hour
    let closest: { timestamp: string; diff: number; value: { status: string; hoursRemaining: number } } | null = null;
    driverCompliance.forEach((value, timestamp) => {
      const complianceTime = new Date(timestamp);
      const diff = Math.abs(complianceTime.getTime() - blockTime.getTime());
      
      if (diff < 1000 * 60 * 60) { // Within 1 hour
        if (!closest || diff < closest.diff) {
          closest = { timestamp, diff, value };
        }
      }
    });
    
    return closest ? closest.value : null;
  };

  return (
    <div className="flex h-full bg-background p-6 gap-6">
      {/* Left Sidebar - Always Visible */}
      <div className="w-72 flex-shrink-0 space-y-4">
        {/* Search */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Search Drivers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search driver..."
                value={driverSearch}
                onChange={(e) => setDriverSearch(e.target.value)}
                className="pl-9"
                data-testid="input-driver-search"
              />
            </div>
          </CardContent>
        </Card>

        {/* Filters Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Solo Type Filter - Toggle Chips */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Block Type</Label>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={soloTypeFilter === "all" ? "default" : "outline"}
                  className="cursor-pointer hover-elevate"
                  onClick={() => setSoloTypeFilter("all")}
                  data-testid="badge-filter-all"
                >
                  All
                </Badge>
                <Badge
                  variant={soloTypeFilter === "solo1" ? "default" : "outline"}
                  className="cursor-pointer hover-elevate"
                  onClick={() => setSoloTypeFilter("solo1")}
                  data-testid="badge-filter-solo1"
                >
                  Solo 1
                </Badge>
                <Badge
                  variant={soloTypeFilter === "solo2" ? "default" : "outline"}
                  className="cursor-pointer hover-elevate"
                  onClick={() => setSoloTypeFilter("solo2")}
                  data-testid="badge-filter-solo2"
                >
                  Solo 2
                </Badge>
                <Badge
                  variant={soloTypeFilter === "team" ? "default" : "outline"}
                  className="cursor-pointer hover-elevate"
                  onClick={() => setSoloTypeFilter("team")}
                  data-testid="badge-filter-team"
                >
                  Team
                </Badge>
              </div>
            </div>

            {/* Status Filter - Checkboxes */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="status-all"
                    checked={statusFilter === "all"}
                    onCheckedChange={() => setStatusFilter("all")}
                    data-testid="checkbox-status-all"
                  />
                  <Label htmlFor="status-all" className="text-sm cursor-pointer">All</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="status-valid"
                    checked={statusFilter === "valid"}
                    onCheckedChange={() => setStatusFilter("valid")}
                    data-testid="checkbox-status-valid"
                  />
                  <Label htmlFor="status-valid" className="text-sm cursor-pointer flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                    Valid
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="status-warning"
                    checked={statusFilter === "warning"}
                    onCheckedChange={() => setStatusFilter("warning")}
                    data-testid="checkbox-status-warning"
                  />
                  <Label htmlFor="status-warning" className="text-sm cursor-pointer flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-yellow-600" />
                    Warning
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="status-violation"
                    checked={statusFilter === "violation"}
                    onCheckedChange={() => setStatusFilter("violation")}
                    data-testid="checkbox-status-violation"
                  />
                  <Label htmlFor="status-violation" className="text-sm cursor-pointer flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-red-600" />
                    Violation
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="status-unassigned"
                    checked={statusFilter === "unassigned"}
                    onCheckedChange={() => setStatusFilter("unassigned")}
                    data-testid="checkbox-status-unassigned"
                  />
                  <Label htmlFor="status-unassigned" className="text-sm cursor-pointer">Unassigned</Label>
                </div>
              </div>
            </div>

            {/* Driver Filter */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Drivers ({selectedDrivers.size} selected)
              </Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
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
                  className="w-full"
                  data-testid="button-clear-drivers"
                >
                  Clear Selection
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Main Calendar Area */}
      <div className="flex-1 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
              Start Times </h1>
              <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
                {format(dateRange.start, "MMM d")} - {format(dateRange.end, "MMM d, yyyy")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Display Mode Toggle (Calendar vs List) - Only show for week/month views */}
            {(viewMode === "week" || viewMode === "month") && (
              <div className="flex items-center border rounded-md shadow-md">
                <Button
                  variant={displayMode === "calendar" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setDisplayMode("calendar")}
                  className="rounded-none rounded-l-md"
                  data-testid="button-calendar-display"
                >
                  <LayoutGrid className="w-4 h-4 mr-1" />
                  Grid
                </Button>
                <Button
                  variant={displayMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setDisplayMode("list")}
                  className="rounded-none rounded-r-md"
                  data-testid="button-list-display"
                >
                  <List className="w-4 h-4 mr-1" />
                  List
                </Button>
              </div>
            )}
            
            {/* View Mode Toggle (Week/Month/Tally) */}
            <div className="flex items-center border rounded-md shadow-md">
              <Button
                variant={viewMode === "week" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("week")}
                className="rounded-none rounded-l-md"
                data-testid="button-week-view"
              >
                Week
              </Button>
              <Button
                variant={viewMode === "month" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("month")}
                className="rounded-none border-x-0"
                data-testid="button-month-view"
              >
                Month
              </Button>
              <Button
                variant={viewMode === "tally" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("tally")}
                className="rounded-none rounded-r-md"
                data-testid="button-tally-view"
              >
                Tally
              </Button>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevious}
                className="shadow-md hover:shadow-lg transition-shadow"
                data-testid="button-previous"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToday}
                className="shadow-md hover:shadow-lg transition-shadow"
                data-testid="button-today"
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNext}
                className="shadow-md hover:shadow-lg transition-shadow"
                data-testid="button-next"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

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

      {/* Driver-Row Schedule Grid (Week / Month views) */}
      {(viewMode === "week" || viewMode === "month") && displayMode === "calendar" && (
        <div className="flex-1 overflow-auto">
          <div className="space-y-6">
            {/* Solo 1 Section */}
            {blocksBySoloType.solo1.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-3 pb-2 border-b">
                  Solo 1
                </h2>
                <div className="border rounded-lg overflow-hidden">
                  {/* Header Row */}
                  <div className="grid grid-cols-8 bg-muted/50">
                    <div className="p-3 font-medium text-sm border-r">Block ID</div>
                    {dateRange.days.map((day, idx) => (
                      <div
                        key={idx}
                        className="p-3 text-center font-medium text-sm border-r last:border-r-0"
                        data-testid={`day-header-${idx}`}
                      >
                        <div>{format(day, "EEE")}</div>
                        <div className="text-xs text-muted-foreground">{format(day, "MMM d")}</div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Block Rows */}
                  {blocksBySoloType.solo1.map((block) => {
                    const blockDay = new Date(block.startTimestamp);
                    
                    return (
                      <div key={block.id} className="grid grid-cols-8 border-t">
                        <div className="p-3 border-r bg-background">
                          <div className="font-medium text-sm">{block.blockId}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(blockDay, "HH:mm")}
                          </div>
                        </div>
                        
                        {dateRange.days.map((day) => {
                          const dayKey = format(day, "yyyy-MM-dd");
                          const isBlockDay = isSameDay(day, blockDay);
                          const isAssigned = block.assignment?.driver;
                          
                          // Get compliance and workload info
                          const driverWorkload = isAssigned
                            ? getDriverWorkload(block.assignment.driverId, day)
                            : null;
                          const compliance = getBlockCompliance(block);
                          const isCritical = driverWorkload && driverWorkload.daysWorked >= 6;
                          const hasViolation = compliance && compliance.status === "violation";
                          const hasWarning = compliance && compliance.status === "warning";
                          
                          // Determine cell styling
                          let cellBg = "bg-background";
                          let borderClass = "border-r last:border-r-0";
                          
                          if (isBlockDay) {
                            if (!isAssigned) {
                              // Unassigned - grey gradient
                              cellBg = "bg-gradient-to-br from-muted/30 to-muted/10";
                            } else {
                              // Assigned - solo type color
                              cellBg = "bg-gradient-to-br from-blue-500/20 to-blue-500/5";
                              if (isCritical || hasViolation) {
                                borderClass = "border-r border-l-4 border-l-red-500";
                              } else if (hasWarning) {
                                borderClass = "border-r border-l-4 border-l-yellow-500";
                              }
                            }
                          }
                          
                          return (
                            <div
                              key={dayKey}
                              className={`p-2 min-h-[60px] ${cellBg} ${borderClass} transition-colors`}
                              data-testid={`block-cell-${block.id}-${dayKey}`}
                            >
                              {isBlockDay && (
                                <div
                                  onClick={() => setSelectedBlock(block)}
                                  className="cursor-pointer hover-elevate p-2 rounded h-full"
                                >
                                  {isAssigned ? (
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-xs font-medium truncate">
                                          {block.assignment.driver.firstName} {block.assignment.driver.lastName}
                                        </span>
                                        {getStatusIcon(block)}
                                      </div>
                                      {driverWorkload && (
                                        <Badge
                                          variant={getWorkloadBadgeVariant(driverWorkload.workloadLevel)}
                                          className={`text-xs ${getWorkloadBadgeColor(driverWorkload.workloadLevel)}`}
                                        >
                                          {driverWorkload.daysWorked}d
                                        </Badge>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground italic">
                                      Available
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* Solo 2 Section */}
            {blocksBySoloType.solo2.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-3 pb-2 border-b">
                  Solo 2
                </h2>
                <div className="border rounded-lg overflow-hidden">
                  {/* Header Row */}
                  <div className="grid grid-cols-8 bg-muted/50">
                    <div className="p-3 font-medium text-sm border-r">Block ID</div>
                    {dateRange.days.map((day, idx) => (
                      <div
                        key={idx}
                        className="p-3 text-center font-medium text-sm border-r last:border-r-0"
                        data-testid={`day-header-solo2-${idx}`}
                      >
                        <div>{format(day, "EEE")}</div>
                        <div className="text-xs text-muted-foreground">{format(day, "MMM d")}</div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Block Rows */}
                  {blocksBySoloType.solo2.map((block) => {
                    const blockDay = new Date(block.startTimestamp);
                    
                    return (
                      <div key={block.id} className="grid grid-cols-8 border-t">
                        <div className="p-3 border-r bg-background">
                          <div className="font-medium text-sm">{block.blockId}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(blockDay, "HH:mm")}
                          </div>
                        </div>
                        
                        {dateRange.days.map((day) => {
                          const dayKey = format(day, "yyyy-MM-dd");
                          const isBlockDay = isSameDay(day, blockDay);
                          const isAssigned = block.assignment?.driver;
                          
                          // Get compliance and workload info
                          const driverWorkload = isAssigned
                            ? getDriverWorkload(block.assignment.driverId, day)
                            : null;
                          const compliance = getBlockCompliance(block);
                          const isCritical = driverWorkload && driverWorkload.daysWorked >= 6;
                          const hasViolation = compliance && compliance.status === "violation";
                          const hasWarning = compliance && compliance.status === "warning";
                          
                          // Determine cell styling
                          let cellBg = "bg-background";
                          let borderClass = "border-r last:border-r-0";
                          
                          if (isBlockDay) {
                            if (!isAssigned) {
                              // Unassigned - grey gradient
                              cellBg = "bg-gradient-to-br from-muted/30 to-muted/10";
                            } else {
                              // Assigned - solo type color (purple for Solo2)
                              cellBg = "bg-gradient-to-br from-purple-500/20 to-purple-500/5";
                              if (isCritical || hasViolation) {
                                borderClass = "border-r border-l-4 border-l-red-500";
                              } else if (hasWarning) {
                                borderClass = "border-r border-l-4 border-l-yellow-500";
                              }
                            }
                          }
                          
                          return (
                            <div
                              key={dayKey}
                              className={`p-2 min-h-[60px] ${cellBg} ${borderClass} transition-colors`}
                              data-testid={`block-cell-${block.id}-${dayKey}`}
                            >
                              {isBlockDay && (
                                <div
                                  onClick={() => setSelectedBlock(block)}
                                  className="cursor-pointer hover-elevate p-2 rounded h-full"
                                >
                                  {isAssigned ? (
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-xs font-medium truncate">
                                          {block.assignment.driver.firstName} {block.assignment.driver.lastName}
                                        </span>
                                        {getStatusIcon(block)}
                                      </div>
                                      {driverWorkload && (
                                        <Badge
                                          variant={getWorkloadBadgeVariant(driverWorkload.workloadLevel)}
                                          className={`text-xs ${getWorkloadBadgeColor(driverWorkload.workloadLevel)}`}
                                        >
                                          {driverWorkload.daysWorked}d
                                        </Badge>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground italic">
                                      Available
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Block List View (Week / Month views) */}
      {(viewMode === "week" || viewMode === "month") && displayMode === "list" && (
        <div className="flex-1 overflow-auto">
          <BlockListView 
            blocks={filteredBlocks}
            drivers={drivers}
            onBlockSelect={setSelectedBlock}
            getBlockCompliance={getBlockCompliance}
          />
        </div>
      )}

      {/* Tally View (Workload Tally) */}
      {viewMode === "tally" && (() => {
        // Calculate weeks array (6 weeks)
        const weeks: Date[] = [];
        for (let i = 0; i < 6; i++) {
          weeks.push(addWeeks(tallyDateRange.start, i));
        }
        
        // Create workload lookup map: [driverId][weekStartIso] => workloadData
        const workloadMap: Record<string, Record<string, typeof workloadData[0]>> = {};
        workloadData.forEach(w => {
          if (!workloadMap[w.driverId]) workloadMap[w.driverId] = {};
          workloadMap[w.driverId][w.weekStartIso] = w;
        });
        
        // Create PTO lookup map: [driverId][weekStartIso] => approved requests
        const ptoMap: Record<string, Record<string, number>> = {};
        approvedRequests.forEach((req: any) => {
          const weekStart = startOfWeek(new Date(req.affectedDate), { weekStartsOn: 0 });
          const weekKey = format(weekStart, "yyyy-MM-dd");
          if (!ptoMap[req.driverId]) ptoMap[req.driverId] = {};
          ptoMap[req.driverId][weekKey] = (ptoMap[req.driverId][weekKey] || 0) + 1;
        });
        
        // Helper to get workload color classes
        const getWorkloadColorClasses = (level: string) => {
          switch (level) {
            case "ideal": return "bg-green-500/10 border-green-500 text-green-700 dark:text-green-400";
            case "warning": return "bg-yellow-500/10 border-yellow-500 text-yellow-700 dark:text-yellow-400";
            case "critical": return "bg-red-500/10 border-red-500 text-red-700 dark:text-red-400";
            case "underutilized": return "bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-400";
            default: return "bg-muted border-border text-muted-foreground";
          }
        };
        
        return (
          <div className="flex-1 overflow-auto">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-background border-b border-r p-3 text-left font-semibold text-sm min-w-48">
                      Driver
                    </th>
                    {weeks.map((week, idx) => (
                      <th key={idx} className="border-b p-3 text-center font-semibold text-sm min-w-32">
                        <div>{format(week, "MMM d")}</div>
                        <div className="text-xs text-muted-foreground font-normal">
                          {format(week, "yyyy")}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drivers
                    .filter(d => d.status === "active")
                    .map(driver => (
                    <tr key={driver.id}>
                      <td className="sticky left-0 z-10 bg-background border-b border-r p-3 font-medium text-sm">
                        {driver.firstName} {driver.lastName}
                      </td>
                      {weeks.map((week, weekIdx) => {
                        const weekKey = format(week, "yyyy-MM-dd");
                        const workload = workloadMap[driver.id]?.[weekKey];
                        const ptoCount = ptoMap[driver.id]?.[weekKey] || 0;
                        
                        return (
                          <td
                            key={weekIdx}
                            className="border-b p-2"
                            data-testid={`cell-driver-${driver.id}-week-${weekKey}`}
                          >
                            {workload ? (
                              <div className={`p-3 rounded-md border text-center ${getWorkloadColorClasses(workload.workloadLevel)}`}>
                                <div className="text-lg font-bold">{workload.daysWorked}</div>
                                <div className="text-xs opacity-80">
                                  {workload.daysWorked === 1 ? "day" : "days"}
                                </div>
                                <div className="text-xs mt-1 opacity-70">
                                  {workload.totalHours}h
                                </div>
                                {ptoCount > 0 && (
                                  <Badge variant="outline" className="mt-1 text-xs">
                                    {ptoCount} PTO
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <div className="p-3 rounded-md border bg-muted/30 text-center text-muted-foreground">
                                <div className="text-lg font-bold">0</div>
                                <div className="text-xs">days</div>
                                {ptoCount > 0 && (
                                  <Badge variant="outline" className="mt-1 text-xs">
                                    {ptoCount} PTO
                                  </Badge>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Legend */}
            <div className="mt-4 flex items-center gap-6 text-sm p-4 border-t">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded border bg-blue-500/10 border-blue-500"></div>
                <span className="text-muted-foreground">Underutilized (&lt;4 days)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded border bg-green-500/10 border-green-500"></div>
                <span className="text-muted-foreground">Ideal (4 days)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded border bg-yellow-500/10 border-yellow-500"></div>
                <span className="text-muted-foreground">Warning (5 days)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded border bg-red-500/10 border-red-500"></div>
                <span className="text-muted-foreground">Critical (6+ days)</span>
              </div>
            </div>
          </div>
        );
      })()}

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
                    {format(new Date(selectedBlock.startTimestamp), "MMM d, yyyy HH:mm")}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">End Time</Label>
                  <div className="font-medium">
                    {format(new Date(selectedBlock.endTimestamp), "MMM d, yyyy HH:mm")}
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

              {/* Contract Details */}
              {selectedBlock.contract && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-3">Contract Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Bench Type</Label>
                      <div className="font-medium capitalize">{selectedBlock.contract.type}</div>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Standard Start</Label>
                      <div className="font-medium">{selectedBlock.contract.startTime}</div>
                    </div>
                    {selectedBlock.contract.protectedDrivers && (
                      <div className="col-span-2">
                        <Badge variant="outline" className="text-yellow-700 dark:text-yellow-400 border-yellow-500">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Protected Driver Rules Active
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                        {format(new Date(selectedBlock.assignment.assignedAt), "MMM d, yyyy HH:mm")}
                      </div>
                    </div>
                  </div>

                  {/* Validation Summary - User Friendly */}
                  {selectedBlock.assignment.validationSummary && (() => {
                    const summary = JSON.parse(selectedBlock.assignment.validationSummary);
                    const compliance = getBlockCompliance(selectedBlock);
                    
                    return (
                      <div>
                        <Label className="text-muted-foreground">DOT Compliance Summary</Label>
                        <div className="mt-2 p-4 bg-muted/50 rounded-md space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Status</span>
                            <Badge
                              variant={
                                summary.status === "valid"
                                  ? "default"
                                  : summary.status === "warning"
                                  ? "secondary"
                                  : "destructive"
                              }
                            >
                              {summary.status}
                            </Badge>
                          </div>
                          
                          {compliance && (
                            <div className="flex items-center justify-between text-sm">
                              <span>Hours Remaining</span>
                              <span className="font-medium">
                                {compliance.hoursRemaining.toFixed(1)}h
                              </span>
                            </div>
                          )}
                          
                          {summary.metrics && (
                            <div className="space-y-2">
                              <div className="text-sm font-medium">Utilization Metrics</div>
                              <div className="text-xs space-y-1 text-muted-foreground">
                                {Object.entries(summary.metrics).map(([key, value]: [string, any]) => (
                                  <div key={key} className="flex justify-between">
                                    <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                    <span className="font-mono">{typeof value === 'number' ? value.toFixed(1) : value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {summary.messages && summary.messages.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-sm font-medium">Compliance Notes</div>
                              <ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">
                                {summary.messages.map((msg: string, idx: number) => (
                                  <li key={idx}>{msg}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {selectedBlock.assignment.notes && (
                    <div>
                      <Label className="text-muted-foreground">Notes</Label>
                      <div className="mt-1 text-sm">{selectedBlock.assignment.notes}</div>
                    </div>
                  )}

                  {/* Driver Reassignment */}
                  <div className="border-t pt-4">
                    <Label className="text-muted-foreground mb-2 block">Reassign Driver</Label>
                    <div className="flex gap-2">
                      <Select 
                        value={reassignDriverId || (selectedBlock.assignment?.driverId || "")} 
                        onValueChange={setReassignDriverId}
                      >
                        <SelectTrigger data-testid="select-reassign-driver">
                          <SelectValue placeholder="Select driver" />
                        </SelectTrigger>
                        <SelectContent>
                          {drivers.map(driver => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.firstName} {driver.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => handleReassign(reassignDriverId || (selectedBlock.assignment?.driverId || ""))}
                        disabled={!reassignDriverId || reassignDriverId === (selectedBlock.assignment?.driverId || "") || updateAssignmentMutation.isPending}
                        data-testid="button-reassign-driver"
                      >
                        {updateAssignmentMutation.isPending ? "Reassigning..." : "Reassign"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t pt-4">
                  <p className="text-muted-foreground text-sm">This block has not been assigned to a driver yet.</p>
                </div>
              )}
            </div>
          )}

          {/* Modal Footer with Unassign Button */}
          {selectedBlock?.assignment && (
            <DialogFooter>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" data-testid="button-unassign">
                    <X className="w-4 h-4 mr-2" />
                    Unassign Driver
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Unassignment</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to unassign{" "}
                      <span className="font-medium">
                        {selectedBlock.assignment.driver
                          ? `${selectedBlock.assignment.driver.firstName} ${selectedBlock.assignment.driver.lastName}`
                          : "this driver"}
                      </span>{" "}
                      from block {selectedBlock.blockId}? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleUnassign}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Unassign
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
