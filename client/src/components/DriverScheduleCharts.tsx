/**
 * Driver Schedule Charts for AI Scheduler
 * Visual representations of driver assignments, workload distribution, and patterns
 */

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Match the interface from AIScheduler
interface MatchSuggestion {
  blockId: string;
  driverId: string;
  driverName: string;
  confidence: number;
  matchType: string;
  preferredTime: string;
  actualTime: string;
  serviceDate?: string;
  day?: string;
  mlScore?: number | null;
  patternGroup?: string | null;
}

interface DriverChartProps {
  suggestions: MatchSuggestion[];
}

// Color utilities matching AIScheduler
const getScoreColor = (score: number): string => {
  if (score >= 0.8) return "#10b981"; // emerald-500
  if (score >= 0.6) return "#14b8a6"; // teal-500
  if (score >= 0.4) return "#f59e0b"; // amber-500
  return "#64748b"; // slate-500
};

const getScoreBgColor = (score: number): string => {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.6) return "bg-teal-500";
  if (score >= 0.4) return "bg-amber-500";
  return "bg-slate-500";
};

const PATTERN_COLORS: Record<string, string> = {
  sunWed: "#a855f7", // purple-500
  wedSat: "#06b6d4", // cyan-500
  mixed: "#64748b", // slate-500
  unknown: "#94a3b8", // slate-400
};

const DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Horizontal bar chart showing days assigned per driver
 * Color coded by average ML score
 */
export function DriverWorkloadChart({ suggestions }: DriverChartProps) {
  const chartData = useMemo(() => {
    // Group by driver
    const driverMap: Record<string, { name: string; days: number; avgScore: number; scores: number[] }> = {};

    for (const s of suggestions) {
      if (!driverMap[s.driverId]) {
        driverMap[s.driverId] = { name: s.driverName, days: 0, avgScore: 0, scores: [] };
      }
      driverMap[s.driverId].days++;
      if (s.mlScore != null) {
        driverMap[s.driverId].scores.push(s.mlScore);
      }
    }

    // Calculate averages and sort by days descending
    return Object.entries(driverMap)
      .map(([id, data]) => ({
        id,
        name: data.name.split(" ")[0], // First name only for chart
        fullName: data.name,
        days: data.days,
        avgScore: data.scores.length > 0
          ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
          : 0.35,
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 15); // Top 15 drivers
  }, [suggestions]);

  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Driver Workload</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
              <XAxis type="number" domain={[0, 7]} tickCount={8} fontSize={11} />
              <YAxis
                type="category"
                dataKey="name"
                width={55}
                fontSize={10}
                tickLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-background border rounded-lg shadow-lg p-2 text-xs">
                      <p className="font-medium">{data.fullName}</p>
                      <p className="text-muted-foreground">{data.days} days assigned</p>
                      <p className="text-muted-foreground">
                        Avg Score: {Math.round(data.avgScore * 100)}%
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={getScoreColor(entry.avgScore)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-emerald-500" /> Excellent
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-teal-500" /> Good
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-amber-500" /> Fair
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-slate-500" /> Assigned
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Heatmap showing Driver x Day matrix
 * Color intensity based on ML score
 */
export function DriverWeekHeatmap({ suggestions }: DriverChartProps) {
  const heatmapData = useMemo(() => {
    // Group by driver, then by day
    const driverDays: Record<string, {
      name: string;
      days: Record<string, { score: number; time: string; blockId: string }>
    }> = {};

    for (const s of suggestions) {
      if (!driverDays[s.driverId]) {
        driverDays[s.driverId] = { name: s.driverName, days: {} };
      }

      const dayName = s.day?.toLowerCase() || "";
      if (dayName && DAY_ORDER.includes(dayName)) {
        driverDays[s.driverId].days[dayName] = {
          score: s.mlScore ?? 0.35,
          time: s.actualTime,
          blockId: s.blockId,
        };
      }
    }

    // Sort by total days descending
    return Object.entries(driverDays)
      .map(([id, data]) => ({
        id,
        name: data.name,
        days: data.days,
        totalDays: Object.keys(data.days).length,
      }))
      .sort((a, b) => b.totalDays - a.totalDays)
      .slice(0, 12); // Top 12 drivers for heatmap
  }, [suggestions]);

  if (heatmapData.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Weekly Schedule Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left py-1 px-2 font-medium text-muted-foreground w-32">Driver</th>
                {DAY_LABELS.map((day) => (
                  <th key={day} className="text-center py-1 px-1 font-medium text-muted-foreground w-10">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapData.map((driver) => (
                <tr key={driver.id} className="border-t border-border/50">
                  <td className="py-1.5 px-2 font-medium truncate max-w-[120px]" title={driver.name}>
                    {driver.name.split(" ")[0]} {driver.name.split(" ")[1]?.[0]}.
                  </td>
                  {DAY_ORDER.map((day) => {
                    const assignment = driver.days[day];
                    return (
                      <td key={day} className="text-center py-1.5 px-1">
                        {assignment ? (
                          <div
                            className={cn(
                              "w-7 h-7 rounded-md mx-auto flex items-center justify-center cursor-pointer transition-transform hover:scale-110",
                              getScoreBgColor(assignment.score)
                            )}
                            title={`${driver.name}\n${day} @ ${assignment.time}\nScore: ${Math.round(assignment.score * 100)}%`}
                          >
                            <span className="text-[9px] font-medium text-white">
                              {assignment.time.split(":")[0]}
                            </span>
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-md mx-auto bg-muted/30" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
          <span>ML Score:</span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-emerald-500" /> 80%+
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-teal-500" /> 60-79%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-amber-500" /> 40-59%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-slate-500" /> &lt;40%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Pie chart showing pattern group distribution
 */
export function PatternDistributionChart({ suggestions }: DriverChartProps) {
  const chartData = useMemo(() => {
    // Count unique drivers per pattern (only count drivers with a determined pattern)
    const patternDrivers: Record<string, Set<string>> = {
      sunWed: new Set(),
      wedSat: new Set(),
      mixed: new Set(),
      unknown: new Set(),  // Drivers without enough data
    };

    for (const s of suggestions) {
      const pattern = s.patternGroup;
      // Only count drivers with a valid pattern group
      // null/undefined means insufficient data - put in unknown
      if (pattern && patternDrivers[pattern]) {
        patternDrivers[pattern].add(s.driverId);
      } else if (!pattern) {
        patternDrivers.unknown.add(s.driverId);
      } else {
        patternDrivers.mixed.add(s.driverId);
      }
    }

    return [
      { name: "Sun-Wed", value: patternDrivers.sunWed.size, color: PATTERN_COLORS.sunWed },
      { name: "Wed-Sat", value: patternDrivers.wedSat.size, color: PATTERN_COLORS.wedSat },
      { name: "Mixed", value: patternDrivers.mixed.size, color: PATTERN_COLORS.mixed },
      { name: "New", value: patternDrivers.unknown.size, color: PATTERN_COLORS.unknown },  // Insufficient history
    ].filter(d => d.value > 0);
  }, [suggestions]);

  if (chartData.length === 0) return null;

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Pattern Groups</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-background border rounded-lg shadow-lg p-2 text-xs">
                      <p className="font-medium">{data.name}</p>
                      <p className="text-muted-foreground">
                        {data.value} drivers ({Math.round((data.value / total) * 100)}%)
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-3 text-xs">
          {chartData.map((item) => (
            <Badge
              key={item.name}
              variant="outline"
              className="gap-1"
              style={{ borderColor: item.color }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}: {item.value}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Match quality distribution bar chart
 */
export function MatchQualityChart({ suggestions }: DriverChartProps) {
  const chartData = useMemo(() => {
    const counts = {
      excellent: 0,
      good: 0,
      fair: 0,
      assigned: 0,
    };

    for (const s of suggestions) {
      const score = s.mlScore ?? 0.35;
      if (score >= 0.8) counts.excellent++;
      else if (score >= 0.6) counts.good++;
      else if (score >= 0.4) counts.fair++;
      else counts.assigned++;
    }

    return [
      { name: "Excellent", value: counts.excellent, color: "#10b981" },
      { name: "Good", value: counts.good, color: "#14b8a6" },
      { name: "Fair", value: counts.fair, color: "#f59e0b" },
      { name: "Assigned", value: counts.assigned, color: "#64748b" },
    ];
  }, [suggestions]);

  const total = chartData.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Match Quality</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {chartData.map((item) => {
            const percent = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <div key={item.name} className="flex items-center gap-2">
                <span className="text-xs w-16 text-muted-foreground">{item.name}</span>
                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${percent}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
                <span className="text-xs w-12 text-right font-medium">
                  {item.value} <span className="text-muted-foreground">({Math.round(percent)}%)</span>
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
