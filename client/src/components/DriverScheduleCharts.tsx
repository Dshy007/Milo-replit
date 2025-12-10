/**
 * Driver Schedule Charts for AI Scheduler
 * Elegant dark theme with subtle gradients and professional styling
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
} from "recharts";
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

// Elegant color palette
const ELEGANT_COLORS = {
  excellent: "#10b981",
  good: "#14b8a6",
  fair: "#f59e0b",
  low: "#64748b",
  pattern: {
    sunWed: "#8b5cf6",
    wedSat: "#06b6d4",
    mixed: "#64748b",
    unknown: "#475569",
  },
};

const getScoreColor = (score: number): string => {
  if (score >= 0.8) return ELEGANT_COLORS.excellent;
  if (score >= 0.6) return ELEGANT_COLORS.good;
  if (score >= 0.4) return ELEGANT_COLORS.fair;
  return ELEGANT_COLORS.low;
};

const getScoreLabel = (score: number): string => {
  if (score >= 0.8) return "excellent";
  if (score >= 0.6) return "good";
  if (score >= 0.4) return "fair";
  return "low";
};

const DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Elegant horizontal bar chart showing days assigned per driver
 */
export function DriverWorkloadChart({ suggestions }: DriverChartProps) {
  const chartData = useMemo(() => {
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

    return Object.entries(driverMap)
      .map(([id, data]) => ({
        id,
        name: data.name.split(" ")[0],
        fullName: data.name,
        days: data.days,
        avgScore: data.scores.length > 0
          ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
          : 0.35,
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 12);
  }, [suggestions]);

  if (chartData.length === 0) return null;

  return (
    <div className="chart-container animate-fade-in-up">
      <h3 className="text-sm font-medium text-slate-200 mb-4">Driver Workload</h3>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 50, right: 20, top: 5, bottom: 5 }}>
            <XAxis
              type="number"
              domain={[0, 7]}
              tickCount={8}
              fontSize={10}
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={45}
              fontSize={10}
              stroke="#94a3b8"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(20, 184, 166, 0.05)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="elegant-card p-3 text-xs">
                    <p className="font-medium text-slate-100">{data.fullName}</p>
                    <p className="text-slate-400 mt-1">{data.days} days assigned</p>
                    <p className={cn("mt-0.5", `score-${getScoreLabel(data.avgScore)}`)}>
                      Score: {Math.round(data.avgScore * 100)}%
                    </p>
                  </div>
                );
              }}
            />
            <defs>
              <linearGradient id="barGradientExcellent" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.6} />
              </linearGradient>
              <linearGradient id="barGradientGood" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.6} />
              </linearGradient>
              <linearGradient id="barGradientFair" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.6} />
              </linearGradient>
              <linearGradient id="barGradientLow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#64748b" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#64748b" stopOpacity={0.6} />
              </linearGradient>
            </defs>
            <Bar dataKey="days" radius={[0, 6, 6, 0]}>
              {chartData.map((entry, index) => {
                const label = getScoreLabel(entry.avgScore);
                const gradientId = `barGradient${label.charAt(0).toUpperCase() + label.slice(1)}`;
                return <Cell key={index} fill={`url(#${gradientId})`} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-5 mt-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Excellent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-teal-500" /> Good
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Fair
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-500" /> Assigned
        </span>
      </div>
    </div>
  );
}

/**
 * Elegant heatmap showing Driver x Day matrix
 */
export function DriverWeekHeatmap({ suggestions }: DriverChartProps) {
  const heatmapData = useMemo(() => {
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

    return Object.entries(driverDays)
      .map(([id, data]) => ({
        id,
        name: data.name,
        days: data.days,
        totalDays: Object.keys(data.days).length,
      }))
      .sort((a, b) => b.totalDays - a.totalDays)
      .slice(0, 10);
  }, [suggestions]);

  if (heatmapData.length === 0) return null;

  return (
    <div className="chart-container animate-fade-in-up delay-100">
      <h3 className="text-sm font-medium text-slate-200 mb-4">Weekly Schedule Heatmap</h3>
      <div className="overflow-x-auto">
        <table className="elegant-table">
          <thead>
            <tr>
              <th className="w-28">Driver</th>
              {DAY_LABELS.map((day) => (
                <th key={day} className="text-center w-12">{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmapData.map((driver) => (
              <tr key={driver.id}>
                <td className="font-medium text-slate-300 truncate max-w-[100px]" title={driver.name}>
                  {driver.name.split(" ")[0]} {driver.name.split(" ")[1]?.[0]}.
                </td>
                {DAY_ORDER.map((day) => {
                  const assignment = driver.days[day];
                  return (
                    <td key={day} className="text-center p-1">
                      {assignment ? (
                        <div
                          className={cn(
                            "heatmap-cell w-8 h-8 mx-auto flex items-center justify-center cursor-pointer",
                            `bg-score-${getScoreLabel(assignment.score)}`
                          )}
                          style={{ backgroundColor: getScoreColor(assignment.score) + "30" }}
                          title={`${driver.name}\n${day} @ ${assignment.time}\nScore: ${Math.round(assignment.score * 100)}%`}
                        >
                          <span className="text-[9px] font-medium" style={{ color: getScoreColor(assignment.score) }}>
                            {assignment.time.split(":")[0]}
                          </span>
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded mx-auto bg-slate-800/30" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-center gap-5 mt-4 text-[10px] text-slate-500">
        <span>ML Score:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80" /> 80%+
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-teal-500/80" /> 60-79%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/80" /> 40-59%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-500/80" /> &lt;40%
        </span>
      </div>
    </div>
  );
}

/**
 * Elegant donut chart showing pattern group distribution
 */
export function PatternDistributionChart({ suggestions }: DriverChartProps) {
  const chartData = useMemo(() => {
    const patternDrivers: Record<string, Set<string>> = {
      sunWed: new Set(),
      wedSat: new Set(),
      mixed: new Set(),
      unknown: new Set(),
    };

    for (const s of suggestions) {
      const pattern = s.patternGroup;
      if (pattern && patternDrivers[pattern]) {
        patternDrivers[pattern].add(s.driverId);
      } else if (!pattern) {
        patternDrivers.unknown.add(s.driverId);
      } else {
        patternDrivers.mixed.add(s.driverId);
      }
    }

    return [
      { name: "Sun-Wed", value: patternDrivers.sunWed.size, color: ELEGANT_COLORS.pattern.sunWed },
      { name: "Wed-Sat", value: patternDrivers.wedSat.size, color: ELEGANT_COLORS.pattern.wedSat },
      { name: "Mixed", value: patternDrivers.mixed.size, color: ELEGANT_COLORS.pattern.mixed },
      { name: "New", value: patternDrivers.unknown.size, color: ELEGANT_COLORS.pattern.unknown },
    ].filter(d => d.value > 0);
  }, [suggestions]);

  if (chartData.length === 0) return null;

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="chart-container animate-fade-in-up delay-200">
      <h3 className="text-sm font-medium text-slate-200 mb-4">Pattern Distribution</h3>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              {chartData.map((entry) => (
                <linearGradient key={entry.name} id={`pieGradient${entry.name.replace("-", "")}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={entry.color} stopOpacity={1} />
                  <stop offset="100%" stopColor={entry.color} stopOpacity={0.7} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={70}
              paddingAngle={3}
              dataKey="value"
              stroke="rgba(0,0,0,0.3)"
              strokeWidth={1}
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={`url(#pieGradient${entry.name.replace("-", "")})`} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="elegant-card p-3 text-xs">
                    <p className="font-medium text-slate-100">{data.name}</p>
                    <p className="text-slate-400 mt-1">
                      {data.value} drivers ({Math.round((data.value / total) * 100)}%)
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-4 text-[10px]">
        {chartData.map((item) => (
          <span key={item.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="text-slate-400">{item.name}:</span>
            <span className="text-slate-200 font-medium">{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Elegant match quality distribution with gradient bars
 */
export function MatchQualityChart({ suggestions }: DriverChartProps) {
  const chartData = useMemo(() => {
    const counts = { excellent: 0, good: 0, fair: 0, assigned: 0 };

    for (const s of suggestions) {
      const score = s.mlScore ?? 0.35;
      if (score >= 0.8) counts.excellent++;
      else if (score >= 0.6) counts.good++;
      else if (score >= 0.4) counts.fair++;
      else counts.assigned++;
    }

    return [
      { name: "Excellent", value: counts.excellent, color: ELEGANT_COLORS.excellent },
      { name: "Good", value: counts.good, color: ELEGANT_COLORS.good },
      { name: "Fair", value: counts.fair, color: ELEGANT_COLORS.fair },
      { name: "Assigned", value: counts.assigned, color: ELEGANT_COLORS.low },
    ];
  }, [suggestions]);

  const total = chartData.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  return (
    <div className="chart-container animate-fade-in-up delay-300">
      <h3 className="text-sm font-medium text-slate-200 mb-4">Match Quality</h3>
      <div className="space-y-3">
        {chartData.map((item) => {
          const percent = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={item.name} className="flex items-center gap-3">
              <span className="text-[11px] w-16 text-slate-400">{item.name}</span>
              <div className="flex-1 h-3 bg-slate-800/50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${percent}%`,
                    background: `linear-gradient(90deg, ${item.color} 0%, ${item.color}99 100%)`,
                    boxShadow: percent > 0 ? `0 0 8px ${item.color}40` : "none",
                  }}
                />
              </div>
              <span className="text-[11px] w-16 text-right">
                <span className="text-slate-200 font-medium">{item.value}</span>
                <span className="text-slate-500 ml-1">({Math.round(percent)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
