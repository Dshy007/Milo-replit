import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  XCircle,
  Plus,
  ChevronDown,
  User,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

interface ExceptionCardProps {
  match: SlotMatch;
  type: "bump" | "unavailable" | "new";
  onAssign: (blockId: string, driverId: string) => void;
  canEdit: boolean;
}

const TYPE_STYLES = {
  bump: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    icon: Clock,
    iconColor: "text-amber-400",
    badge: "Time Bump",
    badgeBg: "bg-amber-500/20"
  },
  unavailable: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    icon: XCircle,
    iconColor: "text-red-400",
    badge: "Needs Driver",
    badgeBg: "bg-red-500/20"
  },
  new: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    icon: Plus,
    iconColor: "text-violet-400",
    badge: "New Slot",
    badgeBg: "bg-violet-500/20"
  }
};

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  isActive: boolean;
}

export function ExceptionCard({ match, type, onAssign, canEdit }: ExceptionCardProps) {
  const style = TYPE_STYLES[type];
  const Icon = style.icon;
  const [expanded, setExpanded] = useState(false);

  // Fetch available drivers
  const { data: drivers } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
    queryFn: async () => {
      const res = await fetch("/api/drivers");
      if (!res.ok) throw new Error("Failed to fetch drivers");
      return res.json();
    }
  });

  // Get unassigned blocks that need drivers
  const unassignedDays = match.thisWeek.days.filter(d => d.status === "unassigned" && d.blockId);

  // Filter to active drivers
  const activeDrivers = (drivers || []).filter(d => d.isActive && d.status === "active");

  // Get suggested driver name
  const suggestedDriver = match.suggestedDriverName || match.lastWeek.assignedDriver;
  const suggestedDriverId = match.suggestedDriverId || match.lastWeek.assignedDriverId;

  const handleQuickAssign = () => {
    if (!suggestedDriverId) return;
    // Assign suggested driver to all unassigned blocks
    unassignedDays.forEach(day => {
      if (day.blockId) {
        onAssign(day.blockId, suggestedDriverId);
      }
    });
  };

  const handleAssignDriver = (driverId: string) => {
    // Assign selected driver to all unassigned blocks
    unassignedDays.forEach(day => {
      if (day.blockId) {
        onAssign(day.blockId, driverId);
      }
    });
  };

  return (
    <div className={`rounded-lg border p-3 ${style.bg} ${style.border}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Icon className={`h-4 w-4 mt-0.5 ${style.iconColor}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">{match.slot.startTime}</span>
              <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                {match.slot.soloType}
              </Badge>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {match.slot.tractorId}
            </div>
          </div>
        </div>
        <Badge className={`${style.badgeBg} ${style.iconColor} border-0 text-xs`}>
          {style.badge}
        </Badge>
      </div>

      {/* Reason */}
      {match.reason && (
        <p className="text-xs text-slate-400 mt-2">{match.reason}</p>
      )}

      {/* Bump Info */}
      {type === "bump" && match.bumpMinutes && (
        <div className="flex items-center gap-2 mt-2 text-xs">
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          <span className="text-amber-400">
            Shifted {match.bumpMinutes > 0 ? "+" : ""}{match.bumpMinutes} min from expected
          </span>
        </div>
      )}

      {/* Unassigned Count */}
      {unassignedDays.length > 0 && (
        <div className="flex items-center gap-2 mt-2 text-xs">
          <XCircle className="h-3 w-3 text-red-400" />
          <span className="text-red-400">
            {unassignedDays.length} day{unassignedDays.length > 1 ? "s" : ""} need assignment
          </span>
        </div>
      )}

      {/* Actions */}
      {canEdit && unassignedDays.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          {/* Quick Assign Suggested Driver */}
          {suggestedDriver && suggestedDriverId && (
            <Button
              size="sm"
              onClick={handleQuickAssign}
              className="bg-emerald-600 hover:bg-emerald-700 text-xs h-7"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Assign {suggestedDriver.split(" ")[0]}
            </Button>
          )}

          {/* Manual Pick Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-slate-600"
              >
                <User className="h-3 w-3 mr-1" />
                Pick Driver
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-slate-800 border-slate-700 max-h-64 overflow-y-auto">
              <DropdownMenuLabel className="text-slate-400 text-xs">
                Available Drivers
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-700" />
              {activeDrivers.map(driver => (
                <DropdownMenuItem
                  key={driver.id}
                  onClick={() => handleAssignDriver(driver.id)}
                  className="text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  {driver.firstName} {driver.lastName}
                </DropdownMenuItem>
              ))}
              {activeDrivers.length === 0 && (
                <DropdownMenuItem disabled className="text-slate-500">
                  No active drivers available
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Expand to see day details */}
      {unassignedDays.length > 1 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 mt-2"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Hide" : "Show"} day details
        </button>
      )}

      {expanded && (
        <div className="mt-2 space-y-1">
          {match.thisWeek.days.map((day, idx) => (
            <div
              key={idx}
              className={`
                flex items-center justify-between text-xs px-2 py-1 rounded
                ${day.status === "unassigned"
                  ? "bg-red-500/10 text-red-400"
                  : day.status === "assigned"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-slate-700/30 text-slate-500"
                }
              `}
            >
              <span className="capitalize">{day.dayOfWeek}</span>
              <span>
                {day.status === "assigned"
                  ? day.driverName?.split(" ")[0]
                  : day.status === "unassigned"
                    ? "Needs driver"
                    : "No block"
                }
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
