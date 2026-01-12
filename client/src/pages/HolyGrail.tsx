import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks, parseISO } from "date-fns";
import {
  CheckCircle2,
  AlertTriangle,
  Plus,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Download,
  User,
  ChevronDown,
  Clock,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ============================================================================
// Types
// ============================================================================

interface BlockSuggestion {
  blockId: string;
  serviceDate: string;
  dayOfWeek: string;
  slotKey: string;
  soloType: string;
  startTime: string;
  tractorId: string;
  currentDriverId: string | null;
  currentDriverName: string | null;
  suggestedDriverId: string | null;
  suggestedDriverName: string | null;
  matchType: "direct" | "opportunity" | "new_slot" | "already_assigned";
  reason: string;
}

interface SlotOwner {
  slotKey: string;
  driverId: string;
  driverName: string;
  soloType: string;
  startTime: string;
  tractorId: string;
  daysWorkedLastWeek: number;
}

interface DriverWorkload {
  driverId: string;
  driverName: string;
  soloType: string;
  daysWorkedLastWeek: number;
  daysAssignedThisWeek: number;
  hasCapacity: boolean;
  preferredStartTimes: string[];
}

interface HolyGrailResult {
  lastWeekStart: string;
  thisWeekStart: string;
  directMatches: BlockSuggestion[];
  opportunities: BlockSuggestion[];
  newSlots: BlockSuggestion[];
  alreadyAssigned: BlockSuggestion[];
  missingSlots: SlotOwner[];
  driverWorkloads: DriverWorkload[];
  summary: {
    totalBlocksThisWeek: number;
    directMatches: number;
    opportunities: number;
    newSlots: number;
    alreadyAssigned: number;
    missingSlots: number;
  };
}

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  isActive: boolean;
}

// ============================================================================
// Component
// ============================================================================

export default function HolyGrail() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Week navigation - this week starts on Sunday
  const [thisWeekStart, setThisWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const lastWeekStart = subWeeks(thisWeekStart, 1);

  // Format dates for API
  const lastWeekStr = format(lastWeekStart, "yyyy-MM-dd");
  const thisWeekStr = format(thisWeekStart, "yyyy-MM-dd");
  const thisWeekEnd = addWeeks(thisWeekStart, 1);

  // Fetch suggestions
  const { data: result, isLoading, refetch } = useQuery<HolyGrailResult>({
    queryKey: ["/api/holy-grail/suggest", lastWeekStr, thisWeekStr],
    queryFn: async () => {
      const res = await fetch(`/api/holy-grail/suggest?lastWeek=${lastWeekStr}&thisWeek=${thisWeekStr}`);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    }
  });

  // Fetch drivers for manual assignment
  const { data: drivers } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
    queryFn: async () => {
      const res = await fetch("/api/drivers");
      if (!res.ok) throw new Error("Failed to fetch drivers");
      return res.json();
    }
  });

  // Apply all mutations
  const applyAllMutation = useMutation({
    mutationFn: async (suggestions: BlockSuggestion[]) => {
      const res = await apiRequest("POST", "/api/holy-grail/apply", { suggestions });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Applied Successfully",
        description: `Assigned ${data.applied} blocks${data.errors?.length ? `, ${data.errors.length} errors` : ""}`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/holy-grail/suggest"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Apply single mutation
  const applySingleMutation = useMutation({
    mutationFn: async ({ blockId, driverId }: { blockId: string; driverId: string }) => {
      const res = await apiRequest("POST", "/api/holy-grail/apply-single", { blockId, driverId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Assigned", description: "Block assigned successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/holy-grail/suggest"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Active drivers
  const activeDrivers = useMemo(() =>
    (drivers || []).filter(d => d.isActive && d.status === "active"),
    [drivers]
  );

  // Navigation
  const goToPreviousWeek = () => setThisWeekStart(prev => subWeeks(prev, 1));
  const goToNextWeek = () => setThisWeekStart(prev => addWeeks(prev, 1));
  const goToCurrentWeek = () => setThisWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));

  // Apply all direct matches
  const handleApplyAllDirect = () => {
    if (!result?.directMatches.length) return;
    applyAllMutation.mutate(result.directMatches);
  };

  // Apply all (direct + opportunities)
  const handleApplyAll = () => {
    if (!result) return;
    const all = [...result.directMatches, ...result.opportunities];
    if (all.length === 0) return;
    applyAllMutation.mutate(all);
  };

  // Assign single block
  const handleAssignSingle = (blockId: string, driverId: string) => {
    applySingleMutation.mutate({ blockId, driverId });
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Holy Grail Matcher</h1>
            <p className="text-slate-400 text-sm mt-1">
              Match drivers to slots based on last week's assignments
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="border-slate-600"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Week Navigation */}
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goToPreviousWeek}
                  className="text-slate-400 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center">
                  <div className="text-lg font-semibold text-white">
                    {format(thisWeekStart, "MMM d")} - {format(thisWeekEnd, "MMM d, yyyy")}
                  </div>
                  <div className="text-xs text-slate-500">
                    Reference: {format(lastWeekStart, "MMM d")} - {format(subWeeks(thisWeekEnd, 1), "MMM d")}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goToNextWeek}
                  className="text-slate-400 hover:text-white"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={goToCurrentWeek}
                className="border-slate-600 text-slate-300"
              >
                This Week
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Stats */}
        {result && (
          <div className="grid grid-cols-5 gap-4">
            <Card className="bg-emerald-500/10 border-emerald-500/30">
              <CardContent className="py-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">{result.summary.directMatches}</div>
                <div className="text-xs text-emerald-300">Direct Matches</div>
              </CardContent>
            </Card>
            <Card className="bg-amber-500/10 border-amber-500/30">
              <CardContent className="py-3 text-center">
                <div className="text-2xl font-bold text-amber-400">{result.summary.opportunities}</div>
                <div className="text-xs text-amber-300">Opportunities</div>
              </CardContent>
            </Card>
            <Card className="bg-violet-500/10 border-violet-500/30">
              <CardContent className="py-3 text-center">
                <div className="text-2xl font-bold text-violet-400">{result.summary.newSlots}</div>
                <div className="text-xs text-violet-300">New Slots</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-500/10 border-slate-500/30">
              <CardContent className="py-3 text-center">
                <div className="text-2xl font-bold text-slate-400">{result.summary.alreadyAssigned}</div>
                <div className="text-xs text-slate-300">Already Assigned</div>
              </CardContent>
            </Card>
            <Card className="bg-red-500/10 border-red-500/30">
              <CardContent className="py-3 text-center">
                <div className="text-2xl font-bold text-red-400">{result.summary.missingSlots}</div>
                <div className="text-xs text-red-300">Missing Slots</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Quick Actions */}
        {result && (result.summary.directMatches > 0 || result.summary.opportunities > 0) && (
          <div className="flex items-center gap-3">
            {result.summary.directMatches > 0 && (
              <Button
                onClick={handleApplyAllDirect}
                disabled={applyAllMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Apply All Direct Matches ({result.summary.directMatches})
              </Button>
            )}
            {(result.summary.directMatches + result.summary.opportunities) > 0 && (
              <Button
                onClick={handleApplyAll}
                disabled={applyAllMutation.isPending}
                variant="outline"
                className="border-slate-600"
              >
                <Download className="h-4 w-4 mr-2" />
                Apply All ({result.summary.directMatches + result.summary.opportunities})
              </Button>
            )}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-slate-500 mx-auto" />
            <p className="text-slate-400 mt-2">Loading suggestions...</p>
          </div>
        )}

        {/* Results Tables */}
        {result && !isLoading && (
          <div className="space-y-6">
            {/* Direct Matches */}
            {result.directMatches.length > 0 && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <CardTitle className="text-lg text-emerald-400">
                      Direct Matches ({result.directMatches.length})
                    </CardTitle>
                  </div>
                  <p className="text-xs text-slate-500">
                    Same slot (soloType + time + tractor) as last week
                  </p>
                </CardHeader>
                <CardContent>
                  <SuggestionTable
                    suggestions={result.directMatches}
                    drivers={activeDrivers}
                    onAssign={handleAssignSingle}
                    isPending={applySingleMutation.isPending}
                  />
                </CardContent>
              </Card>
            )}

            {/* Opportunities */}
            {result.opportunities.length > 0 && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                    <CardTitle className="text-lg text-amber-400">
                      Opportunities ({result.opportunities.length})
                    </CardTitle>
                  </div>
                  <p className="text-xs text-slate-500">
                    Drivers with capacity who could take these slots
                  </p>
                </CardHeader>
                <CardContent>
                  <SuggestionTable
                    suggestions={result.opportunities}
                    drivers={activeDrivers}
                    onAssign={handleAssignSingle}
                    isPending={applySingleMutation.isPending}
                  />
                </CardContent>
              </Card>
            )}

            {/* New Slots */}
            {result.newSlots.length > 0 && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-lg text-violet-400">
                      New Slots - Need Assignment ({result.newSlots.length})
                    </CardTitle>
                  </div>
                  <p className="text-xs text-slate-500">
                    No matching driver from last week
                  </p>
                </CardHeader>
                <CardContent>
                  <SuggestionTable
                    suggestions={result.newSlots}
                    drivers={activeDrivers}
                    onAssign={handleAssignSingle}
                    isPending={applySingleMutation.isPending}
                    showDriverPicker
                  />
                </CardContent>
              </Card>
            )}

            {/* Already Assigned */}
            {result.alreadyAssigned.length > 0 && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-slate-400" />
                    <CardTitle className="text-lg text-slate-400">
                      Already Assigned ({result.alreadyAssigned.length})
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <SuggestionTable
                    suggestions={result.alreadyAssigned}
                    drivers={activeDrivers}
                    onAssign={handleAssignSingle}
                    isPending={applySingleMutation.isPending}
                    readOnly
                  />
                </CardContent>
              </Card>
            )}

            {/* Missing Slots */}
            {result.missingSlots.length > 0 && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-400" />
                    <CardTitle className="text-lg text-red-400">
                      Missing From This Week ({result.missingSlots.length})
                    </CardTitle>
                  </div>
                  <p className="text-xs text-slate-500">
                    Slots that existed last week but not this week
                  </p>
                </CardHeader>
                <CardContent>
                  <MissingSlotsTable missingSlots={result.missingSlots} />
                </CardContent>
              </Card>
            )}

            {/* No Data State */}
            {result.summary.totalBlocksThisWeek === 0 && (
              <div className="text-center py-12 text-slate-500">
                <p>No blocks found for this week.</p>
                <p className="text-sm mt-2">Import schedule data to see suggestions.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface SuggestionTableProps {
  suggestions: BlockSuggestion[];
  drivers: Driver[];
  onAssign: (blockId: string, driverId: string) => void;
  isPending: boolean;
  showDriverPicker?: boolean;
  readOnly?: boolean;
}

function SuggestionTable({
  suggestions,
  drivers,
  onAssign,
  isPending,
  showDriverPicker,
  readOnly
}: SuggestionTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 border-b border-slate-700">
            <th className="text-left py-2 px-3 font-medium">Day</th>
            <th className="text-left py-2 px-3 font-medium">Time</th>
            <th className="text-left py-2 px-3 font-medium">Type</th>
            <th className="text-left py-2 px-3 font-medium">Tractor</th>
            <th className="text-left py-2 px-3 font-medium">
              {readOnly ? "Assigned Driver" : "Suggested Driver"}
            </th>
            <th className="text-left py-2 px-3 font-medium">Reason</th>
            {!readOnly && <th className="text-left py-2 px-3 font-medium">Action</th>}
          </tr>
        </thead>
        <tbody>
          {suggestions.map((s) => (
            <tr key={s.blockId} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td className="py-2 px-3 text-slate-300">{s.dayOfWeek.slice(0, 3)}</td>
              <td className="py-2 px-3 text-white font-medium">{s.startTime}</td>
              <td className="py-2 px-3">
                <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                  {s.soloType}
                </Badge>
              </td>
              <td className="py-2 px-3 text-slate-400">{s.tractorId}</td>
              <td className="py-2 px-3 text-white">
                {s.currentDriverName || s.suggestedDriverName || "—"}
              </td>
              <td className="py-2 px-3 text-slate-400 text-xs max-w-xs truncate">
                {s.reason}
              </td>
              {!readOnly && (
                <td className="py-2 px-3">
                  {s.suggestedDriverId && !showDriverPicker ? (
                    <Button
                      size="sm"
                      onClick={() => onAssign(s.blockId, s.suggestedDriverId!)}
                      disabled={isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-xs h-7"
                    >
                      Apply
                    </Button>
                  ) : (
                    <DriverPicker
                      drivers={drivers}
                      onSelect={(driverId) => onAssign(s.blockId, driverId)}
                      disabled={isPending}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DriverPickerProps {
  drivers: Driver[];
  onSelect: (driverId: string) => void;
  disabled: boolean;
}

function DriverPicker({ drivers, onSelect, disabled }: DriverPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          className="text-xs h-7 border-slate-600"
        >
          <User className="h-3 w-3 mr-1" />
          Pick Driver
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-slate-800 border-slate-700 max-h-64 overflow-y-auto">
        <DropdownMenuLabel className="text-slate-400 text-xs">
          Select Driver
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-slate-700" />
        {drivers.map((driver) => (
          <DropdownMenuItem
            key={driver.id}
            onClick={() => onSelect(driver.id)}
            className="text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            {driver.firstName} {driver.lastName}
          </DropdownMenuItem>
        ))}
        {drivers.length === 0 && (
          <DropdownMenuItem disabled className="text-slate-500">
            No active drivers
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface MissingSlotsTableProps {
  missingSlots: SlotOwner[];
}

function MissingSlotsTable({ missingSlots }: MissingSlotsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 border-b border-slate-700">
            <th className="text-left py-2 px-3 font-medium">Time</th>
            <th className="text-left py-2 px-3 font-medium">Type</th>
            <th className="text-left py-2 px-3 font-medium">Tractor</th>
            <th className="text-left py-2 px-3 font-medium">Last Week Driver</th>
            <th className="text-left py-2 px-3 font-medium">Days Worked</th>
          </tr>
        </thead>
        <tbody>
          {missingSlots.map((slot) => (
            <tr key={slot.slotKey} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td className="py-2 px-3 text-white font-medium">{slot.startTime}</td>
              <td className="py-2 px-3">
                <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                  {slot.soloType}
                </Badge>
              </td>
              <td className="py-2 px-3 text-slate-400">{slot.tractorId}</td>
              <td className="py-2 px-3 text-white">{slot.driverName}</td>
              <td className="py-2 px-3 text-slate-400">{slot.daysWorkedLastWeek} days</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
