import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks, eachDayOfInterval, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const [currentDate, setCurrentDate] = useState(new Date());

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

        {/* Week Navigation */}
        <div className="flex items-center gap-2">
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
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-card border-b">
              <tr>
                <th className="text-left p-4 font-semibold min-w-[300px] border-r">
                  Start Time
                </th>
                {weekRange.weekDays.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="text-center p-4 font-semibold min-w-[150px] border-r last:border-r-0"
                  >
                    <div>{format(day, "EEE")}</div>
                    <div className="text-sm font-normal text-muted-foreground">
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
                    <td className="p-4 border-r align-top">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-base">
                            {formatTime(contract.startTime)} CT
                          </span>
                          <Badge variant="outline" className={getBlockTypeColor(contract.type)}>
                            {contract.type.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-1">
                            <span className="font-medium">Tractor:</span> {contract.tractorId}
                          </div>
                          {contract.domicile && (
                            <div className="flex items-center gap-1">
                              <span className="font-medium">Domicile:</span> {contract.domicile}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Day Cells */}
                    {weekRange.weekDays.map((day) => {
                      const dayISO = format(day, "yyyy-MM-dd");
                      const dayBlocks = blockGrid[contract.id]?.[dayISO] || [];

                      return (
                        <td
                          key={day.toISOString()}
                          className="p-2 border-r last:border-r-0 align-top"
                        >
                          {dayBlocks.length > 0 ? (
                            <div className="space-y-1">
                              {dayBlocks.map((block) => (
                                <div
                                  key={block.id}
                                  className="p-2 rounded-md bg-muted/50 text-xs space-y-1"
                                  data-testid={`block-${block.id}`}
                                >
                                  <div className="font-mono font-medium">
                                    {block.blockId}
                                  </div>
                                  {block.assignment?.driver ? (
                                    <div className="flex items-center gap-1 text-foreground">
                                      <User className="w-3 h-3" />
                                      <span>
                                        {block.assignment.driver.firstName}{" "}
                                        {block.assignment.driver.lastName}
                                      </span>
                                    </div>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs">
                                      Unassigned
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground text-xs py-2">
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
    </div>
  );
}
