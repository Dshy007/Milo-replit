import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks, eachDayOfInterval, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, User, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { Block, BlockAssignment, Driver, Contract } from "@shared/schema";

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

export default function Schedules() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedBlock, setSelectedBlock] = useState<(Block & { contract: Contract | null }) | null>(null);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [shiftToDelete, setShiftToDelete] = useState<string | null>(null);
  const [importStartDate, setImportStartDate] = useState<string>("2025-11-03"); // Sunday, Nov 3, 2024

  const handleBlockClick = (block: Block & { contract: Contract | null }) => {
    setSelectedBlock(block);
    setIsAssignmentModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsAssignmentModalOpen(false);
    setSelectedBlock(null);
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
    mutationFn: async ({ file, startDate }: { file: File; startDate: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const url = `/api/schedules/excel-import?startDate=${encodeURIComponent(startDate)}`;
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
      
      // Show errors if any
      if (result.errors && result.errors.length > 0) {
        const errorPreview = result.errors.slice(0, 5).join("\n");
        const moreErrors = result.errors.length > 5 ? `\n...and ${result.errors.length - 5} more errors` : "";
        
        toast({
          variant: result.created > 0 ? "default" : "destructive",
          title: result.created > 0 ? "Partial Import" : "Import Failed",
          description: `${result.message}\n\nErrors:\n${errorPreview}${moreErrors}`,
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

    importMutation.mutate({ file: importFile, startDate: importStartDate });
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

  // Fetch all contracts
  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

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

  // Normalize blocks into contract/day grid: { contractId: { "2025-11-09": [blocks] } }
  const blockGrid = useMemo(() => {
    if (!calendarData) return {};

    const grid: Record<string, Record<string, typeof calendarData.blocks>> = {};

    calendarData.blocks.forEach((block) => {
      if (!block.contract) return;

      const contractId = block.contract.id;
      const dayISO = format(new Date(block.startTimestamp), "yyyy-MM-dd");

      if (!grid[contractId]) {
        grid[contractId] = {};
      }
      if (!grid[contractId][dayISO]) {
        grid[contractId][dayISO] = [];
      }
      grid[contractId][dayISO].push(block);
    });

    return grid;
  }, [calendarData]);

  // Navigation handlers
  const handlePreviousWeek = () => {
    setCurrentDate(subWeeks(currentDate, 1));
  };

  const handleNextWeek = () => {
    setCurrentDate(addWeeks(currentDate, 1));
  };

  const formatTime = (timeStr: string) => {
    // Return military time (24-hour format) as-is
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

  const calculateBumpMinutes = (actualStart: string | Date, canonicalStart: string | Date | null): number => {
    if (!canonicalStart) return 0;
    const actual = typeof actualStart === 'string' ? new Date(actualStart).getTime() : actualStart.getTime();
    const canonical = typeof canonicalStart === 'string' ? new Date(canonicalStart).getTime() : canonicalStart.getTime();
    return Math.round((actual - canonical) / (1000 * 60));
  };

  if (contractsLoading || calendarLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading schedules...</div>
      </div>
    );
  }

  // Sort contracts by type and start time
  const sortedContracts = [...contracts].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type.localeCompare(b.type);
    }
    return a.startTime.localeCompare(b.startTime);
  });

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
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

        {/* Actions */}
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

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      Import shifts starting from:
                    </label>
                    <input
                      type="date"
                      value={importStartDate}
                      onChange={(e) => setImportStartDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                      data-testid="input-start-date"
                    />
                  </div>

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
      </div>

      {/* Contract Grid Table */}
      <Card className="flex-1 overflow-hidden">
        <CardContent className="p-0 h-full overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card border-b">
              <tr>
                <th className="text-left p-2 font-semibold min-w-[140px] border-r">
                  Start Time
                </th>
                {weekRange.weekDays.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="text-center p-2 font-semibold min-w-[120px] border-r last:border-r-0"
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
                    No contracts found. Import weekly assignments from Start Times page.
                  </td>
                </tr>
              ) : (
                sortedContracts.map((contract) => (
                  <tr key={contract.id} className="border-b hover:bg-muted/30">
                    {/* Contract Info Cell */}
                    <td className="p-2 border-r align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm">
                          {formatTime(contract.startTime)}
                        </span>
                        <Badge variant="outline" className={`${getBlockTypeColor(contract.type)} text-xs px-1.5 py-0`}>
                          {contract.type.toUpperCase()}
                        </Badge>
                      </div>
                    </td>

                    {/* Day Cells */}
                    {weekRange.weekDays.map((day) => {
                      const dayISO = format(day, "yyyy-MM-dd");
                      const dayBlocks = blockGrid[contract.id]?.[dayISO] || [];

                      return (
                        <td
                          key={day.toISOString()}
                          className="p-1.5 border-r last:border-r-0 align-top"
                        >
                          {dayBlocks.length > 0 ? (
                            <div className="space-y-1">
                              {dayBlocks.map((block) => {
                                const bumpMinutes = calculateBumpMinutes(
                                  block.startTimestamp,
                                  block.canonicalStart
                                );
                                
                                return (
                                  <div key={block.id} className="relative group">
                                    <button
                                      onClick={() => handleBlockClick(block)}
                                      className="w-full p-1.5 rounded-md bg-muted/50 text-xs space-y-1 text-left hover-elevate active-elevate-2 transition-colors"
                                      data-testid={`block-${block.id}`}
                                    >
                                      {/* Block ID */}
                                      <div className="font-mono font-medium text-xs pr-4">
                                        {block.blockId}
                                      </div>

                                      {/* Pattern & Bump Indicators */}
                                      <div className="flex items-center gap-1 flex-wrap">
                                        {block.patternGroup && (
                                          <Badge 
                                            variant="outline" 
                                            className={`${getPatternBadgeColor(block.patternGroup)} text-xs px-1 py-0`}
                                            data-testid={`badge-pattern-${block.id}`}
                                          >
                                            {block.patternGroup === "sunWed" ? "Sun-Wed" : "Wed-Sat"}
                                          </Badge>
                                        )}
                                        {block.canonicalStart && (
                                          <span 
                                            className={`text-xs font-medium ${getBumpIndicatorColor(bumpMinutes)}`}
                                            data-testid={`bump-indicator-${block.id}`}
                                          >
                                            {formatBumpTime(bumpMinutes)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Driver Assignment */}
                                      {block.assignment?.driver ? (
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-1 text-foreground text-xs">
                                            <User className="w-2.5 h-2.5" />
                                            <span>
                                              {block.assignment.driver.firstName}{" "}
                                              {block.assignment.driver.lastName}
                                            </span>
                                          </div>
                                          {/* Assignment Type Indicator */}
                                          {!block.assignment.assignedBy ? (
                                            <Badge 
                                              variant="outline" 
                                              className="text-xs px-1 py-0 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                                              data-testid={`badge-auto-${block.id}`}
                                            >
                                              Auto
                                            </Badge>
                                          ) : (
                                            <Badge 
                                              variant="outline" 
                                              className="text-xs px-1 py-0 bg-gray-500/10 text-gray-700 dark:text-gray-300"
                                              data-testid={`badge-manual-${block.id}`}
                                            >
                                              Manual
                                            </Badge>
                                          )}
                                        </div>
                                      ) : (
                                        <Badge 
                                          variant="secondary" 
                                          className="text-xs px-1 py-0"
                                          data-testid={`badge-unassigned-${block.id}`}
                                        >
                                          Unassigned
                                        </Badge>
                                      )}
                                    </button>
                                    
                                    {/* Delete Button */}
                                    <button
                                      onClick={(e) => handleDeleteShift(e, block.id)}
                                      disabled={deleteMutation.isPending}
                                      className="absolute top-0.5 right-0.5 p-0.5 rounded hover:bg-destructive/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                      data-testid={`button-delete-shift-${block.id}`}
                                      aria-label="Delete shift"
                                    >
                                      {deleteMutation.isPending ? (
                                        <div className="w-3 h-3 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <X className="w-3 h-3 text-destructive" />
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground text-xs py-1">
                              -
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Driver Assignment Modal */}
      <DriverAssignmentModal
        block={selectedBlock}
        isOpen={isAssignmentModalOpen}
        onClose={handleCloseModal}
      />

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
    </div>
  );
}
