import React, { useState, useMemo, memo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks, eachDayOfInterval, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, User, Upload, X, LayoutGrid, List, UserMinus, Undo2, Redo2, CheckSquare, XSquare, Moon, Sun, Zap, Cpu, Shield, AlertTriangle, Search, Sparkles, Loader2, Dna, Clock, Truck } from "lucide-react";
import { ImportOverlay } from "@/components/ImportOverlay";
import { ImportWizard } from "@/components/ImportWizard";
import { ActualsComparisonReview } from "@/components/ActualsComparisonReview";
import { MatrixAnalysisOverlay } from "@/components/MatrixAnalysisOverlay";
import { useTheme } from "@/contexts/ThemeContext";
import { DndContext, DragEndEvent, DragStartEvent, useDraggable, useDroppable, DragOverlay, PointerSensor, useSensor, useSensors, pointerWithin, closestCenter, rectIntersection, closestCorners } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { DriverPoolSidebar, calculateBlockMatch } from "@/components/DriverPoolSidebar";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";
import { DNAPatternBadge } from "@/components/DNAPatternBadge";
import type { DriverDnaProfile } from "@shared/schema";
import { AnalysisPanel } from "@/components/AnalysisPanel";
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
  isRejectedLoad?: boolean; // True if Amazon rejected the driver assignment (no driver in CSV)
  source?: 'imported_block' | 'shift_occurrence'; // Distinguishes imported blocks from legacy shift occurrences
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

  // Only use opacity - no transform to prevent visual movement
  const style = {
    opacity: isDragging ? 0 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      {children}
    </div>
  );
}

// Droppable cell component - memoized to prevent re-renders during drag
const DroppableCell = memo(function DroppableCell({
  id,
  children,
  className,
  isDroppable = true,
  isSelected = false,
  onToggleSelection,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  isDroppable?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
}) {
  // CRITICAL FIX: Never disable droppable - always register with DndContext
  const { isOver, setNodeRef } = useDroppable({
    id,
    disabled: false, // Always enabled - validation happens in handleDragEnd
  });

  // Memoize style to prevent unnecessary re-renders
  const style = useMemo(() => ({
    backgroundColor: isOver ? 'rgba(34, 197, 94, 0.2)' : isSelected ? 'rgba(59, 130, 246, 0.1)' : undefined,
    boxShadow: isOver
      ? '0 0 0 2px rgb(34, 197, 94), inset 0 0 20px rgba(34, 197, 94, 0.2)'
      : isSelected
      ? '0 0 0 2px rgb(59, 130, 246), inset 0 0 20px rgba(59, 130, 246, 0.15)'
      : undefined,
    transition: 'all 0.15s ease',
  }), [isOver, isSelected]);

  return (
    <td ref={setNodeRef} style={style} className={`${className} relative`} data-droppable={isDroppable ? "true" : "false"}>
      {isDroppable && onToggleSelection && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelection(id);
          }}
          className="absolute top-0.5 left-0.5 z-10 w-3 h-3 cursor-pointer opacity-40 hover:opacity-100 transition-opacity"
          title="Select for bulk operations"
        />
      )}
      {children}
    </td>
  );
});

// Custom collision detection that looks at pointer position and finds the cell
const customPointerCollision = (args: any) => {
  const { droppableContainers, pointerCoordinates } = args;

  // Try multiple collision detection strategies in order of preference
  // 1. pointerWithin - most accurate for mouse position
  const pointerCollisions = pointerWithin(args);

  if (pointerCollisions.length > 0) {
    // Prioritize calendar cells over sidebar pool
    const cellCollision = pointerCollisions.find((collision: any) =>
      String(collision.id).startsWith('cell-')
    );
    if (cellCollision) {
      return [cellCollision];
    }
    return pointerCollisions;
  }

  // 2. rectIntersection - more forgiving for drag operations
  const rectCollisions = rectIntersection(args);
  if (rectCollisions.length > 0) {
    const cellCollision = rectCollisions.find((collision: any) =>
      String(collision.id).startsWith('cell-')
    );
    if (cellCollision) {
      return [cellCollision];
    }
    return rectCollisions;
  }

  // 3. closestCenter - fallback for when pointer isn't directly over target
  const centerCollisions = closestCenter(args);
  if (centerCollisions.length > 0) {
    const cellCollision = centerCollisions.find((collision: any) =>
      String(collision.id).startsWith('cell-')
    );
    if (cellCollision) {
      return [cellCollision];
    }
    return centerCollisions;
  }

  // 4. DOM-based fallback - walk up tree to find droppable cell
  if (!pointerCoordinates) return [];
  const element = document.elementFromPoint(pointerCoordinates.x, pointerCoordinates.y);
  if (element) {
    let current: HTMLElement | null = element as HTMLElement;
    let depth = 0;
    while (current && current !== document.body && depth < 10) {
      if (current.tagName === 'TD' && current.dataset?.droppable === 'true') {
        const droppable = args.droppableContainers.find((container: any) =>
          container.node.current === current
        );
        if (droppable) {
          return [{ id: droppable.id }];
        }
      }
      // Stop at non-droppable TD (bench column)
      if (current.tagName === 'TD') {
        return [];
      }
      current = current.parentElement;
      depth++;
    }
  }

  return [];
};

export default function Schedules() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOccurrence, setSelectedOccurrence] = useState<ShiftOccurrence | null>(null);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [pendingImportFiles, setPendingImportFiles] = useState<Array<{ file: File; type: string }>>([]);
  const [shiftToDelete, setShiftToDelete] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"time" | "type">("time");
  const [filterType, setFilterType] = useState<"all" | "solo1" | "solo2" | "team">("all");
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [showRate, setShowRate] = useState(true);
  const [activeOccurrence, setActiveOccurrence] = useState<ShiftOccurrence | null>(null);
  const [activeDriver, setActiveDriver] = useState<Driver | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; occurrence: ShiftOccurrence } | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<{
    type: 'assign' | 'replace' | 'swap' | 'move';
    driver: Driver;
    targetOccurrence: ShiftOccurrence;
    sourceOccurrence?: ShiftOccurrence;
  } | null>(null);

  // Undo/Redo history stacks
  type HistoryChange = {
    occurrenceId: string;
    previousDriverId: string | null;
    newDriverId: string | null;
    blockId: string;
  };

  type HistoryAction = {
    changes: HistoryChange[]; // Support bulk operations
    timestamp: number;
    isBulk: boolean;
  };

  const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

  // Bulk selection state
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Import result state for overlay
  const [importResult, setImportResult] = useState<{
    success: boolean;
    message: string;
    created?: number;
    assigned?: number;
    unassigned?: number;
    failed?: number;
    errors?: string[];
    warnings?: string[];
  } | null>(null);

  // Actuals comparison state
  const [isActualsReviewOpen, setIsActualsReviewOpen] = useState(false);
  const [actualsComparison, setActualsComparison] = useState<{
    summary: {
      totalChanges: number;
      noShows: number;
      driverSwaps: number;
      timeChanges: number;
      newBlocks: number;
      missingBlocks: number;
      dateRange: { start: string; end: string };
    };
    changes: Array<{
      type: 'no_show' | 'driver_swap' | 'time_change' | 'new_block' | 'missing_block';
      blockId: string;
      serviceDate: string;
      expected?: { driverName: string | null; startTime: string };
      actual?: { driverName: string | null; startTime: string };
      description: string;
    }>;
    pendingFile: File | null;
  } | null>(null);
  const [isComparingActuals, setIsComparingActuals] = useState(false);

  // Analysis Panel state
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

  // Compliance analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResults, setAnalysisResults] = useState<{
    violations: Array<{
      occurrenceId: string;
      driverId: string;
      driverName: string;
      blockId: string;
      serviceDate: string;
      startTime: string;
      type: "violation" | "warning";
      messages: string[];
    }>;
    violationCount: number;
    warningCount: number;
    // Bump detection from cascade analysis
    bumps: Array<{
      occurrenceId: string;
      driverId: string;
      driverName: string;
      blockId: string;
      serviceDate: string;
      scheduledTime: string;
      canonicalTime: string;
      bumpMinutes: number;
      bumpHours: number;
      severity: "info" | "warning" | "alert";
    }>;
    bumpCount: number;
    bumpStats: {
      total: number;
      info: number;
      warning: number;
      alert: number;
    };
  } | null>(null);

  // Driver DNA hover state for block matching
  // selectedDriverId = "sticky" selection that persists for Milo interaction
  // hoveredDriverId = ephemeral hover state for visual highlighting
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [hoveredDriverId, setHoveredDriverId] = useState<string | null>(null);
  const [isCardFlipped, setIsCardFlipped] = useState(false); // Flip card state
  const [showAllBlocks, setShowAllBlocks] = useState(false); // Show all matching blocks vs top 4

  // The "active" driver is either selected (sticky) or hovered
  const activeDriverId = selectedDriverId || hoveredDriverId;

  // Reset flip state when driver changes
  useEffect(() => {
    setIsCardFlipped(false);
    setShowAllBlocks(false);
  }, [selectedDriverId]);

  // Use global theme
  const { themeMode, setThemeMode, themeStyles } = useTheme();

  // Configure drag sensors for better performance
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    })
  );

  // Log setup on mount
  useMemo(() => {
    console.log('🎮 Drag-and-drop initialized with custom collision detection');
  }, []);

  // Fetch contracts to get static start times
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  // Fetch all drivers for context menu
  const { data: allDrivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Fetch all DNA profiles for block matching
  const { data: dnaData } = useQuery<{ profiles: DriverDnaProfile[]; stats: any }>({
    queryKey: ["/api/driver-dna"],
  });

  // Convert DNA profiles array to map for easy lookup
  const dnaProfileMap = useMemo(() => {
    const map = new Map<string, DriverDnaProfile>();
    if (dnaData?.profiles) {
      for (const profile of dnaData.profiles) {
        map.set(profile.driverId, profile);
      }
    }
    return map;
  }, [dnaData]);

  // Get the active driver's DNA profile (selected or hovered)
  // Use || null to ensure undefined from .get() becomes null
  const activeDriverProfile = activeDriverId ? (dnaProfileMap.get(activeDriverId) || null) : null;

  // Get the active driver's info for the Milo assistant
  const miloActiveDriver = useMemo(() => {
    if (!activeDriverId) return null;
    const driver = allDrivers.find(d => d.id === activeDriverId);
    if (!driver) return null;
    return {
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      profile: dnaProfileMap.get(driver.id) || null,
    };
  }, [activeDriverId, allDrivers, dnaProfileMap]);

  // Legacy aliases for compatibility
  const hoveredDriverProfile = activeDriverProfile;
  const hoveredDriverName = miloActiveDriver?.name || null;

  // DEBUG: Log when driver profile changes
  useEffect(() => {
    console.log('[DNA DEBUG STATE]', {
      activeDriverId,
      selectedDriverId,
      hoveredDriverId,
      hasActiveProfile: !!activeDriverProfile,
      hasHoveredProfile: !!hoveredDriverProfile,
      dnaProfileMapSize: dnaProfileMap.size,
    });
    if (activeDriverId) {
      console.log('[DNA DEBUG] Active driver changed:', activeDriverId);
      console.log('[DNA DEBUG] Profile found:', activeDriverProfile);
      if (activeDriverProfile) {
        console.log('[DNA DEBUG] Preferred days:', activeDriverProfile.preferredDays);
        console.log('[DNA DEBUG] Preferred times:', activeDriverProfile.preferredStartTimes);
        console.log('[DNA DEBUG] Preferred tractors:', activeDriverProfile.preferredTractors);
        console.log('[DNA DEBUG] Contract type:', activeDriverProfile.preferredContractType);
      } else {
        console.log('[DNA DEBUG WARNING] Active driver has NO DNA profile in map!');
        console.log('[DNA DEBUG] Available profile IDs:', Array.from(dnaProfileMap.keys()));
      }
    }
  }, [activeDriverId, selectedDriverId, hoveredDriverId, activeDriverProfile, hoveredDriverProfile, dnaProfileMap]);

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

      // Invalidate queries in parallel (don't block UI)
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"], refetchType: 'active' });

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

  const handleRightClickUnassigned = (e: React.MouseEvent, occurrence: ShiftOccurrence) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      occurrence,
    });
  };

  const handleAssignFromContextMenu = async (driverId: string) => {
    if (!contextMenu) return;

    try {
      await updateAssignmentMutation.mutateAsync({
        occurrenceId: contextMenu.occurrence.occurrenceId,
        driverId,
      });

      // Invalidate queries in parallel (don't block UI)
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"], refetchType: 'active' });

      const driver = allDrivers.find(d => d.id === driverId);
      toast({
        title: "Driver Assigned",
        description: `${driver?.firstName} ${driver?.lastName} assigned to ${contextMenu.occurrence.blockId}`,
      });

      setContextMenu(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Assignment Failed",
        description: error.message || "Failed to assign driver",
      });
    }
  };

  // Close context menu when clicking outside
  const handleClickOutside = () => {
    setContextMenu(null);
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

      // Show result in overlay
      setImportResult({
        success: true,
        message: result.message || `Imported ${result.created || 0} shifts successfully`,
        created: result.created || 0,
        assigned: result.assigned || 0,
        unassigned: result.unassigned || 0,
        failed: result.failed || 0,
        errors: result.errors,
        warnings: result.warnings,
      });

      setImportFile(null);
    },
    onError: (error: Error) => {
      setImportResult({
        success: false,
        message: error.message || "Failed to import schedule",
        failed: 1,
        errors: [error.message || "Unknown error"],
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setImportFile(files[0]);
    }
  };

  // Handle import from the new wizard
  const handleWizardImport = async (files: Array<{ file: File; type: string }>, importType: "new_week" | "actuals" | "both") => {
    // Store the import type for potential actuals processing
    setPendingImportFiles(files);

    // Close the wizard
    setIsImportWizardOpen(false);

    if (files.length === 0) return;

    // For actuals import, first compare against existing records
    if (importType === "actuals") {
      setIsComparingActuals(true);

      try {
        const formData = new FormData();
        formData.append("file", files[0].file);

        const response = await fetch("/api/schedules/compare-actuals", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to compare actuals");
        }

        const result = await response.json();

        // Store the comparison results and open review dialog
        setActualsComparison({
          summary: result.summary,
          changes: result.changes,
          pendingFile: files[0].file,
        });
        setIsActualsReviewOpen(true);
      } catch (error: any) {
        toast({
          variant: "destructive",
          title: "Comparison Failed",
          description: error.message || "Failed to compare actuals file",
        });
      } finally {
        setIsComparingActuals(false);
      }
    } else {
      // For new week import, proceed directly with the import
      importMutation.mutate({ file: files[0].file });
    }
  };

  // Handle applying actuals changes after review
  const handleApplyActuals = () => {
    if (!actualsComparison?.pendingFile) return;

    // Import the file (which will update records)
    importMutation.mutate({ file: actualsComparison.pendingFile });

    // Close the review dialog
    setIsActualsReviewOpen(false);
    setActualsComparison(null);
  };

  // Handle canceling actuals review
  const handleCancelActualsReview = () => {
    setIsActualsReviewOpen(false);
    setActualsComparison(null);
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

    // Close dialog immediately so truck overlay can show
    setIsImportWizardOpen(false);
    importMutation.mutate({ file: importFile });
  };

  const clearAllMutation = useMutation({
    mutationFn: async ({ weekStart, weekEnd }: { weekStart: string; weekEnd: string }) => {
      // Clear both shift occurrences AND imported blocks
      const [shiftsResponse, blocksResponse] = await Promise.all([
        fetch('/api/shift-occurrences/clear-week', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ weekStart, weekEnd }),
        }),
        fetch('/api/blocks/clear-week', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ weekStart, weekEnd }),
        }),
      ]);

      if (!shiftsResponse.ok) {
        const error = await shiftsResponse.json();
        throw new Error(error.message || 'Failed to clear shifts');
      }

      if (!blocksResponse.ok) {
        const error = await blocksResponse.json();
        throw new Error(error.message || 'Failed to clear blocks');
      }

      const [shiftsResult, blocksResult] = await Promise.all([
        shiftsResponse.json(),
        blocksResponse.json(),
      ]);

      return {
        shiftsCount: shiftsResult.count || 0,
        blocksCount: blocksResult.count || 0
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      toast({
        title: "Schedule Cleared",
        description: `Deleted ${result.shiftsCount} shifts and ${result.blocksCount} imported blocks`,
      });
      setShowClearAllDialog(false);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Clear Failed",
        description: error.message || "Failed to clear schedule",
      });
    },
  });

  const handleClearAll = () => {
    const weekStart = format(weekRange.weekStart, "yyyy-MM-dd");
    const weekEnd = format(addDays(weekRange.weekStart, 6), "yyyy-MM-dd");
    clearAllMutation.mutate({ weekStart, weekEnd });
  };

  // Confirm and execute pending assignment
  const confirmAssignment = () => {
    if (!pendingAssignment) return;

    const { type, driver, targetOccurrence } = pendingAssignment;
    const previousDriverId = targetOccurrence.driverId;

    if (type === 'assign' || type === 'replace') {
      updateAssignmentMutation.mutate(
        {
          occurrenceId: targetOccurrence.occurrenceId,
          driverId: driver.id,
        },
        {
          onSuccess: () => {
            // Record action in undo stack
            const action: HistoryAction = {
              changes: [{
                occurrenceId: targetOccurrence.occurrenceId,
                previousDriverId,
                newDriverId: driver.id,
                blockId: targetOccurrence.blockId,
              }],
              timestamp: Date.now(),
              isBulk: false,
            };
            setUndoStack(prev => [...prev, action]);
            setRedoStack([]); // Clear redo stack on new action

            toast({
              title: type === 'assign' ? "Driver Assigned" : "Driver Replaced",
              description: type === 'assign'
                ? `${driver.firstName} ${driver.lastName} assigned to ${targetOccurrence.blockId}`
                : `${driver.firstName} ${driver.lastName} replaced ${targetOccurrence.driverName} on ${targetOccurrence.blockId}`,
            });
            setPendingAssignment(null);
          },
          onError: (error: any) => {
            toast({
              variant: "destructive",
              title: "Assignment Failed",
              description: error.message || "Failed to assign driver",
            });
            setPendingAssignment(null);
          },
        }
      );
    }
  };

  // Undo last assignment change
  const handleUndo = async () => {
    if (undoStack.length === 0) return;

    const action = undoStack[undoStack.length - 1];

    try {
      // Process all changes in the action
      for (const change of action.changes) {
        await updateAssignmentMutation.mutateAsync({
          occurrenceId: change.occurrenceId,
          driverId: change.previousDriverId,
        });
      }

      setUndoStack(prev => prev.slice(0, -1));
      setRedoStack(prev => [...prev, action]);

      const description = action.isBulk
        ? `Reverted ${action.changes.length} assignments`
        : `Reverted assignment on ${action.changes[0].blockId}`;

      toast({ title: "Undo Successful", description });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Undo Failed",
        description: error.message || "Failed to undo assignment",
      });
    }
  };

  // Redo last undone assignment change
  const handleRedo = async () => {
    if (redoStack.length === 0) return;

    const action = redoStack[redoStack.length - 1];

    try {
      // Process all changes in the action
      for (const change of action.changes) {
        await updateAssignmentMutation.mutateAsync({
          occurrenceId: change.occurrenceId,
          driverId: change.newDriverId,
        });
      }

      setRedoStack(prev => prev.slice(0, -1));
      setUndoStack(prev => [...prev, action]);

      const description = action.isBulk
        ? `Reapplied ${action.changes.length} assignments`
        : `Reapplied assignment on ${action.changes[0].blockId}`;

      toast({ title: "Redo Successful", description });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Redo Failed",
        description: error.message || "Failed to redo assignment",
      });
    }
  };

  // Bulk selection handlers
  const toggleCellSelection = (cellId: string) => {
    setSelectedCells(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cellId)) {
        newSet.delete(cellId);
      } else {
        newSet.add(cellId);
      }
      return newSet;
    });
  };

  const selectAllUnassigned = () => {
    const unassignedCellIds = new Set<string>();
    Object.entries(occurrencesByContract).forEach(([tractorId, dates]) => {
      Object.entries(dates).forEach(([date, occurrences]) => {
        occurrences.forEach(occ => {
          if (!occ.driverId) {
            const cellId = `cell-${date}-${tractorId}-${occ.startTime}`;
            unassignedCellIds.add(cellId);
          }
        });
      });
    });
    setSelectedCells(unassignedCellIds);
    toast({
      title: "Selection Updated",
      description: `Selected ${unassignedCellIds.size} unassigned shifts`,
    });
  };

  const clearSelection = () => {
    setSelectedCells(new Set());
  };

  const unassignSelected = async () => {
    if (selectedCells.size === 0) {
      toast({
        variant: "destructive",
        title: "No Selection",
        description: "Please select cells first",
      });
      return;
    }

    const changes: HistoryChange[] = [];

    try {
      // Find all occurrences in selected cells
      for (const cellId of Array.from(selectedCells)) {
        const parts = cellId.split('-');
        if (parts.length < 6) continue;

        const targetDate = `${parts[1]}-${parts[2]}-${parts[3]}`;
        const targetStartTime = parts[parts.length - 1];
        const targetContractId = parts.slice(4, parts.length - 1).join('-');

        const occurrences = occurrencesByContract[targetContractId]?.[targetDate] || [];
        const matchingOccurrences = occurrences.filter(occ => occ.startTime === targetStartTime);

        for (const occ of matchingOccurrences) {
          if (occ.driverId) {
            // Unassign the driver
            await updateAssignmentMutation.mutateAsync({
              occurrenceId: occ.occurrenceId,
              driverId: null,
            });

            changes.push({
              occurrenceId: occ.occurrenceId,
              previousDriverId: occ.driverId,
              newDriverId: null,
              blockId: occ.blockId,
            });
          }
        }
      }

      if (changes.length > 0) {
        // Record in undo history
        const action: HistoryAction = {
          changes,
          timestamp: Date.now(),
          isBulk: true,
        };
        setUndoStack(prev => [...prev, action]);
        setRedoStack([]);

        toast({
          title: "Bulk Unassign Complete",
          description: `Unassigned ${changes.length} drivers`,
        });
      }

      clearSelection();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Bulk Unassign Failed",
        description: error.message || "Failed to unassign drivers",
      });
    }
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
    onSuccess: () => {
      // Refresh data after successful mutation
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"], refetchType: 'active' });
    },
  });

  // Handle drag start event
  const handleDragStart = (event: DragStartEvent) => {
    // Check if dragging an occurrence or a driver from sidebar
    if (event.active.data.current?.occurrence) {
      const draggedOccurrence = event.active.data.current.occurrence as ShiftOccurrence;
      setActiveOccurrence(draggedOccurrence);
      setActiveDriver(null);
    } else if (event.active.data.current?.type === 'driver') {
      const driver = event.active.data.current.driver as Driver;
      setActiveDriver(driver);
      setActiveOccurrence(null);
    }
  };

  // Handle drag end event
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    console.log('🎯 DIAGNOSTIC: Drag ended', {
      activeId: active.id,
      overId: over?.id,
      hasOver: !!over
    });

    // Clear the active dragged items
    setActiveOccurrence(null);
    setActiveDriver(null);

    if (!over) {
      console.log('❌ DIAGNOSTIC: No drop target detected');
      return;
    }

    const targetId = over.id as string;
    console.log('🎯 DIAGNOSTIC: Drop target ID:', targetId);

    // SPECIAL CASE: Dropping on Available Drivers Pool to unassign
    if (targetId === 'available-drivers-pool') {
      const draggedOccurrence = active.data.current?.occurrence as ShiftOccurrence;

      if (!draggedOccurrence?.driverId) return;

      const driverName = draggedOccurrence.driverName;
      const blockId = draggedOccurrence.blockId;

      // Fire mutation without waiting
      updateAssignmentMutation.mutate(
        {
          occurrenceId: draggedOccurrence.occurrenceId,
          driverId: null,
        },
        {
          onSuccess: () => {
            toast({
              title: "Driver Unassigned",
              description: `${driverName} returned to available pool`,
            });
          },
          onError: (error: any) => {
            toast({
              variant: "destructive",
              title: "Unassign Failed",
              description: error.message || "Failed to unassign driver",
            });
          },
        }
      );

      return;
    }

    // Regular calendar cell drops
    if (!targetId.startsWith('cell-')) {
      return;
    }

    // Parse target cell ID: cell-YYYY-MM-DD-TractorId-HH:MM
    const parts = targetId.split('-');
    console.log('📋 DIAGNOSTIC: Parsing cell ID:', targetId, 'parts:', parts);

    if (parts.length < 6) {
      console.log('❌ DIAGNOSTIC: Invalid cell ID format - too few parts');
      return;
    }

    const targetDate = `${parts[1]}-${parts[2]}-${parts[3]}`;
    const targetStartTime = parts[parts.length - 1];
    const targetContractId = parts.slice(4, parts.length - 1).join('-');

    console.log('📋 DIAGNOSTIC: Parsed cell:', {
      targetDate,
      targetContractId,
      targetStartTime
    });

    // Find target occurrence in the target cell
    const targetCell = occurrencesByContract[targetContractId]?.[targetDate] || [];
    console.log('📋 DIAGNOSTIC: Target cell occurrences:', targetCell);
    console.log('📋 DIAGNOSTIC: Looking for startTime:', targetStartTime);

    const matchingOccurrences = targetCell.filter(occ => occ.startTime === targetStartTime);
    console.log('📋 DIAGNOSTIC: Matching occurrences found:', matchingOccurrences.length, matchingOccurrences);

    if (matchingOccurrences.length === 0) {
      console.log('❌ DIAGNOSTIC: NO MATCHING OCCURRENCES - Cannot drop');
      console.log('📋 DIAGNOSTIC: Available startTimes in this cell:', targetCell.map(o => o.startTime));
      console.log('📋 DIAGNOSTIC: occurrencesByContract keys:', Object.keys(occurrencesByContract));
      console.log('📋 DIAGNOSTIC: dates for tractorId', targetContractId, ':', Object.keys(occurrencesByContract[targetContractId] || {}));

      toast({
        variant: "default",
        title: "Cannot Drop Here",
        description: "This cell has no shift occurrence. Drops are only allowed on cells with existing shifts.",
      });
      return;
    }

    console.log('✅ DIAGNOSTIC: Found matching occurrence:', matchingOccurrences[0]);

    const targetOccurrence = matchingOccurrences[0];

    // Case 1: Dragging a driver from the sidebar
    if (active.data.current?.type === 'driver') {
      const driver = active.data.current.driver as Driver;

      // BULK ASSIGNMENT: If cells are selected and drop is on a selected cell
      if (selectedCells.size > 0 && selectedCells.has(targetId)) {
        const changes: HistoryChange[] = [];

        try {
          // Assign driver to all selected cells
          for (const cellId of Array.from(selectedCells)) {
            const parts = cellId.split('-');
            if (parts.length < 6) continue;

            const date = `${parts[1]}-${parts[2]}-${parts[3]}`;
            const startTime = parts[parts.length - 1];
            const contractId = parts.slice(4, parts.length - 1).join('-');

            const occurrences = occurrencesByContract[contractId]?.[date] || [];
            const matchingOccs = occurrences.filter(occ => occ.startTime === startTime);

            for (const occ of matchingOccs) {
              const previousDriverId = occ.driverId;

              await updateAssignmentMutation.mutateAsync({
                occurrenceId: occ.occurrenceId,
                driverId: driver.id,
              });

              changes.push({
                occurrenceId: occ.occurrenceId,
                previousDriverId,
                newDriverId: driver.id,
                blockId: occ.blockId,
              });
            }
          }

          if (changes.length > 0) {
            // Record bulk operation in undo history
            const action: HistoryAction = {
              changes,
              timestamp: Date.now(),
              isBulk: true,
            };
            setUndoStack(prev => [...prev, action]);
            setRedoStack([]);

            toast({
              title: "Bulk Assignment Complete",
              description: `Assigned ${driver.firstName} ${driver.lastName} to ${changes.length} shifts`,
            });
          }

          clearSelection();
          return;
        } catch (error: any) {
          toast({
            variant: "destructive",
            title: "Bulk Assignment Failed",
            description: error.message || "Failed to assign driver",
          });
          return;
        }
      }

      // SINGLE ASSIGNMENT: If target already has a driver, REPLACE them
      if (targetOccurrence.driverId) {
        setPendingAssignment({
          type: 'replace',
          driver,
          targetOccurrence,
        });
        return;
      }

      // Target is empty - just assign
      setPendingAssignment({
        type: 'assign',
        driver,
        targetOccurrence,
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
      const draggedDriverName = draggedOccurrence.driverName;
      const targetDriverName = targetOccurrence.driverName;

      // Execute first mutation, then second on success
      updateAssignmentMutation.mutate(
        {
          occurrenceId: targetOccurrence.occurrenceId,
          driverId: draggedDriverId,
        },
        {
          onSuccess: () => {
            // Chain second mutation
            updateAssignmentMutation.mutate(
              {
                occurrenceId: draggedOccurrence.occurrenceId,
                driverId: targetDriverId,
              },
              {
                onSuccess: () => {
                  toast({
                    title: "Drivers Swapped",
                    description: `${draggedDriverName} and ${targetDriverName} have been swapped`,
                  });
                },
              }
            );
          },
          onError: (error: any) => {
            toast({
              variant: "destructive",
              title: "Swap Failed",
              description: error.message || "Failed to swap drivers",
            });
          },
        }
      );
    } else {
      // Target is unassigned, just move the driver
      const driverName = draggedOccurrence.driverName;

      updateAssignmentMutation.mutate(
        {
          occurrenceId: targetOccurrence.occurrenceId,
          driverId: draggedOccurrence.driverId,
        },
        {
          onSuccess: () => {
            // Chain second mutation to clear source
            updateAssignmentMutation.mutate(
              {
                occurrenceId: draggedOccurrence.occurrenceId,
                driverId: null,
              },
              {
                onSuccess: () => {
                  toast({
                    title: "Driver Moved",
                    description: `${driverName} has been moved successfully`,
                  });
                },
              }
            );
          },
          onError: (error: any) => {
            toast({
              variant: "destructive",
              title: "Move Failed",
              description: error.message || "Failed to move driver",
            });
          },
        }
      );
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

  // Compliance analysis handler
  const handleAnalyzeCompliance = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisResults(null);

    try {
      // Simulate progress updates for visual effect
      const progressInterval = setInterval(() => {
        setAnalysisProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + Math.random() * 15;
        });
      }, 200);

      const weekStartStr = format(weekRange.weekStart, "yyyy-MM-dd");

      const response = await fetch('/api/schedules/analyze-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ weekStart: weekStartStr }),
      });

      clearInterval(progressInterval);
      setAnalysisProgress(100);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Analysis failed');
      }

      const result = await response.json();

      // Brief delay to show 100% before closing
      await new Promise(resolve => setTimeout(resolve, 500));

      setAnalysisResults({
        violations: result.violations,
        violationCount: result.violationCount,
        warningCount: result.warningCount,
        bumps: result.bumps || [],
        bumpCount: result.bumpCount || 0,
        bumpStats: result.bumpStats || { total: 0, info: 0, warning: 0, alert: 0 },
      });

      // Build smart summary message
      const parts: string[] = [];
      if (result.violationCount > 0) parts.push(`${result.violationCount} HOS violation${result.violationCount > 1 ? 's' : ''}`);
      if (result.warningCount > 0) parts.push(`${result.warningCount} warning${result.warningCount > 1 ? 's' : ''}`);
      if (result.bumpCount > 0) parts.push(`${result.bumpCount} time bump${result.bumpCount > 1 ? 's' : ''}`);

      toast({
        title: "Analysis Complete",
        description: parts.length > 0 ? `Found ${parts.join(', ')}` : "All assignments within compliance",
        variant: result.violationCount > 0 ? "destructive" : "default",
      });

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: error.message || "Failed to analyze compliance",
      });
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
    }
  }, [weekRange.weekStart, toast]);

  // Check if an occurrence has a violation
  const getOccurrenceViolationStatus = useCallback((occurrenceId: string): "violation" | "warning" | null => {
    if (!analysisResults) return null;
    const violation = analysisResults.violations.find(v => v.occurrenceId === occurrenceId);
    return violation?.type || null;
  }, [analysisResults]);

  // Get bump info for an occurrence (only available after analysis)
  const getOccurrenceBump = useCallback((occurrenceId: string) => {
    if (!analysisResults) return null;
    return analysisResults.bumps.find(b => b.occurrenceId === occurrenceId) || null;
  }, [analysisResults]);

  // Check if an occurrence matches search query
  const matchesSearch = useCallback((occ: ShiftOccurrence): boolean => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    const driverMatch = occ.driverName?.toLowerCase().includes(query);
    const blockMatch = occ.blockId?.toLowerCase().includes(query);
    return driverMatch || blockMatch || false;
  }, [searchQuery]);

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

  // Count search matches for feedback
  const searchMatchCount = useMemo(() => {
    if (!searchQuery.trim() || !calendarData) return 0;
    return calendarData.occurrences.filter(matchesSearch).length;
  }, [searchQuery, calendarData, matchesSearch]);

  // Get list of unassigned occurrences for DNA matching
  const unassignedOccurrences = useMemo(() => {
    if (!calendarData) return [];
    return calendarData.occurrences.filter(occ => !occ.driverId);
  }, [calendarData]);

  // Get top matching blocks for the active driver, sorted by match score
  const topMatchingBlocks = useMemo(() => {
    if (!miloActiveDriver?.profile) return [];
    const profile = miloActiveDriver.profile;

    return unassignedOccurrences
      .map(occ => ({
        occurrence: occ,
        matchScore: calculateBlockMatch(occ, profile),
      }))
      .filter(item => item.matchScore >= 0.5) // Only 50%+ matches
      .sort((a, b) => b.matchScore - a.matchScore); // Highest first
  }, [miloActiveDriver?.profile, unassignedOccurrences]);

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

    console.log('📊 DIAGNOSTIC: Occurrences loaded:', calendarData.occurrences.length);
    console.log('📊 DIAGNOSTIC: Grouped by tractorId:', Object.keys(grouped));
    console.log('📊 DIAGNOSTIC: Full grouped structure:', grouped);

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
    const sorted = filtered.sort((a, b) => {
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
    return sorted;
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
    <>
      {/* Matrix Analysis Overlay */}
      <MatrixAnalysisOverlay
        isAnalyzing={isAnalyzing}
        analysisProgress={analysisProgress}
        analysisMessage="Analyzing compliance..."
      />

      {/* Import Overlay with Truck Animation */}
      <ImportOverlay
        isImporting={importMutation.isPending}
        importResult={importResult}
        onClose={() => setImportResult(null)}
      />

      <div
        className="flex flex-col h-full"
        onClick={handleClickOutside}
      >
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
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsImportWizardOpen(true)}
                data-testid="button-import-schedule"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import Schedule
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={() => setShowAnalysisPanel(true)}
                className="bg-green-600 hover:bg-green-700 text-white"
                data-testid="button-analyze"
              >
                <Shield className="w-4 h-4 mr-2" />
                Analyze
                {calendarData && (
                  <>
                    {calendarData.occurrences.filter(b => !b.driverId && !b.isRejectedLoad).length > 0 && (
                      <Badge variant="outline" className="ml-2 text-xs bg-amber-500/20 text-amber-300 border-amber-500/50">
                        {calendarData.occurrences.filter(b => !b.driverId && !b.isRejectedLoad).length}
                      </Badge>
                    )}
                  </>
                )}
              </Button>

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

            {/* Search */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search driver or block ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  data-testid="input-search"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {searchQuery && (
                <Badge variant={searchMatchCount > 0 ? "default" : "secondary"} className="whitespace-nowrap">
                  {searchMatchCount} found
                </Badge>
              )}
            </div>

            {/* Undo/Redo */}
            <div className="flex items-center gap-1 border rounded-md p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUndo}
                disabled={undoStack.length === 0 || updateAssignmentMutation.isPending}
                data-testid="button-undo"
                title="Undo last assignment"
              >
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRedo}
                disabled={redoStack.length === 0 || updateAssignmentMutation.isPending}
                data-testid="button-redo"
                title="Redo last undone assignment"
              >
                <Redo2 className="w-4 h-4" />
              </Button>
            </div>

            {/* Bulk Selection Controls */}
            <div className="flex items-center gap-2 border rounded-md p-1">
              {selectedCells.size > 0 && (
                <span className="text-sm font-medium text-primary px-2">
                  {selectedCells.size} selected
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllUnassigned}
                data-testid="button-select-all-unassigned"
                title="Select all unassigned shifts"
              >
                <CheckSquare className="w-4 h-4 mr-1" />
                Select Unassigned
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearSelection}
                disabled={selectedCells.size === 0}
                data-testid="button-clear-selection"
                title="Clear selection"
              >
                <XSquare className="w-4 h-4 mr-1" />
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={unassignSelected}
                disabled={selectedCells.size === 0 || updateAssignmentMutation.isPending}
                data-testid="button-unassign-selected"
                title="Unassign all selected shifts"
              >
                <UserMinus className="w-4 h-4 mr-1" />
                Unassign Selected
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
        <DndContext
          sensors={sensors}
          collisionDetection={customPointerCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
        <div className="flex flex-1 gap-0 overflow-hidden">
          {/* Driver Pool Sidebar */}
          <DriverPoolSidebar
            currentWeekStart={weekRange.weekStart}
            currentWeekEnd={addDays(weekRange.weekStart, 6)}
            onDriverHoverStart={(driverId) => setHoveredDriverId(driverId)}
            onDriverHoverEnd={() => setHoveredDriverId(null)}
            onDriverSelect={(driverId) => setSelectedDriverId(prev => prev === driverId ? null : driverId)}
            hoveredDriverId={hoveredDriverId}
            selectedDriverId={selectedDriverId}
            unassignedOccurrences={unassignedOccurrences}
          />

          {/* Calendar */}
          <Card className="flex-1 overflow-hidden" style={{ backgroundColor: themeMode === 'day' ? undefined : 'rgba(0, 0, 0, 0.2)' }}>
            <CardContent className="p-0 h-full overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead
              className="sticky top-0 z-10 border-b shadow-md"
              style={{
                backgroundColor: themeMode === 'day' ? undefined : 'rgba(0, 0, 0, 0.3)',
                color: themeStyles.color
              }}
            >
              <tr>
                <th className="text-left p-3 font-semibold min-w-[140px] border-r shadow-sm">
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
                  <tr
                    key={contract.id}
                    className="border-b"
                    style={{
                      backgroundColor: themeMode === 'day' ? undefined : 'rgba(0, 0, 0, 0.1)',
                    }}
                  >
                    {/* Bench Slot Cell */}
                    <td
                      className="p-3 border-r align-top"
                      style={{
                        backgroundColor: themeMode === 'day' ? undefined : 'rgba(0, 0, 0, 0.2)',
                        color: themeStyles.color
                      }}
                    >
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
                      // Filter occurrences by tractorId. For shift occurrences, also filter by startTime.
                      // For imported blocks, filter by contractType (soloType) - e.g. Tractor_6/solo1 vs Tractor_6/solo2
                      const dayOccurrences = (occurrencesByContract[contract.tractorId]?.[dayISO] || [])
                        .filter(occ => {
                          if (occ.source === 'imported_block') {
                            // Imported blocks must match contract type (solo1/solo2/team)
                            return occ.contractType?.toLowerCase() === contract.type.toLowerCase();
                          }
                          // Shift occurrences match by startTime
                          return occ.startTime === contract.startTime;
                        });

                      const cellId = `cell-${dayISO}-${contract.tractorId}-${contract.startTime}`;

                      // Log cell creation with occurrence count
                      if (dayOccurrences.length === 0) {
                        console.log('⚠️ DIAGNOSTIC: Creating EMPTY cell:', cellId);
                      } else {
                        console.log('✅ DIAGNOSTIC: Creating cell with', dayOccurrences.length, 'occurrence(s):', cellId);
                      }

                      return (
                        <DroppableCell
                          key={day.toISOString()}
                          id={cellId}
                          className="p-1.5 border-r last:border-r-0 align-top"
                          isDroppable={true}
                          isSelected={selectedCells.has(cellId)}
                          onToggleSelection={toggleCellSelection}
                        >
                          {dayOccurrences.length > 0 ? (
                            <div className="space-y-1">
                              {dayOccurrences.map((occ, occIndex) => {
                                const isSearchMatch = searchQuery && matchesSearch(occ);
                                // Calculate DNA match for UNASSIGNED blocks only
                                const isUnassigned = !occ.driverId;
                                const hasProfile = !!hoveredDriverProfile;
                                const notRejected = !occ.isRejectedLoad;

                                // DEBUG: Log calculation conditions for first few blocks
                                if (occIndex < 2 && hasProfile) {
                                  console.log('[MATCH CALC DEBUG]', {
                                    blockId: occ.blockId,
                                    isUnassigned,
                                    hasProfile,
                                    notRejected,
                                    willCalculate: isUnassigned && hasProfile && notRejected,
                                    profileData: hoveredDriverProfile ? {
                                      days: hoveredDriverProfile.preferredDays,
                                      times: hoveredDriverProfile.preferredStartTimes,
                                      tractors: hoveredDriverProfile.preferredTractors,
                                      contract: hoveredDriverProfile.preferredContractType,
                                    } : null,
                                    occData: {
                                      serviceDate: occ.serviceDate,
                                      startTime: occ.startTime,
                                      tractorId: occ.tractorId,
                                      contractType: occ.contractType,
                                    }
                                  });
                                }

                                const dnaMatchScore = isUnassigned && hasProfile && notRejected
                                  ? calculateBlockMatch(occ, hoveredDriverProfile!, true) // Always debug for now
                                  : 0;
                                const isHighMatch = dnaMatchScore >= 0.75;
                                const isMedMatch = dnaMatchScore >= 0.5 && dnaMatchScore < 0.75;
                                const isLowMatch = dnaMatchScore > 0 && dnaMatchScore < 0.5;
                                const hasAnyMatch = dnaMatchScore > 0;

                                return (
                                  <div
                                    key={occ.occurrenceId}
                                    className={`
                                      rounded-md transition-all duration-300 ease-out
                                      ${isSearchMatch ? 'ring-2 ring-yellow-400 ring-offset-1 bg-yellow-400/10' : ''}
                                      ${hasAnyMatch ? 'transform scale-[1.02]' : ''}
                                    `}
                                    style={{
                                      // AI purple glow theme for DNA matching
                                      boxShadow: isHighMatch
                                        ? '0 0 20px rgba(147, 51, 234, 0.6), 0 0 40px rgba(147, 51, 234, 0.3), inset 0 0 15px rgba(147, 51, 234, 0.15)'
                                        : isMedMatch
                                        ? '0 0 15px rgba(139, 92, 246, 0.5), 0 0 30px rgba(139, 92, 246, 0.2), inset 0 0 10px rgba(139, 92, 246, 0.1)'
                                        : isLowMatch
                                        ? '0 0 8px rgba(167, 139, 250, 0.4), inset 0 0 6px rgba(167, 139, 250, 0.08)'
                                        : undefined,
                                      outline: isHighMatch
                                        ? '2px solid rgba(147, 51, 234, 0.8)'
                                        : isMedMatch
                                        ? '2px solid rgba(139, 92, 246, 0.7)'
                                        : isLowMatch
                                        ? '1px solid rgba(167, 139, 250, 0.5)'
                                        : undefined,
                                      outlineOffset: hasAnyMatch ? '1px' : undefined,
                                    }}
                                  >
                                    {/* STATIC SECTION - Never moves */}
                                    <div className="relative group">
                                      <button
                                        onClick={() => handleOccurrenceClick(occ)}
                                        className="w-full p-1.5 rounded-t-md text-xs space-y-0.5 text-left transition-colors border border-b-0"
                                        style={{
                                          backgroundColor: themeMode === 'day' ? undefined : 'rgba(255, 255, 255, 0.05)',
                                          color: themeStyles.color,
                                          borderColor: themeMode === 'day' ? undefined : 'rgba(255, 255, 255, 0.1)'
                                        }}
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
                                          {/* Bump indicator - only shows AFTER cascade analysis */}
                                          {(() => {
                                            const bump = getOccurrenceBump(occ.occurrenceId);
                                            if (!bump) return null;
                                            return (
                                              <>
                                                <span>•</span>
                                                <span
                                                  className={`font-medium ${
                                                    bump.severity === "alert" ? "text-red-600 dark:text-red-400" :
                                                    bump.severity === "warning" ? "text-yellow-600 dark:text-yellow-400" :
                                                    "text-blue-600 dark:text-blue-400"
                                                  }`}
                                                  data-testid={`bump-indicator-${occ.occurrenceId}`}
                                                  title={`Scheduled: ${bump.scheduledTime} | Canonical: ${bump.canonicalTime}`}
                                                >
                                                  {formatBumpTime(bump.bumpMinutes)}
                                                </span>
                                              </>
                                            );
                                          })()}
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
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <div className="relative group">
                                                {/* Violation indicator icon */}
                                                {getOccurrenceViolationStatus(occ.occurrenceId) && (
                                                  <div className="absolute -top-1 -right-1 z-20">
                                                    <AlertTriangle
                                                      className={`w-4 h-4 ${
                                                        getOccurrenceViolationStatus(occ.occurrenceId) === 'violation'
                                                          ? 'text-red-500'
                                                          : 'text-amber-500'
                                                      }`}
                                                    />
                                                  </div>
                                                )}
                                                <div
                                                  className={`w-full p-1.5 rounded-b-md border border-t-0 text-xs transition-colors cursor-grab active:cursor-grabbing ${
                                                    getOccurrenceViolationStatus(occ.occurrenceId) === 'violation'
                                                      ? 'violation-gradient'
                                                      : getOccurrenceViolationStatus(occ.occurrenceId) === 'warning'
                                                      ? 'warning-gradient'
                                                      : ''
                                                  }`}
                                                  style={{
                                                    backgroundColor: getOccurrenceViolationStatus(occ.occurrenceId)
                                                      ? undefined
                                                      : (themeMode === 'day' ? undefined : 'rgba(59, 130, 246, 0.15)'),
                                                    borderColor: getOccurrenceViolationStatus(occ.occurrenceId)
                                                      ? undefined
                                                      : (themeMode === 'day' ? undefined : 'rgba(59, 130, 246, 0.3)'),
                                                    color: themeMode === 'day' ? undefined : themeStyles.color
                                                  }}
                                                >
                                                  <div className="flex items-center gap-1.5">
                                                    <User className="w-3 h-3 flex-shrink-0" style={{ color: themeStyles.accentColor }} />
                                                    <span className="font-medium">
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
                                            </TooltipTrigger>
                                            <TooltipContent
                                              side="bottom"
                                              align="start"
                                              sideOffset={2}
                                              alignOffset={-8}
                                              avoidCollisions={true}
                                              collisionPadding={8}
                                            >
                                              <div className="space-y-1">
                                                <div className="font-medium">{occ.driverName}</div>
                                                <div className="text-sm">{occ.blockId}</div>
                                                <div className="text-xs text-muted-foreground">Drag to move or swap</div>
                                              </div>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </DraggableOccurrence>
                                    ) : (
                                      (() => {
                                        // Calculate DNA match score if a driver is hovered/selected
                                        const dnaMatchScore = hoveredDriverProfile && !occ.isRejectedLoad
                                          ? calculateBlockMatch(occ, hoveredDriverProfile, false)
                                          : 0;
                                        const isHighMatch = dnaMatchScore >= 0.75;
                                        const isMedMatch = dnaMatchScore >= 0.5 && dnaMatchScore < 0.75;
                                        const isLowMatch = dnaMatchScore > 0 && dnaMatchScore < 0.5;

                                        return (
                                      <div
                                        className="w-full p-2 rounded-b-md border border-t-0 border-dashed text-xs text-center transition-all cursor-pointer"
                                        style={{
                                          // DNA match highlighting with AI purple glow theme
                                          backgroundColor: isHighMatch
                                            ? 'rgba(147, 51, 234, 0.15)'  // purple-600
                                            : isMedMatch
                                            ? 'rgba(139, 92, 246, 0.1)'   // violet-500
                                            : isLowMatch
                                            ? 'rgba(167, 139, 250, 0.08)' // violet-400
                                            : themeMode === 'day'
                                            ? (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)')
                                            : (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'),
                                          borderColor: isHighMatch
                                            ? 'rgba(147, 51, 234, 0.5)'   // purple-600
                                            : isMedMatch
                                            ? 'rgba(139, 92, 246, 0.35)'  // violet-500
                                            : isLowMatch
                                            ? 'rgba(167, 139, 250, 0.2)'  // violet-400
                                            : themeMode === 'day'
                                            ? (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)')
                                            : (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'),
                                          color: themeMode === 'day'
                                            ? (occ.isRejectedLoad ? '#dc2626' : '#d97706')
                                            : (occ.isRejectedLoad ? '#ff6b6b' : '#fbbf24'),
                                          boxShadow: isHighMatch
                                            ? '0 0 20px rgba(147, 51, 234, 0.6), inset 0 0 10px rgba(147, 51, 234, 0.2)'
                                            : isMedMatch
                                            ? '0 0 12px rgba(139, 92, 246, 0.4), inset 0 0 6px rgba(139, 92, 246, 0.15)'
                                            : isLowMatch
                                            ? '0 0 6px rgba(167, 139, 250, 0.25)'
                                            : undefined,
                                        }}
                                        onContextMenu={(e) => handleRightClickUnassigned(e, occ)}
                                        title={
                                          isHighMatch
                                            ? `AI Match: ${Math.round(dnaMatchScore * 100)}% - Excellent fit for ${hoveredDriverName}`
                                            : isMedMatch
                                            ? `AI Match: ${Math.round(dnaMatchScore * 100)}% - Good fit for ${hoveredDriverName}`
                                            : isLowMatch
                                            ? `AI Match: ${Math.round(dnaMatchScore * 100)}% - Partial fit for ${hoveredDriverName}`
                                            : occ.isRejectedLoad
                                            ? "Rejected load - Amazon rejected driver assignment"
                                            : "Right-click to assign driver"
                                        }
                                      >
                                        <Badge
                                          variant="secondary"
                                          className="text-xs px-2 py-0.5"
                                          style={{
                                            backgroundColor: themeMode === 'day'
                                              ? (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)')
                                              : (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)'),
                                            color: themeMode === 'day'
                                              ? (occ.isRejectedLoad ? '#dc2626' : '#d97706')
                                              : (occ.isRejectedLoad ? '#ff6b6b' : '#fbbf24')
                                          }}
                                          data-testid={`badge-${occ.isRejectedLoad ? 'rejected' : 'unassigned'}-${occ.occurrenceId}`}
                                        >
                                          {occ.isRejectedLoad ? 'Rejected' : 'Unassigned'}
                                        </Badge>
                                      </div>
                                        );
                                      })()
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
        </CardContent>
      </Card>
        </div>

          {/* DragOverlay shows a floating clone while dragging - MUST be outside scroll container */}
          <DragOverlay
            dropAnimation={null}
          >
            {activeDriver ? (
              <div
                className="p-3 rounded-lg bg-blue-500 border-2 border-blue-600 shadow-2xl pointer-events-none"
                style={{
                  width: 'max-content',
                  maxWidth: '200px',
                }}
              >
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-white flex-shrink-0" />
                  <span className="font-semibold text-white text-sm whitespace-nowrap">
                    {activeDriver.firstName} {activeDriver.lastName}
                  </span>
                </div>
              </div>
            ) : activeOccurrence ? (
              <div
                className="p-3 rounded-lg bg-blue-500 border-2 border-blue-600 shadow-2xl pointer-events-none"
                style={{
                  width: 'max-content',
                  maxWidth: '200px',
                }}
              >
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-white flex-shrink-0" />
                  <span className="font-semibold text-white text-sm whitespace-nowrap">
                    {activeOccurrence.driverName || 'Unassigned'}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>

          {/* Milo Driver Profile Card - Flip Card Design with Glowing Block Suggestions */}
          {miloActiveDriver && (
            <div
              className={`
                fixed bottom-6 right-6 z-50
                transition-all duration-500 ease-out
                ${selectedDriverId ? 'animate-in fade-in slide-in-from-bottom-4' : 'animate-in fade-in slide-in-from-right-3'}
              `}
              style={{ perspective: '1000px' }}
              onMouseEnter={() => {
                if (hoveredDriverId) setHoveredDriverId(hoveredDriverId);
              }}
            >
              {/* Flip Card Container - needs min-height for absolute positioned children */}
              <div
                className="relative w-80 transition-transform duration-500 ease-out"
                style={{
                  transformStyle: 'preserve-3d',
                  transform: isCardFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  minHeight: isCardFlipped ? '320px' : `${Math.max(280, 180 + Math.min(topMatchingBlocks.length, showAllBlocks ? topMatchingBlocks.length : 4) * 52)}px`,
                }}
              >
                {/* FRONT SIDE - Driver Name + Quick View */}
                <Card
                  className={`
                    absolute inset-0 w-full h-full cursor-pointer
                    shadow-2xl backdrop-blur-sm
                    transition-all duration-300
                    ${selectedDriverId
                      ? 'border-2 border-sky-500 shadow-[0_0_40px_rgba(14,165,233,0.4)]'
                      : 'border border-sky-300 dark:border-sky-700 hover:border-sky-400'
                    }
                    bg-gradient-to-br from-white/95 to-sky-50/95 dark:from-slate-900/95 dark:to-sky-950/95
                  `}
                  style={{ backfaceVisibility: 'hidden' }}
                  onClick={() => setIsCardFlipped(true)}
                >
                  <CardContent className="p-4">
                    {/* Header: Milo + Driver Name (Close together) */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`
                          w-10 h-10 rounded-full flex items-center justify-center
                          bg-gradient-to-br from-sky-500 to-blue-600
                          ${selectedDriverId ? 'shadow-[0_0_20px_rgba(14,165,233,0.6)] animate-pulse' : 'shadow-lg'}
                        `}>
                          <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base">{miloActiveDriver.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <DNAPatternBadge pattern={miloActiveDriver.profile?.patternGroup} size="sm" showIcon={false} />
                            <ContractTypeBadge contractType={miloActiveDriver.profile?.preferredContractType} size="sm" showIcon={false} />
                          </div>
                        </div>
                      </div>
                      {selectedDriverId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 hover:bg-slate-200 dark:hover:bg-slate-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDriverId(null);
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    {/* Quick Stats - Days/Times/Contract (mirrors Driver Profile page) */}
                    {miloActiveDriver.profile && (
                      <div className="space-y-1.5 mb-3 text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{(miloActiveDriver.profile.preferredDays || []).slice(0, 4).join(", ") || "Any day"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{(miloActiveDriver.profile.preferredStartTimes || []).slice(0, 2).join(", ") || "Any time"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Truck className="w-3.5 h-3.5" />
                          <span>{miloActiveDriver.profile.preferredContractType?.toUpperCase() || "Any contract"}</span>
                        </div>
                      </div>
                    )}

                    {/* Glowing Block Suggestions - Top 4 (only if profile exists) */}
                    {miloActiveDriver.profile ? (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-purple-700 dark:text-purple-400 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            AI Matches ({topMatchingBlocks.length})
                          </span>
                          {topMatchingBlocks.length > 4 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-2 text-[10px] text-sky-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowAllBlocks(!showAllBlocks);
                              }}
                            >
                              {showAllBlocks ? 'Show less' : `+${topMatchingBlocks.length - 4} more`}
                            </Button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {(showAllBlocks ? topMatchingBlocks : topMatchingBlocks.slice(0, 4)).map(({ occurrence: occ, matchScore }) => (
                            <div
                              key={occ.occurrenceId}
                              className={`
                                p-2 rounded-lg text-xs flex items-center justify-between
                                transition-all duration-300 cursor-pointer
                                ${matchScore >= 0.75
                                  ? 'bg-purple-50 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-700 shadow-[0_0_12px_rgba(147,51,234,0.3)]'
                                  : 'bg-violet-50 dark:bg-violet-950/40 border border-violet-300 dark:border-violet-700 shadow-[0_0_8px_rgba(139,92,246,0.25)]'
                                }
                                hover:scale-[1.02]
                              `}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`
                                  w-1.5 h-6 rounded-full
                                  ${matchScore >= 0.75 ? 'bg-purple-500' : 'bg-violet-400'}
                                `} />
                                <div>
                                  <div className="font-medium">{occ.blockId}</div>
                                  <div className="text-muted-foreground">
                                    {format(new Date(occ.serviceDate), 'EEE M/d')} @ {occ.startTime}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`font-bold ${matchScore >= 0.75 ? 'text-purple-600' : 'text-violet-500'}`}>
                                  {Math.round(matchScore * 100)}%
                                </div>
                                <div className="text-[10px] text-muted-foreground">{occ.tractorId || 'Any'}</div>
                              </div>
                            </div>
                          ))}
                          {topMatchingBlocks.length === 0 && (
                            <div className="text-center py-3 text-xs text-muted-foreground italic">
                              No matching blocks found
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mb-3 p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-600">
                        <div className="text-center">
                          <Dna className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                          <p className="text-sm text-muted-foreground mb-2">No profile data yet</p>
                          <p className="text-xs text-muted-foreground">
                            Run analysis from Driver Profile page to enable matching
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Flip hint (only if profile exists) */}
                    {miloActiveDriver.profile && (
                      <div className="text-[10px] text-center text-muted-foreground pt-2 border-t flex items-center justify-center gap-1">
                        <ChevronRight className="w-3 h-3" />
                        Tap for profile details
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* BACK SIDE - DNA Details */}
                <Card
                  className={`
                    absolute inset-0 w-full h-full cursor-pointer
                    shadow-2xl backdrop-blur-sm
                    transition-all duration-300
                    border-2 border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.4)]
                    bg-gradient-to-br from-white/95 to-blue-50/95 dark:from-slate-900/95 dark:to-blue-950/95
                  `}
                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                  onClick={() => setIsCardFlipped(false)}
                >
                  <CardContent className="p-4">
                    {/* Back Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Dna className="w-5 h-5 text-blue-600" />
                        <span className="font-bold text-sm">Driver Profile</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {miloActiveDriver.name}
                      </Badge>
                    </div>

                    {/* Profile Details - AI Summary and Insights (mirrors Driver Profile page) */}
                    {miloActiveDriver.profile ? (
                      <>
                        {/* AI Summary */}
                        <div className="mb-3">
                          <h4 className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">AI Summary</h4>
                          <p className="text-xs text-muted-foreground">
                            {miloActiveDriver.profile.aiSummary || "No AI summary available yet. Run analysis from Driver Profile page."}
                          </p>
                        </div>

                        {/* Insights */}
                        {Array.isArray(miloActiveDriver.profile.insights) && miloActiveDriver.profile.insights.length > 0 && (
                          <div className="mb-3">
                            <h4 className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">Insights</h4>
                            <ul className="text-xs text-muted-foreground space-y-1">
                              {miloActiveDriver.profile.insights.slice(0, 3).map((insight: string, i: number) => (
                                <li key={i} className="flex items-start gap-1">
                                  <Sparkles className="w-3 h-3 mt-0.5 text-purple-500 flex-shrink-0" />
                                  <span>{insight}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Quick Stats Row */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-center">
                            <div className="text-[10px] text-muted-foreground">Days</div>
                            <div className="text-xs font-medium">{(miloActiveDriver.profile.preferredDays || []).length || '—'}</div>
                          </div>
                          <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-center">
                            <div className="text-[10px] text-muted-foreground">Times</div>
                            <div className="text-xs font-medium">{(miloActiveDriver.profile.preferredStartTimes || []).length || '—'}</div>
                          </div>
                          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                            <div className="text-[10px] text-muted-foreground">Score</div>
                            <div className="text-xs font-medium text-purple-600">{Math.round(Number(miloActiveDriver.profile.consistencyScore || 0) * 100)}%</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-600 mb-3">
                        <div className="text-center">
                          <Dna className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                          <p className="text-sm text-muted-foreground mb-2">No profile data</p>
                          <p className="text-xs text-muted-foreground">
                            Run analysis from Driver Profile page
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Flip back hint */}
                    <div className="text-[10px] text-center text-muted-foreground pt-2 border-t flex items-center justify-center gap-1">
                      <ChevronRight className="w-3 h-3 rotate-180" />
                      Tap to go back
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Hint below card when not selected */}
              {!selectedDriverId && (
                <div className="text-[10px] text-center text-muted-foreground mt-2 animate-in fade-in">
                  Click a driver to keep panel open
                </div>
              )}
            </div>
          )}
        </DndContext>
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

      {/* Assignment Confirmation Dialog */}
      <AlertDialog open={!!pendingAssignment} onOpenChange={(open) => !open && setPendingAssignment(null)}>
        <AlertDialogContent data-testid="dialog-confirm-assignment">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAssignment?.type === 'replace' ? 'Replace Driver?' : 'Assign Driver?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAssignment?.type === 'replace' ? (
                <>
                  Replace <strong>{pendingAssignment.targetOccurrence.driverName}</strong> with{' '}
                  <strong>{pendingAssignment.driver.firstName} {pendingAssignment.driver.lastName}</strong> on{' '}
                  <strong>{pendingAssignment.targetOccurrence.blockId}</strong>
                  {' '}({format(new Date(pendingAssignment.targetOccurrence.serviceDate), 'MMM d, yyyy')} at {pendingAssignment.targetOccurrence.startTime})?
                </>
              ) : (
                <>
                  Assign <strong>{pendingAssignment?.driver.firstName} {pendingAssignment?.driver.lastName}</strong> to{' '}
                  <strong>{pendingAssignment?.targetOccurrence.blockId}</strong>
                  {' '}({pendingAssignment && format(new Date(pendingAssignment.targetOccurrence.serviceDate), 'MMM d, yyyy')} at {pendingAssignment?.targetOccurrence.startTime})?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-assignment">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAssignment}
              disabled={updateAssignmentMutation.isPending}
              data-testid="button-confirm-assignment"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {updateAssignmentMutation.isPending ? "Assigning..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Wizard */}
      <ImportWizard
        open={isImportWizardOpen}
        onOpenChange={setIsImportWizardOpen}
        onImport={handleWizardImport}
        onImportComplete={async (dominantWeekStart) => {
          // First, invalidate ALL calendar queries to mark them stale
          await queryClient.invalidateQueries({
            queryKey: ["/api/schedules/calendar"],
            refetchType: 'all'
          });
          // Navigate to the dominant imported week (this will trigger a new query)
          if (dominantWeekStart) {
            setCurrentDate(dominantWeekStart);
          }
          // Force refetch after a small delay to ensure state update has propagated
          setTimeout(() => {
            queryClient.refetchQueries({
              queryKey: ["/api/schedules/calendar"],
              type: 'active'
            });
          }, 100);
        }}
        currentWeekStart={weekRange.weekStart}
      />

      {/* Actuals Comparison Review */}
      <ActualsComparisonReview
        open={isActualsReviewOpen}
        onOpenChange={setIsActualsReviewOpen}
        summary={actualsComparison?.summary || null}
        changes={actualsComparison?.changes || []}
        onApply={handleApplyActuals}
        onCancel={handleCancelActualsReview}
        isApplying={importMutation.isPending}
      />

      {/* Context Menu for Unassigned Blocks */}
      {contextMenu && (
        <div
          className="fixed bg-card border border-border rounded-md shadow-lg py-1 z-50 min-w-[200px] max-h-[400px] overflow-y-auto"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b">
            Assign Driver to {contextMenu.occurrence.blockId}
          </div>
          <div className="py-1">
            {allDrivers
              .filter(d => d.status === 'active' && d.loadEligible)
              .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
              .map(driver => (
                <button
                  key={driver.id}
                  onClick={() => handleAssignFromContextMenu(driver.id)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span>{driver.firstName} {driver.lastName}</span>
                </button>
              ))}
            {allDrivers.filter(d => d.status === 'active' && d.loadEligible).length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                No available drivers
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analysis Panel */}
      {calendarData && (
        <AnalysisPanel
          open={showAnalysisPanel}
          weekStart={weekRange.weekStart}
          weekEnd={addDays(weekRange.weekStart, 6)}
          blocks={calendarData.occurrences.map(occ => ({
            id: occ.occurrenceId,
            blockId: occ.blockId,
            driverId: occ.driverId,
            driverName: occ.driverName,
            serviceDate: occ.serviceDate,
            startTime: occ.startTime,
            contractType: occ.contractType || 'unknown',
            isRejectedLoad: occ.isRejectedLoad,
          }))}
          onAssignDriver={async (blockId, driverId) => {
            // Find the occurrence by blockId
            const occurrence = calendarData.occurrences.find(o => o.blockId === blockId);
            if (!occurrence) return;

            // Use the existing assignment mutation
            await updateAssignmentMutation.mutateAsync({
              occurrenceId: occurrence.occurrenceId,
              driverId,
            });
          }}
          onUnassignAll={async () => {
            // Unassign all blocks that have drivers
            const assignedOccurrences = calendarData.occurrences.filter(o => o.driverId);
            for (const occ of assignedOccurrences) {
              await updateAssignmentMutation.mutateAsync({
                occurrenceId: occ.occurrenceId,
                driverId: null,
              });
            }
          }}
          onClose={() => setShowAnalysisPanel(false)}
        />
      )}
    </div>
  </div>
  </>
  );
}
