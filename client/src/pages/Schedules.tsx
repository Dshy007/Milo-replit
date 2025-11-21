import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks, eachDayOfInterval, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, User, Upload, X, LayoutGrid, List, UserMinus } from "lucide-react";
import { DndContext, DragEndEvent, DragStartEvent, useDraggable, useDroppable, DragOverlay } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { DriverAssignmentModal } from "@/components/DriverAssignmentModal";
import { ScheduleListView } from "@/components/ScheduleListView";
import { DriverPoolSidebar } from "@/components/DriverPoolSidebar";
import type { Block, BlockAssignment, Driver, Contract } from "@shared/schema";

// Simplified occurrence from new calendar API
type ShiftOccurrence = {
  occurrenceId: string;
  serviceDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm (canonical)
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

// Calendar API response type (simplified)
type CalendarResponse = {
  range: { start: string; end: string };
  occurrences: ShiftOccurrence[];
};

// Draggable occurrence component
function DraggableOccurrence({ occurrence, children }: { occurrence: ShiftOccurrence; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: occurrence.occurrenceId,
    data: {
      occurrence,
    },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
      }
    : { cursor: 'grab' };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      {children}
    </div>
  );
}

// Droppable cell component
function DroppableCell({
  id,
  children,
  className,
  isDroppable = true,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  isDroppable?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    disabled: !isDroppable,
  });

  const style = {
    backgroundColor: isOver ? 'rgba(59, 130, 246, 0.1)' : undefined,
  };

  return (
    <td ref={setNodeRef} style={style} className={className}>
      {children}
    </td>
  );
}

export default function Schedules() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOccurrence, setSelectedOccurrence] = useState<ShiftOccurrence | null>(null);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [shiftToDelete, setShiftToDelete] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "type">("time");
  const [filterType, setFilterType] = useState<"all" | "solo1" | "solo2" | "team">("all");
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [showRate, setShowRate] = useState(true);
  const [activeOccurrence, setActiveOccurrence] = useState<ShiftOccurrence | null>(null);

  // Fetch contracts to get static start times
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const handleOccurrenceClick = (occurrence: ShiftOccurrence) => {
    setSelectedOccurrence(occurrence);
    setIsAssignmentModalOpen(true);
  };

  const handleUnassignDriver = async (e: React.MouseEvent, occurrence: ShiftOccurrence) => {
    e.stopPropagation(); // Prevent occurrence click modal from opening

    if (!occurrence.driverId) return;

    try {
      await updateAssignmentMutation.mutateAsync({
        occurrenceId: occurrence.occurrenceId,
        driverId: null,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });

      toast({
        title: "Driver Unassigned",
        description: `${occurrence.driverName} removed from ${occurrence.blockId}`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Unassign Failed",
        description: error.message || "Failed to unassign driver",
      });
    }
  };

  const handleCloseModal = () => {
    setIsAssignmentModalOpen(false);
    setSelectedOccurrence(null);
  };

  const deleteMutation = useMutation({
    mutationFn: async (shiftId: string) => {
      const response = await fetch(`/api/shift-occurrences/${shiftId}`, {
        method: "DELETE",
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to delete shift" }));
        const error: any = new Error(errorData.message);
        error.status = response.status;
        throw error;
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      toast({
        title: "Shift Deleted",
        description: "The shift has been removed from the calendar",
      });
    },
    onError: (error: any) => {
      let title = "Delete Failed";
      let description = "Failed to delete shift";
      
      if (error.status === 409) {
        title = "Cannot Delete Active Shift";
        description = "This shift is currently in progress or completed and cannot be deleted.";
      } else if (error.status === 404) {
        title = "Shift Not Found";
        description = "The shift you're trying to delete no longer exists.";
      } else if (error.message) {
        description = error.message;
      }
      
      toast({
        variant: "destructive",
        title,
        description,
      });
    },
  });

  const handleDeleteShift = (e: React.MouseEvent, shiftId: string) => {
    e.stopPropagation(); // Don't open the assignment modal
    setShiftToDelete(shiftId);
  };

  const confirmDelete = () => {
    if (shiftToDelete) {
      deleteMutation.mutate(shiftToDelete);
      setShiftToDelete(null);
    }
  };

  const importMutation = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("importMode", "shift"); // Use shift-based import (Operator ID mapping)

      const url = `/api/schedules/excel-import`;
      const response = await fetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to import schedule");
      }
      
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      
      // Log full result for debugging
      console.log("Import result:", result);

      // Show errors if any
      if (result.errors && result.errors.length > 0) {
        const errorPreview = result.errors.slice(0, 5).join("\n");
        const moreErrors = result.errors.length > 5 ? `\n...and ${result.errors.length - 5} more errors` : "";

        toast({
          variant: result.created > 0 ? "default" : "destructive",
          title: result.created > 0 ? "Partial Import" : "Import Failed",
          description: `${result.message}\n\nErrors:\n${errorPreview}${moreErrors}`,
        });
      } else if (result.warnings && result.warnings.length > 0) {
        // Show warnings only if no errors
        toast({
          title: "Import Successful with Warnings",
          description: `${result.message}\n\nWarnings:\n${result.warnings.slice(0, 3).join("\n")}`,
        });
      } else {
        toast({
          title: "Import Successful",
          description: result.message || `Imported ${result.created || 0} blocks successfully`,
        });
      }
      
      setIsImportDialogOpen(false);
      setImportFile(null);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: error.message || "Failed to import schedule",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setImportFile(files[0]);
    }
  };

  const handleImport = () => {
    if (!importFile) {
      toast({
        variant: "destructive",
        title: "No File Selected",
        description: "Please select an Excel file to import",
      });
      return;
    }

    importMutation.mutate({ file: importFile });
  };

  const clearAllMutation = useMutation({
    mutationFn: async ({ weekStart, weekEnd }: { weekStart: string; weekEnd: string }) => {
      const response = await fetch('/api/shift-occurrences/clear-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ weekStart, weekEnd }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to clear shifts');
      }
      
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      toast({
        title: "Shifts Cleared",
        description: `Successfully deleted ${result.count || 0} shifts from this week`,
      });
      setShowClearAllDialog(false);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Clear Failed",
        description: error.message || "Failed to clear shifts",
      });
    },
  });

  const handleClearAll = () => {
    const weekStart = format(weekRange.weekStart, "yyyy-MM-dd");
    const weekEnd = format(addDays(weekRange.weekStart, 6), "yyyy-MM-dd");
    clearAllMutation.mutate({ weekStart, weekEnd });
  };

  // Assignment update mutation for drag-and-drop
  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ occurrenceId, driverId }: { occurrenceId: string; driverId: string | null }) => {
      const response = await fetch(`/api/shift-occurrences/${occurrenceId}/assignment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ driverId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update assignment');
      }

      return response.json();
    },
    // Note: onSuccess removed to prevent multiple invalidations and toasts
    // We'll handle this manually in handleDragEnd after all mutations complete
  });

  // Handle drag start event
  const handleDragStart = (event: DragStartEvent) => {
    // Check if dragging an occurrence or a driver from sidebar
    if (event.active.data.current?.occurrence) {
      const draggedOccurrence = event.active.data.current.occurrence as ShiftOccurrence;
      setActiveOccurrence(draggedOccurrence);
    }
    // Driver dragging handled by sidebar component's visual feedback
  };

  // Handle drag end event
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    // Clear the active dragged item
    setActiveOccurrence(null);

    if (!over) return;

    const targetCellId = over.id as string;
    if (!targetCellId.startsWith('cell-')) return;

    // Parse target cell ID
    const parts = targetCellId.split('-');
    if (parts.length < 3) return;

    const targetDate = parts[1];
    const targetContractId = parts.slice(2).join('-');

    // Find target occurrence in the target cell
    const targetCell = occurrencesByContract[targetContractId]?.[targetDate] || [];
    if (targetCell.length === 0) return;

    const targetOccurrence = targetCell[0];

    try {
      // Case 1: Dragging a driver from the sidebar
      if (active.data.current?.type === 'driver') {
        const driver = active.data.current.driver as Driver;

        // TODO: Add validation here (green/gray logic)
        // For now, allow all assignments

        // If target already has a driver, swap is not allowed from sidebar
        // (can only swap by dragging between cells)
        if (targetOccurrence.driverId) {
          toast({
            variant: "destructive",
            title: "Cannot Assign",
            description: "This slot already has a driver. Drag between cells to swap drivers.",
          });
          return;
        }

        // Assign driver to the empty slot
        await updateAssignmentMutation.mutateAsync({
          occurrenceId: targetOccurrence.occurrenceId,
          driverId: driver.id,
        });

        await queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });

        toast({
          title: "Driver Assigned",
          description: `${driver.firstName} ${driver.lastName} assigned to ${targetOccurrence.blockId}`,
        });

        return;
      }

      // Case 2: Dragging an occurrence (existing swap/move logic)
      const draggedOccurrence = active.data.current?.occurrence as ShiftOccurrence;

      // Only allow dragging if the occurrence has a driver assigned
      if (!draggedOccurrence?.driverId) return;

      // Don't allow dropping on the same cell
      if (draggedOccurrence.serviceDate === targetDate && draggedOccurrence.tractorId === targetContractId) {
        return;
      }

      // If target has a driver, swap assignments
      if (targetOccurrence.driverId) {
        const draggedDriverId = draggedOccurrence.driverId;
        const targetDriverId = targetOccurrence.driverId;

        // Execute mutations sequentially to prevent race conditions
        await updateAssignmentMutation.mutateAsync({
          occurrenceId: targetOccurrence.occurrenceId,
          driverId: draggedDriverId,
        });

        await updateAssignmentMutation.mutateAsync({
          occurrenceId: draggedOccurrence.occurrenceId,
          driverId: targetDriverId,
        });

        await queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });

        toast({
          title: "Drivers Swapped",
          description: `${draggedOccurrence.driverName} and ${targetOccurrence.driverName} have been swapped`,
        });
      } else {
        // Target is unassigned, just move the driver
        await updateAssignmentMutation.mutateAsync({
          occurrenceId: targetOccurrence.occurrenceId,
          driverId: draggedOccurrence.driverId,
        });

        await updateAssignmentMutation.mutateAsync({
          occurrenceId: draggedOccurrence.occurrenceId,
          driverId: null,
        });

        await queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });

        toast({
          title: "Driver Moved",
          description: `${draggedOccurrence.driverName} has been moved successfully`,
        });
      }
    } catch (error: any) {
      // Handle errors from mutations
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error.message || "Failed to update assignment",
      });
    }
  };

  // Calculate week range (Sunday to Saturday)
  const weekRange = useMemo(() => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday
    const weekDays = eachDayOfInterval({
      start: weekStart,
      end: addDays(weekStart, 6), // Saturday
    });
    return { weekStart, weekDays };
  }, [currentDate]);

  // Fetch week's calendar data
  const { data: calendarData, isLoading: calendarLoading } = useQuery<CalendarResponse>({
    queryKey: ["/api/schedules/calendar", format(weekRange.weekStart, "yyyy-MM-dd"), format(addDays(weekRange.weekStart, 6), "yyyy-MM-dd")],
    queryFn: async () => {
      const startStr = format(weekRange.weekStart, "yyyy-MM-dd");
      const endStr = format(addDays(weekRange.weekStart, 6), "yyyy-MM-dd");
      const res = await fetch(`/api/schedules/calendar?startDate=${startStr}&endDate=${endStr}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch calendar data");
      return await res.json();
    },
  });

  // Group occurrences by contract (tractor), then by date
  // This allows each row to show one tractor's schedule across the week
  const occurrencesByContract = useMemo(() => {
    if (!calendarData) return {};

    const grouped: Record<string, Record<string, ShiftOccurrence[]>> = {};

    calendarData.occurrences.forEach((occ) => {
      const tractorId = occ.tractorId || "unassigned";
      const date = occ.serviceDate; // YYYY-MM-DD

      if (!grouped[tractorId]) {
        grouped[tractorId] = {};
      }
      if (!grouped[tractorId][date]) {
        grouped[tractorId][date] = [];
      }
      grouped[tractorId][date].push(occ);
    });

    return grouped;
  }, [calendarData]);

  // Get sorted and filtered contracts for bench display
  const sortedContracts = useMemo(() => {
    let filtered = [...contracts];
    
    // Apply type filter
    if (filterType !== "all") {
      filtered = filtered.filter(c => c.type.toLowerCase() === filterType);
    }
    
    // Apply sort
    return filtered.sort((a, b) => {
      if (sortBy === "time") {
        // Sort by start time first, then tractor
        if (a.startTime !== b.startTime) {
          return a.startTime.localeCompare(b.startTime);
        }
        return a.tractorId.localeCompare(b.tractorId);
      } else {
        // Sort by type first, then start time, then tractor
        if (a.type !== b.type) {
          return a.type.localeCompare(b.type);
        }
        if (a.startTime !== b.startTime) {
          return a.startTime.localeCompare(b.startTime);
        }
        return a.tractorId.localeCompare(b.tractorId);
      }
    });
  }, [contracts, sortBy, filterType]);

  // Navigation handlers
  const handlePreviousWeek = () => {
    setCurrentDate(subWeeks(currentDate, 1));
  };

  const handleNextWeek = () => {
    setCurrentDate(addWeeks(currentDate, 1));
  };

  const formatTime = (timeStr: string) => {
    // Return time in military format (HH:mm)
    return timeStr;
  };

  const getBlockTypeColor = (soloType: string) => {
    const normalized = soloType.toLowerCase().replace(/\s+/g, "");
    if (normalized === "solo1") return "bg-blue-500/20 text-blue-700 dark:text-blue-300";
    if (normalized === "solo2") return "bg-purple-500/20 text-purple-700 dark:text-purple-300";
    if (normalized === "team") return "bg-green-500/20 text-green-700 dark:text-green-300";
    return "bg-gray-500/20 text-gray-700 dark:text-gray-300";
  };

  const getPatternBadgeColor = (pattern: string | null | undefined) => {
    if (pattern === "sunWed") return "bg-orange-500/20 text-orange-700 dark:text-orange-300";
    if (pattern === "wedSat") return "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300";
    return "bg-gray-500/20 text-gray-700 dark:text-gray-300";
  };

  const getBumpIndicatorColor = (bumpMinutes: number) => {
    const absMinutes = Math.abs(bumpMinutes);
    if (absMinutes === 0) return "text-muted-foreground";
    if (absMinutes <= 120) return "text-yellow-600 dark:text-yellow-400"; // ±2h warning
    return "text-red-600 dark:text-red-400"; // >2h alert
  };

  const formatBumpTime = (bumpMinutes: number) => {
    if (bumpMinutes === 0) return "On time";
    const hours = Math.floor(Math.abs(bumpMinutes) / 60);
    const mins = Math.abs(bumpMinutes) % 60;
    const sign = bumpMinutes > 0 ? "+" : "-";
    
    if (hours === 0) {
      return `${sign}${mins}m`;
    }
    if (mins === 0) {
      return `${sign}${hours}h`;
    }
    return `${sign}${hours}h${mins}m`;
  };

  if (calendarLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading schedules...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-6 gap-4 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-4">
          {/* Title Section */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <Calendar className="w-5 h-5 text-primary" data-testid="schedules-icon" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
                Schedules
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
                Week of {format(weekRange.weekStart, "MMM d")} - {format(addDays(weekRange.weekStart, 6), "MMM d, yyyy")}
              </p>
            </div>
          </div>

          {/* Toolbar - All controls under headline */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Navigation & Import */}
            <div className="flex items-center gap-2">
              <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="default" size="sm" data-testid="button-import-schedule">
                    <Upload className="w-4 h-4 mr-2" />
                    Import Schedule
                  </Button>
                </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Schedule from Excel</DialogTitle>
                <DialogDescription>
                  Upload Amazon roster Excel file to import blocks and driver assignments
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    <strong>Expected format:</strong> Amazon Excel with columns Block ID, Driver Name, Operator ID, Stop 1/2 Planned Arrival Date/Time
                  </AlertDescription>
                </Alert>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Select Excel file:
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileSelect}
                    className="w-full text-sm"
                    data-testid="input-import-file"
                  />
                </div>

                {importFile && (
                  <div className="text-sm text-muted-foreground">
                    Selected: {importFile.name}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsImportDialogOpen(false);
                      setImportFile(null);
                    }}
                    data-testid="button-cancel-import"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={!importFile || importMutation.isPending}
                    data-testid="button-confirm-import"
                  >
                    {importMutation.isPending ? "Importing..." : "Import"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowClearAllDialog(true)}
                data-testid="button-clear-all"
              >
                <X className="w-4 h-4 mr-2" />
                Clear All
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousWeek}
                data-testid="button-previous-week"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextWeek}
                data-testid="button-next-week"
              >
                Next Week
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 border rounded-md p-1">
              <Button
                variant={viewMode === "calendar" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("calendar")}
                data-testid="button-view-calendar"
                className="gap-2"
              >
                <LayoutGrid className="w-4 h-4" />
                Calendar
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                data-testid="button-view-list"
                className="gap-2"
              >
                <List className="w-4 h-4" />
                List
              </Button>
            </div>

            {/* Sort & Filter Controls - Show for both views */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground">Sort by:</label>
              <div className="flex gap-1">
                <Button
                  variant={sortBy === "time" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("time")}
                  data-testid="button-sort-time"
                >
                  Time
                </Button>
                <Button
                  variant={sortBy === "type" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("type")}
                  data-testid="button-sort-type"
                >
                  Type
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground">Filter:</label>
              <div className="flex gap-1">
                <Button
                  variant={filterType === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterType("all")}
                  data-testid="button-filter-all"
                >
                  All
                </Button>
                <Button
                  variant={filterType === "solo1" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterType("solo1")}
                  data-testid="button-filter-solo1"
                >
                  Solo1
                </Button>
                <Button
                  variant={filterType === "solo2" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterType("solo2")}
                  data-testid="button-filter-solo2"
                >
                  Solo2
                </Button>
                <Button
                  variant={filterType === "team" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterType("team")}
                  data-testid="button-filter-team"
                >
                  Team
                </Button>
              </div>
            </div>

            {/* Rate Toggle - Only show in List view */}
            {viewMode === "list" && (
              <div className="flex items-center gap-2 px-3 py-2 border rounded-md">
                <Switch
                  id="show-rate"
                  checked={showRate}
                  onCheckedChange={setShowRate}
                  data-testid="toggle-rate"
                />
                <Label htmlFor="show-rate" className="text-sm cursor-pointer">
                  Show Rate
                </Label>
              </div>
            )}
          </div>
        </div>

      {/* Calendar View with Sidebar */}
      {viewMode === "calendar" && (
        <div className="flex flex-1 gap-0 overflow-hidden">
          {/* Driver Pool Sidebar */}
          <DriverPoolSidebar
            currentWeekStart={weekRange.weekStart}
            currentWeekEnd={addDays(weekRange.weekStart, 6)}
          />

          {/* Calendar */}
          <Card className="flex-1 overflow-hidden">
            <CardContent className="p-0 h-full overflow-auto">
            <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card border-b shadow-md">
              <tr>
                <th className="text-left p-3 font-semibold min-w-[220px] border-r shadow-sm">
                  Start Times
                </th>
                {weekRange.weekDays.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="text-center p-2 font-semibold min-w-[100px] border-r last:border-r-0 shadow-sm"
                  >
                    <div className="text-sm">{format(day, "EEE")}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {format(day, "MMM d")}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedContracts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground">
                    No bench slots defined. Set up contracts to get started.
                  </td>
                </tr>
              ) : (
                sortedContracts.map((contract) => (
                  <tr key={contract.id} className="border-b hover:bg-muted/30">
                    {/* Bench Slot Cell */}
                    <td className="p-3 border-r align-top bg-muted/20">
                      <div className="space-y-1.5">
                        {/* Start Time & Status */}
                        <div className="flex items-center justify-between">
                          <span className="text-base font-mono font-semibold text-foreground">
                            {formatTime(contract.startTime)}
                          </span>
                          <Badge 
                            variant={contract.status === "active" ? "default" : "secondary"}
                            className="text-xs"
                            data-testid={`bench-status-${contract.id}`}
                          >
                            {contract.status}
                          </Badge>
                        </div>
                        
                        {/* Tractor */}
                        <div className="text-sm text-foreground font-medium">
                          {contract.tractorId}
                        </div>
                        
                        {/* Contract Type & Site */}
                        <div className="flex items-center gap-2 text-xs">
                          <Badge 
                            className={getBlockTypeColor(contract.type)}
                            data-testid={`bench-type-${contract.id}`}
                          >
                            {contract.type}
                          </Badge>
                          <span className="text-muted-foreground">
                            {contract.domicile || "MKC"}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Day Cells */}
                    {weekRange.weekDays.map((day) => {
                      const dayISO = format(day, "yyyy-MM-dd");
                      // Filter occurrences by both tractorId AND startTime to match the correct contract
                      const dayOccurrences = (occurrencesByContract[contract.tractorId]?.[dayISO] || [])
                        .filter(occ => occ.startTime === contract.startTime);

                      return (
                        <DroppableCell
                          key={day.toISOString()}
                          id={`cell-${dayISO}-${contract.tractorId}`}
                          className="p-1.5 border-r last:border-r-0 align-top"
                          isDroppable={dayOccurrences.length > 0}
                        >
                          {dayOccurrences.length > 0 ? (
                            <div className="space-y-1">
                              {dayOccurrences.map((occ) => {
                                return (
                                  <div key={occ.occurrenceId} className="space-y-1">
                                    {/* STATIC SECTION - Never moves */}
                                    <div className="relative group">
                                      <button
                                        onClick={() => handleOccurrenceClick(occ)}
                                        className="w-full p-1.5 rounded-t-md bg-muted/50 text-xs space-y-0.5 text-left hover:bg-muted/70 transition-colors border border-b-0 border-border/50"
                                        data-testid={`occurrence-static-${occ.occurrenceId}`}
                                      >
                                        {/* Block ID */}
                                        <div className="font-mono font-semibold text-foreground">
                                          {occ.blockId}
                                        </div>

                                        {/* Tractor + Contract Type */}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {occ.tractorId && (
                                            <span className="text-blue-600 dark:text-blue-400 font-medium text-xs">
                                              [{occ.tractorId}]
                                            </span>
                                          )}
                                          {occ.contractType && (
                                            <>
                                              <span className="text-muted-foreground">•</span>
                                              <Badge
                                                variant="outline"
                                                className={`${getBlockTypeColor(occ.contractType)} text-xs px-1.5 py-0`}
                                                data-testid={`badge-type-${occ.occurrenceId}`}
                                              >
                                                {occ.contractType.toUpperCase()}
                                              </Badge>
                                            </>
                                          )}
                                        </div>

                                        {/* Time + Status Indicators */}
                                        <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                                          <span>{occ.startTime}</span>
                                          {occ.isCarryover && (
                                            <>
                                              <span>•</span>
                                              <Badge
                                                variant="outline"
                                                className="text-xs px-1 py-0 bg-orange-500/20 text-orange-700 dark:text-orange-300"
                                                data-testid={`badge-carryover-${occ.occurrenceId}`}
                                              >
                                                Carryover
                                              </Badge>
                                            </>
                                          )}
                                          {occ.bumpMinutes !== 0 && (
                                            <>
                                              <span>•</span>
                                              <span className={`font-medium ${getBumpIndicatorColor(occ.bumpMinutes)}`} data-testid={`bump-indicator-${occ.occurrenceId}`}>
                                                {formatBumpTime(occ.bumpMinutes)}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </button>

                                      {/* Delete Button */}
                                      <button
                                        onClick={(e) => handleDeleteShift(e, occ.occurrenceId)}
                                        disabled={deleteMutation.isPending}
                                        className="absolute top-1 right-1 p-0.5 rounded hover:bg-destructive/20 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                        data-testid={`button-delete-shift-${occ.occurrenceId}`}
                                        aria-label="Delete shift"
                                      >
                                        {deleteMutation.isPending ? (
                                          <div className="w-3 h-3 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                          <X className="w-3 h-3 text-destructive" />
                                        )}
                                      </button>
                                    </div>

                                    {/* DRIVER SECTION - Draggable or droppable */}
                                    {occ.driverName ? (
                                      <DraggableOccurrence occurrence={occ}>
                                        <div className="relative group">
                                          <div className="w-full p-1.5 rounded-b-md bg-blue-50/50 dark:bg-blue-950/20 border border-t-0 border-blue-200/50 dark:border-blue-800/50 text-xs hover:bg-blue-100/50 dark:hover:bg-blue-950/30 transition-colors cursor-grab active:cursor-grabbing">
                                            <div className="flex items-center gap-1.5">
                                              <User className="w-3 h-3 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                                              <span className="font-medium text-blue-900 dark:text-blue-100">
                                                {occ.driverName}
                                              </span>
                                            </div>
                                          </div>

                                          {/* Unassign Driver Button */}
                                          <button
                                            onClick={(e) => handleUnassignDriver(e, occ)}
                                            disabled={updateAssignmentMutation.isPending}
                                            className="absolute top-1 right-1 p-0.5 rounded hover:bg-orange-500/20 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                            data-testid={`button-unassign-driver-${occ.occurrenceId}`}
                                            aria-label="Unassign driver"
                                            title="Unassign driver"
                                          >
                                            {updateAssignmentMutation.isPending ? (
                                              <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                              <UserMinus className="w-3 h-3 text-orange-500" />
                                            )}
                                          </button>
                                        </div>
                                      </DraggableOccurrence>
                                    ) : (
                                      <div className="w-full p-2 rounded-b-md bg-muted/30 border border-t-0 border-dashed border-border/50 text-xs text-center text-muted-foreground hover:bg-muted/50 hover:border-blue-400/50 hover:shadow-[0_0_8px_rgba(59,130,246,0.3)] transition-all">
                                        <Badge
                                          variant="secondary"
                                          className="text-xs px-2 py-0.5"
                                          data-testid={`badge-unassigned-${occ.occurrenceId}`}
                                        >
                                          Unassigned
                                        </Badge>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground text-xs py-1">
                              -
                            </div>
                          )}
                        </DroppableCell>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* DragOverlay shows a floating clone while dragging */}
          <DragOverlay>
            {activeOccurrence ? (
              <div className="w-48 p-2 rounded-md bg-blue-100 dark:bg-blue-950/40 border-2 border-blue-400 dark:border-blue-600 shadow-lg">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <span className="font-medium text-blue-900 dark:text-blue-100 text-sm">
                    {activeOccurrence.driverName || 'Unassigned'}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
          </DndContext>
        </CardContent>
      </Card>
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && calendarData && (
        <Card className="flex-1 overflow-hidden">
          <CardContent className="p-4 h-full">
            <ScheduleListView
              occurrences={calendarData.occurrences}
              showRate={showRate}
              sortBy={sortBy}
              filterType={filterType}
            />
          </CardContent>
        </Card>
      )}

        {/* Driver Assignment Modal - Temporarily disabled until modal is updated for occurrences */}
        {/* TODO: Update DriverAssignmentModal to work with occurrenceId instead of blockId */}
        {selectedOccurrence && false && (
          <DriverAssignmentModal
            block={null}
            isOpen={isAssignmentModalOpen}
            onClose={handleCloseModal}
          />
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!shiftToDelete} onOpenChange={(open) => !open && setShiftToDelete(null)}>
          <AlertDialogContent data-testid="dialog-confirm-delete">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Shift?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove this shift occurrence from the calendar. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                data-testid="button-confirm-delete"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Clear All Confirmation Dialog */}
        <AlertDialog open={showClearAllDialog} onOpenChange={setShowClearAllDialog}>
          <AlertDialogContent data-testid="dialog-confirm-clear-all">
            <AlertDialogHeader>
              <AlertDialogTitle>Clear All Shifts for This Week?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete ALL shift occurrences for the week of {format(weekRange.weekStart, "MMM d")} - {format(addDays(weekRange.weekStart, 6), "MMM d, yyyy")}. 
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-clear-all">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearAll}
                disabled={clearAllMutation.isPending}
                data-testid="button-confirm-clear-all"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {clearAllMutation.isPending ? "Clearing..." : "Clear All"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
