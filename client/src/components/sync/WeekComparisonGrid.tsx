import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Plus, Clock, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TimeSlot {
  key: string;
  soloType: string;
  startTime: string;
  tractorId: string;
  patternGroup?: string;
}

interface SlotDay {
  date: string;
  dayOfWeek: string;
  blockId: string | null;
  driverId: string | null;
  driverName: string | null;
  status: "assigned" | "unassigned" | "no_block";
  startTimestamp?: string;
  bumpMinutes?: number;
}

interface SlotWeekData {
  slot: TimeSlot;
  days: SlotDay[];
  assignedDriver: string | null;
  assignedDriverId: string | null;
}

interface SlotMatch {
  slot: TimeSlot;
  lastWeek: SlotWeekData;
  thisWeek: SlotWeekData;
  matchType: "exact" | "time_bump" | "driver_unavailable" | "new_slot" | "removed_slot";
  suggestedDriverId?: string;
  suggestedDriverName?: string;
  confidence?: number;
  bumpMinutes?: number;
  reason?: string;
}

interface WeekComparisonGridProps {
  exactMatches: SlotMatch[];
  timeBumps: SlotMatch[];
  driverUnavailable: SlotMatch[];
  newSlots: SlotMatch[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MATCH_STYLES = {
  exact: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    icon: CheckCircle2,
    iconColor: "text-emerald-400",
    label: "Exact Match"
  },
  time_bump: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    icon: Clock,
    iconColor: "text-amber-400",
    label: "Time Bump"
  },
  driver_unavailable: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    icon: XCircle,
    iconColor: "text-red-400",
    label: "Needs Driver"
  },
  new_slot: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    icon: Plus,
    iconColor: "text-violet-400",
    label: "New Slot"
  },
  removed_slot: {
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    icon: XCircle,
    iconColor: "text-slate-400",
    label: "Removed"
  }
};

function SlotRow({ match }: { match: SlotMatch }) {
  const style = MATCH_STYLES[match.matchType];
  const Icon = style.icon;

  // Get first name only for display
  const getFirstName = (fullName: string | null) => {
    if (!fullName) return "—";
    return fullName.split(" ")[0];
  };

  // Count assigned days
  const lastWeekAssigned = match.lastWeek.days.filter(d => d.status === "assigned").length;
  const thisWeekAssigned = match.thisWeek.days.filter(d => d.status === "assigned").length;
  const thisWeekUnassigned = match.thisWeek.days.filter(d => d.status === "unassigned").length;

  return (
    <div className={`rounded-lg border p-3 ${style.bg} ${style.border}`}>
      {/* Slot Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${style.iconColor}`} />
          <span className="font-medium text-white">{match.slot.startTime}</span>
          <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
            {match.slot.soloType}
          </Badge>
          <span className="text-xs text-slate-500">{match.slot.tractorId}</span>
        </div>
        <Badge className={`${style.bg} ${style.iconColor} border-0 text-xs`}>
          {style.label}
        </Badge>
      </div>

      {/* Last Week → This Week */}
      <div className="grid grid-cols-2 gap-4">
        {/* Last Week */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Last Week</span>
            <span className="text-slate-600">({lastWeekAssigned}/7 assigned)</span>
          </div>
          <div className="flex items-center gap-1">
            {match.lastWeek.days.map((day, idx) => (
              <TooltipProvider key={idx}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`
                        w-8 h-8 rounded flex items-center justify-center text-xs font-medium
                        ${day.status === "assigned"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : day.status === "unassigned"
                            ? "bg-red-500/20 text-red-400 border border-red-500/30"
                            : "bg-slate-700/50 text-slate-500 border border-slate-600"
                        }
                      `}
                    >
                      {day.status === "assigned"
                        ? getFirstName(day.driverName).slice(0, 2)
                        : day.status === "unassigned"
                          ? "?"
                          : "—"
                      }
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <div className="font-medium">{DAYS[idx]}</div>
                      {day.driverName ? (
                        <div>{day.driverName}</div>
                      ) : day.status === "unassigned" ? (
                        <div className="text-red-400">Unassigned</div>
                      ) : (
                        <div className="text-slate-400">No block</div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>

        {/* Arrow */}
        <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 hidden">
          <ArrowRight className="h-4 w-4 text-slate-500" />
        </div>

        {/* This Week */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>This Week</span>
            <span className={thisWeekUnassigned > 0 ? "text-red-400" : "text-slate-600"}>
              ({thisWeekAssigned}/7 assigned{thisWeekUnassigned > 0 && `, ${thisWeekUnassigned} needed`})
            </span>
          </div>
          <div className="flex items-center gap-1">
            {match.thisWeek.days.map((day, idx) => (
              <TooltipProvider key={idx}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`
                        w-8 h-8 rounded flex items-center justify-center text-xs font-medium
                        ${day.status === "assigned"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : day.status === "unassigned"
                            ? "bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse"
                            : "bg-slate-700/50 text-slate-500 border border-slate-600"
                        }
                        ${day.bumpMinutes ? "ring-2 ring-amber-500/50" : ""}
                      `}
                    >
                      {day.status === "assigned"
                        ? getFirstName(day.driverName).slice(0, 2)
                        : day.status === "unassigned"
                          ? "?"
                          : "—"
                      }
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <div className="font-medium">{DAYS[idx]}</div>
                      {day.driverName ? (
                        <>
                          <div>{day.driverName}</div>
                          {day.bumpMinutes && (
                            <div className="text-amber-400">
                              Bumped {day.bumpMinutes > 0 ? "+" : ""}{day.bumpMinutes} min
                            </div>
                          )}
                        </>
                      ) : day.status === "unassigned" ? (
                        <div className="text-red-400">Needs assignment</div>
                      ) : (
                        <div className="text-slate-400">No block</div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      </div>

      {/* Additional Info */}
      {match.reason && (
        <div className="mt-2 text-xs text-slate-400">
          {match.reason}
        </div>
      )}

      {/* Bump Info */}
      {match.bumpMinutes && (
        <div className="mt-2 text-xs text-amber-400">
          Time shifted {match.bumpMinutes > 0 ? "+" : ""}{match.bumpMinutes} minutes from expected
        </div>
      )}
    </div>
  );
}

export function WeekComparisonGrid({
  exactMatches,
  timeBumps,
  driverUnavailable,
  newSlots
}: WeekComparisonGridProps) {
  // Combine all matches and sort by start time
  const allMatches = [
    ...exactMatches,
    ...timeBumps,
    ...driverUnavailable,
    ...newSlots
  ].sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));

  if (allMatches.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>No schedule data found for this week comparison.</p>
        <p className="text-sm mt-2">Import schedule data to see comparisons.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
      {allMatches.map((match, idx) => (
        <SlotRow key={match.slot.key + idx} match={match} />
      ))}
    </div>
  );
}
