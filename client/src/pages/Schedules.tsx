import React, { useState, useMemo, memo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks, eachDayOfInterval, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, User, Upload, X, LayoutGrid, List, UserMinus, Undo2, Redo2, CheckSquare, XSquare, Moon, Sun, Zap, Cpu, AlertTriangle, Search, Sparkles, Loader2, Dna, Clock, Truck, Trash2 } from "lucide-react";
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
import { DriverPoolSidebar, calculateBlockMatch, timeToMinutes, type BlockMatchResult, type StrictnessLevel } from "@/components/DriverPoolSidebar";
import { getMatchColor, getMatchBgColor } from "@/lib/utils";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";
import { DNAPatternBadge } from "@/components/DNAPatternBadge";
import type { DriverDnaProfile } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import type { Block, BlockAssignment, Driver, Contract } from "@shared/schema";
import { MiloChat } from "@/components/MiloChat";
import { MessageSquare } from "lucide-react";

// Day formatting helpers for DNA profile display (Sunday-Saturday order)
const DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const sortDays = (days: string[] | null): string[] => {
  if (!days) return [];
  return [...days].sort((a, b) =>
    DAY_ORDER.indexOf(a.toLowerCase()) - DAY_ORDER.indexOf(b.toLowerCase())
  );
};

const formatDay = (day: string) => {
  const map: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat",
  };
  return map[day.toLowerCase()] || day.slice(0, 3);
};

// Generate a consistent gradient color for each driver name
// Uses a hash of the driver name to pick from a set of distinct gradient color pairs
const DRIVER_GRADIENT_COLORS = [
  { from: '#6366f1', to: '#8b5cf6' },  // Indigo to Purple
  { from: '#06b6d4', to: '#0891b2' },  // Cyan to Darker Cyan
  { from: '#10b981', to: '#059669' },  // Emerald to Darker Emerald
  { from: '#f59e0b', to: '#d97706' },  // Amber to Darker Amber
  { from: '#ec4899', to: '#db2777' },  // Pink to Darker Pink
  { from: '#8b5cf6', to: '#7c3aed' },  // Violet to Darker Violet
  { from: '#14b8a6', to: '#0d9488' },  // Teal to Darker Teal
  { from: '#f97316', to: '#ea580c' },  // Orange to Darker Orange
  { from: '#3b82f6', to: '#2563eb' },  // Blue to Darker Blue
  { from: '#a855f7', to: '#9333ea' },  // Purple to Darker Purple
  { from: '#22c55e', to: '#16a34a' },  // Green to Darker Green
  { from: '#ef4444', to: '#dc2626' },  // Red to Darker Red
  { from: '#84cc16', to: '#65a30d' },  // Lime to Darker Lime
  { from: '#0ea5e9', to: '#0284c7' },  // Sky to Darker Sky
  { from: '#d946ef', to: '#c026d3' },  // Fuchsia to Darker Fuchsia
  { from: '#f43f5e', to: '#e11d48' },  // Rose to Darker Rose
];

const getDriverGradient = (driverName: string | null): { background: string; borderColor: string } => {
  if (!driverName) return { background: 'transparent', borderColor: 'transparent' };

  // Simple hash function to get consistent index for same name
  let hash = 0;
  for (let i = 0; i < driverName.length; i++) {
    const char = driverName.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  const index = Math.abs(hash) % DRIVER_GRADIENT_COLORS.length;
  const colors = DRIVER_GRADIENT_COLORS[index];

  return {
    background: `linear-gradient(135deg, ${colors.from}60 0%, ${colors.to}80 100%)`,
    borderColor: colors.from + 'AA'
  };
};

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

// Block analysis type for Driver Profile Analyzer
type BlockAnalysis = {
  occurrence: ShiftOccurrence;
  topMatches: Array<{
    driverId: string;
    driverName: string;
    score: number;
    matchResult: BlockMatchResult;
    dnaProfile: DriverDnaProfile;
  }>;
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

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // DNA Analysis mutation (same as Schedule Intelligence page)
  const analyzeDnaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/driver-dna/analyze", {});
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Analysis Complete",
        description: `Analyzed ${result.totalDrivers} drivers successfully.`,
      });
      // Refresh DNA profiles
      queryClient.invalidateQueries({ queryKey: ["/api/driver-dna"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Block analyzer state
  const [showBlockAnalyzer, setShowBlockAnalyzer] = useState(false);

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
  const [isMiloChatOpen, setIsMiloChatOpen] = useState(false);
  // Matching block IDs from sidebar - these are the EXACT blocks shown in the flip card
  const [sidebarMatchingBlockIds, setSidebarMatchingBlockIds] = useState<string[]>([]);
  // Flip card state moved to sidebar - isCardFlipped and showAllBlocks removed

  // The "active" driver is either selected (sticky) or hovered
  const activeDriverId = selectedDriverId || hoveredDriverId;

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

  // Helper to check if a bench slot row matches the selected driver's DNA profile
  // Used to add subtle glow on matching rows when a driver is selected
  // EXACT MATCH ONLY: time must match exactly (no tolerance)
  const doesRowMatchDriverDNA = useCallback((contractType: string, startTime: string): boolean => {
    if (!activeDriverProfile) return false;

    // Check contract type match
    const driverContract = activeDriverProfile.preferredContractType?.toLowerCase();
    if (driverContract && driverContract !== contractType.toLowerCase()) return false;

    // Check time match - EXACT match only (no tolerance)
    const preferredTimes = activeDriverProfile.preferredStartTimes || [];
    if (preferredTimes.length === 0) return false;

    // Normalize time format for comparison (HH:MM)
    const normalizeTime = (t: string) => t.slice(0, 5);
    const slotTimeNorm = normalizeTime(startTime);

    for (const prefTime of preferredTimes) {
      if (normalizeTime(prefTime) === slotTimeNorm) return true; // Exact match only
    }
    return false;
  }, [activeDriverProfile]);


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
      // Clear driver assignments from blocks (keeps blocks intact for re-matching)
      const [shiftsResponse, assignmentsResponse] = await Promise.all([
        fetch('/api/shift-occurrences/clear-week', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ weekStart, weekEnd }),
        }),
        fetch('/api/assignments/clear-week', {
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

      if (!assignmentsResponse.ok) {
        const error = await assignmentsResponse.json();
        throw new Error(error.message || 'Failed to clear assignments');
      }

      const [shiftsResult, assignmentsResult] = await Promise.all([
        shiftsResponse.json(),
        assignmentsResponse.json(),
      ]);

      return {
        shiftsCount: shiftsResult.count || 0,
        assignmentsCount: assignmentsResult.count || 0
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"] });
      toast({
        title: "Assignments Cleared",
        description: `Cleared ${result.shiftsCount} shifts and ${result.assignmentsCount} block assignments`,
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

  const selectAllBlocks = () => {
    const allCellIds = new Set<string>();
    Object.entries(occurrencesByContract).forEach(([tractorId, dates]) => {
      Object.entries(dates).forEach(([date, occurrences]) => {
        occurrences.forEach(occ => {
          const cellId = `cell-${date}-${tractorId}-${occ.startTime}`;
          allCellIds.add(cellId);
        });
      });
    });
    setSelectedCells(allCellIds);
    toast({
      title: "Selection Updated",
      description: `Selected all ${allCellIds.size} blocks`,
    });
  };

  const selectAllAssigned = () => {
    const assignedCellIds = new Set<string>();
    Object.entries(occurrencesByContract).forEach(([tractorId, dates]) => {
      Object.entries(dates).forEach(([date, occurrences]) => {
        occurrences.forEach(occ => {
          if (occ.driverId) {
            const cellId = `cell-${date}-${tractorId}-${occ.startTime}`;
            assignedCellIds.add(cellId);
          }
        });
      });
    });
    setSelectedCells(assignedCellIds);
    toast({
      title: "Selection Updated",
      description: `Selected ${assignedCellIds.size} assigned shifts`,
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

  // Show confirmation dialog before deleting
  const deleteSelected = () => {
    if (selectedCells.size === 0) {
      toast({
        variant: "destructive",
        title: "No Selection",
        description: "Please select blocks first",
      });
      return;
    }
    // Show confirmation dialog
    setShowDeleteConfirm(true);
  };

  // Actually perform the delete after confirmation
  const confirmDeleteSelected = async () => {
    setIsDeleting(true);

    // Collect unique occurrence IDs to delete (occurrenceId is the database UUID)
    const occurrenceIdsToDelete = new Set<string>();

    for (const cellId of Array.from(selectedCells)) {
      const parts = cellId.split('-');
      if (parts.length < 6) continue;

      const targetDate = `${parts[1]}-${parts[2]}-${parts[3]}`;
      const targetStartTime = parts[parts.length - 1];
      const targetContractId = parts.slice(4, parts.length - 1).join('-');

      const occurrences = occurrencesByContract[targetContractId]?.[targetDate] || [];
      const matchingOccurrences = occurrences.filter(occ => occ.startTime === targetStartTime);

      for (const occ of matchingOccurrences) {
        // Use occurrenceId (database UUID) not blockId (Amazon block ID)
        occurrenceIdsToDelete.add(occ.occurrenceId);
      }
    }

    if (occurrenceIdsToDelete.size === 0) {
      toast({
        variant: "destructive",
        title: "No Blocks Found",
        description: "Could not find blocks to delete",
      });
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      return;
    }

    try {
      let deletedCount = 0;
      for (const occurrenceId of occurrenceIdsToDelete) {
        // Delete using the database UUID (occurrenceId)
        const response = await fetch(`/api/blocks/${occurrenceId}`, {
          method: 'DELETE',
          credentials: 'include',
        });

        if (response.ok) {
          deletedCount++;
        }
      }

      toast({
        title: "Blocks Deleted",
        description: `Permanently deleted ${deletedCount} blocks`,
      });

      clearSelection();
      setShowDeleteConfirm(false);
      // Refetch calendar data
      queryClient.invalidateQueries({ queryKey: ['/api/schedules/calendar'] });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: error.message || "Failed to delete blocks",
      });
    } finally {
      setIsDeleting(false);
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

  // Quick-assign a driver to a block when clicked from sidebar flip card
  // Note: This function is defined here but uses calendarData which is defined later.
  // We use a ref to access current calendarData value.
  const handleBlockClickRef = useRef<((occurrenceId: string, driverId?: string) => Promise<void>) | null>(null);

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

    // Clear the active dragged items
    setActiveOccurrence(null);
    setActiveDriver(null);

    if (!over) {
      return;
    }

    const targetId = over.id as string;

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

    if (parts.length < 6) {
      return;
    }

    const targetDate = `${parts[1]}-${parts[2]}-${parts[3]}`;
    const targetStartTime = parts[parts.length - 1];
    const targetContractId = parts.slice(4, parts.length - 1).join('-');

    // Find target occurrence in the target cell
    const targetCell = occurrencesByContract[targetContractId]?.[targetDate] || [];

    const matchingOccurrences = targetCell.filter(occ => occ.startTime === targetStartTime);

    if (matchingOccurrences.length === 0) {
      toast({
        variant: "default",
        title: "Cannot Drop Here",
        description: "This cell has no shift occurrence. Drops are only allowed on cells with existing shifts.",
      });
      return;
    }

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

  // Block analysis for Driver Profile Analyzer - analyze each unassigned block against all drivers
  const blockAnalysis = useMemo<BlockAnalysis[]>(() => {
    if (!unassignedOccurrences.length || !dnaData?.profiles?.length) return [];

    // Map driver IDs to driver names for lookup
    const driverNameMap = new Map<string, string>();
    for (const driver of allDrivers) {
      driverNameMap.set(driver.id, `${driver.firstName} ${driver.lastName}`);
    }

    return unassignedOccurrences.map(occ => {
      // Calculate match scores for ALL drivers with DNA profiles
      const driverMatches = dnaData.profiles
        .map((profile: DriverDnaProfile) => {
          const matchResult = calculateBlockMatch(
            occ,
            profile,
            'balanced' as StrictnessLevel
          );
          return {
            driverId: profile.driverId,
            driverName: driverNameMap.get(profile.driverId) || profile.driverId,
            score: matchResult.score,
            matchResult,
            dnaProfile: profile,
          };
        })
        .filter(match => match.score > 0) // Only include drivers with some match
        .sort((a, b) => b.score - a.score); // Sort by score descending

      return {
        occurrence: occ,
        topMatches: driverMatches, // Include ALL matching drivers, not just top 5
      };
    });
  }, [unassignedOccurrences, dnaData?.profiles, allDrivers]);

  // Use the matching block IDs from the sidebar (single source of truth)
  // These are the EXACT same blocks shown in the flip card
  const highlightedOccurrenceIds = useMemo(() => {
    return new Set(sidebarMatchingBlockIds);
  }, [sidebarMatchingBlockIds]);

  // Auto-scroll to first matching block when a driver is SELECTED (clicked, not hovered)
  useEffect(() => {
    if (!selectedDriverId || highlightedOccurrenceIds.size === 0) return;

    // Get the first highlighted occurrence ID
    const firstMatchId = highlightedOccurrenceIds.values().next().value;
    if (!firstMatchId) return;

    // Small delay to ensure DOM is updated with highlighting
    const scrollTimeout = setTimeout(() => {
      const element = document.querySelector(`[data-occurrence-id="${firstMatchId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }, 100);

    return () => clearTimeout(scrollTimeout);
  }, [selectedDriverId, highlightedOccurrenceIds]);

  // Note: topMatchingBlocks moved to DriverPoolSidebar flip cards

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

  // Quick-assign a driver to a block when clicked from sidebar flip card
  // Now defined after calendarData so we can record undo history
  const handleBlockClick = useCallback(async (occurrenceId: string, driverId?: string) => {
    const element = document.querySelector(`[data-occurrence-id="${occurrenceId}"]`);
    const blockId = element?.getAttribute('data-block-id') || 'Block';

    if (driverId) {
      // Find the occurrence to get previous driver (should be null for unassigned)
      const occurrence = calendarData?.occurrences.find(o => o.occurrenceId === occurrenceId);
      const previousDriverId = occurrence?.driverId || null;

      // VALIDATION: Check if driver already has an assignment that violates DOT rules
      if (occurrence && calendarData) {
        const blockDate = occurrence.serviceDate;
        const blockTime = occurrence.startTime;
        const blockDatetime = new Date(`${blockDate}T${blockTime}:00`);
        const blockContractType = (occurrence.contractType || 'solo1').toLowerCase();
        const isSolo2 = blockContractType === 'solo2';

        // Get driver's existing assignments
        const driverAssignments = calendarData.occurrences
          .filter(o => o.driverId === driverId)
          .map(o => ({
            date: o.serviceDate,
            datetime: new Date(`${o.serviceDate}T${o.startTime}:00`),
          }));

        // Check DOT compliance based on contract type:
        // - Solo1: 12hr block + 10hr rest = 22hr minimum from start to start
        // - Solo2: 24hr block (leave Day 1, return Day 2) + 10hr rest = 34hr from start to start
        const BLOCK_DURATION_HOURS = isSolo2 ? 24 : 12;
        const REST_HOURS = 10;
        const minGapMs = (BLOCK_DURATION_HOURS + REST_HOURS) * 60 * 60 * 1000;
        const gapDescription = isSolo2 ? '24hr block + 10hr rest' : '12hr block + 10hr rest';

        for (const existing of driverAssignments) {
          // New block must start after the min gap from existing block
          const timeDiff = blockDatetime.getTime() - existing.datetime.getTime();

          // Check if new block is within the blocked window
          if (timeDiff >= 0 && timeDiff < minGapMs) {
            const driver = allDrivers.find(d => d.id === driverId);
            const earliestStart = new Date(existing.datetime.getTime() + minGapMs);
            const earliestTimeStr = earliestStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            toast({
              variant: "destructive",
              title: "Assignment Blocked",
              description: `${driver?.firstName} ${driver?.lastName} has a block on ${existing.date}. Next block can start at ${earliestTimeStr} (${gapDescription}).`,
            });
            return; // Don't proceed with assignment
          }

          // Also check if existing block would start within the gap window after the new block
          const reverseTimeDiff = existing.datetime.getTime() - blockDatetime.getTime();
          if (reverseTimeDiff >= 0 && reverseTimeDiff < minGapMs) {
            const driver = allDrivers.find(d => d.id === driverId);
            toast({
              variant: "destructive",
              title: "Assignment Blocked",
              description: `${driver?.firstName} ${driver?.lastName} has a later block that's too close. Need ${BLOCK_DURATION_HOURS + REST_HOURS}hr gap (${gapDescription}).`,
            });
            return; // Don't proceed with assignment
          }
        }
      }

      try {
        await updateAssignmentMutation.mutateAsync({ occurrenceId, driverId });

        const driver = allDrivers.find(d => d.id === driverId);

        // Record in undo history
        const action = {
          changes: [{
            occurrenceId,
            previousDriverId,
            newDriverId: driverId,
            blockId,
          }],
          timestamp: Date.now(),
          isBulk: false,
        };
        setUndoStack(prev => [...prev, action]);
        setRedoStack([]); // Clear redo on new action

        // Scroll to block and show success animation
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          element.classList.add('ring-4', 'ring-green-500', 'ring-offset-2', 'animate-pulse');
          setTimeout(() => {
            element.classList.remove('ring-4', 'ring-green-500', 'ring-offset-2', 'animate-pulse');
          }, 1500);
        }

        toast({
          title: "Driver Assigned",
          description: `${driver?.firstName} ${driver?.lastName} → ${blockId}`,
        });

        // Refresh data to update counts
        queryClient.invalidateQueries({ queryKey: ["/api/schedules/calendar"], refetchType: 'active' });
        queryClient.invalidateQueries({ queryKey: ["/api/drivers"], refetchType: 'active' });

      } catch (error: any) {
        toast({
          variant: "destructive",
          title: "Assignment Failed",
          description: error.message || "Failed to assign driver",
        });
      }
    } else {
      // Just scroll to block (no assignment)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        element.classList.add('ring-4', 'ring-green-500', 'ring-offset-2');
        setTimeout(() => {
          element.classList.remove('ring-4', 'ring-green-500', 'ring-offset-2');
        }, 2000);
      }
    }
  }, [calendarData, updateAssignmentMutation, allDrivers, toast, queryClient, setUndoStack, setRedoStack]);

  // Two-way matching: Click unassigned block → Find and select matching driver
  // Uses the same Holy Grail matching logic (Contract + Day + Time)
  const handleUnassignedBlockClick = useCallback((occurrence: ShiftOccurrence) => {
    if (!dnaProfileMap.size || !allDrivers.length) {
      return;
    }

    const blockContract = (occurrence.contractType || '').toLowerCase();
    // IMPORTANT: Parse date as local time to avoid timezone shift
    // serviceDate is "YYYY-MM-DD", adding T00:00:00 makes it local
    const blockDate = new Date(occurrence.serviceDate + 'T00:00:00');
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const blockDay = dayNames[blockDate.getDay()];
    const blockTime = occurrence.startTime;

    // Find all drivers with matching DNA profiles
    const matchingDrivers: { driverId: string; driverName: string; score: number }[] = [];

    for (const driver of allDrivers) {
      const profile = dnaProfileMap.get(driver.id);
      if (!profile) continue;

      // Check contract type match
      const driverContract = (profile.preferredContractType || '').toLowerCase();
      if (driverContract !== blockContract) continue;

      // Check day match
      const preferredDays = profile.preferredDays || [];
      if (!preferredDays.some(d => d.toLowerCase() === blockDay)) continue;

      // Check time match (within 2 hours)
      const preferredTimes = profile.preferredStartTimes || [];
      if (preferredTimes.length === 0) continue;

      let bestTimeDiff = Infinity;
      for (const prefTime of preferredTimes) {
        const blockMinutes = timeToMinutes(blockTime);
        const prefMinutes = timeToMinutes(prefTime);
        const diff = Math.abs(blockMinutes - prefMinutes);
        const wrapDiff = Math.min(diff, 1440 - diff);
        bestTimeDiff = Math.min(bestTimeDiff, wrapDiff);
      }

      // Time must be within 2 hours
      if (bestTimeDiff > 120) continue;

      matchingDrivers.push({
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
        score: bestTimeDiff === 0 ? 100 : (100 - Math.floor(bestTimeDiff / 1.2)),
      });
    }

    // Sort by score (highest first)
    matchingDrivers.sort((a, b) => b.score - a.score);

    if (matchingDrivers.length === 0) {
      toast({
        title: "No Matching Drivers",
        description: `No drivers with matching DNA profile for ${occurrence.blockId}`,
        variant: "default",
      });
      return;
    }

    // Select the best matching driver
    const bestMatch = matchingDrivers[0];
    setSelectedDriverId(bestMatch.driverId);

    // Scroll to the driver in the sidebar
    setTimeout(() => {
      const driverElement = document.querySelector(`[data-driver-id="${bestMatch.driverId}"]`);
      if (driverElement) {
        driverElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add visual highlight animation
        driverElement.classList.add('ring-4', 'ring-green-500', 'ring-offset-2');
        setTimeout(() => {
          driverElement.classList.remove('ring-4', 'ring-green-500', 'ring-offset-2');
        }, 2000);
      }
    }, 100);

    toast({
      title: "Best Match Found",
      description: `${bestMatch.driverName} (${bestMatch.score}% match) for ${occurrence.blockId}`,
    });
  }, [dnaProfileMap, allDrivers, toast, setSelectedDriverId]);

  // Click on time slot row header → Find and highlight all matching drivers
  // Shows drivers whose DNA matches this contract type + time slot (EXACT time match only)
  const handleTimeSlotClick = useCallback((contractType: string, startTime: string) => {
    if (!dnaProfileMap.size || !allDrivers.length) {
      return;
    }

    const slotContract = contractType.toLowerCase();
    const slotTime = startTime;
    const slotMinutes = timeToMinutes(slotTime);

    // Find all drivers with matching DNA profiles - EXACT time match (within 30 min)
    const matchingDrivers: { driverId: string; driverName: string; score: number }[] = [];

    for (const driver of allDrivers) {
      const profile = dnaProfileMap.get(driver.id);
      if (!profile) continue;

      // Check contract type match
      const driverContract = (profile.preferredContractType || '').toLowerCase();
      if (driverContract !== slotContract) continue;

      // Check time match - EXACT match only (within 30 minutes)
      const preferredTimes = profile.preferredStartTimes || [];
      if (preferredTimes.length === 0) continue;

      let bestTimeDiff = Infinity;
      for (const prefTime of preferredTimes) {
        const prefMinutes = timeToMinutes(prefTime);
        const diff = Math.abs(slotMinutes - prefMinutes);
        const wrapDiff = Math.min(diff, 1440 - diff);
        bestTimeDiff = Math.min(bestTimeDiff, wrapDiff);
      }

      // Time must be within 30 minutes for exact slot match
      if (bestTimeDiff > 30) continue;

      matchingDrivers.push({
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
        score: bestTimeDiff === 0 ? 100 : (100 - Math.floor(bestTimeDiff)),
      });
    }

    // Sort by score (highest first)
    matchingDrivers.sort((a, b) => b.score - a.score);

    if (matchingDrivers.length === 0) {
      toast({
        title: "No Matching Drivers",
        description: `No drivers with ${slotContract.toUpperCase()} DNA profile for ${slotTime}`,
        variant: "default",
      });
      return;
    }

    // Select the best matching driver
    const bestMatch = matchingDrivers[0];
    setSelectedDriverId(bestMatch.driverId);

    // Scroll to the driver in the sidebar
    setTimeout(() => {
      const driverElement = document.querySelector(`[data-driver-id="${bestMatch.driverId}"]`);
      if (driverElement) {
        driverElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add visual highlight animation
        driverElement.classList.add('ring-4', 'ring-green-500', 'ring-offset-2');
        setTimeout(() => {
          driverElement.classList.remove('ring-4', 'ring-green-500', 'ring-offset-2');
        }, 2000);
      }
    }, 100);

    toast({
      title: `${matchingDrivers.length} Matching Drivers`,
      description: `Best: ${bestMatch.driverName} (${bestMatch.score}%) for ${slotContract.toUpperCase()} @ ${slotTime}`,
    });
  }, [dnaProfileMap, allDrivers, toast, setSelectedDriverId]);

  // Update ref for any components that need it before calendarData is available
  useEffect(() => {
    handleBlockClickRef.current = handleBlockClick;
  }, [handleBlockClick]);

  // Handle applying multiple blocks from CirclePacking "Apply to Calendar" button
  const handleApplyBlocks = useCallback(async (blockIds: string[], driverId: string) => {
    // Apply each block assignment sequentially
    for (const blockId of blockIds) {
      await handleBlockClick(blockId, driverId);
    }

    toast({
      title: "Blocks Applied",
      description: `Applied ${blockIds.length} block${blockIds.length !== 1 ? 's' : ''} to calendar`,
    });
  }, [handleBlockClick, toast]);

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
                onClick={() => setIsMiloChatOpen(true)}
                className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white border-0"
                data-testid="button-milo-chat"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Ask MILO
              </Button>

              {/* DNA Matching Status Indicator */}
              {activeDriverId && (
                <div className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 ${
                  hoveredDriverProfile
                    ? 'bg-green-600 text-white shadow-lg shadow-green-500/30'
                    : 'bg-red-600 text-white'
                }`}>
                  <span className="text-lg">🧬</span>
                  <span>
                    {hoveredDriverProfile
                      ? `Matching blocks for: ${miloActiveDriver?.name}`
                      : `NO PROFILE for ${miloActiveDriver?.name || 'driver'}!`}
                  </span>
                </div>
              )}

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
                onClick={selectAllBlocks}
                data-testid="button-select-all"
                title="Select all blocks"
              >
                <CheckSquare className="w-4 h-4 mr-1" />
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllAssigned}
                data-testid="button-select-assigned"
                title="Select all assigned shifts"
              >
                <User className="w-4 h-4 mr-1" />
                Select Assigned
              </Button>
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
              <Button
                variant="destructive"
                size="sm"
                onClick={deleteSelected}
                disabled={selectedCells.size === 0}
                data-testid="button-delete-selected"
                title="Delete all selected blocks permanently"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete Selected
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

            {/* Block Analyzer Toggle */}
            <Button
              variant={showBlockAnalyzer ? "default" : "outline"}
              size="sm"
              onClick={() => setShowBlockAnalyzer(!showBlockAnalyzer)}
              className="flex items-center gap-1"
            >
              <Dna className="w-4 h-4" />
              Block Analyzer
              {blockAnalysis.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {blockAnalysis.length}
                </Badge>
              )}
            </Button>
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
            onBlockClick={handleBlockClick}
            onApplyBlocks={handleApplyBlocks}
            onMatchingBlocksChange={setSidebarMatchingBlockIds}
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
                sortedContracts.map((contract) => {
                  // Check if this row matches the selected driver's DNA profile
                  const isRowHighlighted = doesRowMatchDriverDNA(contract.type, contract.startTime);

                  return (
                  <tr
                    key={contract.id}
                    className="border-b"
                    style={{
                      backgroundColor: themeMode === 'day' ? undefined : 'rgba(0, 0, 0, 0.1)',
                    }}
                  >
                    {/* Bench Slot Cell - Click to find matching drivers */}
                    <td
                      className={`p-3 border-r align-top cursor-pointer transition-all duration-300 ${
                        isRowHighlighted
                          ? ''
                          : 'hover:bg-sky-50 dark:hover:bg-sky-900/20'
                      }`}
                      style={{
                        background: isRowHighlighted
                          ? (themeMode === 'day'
                              ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(14, 165, 233, 0.25) 100%)'
                              : 'linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(14, 165, 233, 0.35) 100%)')
                          : (themeMode === 'day' ? undefined : 'rgba(0, 0, 0, 0.2)'),
                        color: themeStyles.color,
                        boxShadow: isRowHighlighted
                          ? '0 0 20px rgba(56, 189, 248, 0.4), inset 0 0 15px rgba(56, 189, 248, 0.1)'
                          : undefined,
                        borderLeft: isRowHighlighted ? '3px solid rgba(14, 165, 233, 0.9)' : undefined,
                      }}
                      onClick={() => handleTimeSlotClick(contract.type, contract.startTime)}
                      title={`Click to find ${contract.type.toUpperCase()} drivers for ${contract.startTime}`}
                    >
                      <div className="space-y-1.5">
                        {/* Start Time & Status */}
                        <div className="flex items-center justify-between">
                          <span className="text-base font-mono font-semibold text-foreground hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
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
                                // Use pre-computed highlighted IDs (Holy Grail matching: one block per day)
                                const isUnassigned = !occ.driverId;
                                const isHighlighted = highlightedOccurrenceIds.has(occ.occurrenceId);

                                // For highlighted blocks, show as high match (100%)
                                const isHighMatch = isHighlighted;
                                const isMedMatch = false; // No partial matches in Holy Grail
                                const isLowMatch = false;
                                const hasAnyMatch = isHighlighted;

                                return (
                                  <div
                                    key={occ.occurrenceId}
                                    data-occurrence-id={occ.occurrenceId}
                                    data-block-id={occ.blockId}
                                    className={`
                                      rounded-md transition-all duration-300 ease-out
                                      ${isSearchMatch ? 'ring-2 ring-yellow-400 ring-offset-1 bg-yellow-400/10' : ''}
                                      ${hasAnyMatch ? 'transform scale-[1.02]' : ''}
                                    `}
                                    style={{
                                      // Green glow theme for DNA matching - ENHANCED visibility
                                      backgroundColor: isHighMatch
                                        ? 'rgba(34, 197, 94, 0.15)'  // green-500
                                        : isMedMatch
                                        ? 'rgba(74, 222, 128, 0.1)'  // green-400
                                        : isLowMatch
                                        ? 'rgba(134, 239, 172, 0.08)'  // green-300
                                        : undefined,
                                      boxShadow: isHighMatch
                                        ? '0 0 25px rgba(34, 197, 94, 0.8), 0 0 50px rgba(34, 197, 94, 0.4), inset 0 0 20px rgba(34, 197, 94, 0.2)'
                                        : isMedMatch
                                        ? '0 0 20px rgba(74, 222, 128, 0.6), 0 0 35px rgba(74, 222, 128, 0.3), inset 0 0 12px rgba(74, 222, 128, 0.15)'
                                        : isLowMatch
                                        ? '0 0 12px rgba(134, 239, 172, 0.5), inset 0 0 8px rgba(134, 239, 172, 0.1)'
                                        : undefined,
                                      outline: isHighMatch
                                        ? '3px solid rgba(34, 197, 94, 0.9)'  // green-500
                                        : isMedMatch
                                        ? '2px solid rgba(74, 222, 128, 0.8)'  // green-400
                                        : isLowMatch
                                        ? '2px solid rgba(134, 239, 172, 0.6)'  // green-300
                                        : undefined,
                                      outlineOffset: hasAnyMatch ? '2px' : undefined,
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
                                        <div className="font-mono font-semibold text-foreground flex items-center gap-1">
                                          {occ.blockId}
                                          {/* Show 100% badge for highlighted matches */}
                                          {isHighlighted && (
                                            <span className="text-[10px] font-bold px-1 rounded bg-green-600 text-white">
                                              100%
                                            </span>
                                          )}
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
                                                  style={(() => {
                                                    // Use driver gradient for assigned blocks (without violations)
                                                    if (!getOccurrenceViolationStatus(occ.occurrenceId) && occ.driverName) {
                                                      const gradient = getDriverGradient(occ.driverName);
                                                      return {
                                                        background: gradient.background,
                                                        borderColor: gradient.borderColor,
                                                        color: themeMode === 'day' ? undefined : themeStyles.color
                                                      };
                                                    }
                                                    // Fallback for violations or unassigned
                                                    return {
                                                      backgroundColor: getOccurrenceViolationStatus(occ.occurrenceId)
                                                        ? undefined
                                                        : (themeMode === 'day' ? undefined : 'rgba(59, 130, 246, 0.15)'),
                                                      borderColor: getOccurrenceViolationStatus(occ.occurrenceId)
                                                        ? undefined
                                                        : (themeMode === 'day' ? undefined : 'rgba(59, 130, 246, 0.3)'),
                                                      color: themeMode === 'day' ? undefined : themeStyles.color
                                                    };
                                                  })()}
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
                                        // Use pre-computed highlighted IDs for the Unassigned button
                                        const isButtonHighlighted = highlightedOccurrenceIds.has(occ.occurrenceId);

                                        return (
                                      <div
                                        className="w-full p-2 rounded-b-md border border-t-0 border-dashed text-xs text-center transition-all cursor-pointer"
                                        style={{
                                          // DNA match highlighting with green glow theme
                                          backgroundColor: isButtonHighlighted
                                            ? 'rgba(34, 197, 94, 0.15)'  // green-500
                                            : themeMode === 'day'
                                            ? (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)')
                                            : (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'),
                                          borderColor: isButtonHighlighted
                                            ? 'rgba(34, 197, 94, 0.5)'   // green-500
                                            : themeMode === 'day'
                                            ? (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)')
                                            : (occ.isRejectedLoad ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'),
                                          color: themeMode === 'day'
                                            ? (occ.isRejectedLoad ? '#dc2626' : '#d97706')
                                            : (occ.isRejectedLoad ? '#ff6b6b' : '#fbbf24'),
                                          boxShadow: isButtonHighlighted
                                            ? '0 0 20px rgba(34, 197, 94, 0.6), inset 0 0 10px rgba(34, 197, 94, 0.2)'
                                            : undefined,
                                        }}
                                        onClick={() => handleUnassignedBlockClick(occ)}
                                        onContextMenu={(e) => handleRightClickUnassigned(e, occ)}
                                        title={
                                          isButtonHighlighted
                                            ? `AI Match: 100% - Excellent fit for ${hoveredDriverName}`
                                            : occ.isRejectedLoad
                                            ? "Rejected load - Amazon rejected driver assignment"
                                            : "Click to find matching driver, right-click to assign"
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
                  );
                })
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

          {/* Right-side panel removed - driver info now in sidebar flip cards */}
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

      {/* Delete Selected Blocks Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-confirm-delete-selected">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Delete {selectedCells.size} Selected Block{selectedCells.size !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>permanently delete</strong> the selected blocks from the database.
              This action cannot be undone. The blocks will need to be re-imported if you want them back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-selected" disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteSelected}
              disabled={isDeleting}
              data-testid="button-confirm-delete-selected"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Permanently
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear All Confirmation Dialog */}
      <AlertDialog open={showClearAllDialog} onOpenChange={setShowClearAllDialog}>
        <AlertDialogContent data-testid="dialog-confirm-clear-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Assignments for This Week?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear ALL driver assignments for the week of {format(weekRange.weekStart, "MMM d")} - {format(addDays(weekRange.weekStart, 6), "MMM d, yyyy")}.
              Imported blocks will remain so you can re-run Auto-Match.
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

      {/* Block Analyzer Panel */}
      <Dialog open={showBlockAnalyzer} onOpenChange={setShowBlockAnalyzer}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dna className="w-5 h-5 text-purple-500" />
              Block Analyzer - {blockAnalysis.length} Unassigned Blocks
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {blockAnalysis.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No unassigned blocks to analyze. All blocks have drivers assigned.
              </div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-background border-b z-10">
                  <tr>
                    <th className="text-left p-2 font-semibold">Block</th>
                    <th className="text-left p-2 font-semibold">Date</th>
                    <th className="text-left p-2 font-semibold">Time</th>
                    <th className="text-left p-2 font-semibold">Type</th>
                    <th className="text-left p-2 font-semibold">Matching Drivers (click to assign)</th>
                  </tr>
                </thead>
                <tbody>
                  {blockAnalysis.map((analysis) => (
                    <tr key={analysis.occurrence.occurrenceId} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-mono font-semibold">{analysis.occurrence.blockId}</td>
                      <td className="p-2">{format(new Date(analysis.occurrence.serviceDate + 'T00:00:00'), 'EEE MMM d')}</td>
                      <td className="p-2 font-mono">{analysis.occurrence.startTime}</td>
                      <td className="p-2">
                        <Badge className={getBlockTypeColor(analysis.occurrence.contractType || '')}>
                          {analysis.occurrence.contractType || 'N/A'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        {analysis.topMatches.length === 0 ? (
                          <span className="text-muted-foreground italic">No matching drivers</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {analysis.topMatches.map((match) => (
                              <button
                                key={match.driverId}
                                onClick={async () => {
                                  try {
                                    await updateAssignmentMutation.mutateAsync({
                                      occurrenceId: analysis.occurrence.occurrenceId,
                                      driverId: match.driverId,
                                    });
                                    toast({
                                      title: "Driver Assigned",
                                      description: `${match.driverName} assigned to ${analysis.occurrence.blockId}`,
                                    });
                                  } catch (error: any) {
                                    toast({
                                      variant: "destructive",
                                      title: "Assignment Failed",
                                      description: error.message || "Failed to assign driver",
                                    });
                                  }
                                }}
                                className={`
                                  px-2 py-1 rounded text-xs font-medium transition-all
                                  hover:scale-105 hover:shadow-md cursor-pointer
                                  ${match.score >= 100
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border border-green-300'
                                    : match.score >= 75
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300'
                                    : match.score >= 50
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-300'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-300'
                                  }
                                `}
                                title={`Click to assign ${match.driverName} to this block`}
                              >
                                {match.driverName} ({match.score}%)
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

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

      {/* MILO Chat */}
      <MiloChat isOpen={isMiloChatOpen} onClose={() => setIsMiloChatOpen(false)} />

    </div>
  </div>
  </>
  );
}
