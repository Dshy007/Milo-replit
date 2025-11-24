import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle2, XCircle, Calendar } from "lucide-react";
import { format, parseISO, startOfWeek, endOfWeek, addDays } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface HeatmapCell {
  driverId: string;
  driverName: string;
  date: string;
  status: "safe" | "warning" | "violation" | "none";
  totalHours: number;
  assignmentCount: number;
  details: string[];
}

interface DriverSummary {
  driverId: string;
  driverName: string;
  totalViolations: number;
  totalWarnings: number;
}

interface HeatmapData {
  drivers: DriverSummary[];
  cells: HeatmapCell[];
  dateRange: string[];
}

function getStatusColor(status: string): string {
  switch (status) {
    case "safe":
      return "bg-green-500/20 border-green-500/30 hover:bg-green-500/30";
    case "warning":
      return "bg-yellow-500/20 border-yellow-500/30 hover:bg-yellow-500/30";
    case "violation":
      return "bg-red-500/20 border-red-500/30 hover:bg-red-500/30";
    default:
      return "bg-muted border-border hover:bg-muted/80";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "safe":
      return <CheckCircle2 className="w-3 h-3 text-green-500" />;
    case "warning":
      return <AlertTriangle className="w-3 h-3 text-yellow-500" />;
    case "violation":
      return <XCircle className="w-3 h-3 text-red-500" />;
    default:
      return null;
  }
}

export function ComplianceHeatmap() {
  // Default to current week
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 }); // Sunday

  const [startDate, setStartDate] = useState(format(weekStart, "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(weekEnd, "yyyy-MM-dd"));

  const { data, isLoading, error } = useQuery<HeatmapData>({
    queryKey: ["/api/compliance/heatmap", startDate, endDate],
    enabled: !!startDate && !!endDate,
  });

  const handlePreviousWeek = () => {
    const newStart = addDays(parseISO(startDate), -7);
    const newEnd = addDays(parseISO(endDate), -7);
    setStartDate(format(newStart, "yyyy-MM-dd"));
    setEndDate(format(newEnd, "yyyy-MM-dd"));
  };

  const handleNextWeek = () => {
    const newStart = addDays(parseISO(startDate), 7);
    const newEnd = addDays(parseISO(endDate), 7);
    setStartDate(format(newStart, "yyyy-MM-dd"));
    setEndDate(format(newEnd, "yyyy-MM-dd"));
  };

  const handleCurrentWeek = () => {
    setStartDate(format(weekStart, "yyyy-MM-dd"));
    setEndDate(format(weekEnd, "yyyy-MM-dd"));
  };

  if (error) {
    return (
      <Card data-testid="card-compliance-heatmap">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            DOT Compliance Heatmap
          </CardTitle>
          <CardDescription>Error loading compliance data</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {(error as Error).message || "Failed to load compliance heatmap"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-compliance-heatmap">
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              DOT Compliance Heatmap
            </CardTitle>
            <CardDescription>
              Shows driver work assignments and compliance status per day. Colored cells indicate days with scheduled blocks.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousWeek}
              data-testid="button-previous-week"
            >
              Previous Week
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCurrentWeek}
              data-testid="button-current-week"
            >
              This Week
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextWeek}
              data-testid="button-next-week"
            >
              Next Week
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Legend */}
        <div className="flex items-center gap-6 mb-4 flex-wrap" data-testid="div-legend">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm text-muted-foreground">Safe (working, within limits)</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-sm text-muted-foreground">Warning (approaching limits)</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm text-muted-foreground">Violation (exceeds DOT limits)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-muted border border-border rounded" />
            <span className="text-sm text-muted-foreground">No work scheduled</span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : !data || data.drivers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-data">
            <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No driver data available for this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-max">
              {/* Header Row */}
              <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `200px repeat(${data.dateRange.length}, 80px)` }}>
                <div className="font-medium text-sm p-2 sticky left-0 bg-background z-10">
                  Driver
                </div>
                {data.dateRange.map((date) => (
                  <div key={date} className="font-medium text-xs p-2 text-center">
                    <div>{format(parseISO(date), "EEE")}</div>
                    <div className="text-muted-foreground">{format(parseISO(date), "MM/dd")}</div>
                  </div>
                ))}
              </div>

              {/* Data Rows */}
              {data.drivers.map((driver) => {
                const driverCells = data.cells.filter(c => c.driverId === driver.driverId);
                
                return (
                  <div
                    key={driver.driverId}
                    className="grid gap-1 mb-1"
                    style={{ gridTemplateColumns: `200px repeat(${data.dateRange.length}, 80px)` }}
                    data-testid={`row-driver-${driver.driverId}`}
                  >
                    {/* Driver Name Column */}
                    <div className="flex items-center gap-2 p-2 sticky left-0 bg-background z-10 border-r border-border">
                      <span className="text-sm truncate" title={driver.driverName}>
                        {driver.driverName}
                      </span>
                      {driver.totalViolations > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {driver.totalViolations}
                        </Badge>
                      )}
                      {driver.totalWarnings > 0 && driver.totalViolations === 0 && (
                        <Badge variant="secondary" className="text-xs bg-yellow-500/20">
                          {driver.totalWarnings}
                        </Badge>
                      )}
                    </div>

                    {/* Date Cells */}
                    {data.dateRange.map((date) => {
                      const cell = driverCells.find(c => c.date === date);
                      if (!cell) {
                        return (
                          <div
                            key={date}
                            className="p-2 border border-border rounded-sm bg-muted"
                            data-testid={`cell-${driver.driverId}-${date}`}
                          />
                        );
                      }

                      return (
                        <TooltipProvider key={date}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={`p-2 border rounded-sm transition-colors cursor-pointer ${getStatusColor(cell.status)}`}
                                data-testid={`cell-${driver.driverId}-${date}`}
                              >
                                <div className="flex flex-col items-center justify-center gap-1">
                                  {getStatusIcon(cell.status)}
                                  {cell.status !== "none" && (
                                    <span className="text-xs font-medium">
                                      {cell.totalHours.toFixed(1)}h
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="center"
                              sideOffset={5}
                              avoidCollisions={true}
                              collisionPadding={8}
                            >
                              <div className="space-y-1">
                                <div className="font-medium">{cell.driverName}</div>
                                <div className="text-sm">{format(parseISO(cell.date), "EEEE, MMM d")}</div>
                                <div className="text-sm">
                                  {cell.totalHours.toFixed(1)} hours ({cell.assignmentCount} {cell.assignmentCount === 1 ? 'block' : 'blocks'})
                                </div>
                                {cell.details.length > 0 && (
                                  <div className="text-sm text-muted-foreground border-t border-border pt-1 mt-1">
                                    {cell.details.map((detail, idx) => (
                                      <div key={idx}>{detail}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
