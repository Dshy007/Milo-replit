/**
 * ScheduleBuilder - Main UI Component for Schedule Analysis & Fine-Tuning
 *
 * This is the missing middle piece between CSV import and Executive Report.
 * It handles:
 * - Auto-assignment of drivers to blocks
 * - DOT compliance validation
 * - Fine-tuning/swapping drivers
 * - Workload auditing
 * - Watch list for drivers at max capacity
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, addDays } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Users,
  Calendar,
  ClipboardCheck,
  Eye,
  ArrowRightLeft,
  Loader2,
  X,
} from "lucide-react";

import {
  DriverProfile,
  ReconstructedBlock,
  AssignedBlock,
  FinalSchedule,
  ScheduleBuilderProps,
  DayOfWeek,
  DAY_ORDER,
  DAY_ABBREVIATIONS,
  WatchItem,
  DriverWorkload,
  AvailableDriver,
} from "@/lib/schedule-types";

import {
  autoAssignDrivers,
  calculateWorkloads,
  generateWatchList,
  generateComplianceReport,
  generateFinalSchedule,
  getAvailableDrivers,
  executeSwap,
  validateSwap,
} from "@/lib/schedule-engine";

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface StatsCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  variant?: "default" | "success" | "warning" | "error";
}

function StatsCard({ label, value, subtext, variant = "default" }: StatsCardProps) {
  const variantStyles = {
    default: "bg-slate-50 border-slate-200",
    success: "bg-green-50 border-green-200",
    warning: "bg-yellow-50 border-yellow-200",
    error: "bg-red-50 border-red-200",
  };

  return (
    <Card className={`${variantStyles[variant]} border`}>
      <CardContent className="p-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {subtext && <div className="text-xs text-muted-foreground mt-1">{subtext}</div>}
      </CardContent>
    </Card>
  );
}

interface ComplianceBarProps {
  label: string;
  passed: number;
  failed: number;
  percentage: number;
}

function ComplianceBar({ label, passed, failed, percentage }: ComplianceBarProps) {
  const isSuccess = percentage === 100;
  return (
    <div className="flex items-center gap-3">
      {isSuccess ? (
        <CheckCircle2 className="w-4 h-4 text-green-600" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-yellow-600" />
      )}
      <span className="text-sm flex-1">{label}</span>
      <span className={`text-sm font-medium ${isSuccess ? "text-green-600" : "text-yellow-600"}`}>
        {percentage}%
      </span>
    </div>
  );
}

interface BlockRowProps {
  block: AssignedBlock;
  onSwap: (blockId: string) => void;
}

function BlockRow({ block, onSwap }: BlockRowProps) {
  const hasConflicts = block.conflicts.length > 0;
  const isUnassigned = block.driverId === null;

  return (
    <tr className={`border-b ${isUnassigned ? "bg-red-50" : hasConflicts ? "bg-yellow-50" : ""}`}>
      <td className="py-2 px-3 font-mono text-sm">{block.blockId}</td>
      <td className="py-2 px-3">{block.startTime}</td>
      <td className="py-2 px-3">
        {isUnassigned ? (
          <span className="text-red-600 font-medium">NEEDS COVERAGE</span>
        ) : (
          <span className="flex items-center gap-2">
            {block.driverName}
            {hasConflicts && (
              <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                {block.conflicts.length} warning{block.conflicts.length > 1 ? "s" : ""}
              </Badge>
            )}
          </span>
        )}
      </td>
      <td className="py-2 px-3">
        <Badge variant="outline" className="text-xs">
          {block.assignmentType.replace("_", " ")}
        </Badge>
      </td>
      <td className="py-2 px-3">
        <Button size="sm" variant="outline" onClick={() => onSwap(block.blockId)}>
          <ArrowRightLeft className="w-3 h-3 mr-1" />
          Swap
        </Button>
      </td>
    </tr>
  );
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  block: AssignedBlock | null;
  availableDrivers: AvailableDriver[];
  onConfirmSwap: (newDriverId: number) => void;
}

function SwapModal({ isOpen, onClose, block, availableDrivers, onConfirmSwap }: SwapModalProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);

  if (!block) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Swap Driver</DialogTitle>
          <DialogDescription>
            Select a new driver for block {block.blockId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-slate-50 p-3 rounded-lg">
            <div className="text-sm text-muted-foreground">Block</div>
            <div className="font-medium">{block.blockId}</div>
            <div className="text-sm">
              {DAY_ABBREVIATIONS[block.dayOfWeek]} {block.date} at {block.startTime}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Current: {block.driverName || "Unassigned"}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Available Drivers:</div>
            {availableDrivers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No eligible drivers available for this block
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableDrivers.map((ad) => (
                  <div
                    key={ad.driver.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedDriverId === ad.driver.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                    onClick={() => setSelectedDriverId(ad.driver.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{ad.driver.name}</span>
                      {ad.isRecommended && (
                        <Badge className="bg-green-100 text-green-800">Recommended</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{ad.reason}</div>
                    {ad.warnings.length > 0 && (
                      <div className="text-xs text-yellow-600 mt-1">
                        {ad.warnings.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={selectedDriverId === null}
              onClick={() => selectedDriverId && onConfirmSwap(selectedDriverId)}
            >
              Confirm Swap
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ScheduleBuilder({
  blocks,
  weekStart,
  tenantId,
  onComplete,
  onCancel,
}: ScheduleBuilderProps) {
  // State
  const [assignments, setAssignments] = useState<AssignedBlock[]>([]);
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("by-day");
  const [expandedDays, setExpandedDays] = useState<Set<DayOfWeek>>(new Set(DAY_ORDER));
  const [swapBlockId, setSwapBlockId] = useState<string | null>(null);
  const [compliancePanelOpen, setCompliancePanelOpen] = useState(true);

  // Fetch driver roster
  const { data: rosterData, isLoading: isLoadingRoster } = useQuery({
    queryKey: ["/api/drivers/scheduling-roster"],
    queryFn: async () => {
      const response = await fetch("/api/drivers/scheduling-roster", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch roster");
      return response.json();
    },
  });

  // Initialize on roster load
  useEffect(() => {
    if (rosterData?.drivers && blocks.length > 0) {
      // Convert API response to DriverProfile type
      const driverProfiles: DriverProfile[] = rosterData.drivers.map((d: any) => ({
        ...d,
        id: typeof d.id === "string" ? parseInt(d.id, 10) || 0 : d.id,
      }));
      setDrivers(driverProfiles);

      // Run auto-assignment
      const result = autoAssignDrivers(blocks, driverProfiles);
      setAssignments(result.assignments);
      setIsLoading(false);
    }
  }, [rosterData, blocks]);

  // Derived data
  const workloads = useMemo(
    () => calculateWorkloads(assignments, drivers),
    [assignments, drivers]
  );

  const watchList = useMemo(() => generateWatchList(workloads), [workloads]);

  const compliance = useMemo(
    () => generateComplianceReport(assignments, drivers),
    [assignments, drivers]
  );

  const stats = useMemo(() => {
    const assigned = assignments.filter((b) => b.driverId !== null);
    const solo1 = assignments.filter((b) => b.blockType === "solo1");
    const solo2 = assignments.filter((b) => b.blockType === "solo2");
    return {
      total: assignments.length,
      assigned: assigned.length,
      gaps: assignments.length - assigned.length,
      percentage: assignments.length > 0
        ? Math.round((assigned.length / assignments.length) * 100)
        : 0,
      solo1: solo1.length,
      solo2: solo2.length,
    };
  }, [assignments]);

  // Group blocks by day
  const blocksByDay = useMemo(() => {
    const grouped: Record<DayOfWeek, AssignedBlock[]> = {
      sunday: [],
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
    };
    for (const block of assignments) {
      grouped[block.dayOfWeek].push(block);
    }
    // Sort each day by time
    for (const day of DAY_ORDER) {
      grouped[day].sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return grouped;
  }, [assignments]);

  // Swap modal state
  const swapBlock = useMemo(
    () => assignments.find((b) => b.blockId === swapBlockId) || null,
    [assignments, swapBlockId]
  );

  const availableDriversForSwap = useMemo(() => {
    if (!swapBlockId) return [];
    return getAvailableDrivers(swapBlockId, assignments, drivers);
  }, [swapBlockId, assignments, drivers]);

  // Handlers
  const handleReassignAll = () => {
    setIsLoading(true);
    const result = autoAssignDrivers(blocks, drivers);
    setAssignments(result.assignments);
    setIsLoading(false);
  };

  const handleSwap = (blockId: string) => {
    setSwapBlockId(blockId);
  };

  const handleConfirmSwap = (newDriverId: number) => {
    if (!swapBlockId) return;

    const currentBlock = assignments.find((b) => b.blockId === swapBlockId);
    const newAssignments = executeSwap(
      {
        blockId: swapBlockId,
        currentDriverId: currentBlock?.driverId ?? null,
        newDriverId,
      },
      assignments,
      drivers
    );
    setAssignments(newAssignments);
    setSwapBlockId(null);
  };

  const handleGenerateReport = () => {
    const finalSchedule = generateFinalSchedule(assignments, drivers, weekStart);
    onComplete(finalSchedule);
  };

  const toggleDayExpanded = (day: DayOfWeek) => {
    const newExpanded = new Set(expandedDays);
    if (newExpanded.has(day)) {
      newExpanded.delete(day);
    } else {
      newExpanded.add(day);
    }
    setExpandedDays(newExpanded);
  };

  // Format week range
  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;

  if (isLoading || isLoadingRoster) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <div className="text-lg font-medium">Building Schedule...</div>
          <div className="text-sm text-muted-foreground">
            Auto-assigning drivers to {blocks.length} blocks
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4 bg-slate-50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">MILO Schedule Builder</h2>
            <div className="text-sm text-muted-foreground">Week of {weekLabel}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <StatsCard label="Total Blocks" value={stats.total} />
          <StatsCard
            label="Assigned"
            value={`${stats.assigned} (${stats.percentage}%)`}
            variant={stats.percentage === 100 ? "success" : "default"}
          />
          <StatsCard
            label="Gaps"
            value={stats.gaps}
            subtext="Need Coverage"
            variant={stats.gaps > 0 ? "error" : "success"}
          />
          <StatsCard
            label="Block Types"
            value={`${stats.solo1} S1 / ${stats.solo2} S2`}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReassignAll}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Auto-Assign All
          </Button>
          <Button variant="outline">
            <ClipboardCheck className="w-4 h-4 mr-2" />
            Validate DOT
          </Button>
          <Button variant="outline">
            <Eye className="w-4 h-4 mr-2" />
            Show Gaps
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="border-b px-4">
            <TabsList>
              <TabsTrigger value="by-day" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                By Day
              </TabsTrigger>
              <TabsTrigger value="by-driver" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                By Driver
              </TabsTrigger>
              <TabsTrigger value="conflicts">
                Conflicts
                {compliance.violations.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {compliance.violations.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="workload">Workload</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-hidden p-4">
            {/* By Day View */}
            <TabsContent value="by-day" className="h-full m-0">
              <ScrollArea className="h-full">
                <div className="space-y-4">
                  {DAY_ORDER.map((day) => {
                    const dayBlocks = blocksByDay[day];
                    if (dayBlocks.length === 0) return null;

                    const dayDate = addDays(weekStart, DAY_ORDER.indexOf(day));
                    const solo1Blocks = dayBlocks.filter((b) => b.blockType === "solo1");
                    const solo2Blocks = dayBlocks.filter((b) => b.blockType === "solo2");
                    const isExpanded = expandedDays.has(day);

                    return (
                      <Collapsible
                        key={day}
                        open={isExpanded}
                        onOpenChange={() => toggleDayExpanded(day)}
                      >
                        <Card>
                          <CollapsibleTrigger className="w-full">
                            <CardHeader className="py-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                  <CardTitle className="text-base">
                                    {day.toUpperCase()} - {format(dayDate, "MMM d")}
                                  </CardTitle>
                                  <Badge variant="outline">{dayBlocks.length} blocks</Badge>
                                </div>
                                <div className="flex gap-2">
                                  <Badge variant="secondary">
                                    {solo1Blocks.length} Solo1
                                  </Badge>
                                  <Badge variant="secondary">
                                    {solo2Blocks.length} Solo2
                                  </Badge>
                                </div>
                              </div>
                            </CardHeader>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <CardContent className="pt-0">
                              {/* Solo1 Blocks */}
                              {solo1Blocks.length > 0 && (
                                <div className="mb-4">
                                  <div className="text-sm font-medium text-muted-foreground mb-2">
                                    Solo1 ({solo1Blocks.length} blocks)
                                  </div>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b text-left">
                                        <th className="py-2 px-3 font-medium">Block ID</th>
                                        <th className="py-2 px-3 font-medium">Time</th>
                                        <th className="py-2 px-3 font-medium">Driver</th>
                                        <th className="py-2 px-3 font-medium">Match</th>
                                        <th className="py-2 px-3 font-medium">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {solo1Blocks.map((block) => (
                                        <BlockRow
                                          key={block.blockId}
                                          block={block}
                                          onSwap={handleSwap}
                                        />
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Solo2 Blocks */}
                              {solo2Blocks.length > 0 && (
                                <div>
                                  <div className="text-sm font-medium text-muted-foreground mb-2">
                                    Solo2 ({solo2Blocks.length} blocks)
                                  </div>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b text-left">
                                        <th className="py-2 px-3 font-medium">Block ID</th>
                                        <th className="py-2 px-3 font-medium">Time</th>
                                        <th className="py-2 px-3 font-medium">Driver</th>
                                        <th className="py-2 px-3 font-medium">Match</th>
                                        <th className="py-2 px-3 font-medium">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {solo2Blocks.map((block) => (
                                        <BlockRow
                                          key={block.blockId}
                                          block={block}
                                          onSwap={handleSwap}
                                        />
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    );
                  })}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* By Driver View */}
            <TabsContent value="by-driver" className="h-full m-0">
              <ScrollArea className="h-full">
                <div className="space-y-3">
                  {workloads.map((workload) => (
                    <Card key={workload.driverId}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{workload.driverName}</span>
                            <Badge variant="outline">{workload.soloType}</Badge>
                            {workload.isAtMax && (
                              <Badge variant="destructive">MAX</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {workload.totalBlocks}/{workload.maxBlocks} blocks |{" "}
                            ${workload.estimatedPay.toLocaleString()}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {workload.assignedBlocks.map((block) => (
                            <Badge
                              key={block.blockId}
                              variant="secondary"
                              className="cursor-pointer hover:bg-slate-200"
                              onClick={() => handleSwap(block.blockId)}
                            >
                              {DAY_ABBREVIATIONS[block.dayOfWeek]} {block.startTime}
                            </Badge>
                          ))}
                        </div>
                        {workload.warnings.length > 0 && (
                          <div className="mt-2 text-sm text-yellow-600">
                            {workload.warnings.join(" | ")}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Conflicts View */}
            <TabsContent value="conflicts" className="h-full m-0">
              <ScrollArea className="h-full">
                {compliance.violations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500 mb-4" />
                    <div className="text-lg font-medium">All Clear!</div>
                    <div className="text-sm text-muted-foreground">
                      No DOT compliance violations detected
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {compliance.violations.map((violation, idx) => (
                      <Card
                        key={idx}
                        className={
                          violation.severity === "error"
                            ? "border-red-200 bg-red-50"
                            : "border-yellow-200 bg-yellow-50"
                        }
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <AlertTriangle
                              className={`w-5 h-5 mt-0.5 ${
                                violation.severity === "error"
                                  ? "text-red-500"
                                  : "text-yellow-500"
                              }`}
                            />
                            <div>
                              <div className="font-medium">{violation.message}</div>
                              <div className="text-sm text-muted-foreground mt-1">
                                Type: {violation.type.replace(/_/g, " ")}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Workload View */}
            <TabsContent value="workload" className="h-full m-0">
              <ScrollArea className="h-full">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 px-3 font-medium">Driver</th>
                      <th className="py-2 px-3 font-medium">Type</th>
                      <th className="py-2 px-3 font-medium">Blocks</th>
                      <th className="py-2 px-3 font-medium">Days</th>
                      <th className="py-2 px-3 font-medium">Pay</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workloads.map((workload) => (
                      <tr key={workload.driverId} className="border-b">
                        <td className="py-2 px-3 font-medium">{workload.driverName}</td>
                        <td className="py-2 px-3">{workload.soloType}</td>
                        <td className="py-2 px-3">
                          {workload.totalBlocks}/{workload.maxBlocks}
                        </td>
                        <td className="py-2 px-3">
                          {workload.daysWorked.map((d) => DAY_ABBREVIATIONS[d]).join(", ")}
                        </td>
                        <td className="py-2 px-3">${workload.estimatedPay.toLocaleString()}</td>
                        <td className="py-2 px-3">
                          {workload.isAtMax ? (
                            <Badge variant="destructive">MAX</Badge>
                          ) : workload.totalBlocks >= workload.maxBlocks - 1 ? (
                            <Badge variant="outline" className="text-yellow-600">
                              Near Max
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-600">
                              Available
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Compliance Panel */}
      <Collapsible open={compliancePanelOpen} onOpenChange={setCompliancePanelOpen}>
        <div className="border-t">
          <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-slate-50">
            <div className="flex items-center gap-2">
              {compliancePanelOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span className="font-medium">Compliance Panel</span>
              {compliance.isCompliant ? (
                <Badge className="bg-green-100 text-green-800">All Clear</Badge>
              ) : (
                <Badge variant="destructive">
                  {compliance.violations.filter((v) => v.severity === "error").length} Issues
                </Badge>
              )}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-4 pt-0 grid grid-cols-4 gap-4">
              <ComplianceBar
                label="10-Hour Rest"
                {...compliance.stats.tenHourRest}
              />
              <ComplianceBar
                label="48-Hour Gaps"
                {...compliance.stats.fortyEightHourGaps}
              />
              <ComplianceBar
                label="Max 6 Days"
                {...compliance.stats.maxSixDays}
              />
              <ComplianceBar
                label="Weekly Max"
                {...compliance.stats.weeklyMaximum}
              />
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Watch List */}
      {watchList.length > 0 && (
        <div className="border-t p-4">
          <div className="text-sm font-medium mb-2">Watch List</div>
          <div className="flex flex-wrap gap-2">
            {watchList.map((item, idx) => (
              <Badge
                key={idx}
                variant="outline"
                className={
                  item.severity === "critical"
                    ? "border-red-500 text-red-700 bg-red-50"
                    : item.severity === "warning"
                    ? "border-yellow-500 text-yellow-700 bg-yellow-50"
                    : ""
                }
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                {item.driverName} - {item.message}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t p-4 flex justify-end gap-3 bg-slate-50">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleGenerateReport}>
          Generate Executive Report
        </Button>
      </div>

      {/* Swap Modal */}
      <SwapModal
        isOpen={swapBlockId !== null}
        onClose={() => setSwapBlockId(null)}
        block={swapBlock}
        availableDrivers={availableDriversForSwap}
        onConfirmSwap={handleConfirmSwap}
      />
    </div>
  );
}

export default ScheduleBuilder;
