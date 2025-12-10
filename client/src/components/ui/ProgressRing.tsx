import { cn } from "@/lib/utils";

interface ProgressRingProps {
  value: number; // 0-100
  size?: "sm" | "md" | "lg";
  color?: "teal" | "emerald" | "violet" | "amber" | "slate";
  label?: string;
  sublabel?: string;
  className?: string;
}

const SIZE_CONFIG = {
  sm: { width: 80, strokeWidth: 6, fontSize: "text-lg", sublabelSize: "text-[10px]" },
  md: { width: 100, strokeWidth: 7, fontSize: "text-2xl", sublabelSize: "text-xs" },
  lg: { width: 120, strokeWidth: 8, fontSize: "text-3xl", sublabelSize: "text-sm" },
};

const COLOR_CONFIG = {
  teal: { stroke: "#14b8a6", gradient: ["#14b8a6", "#0d9488"] },
  emerald: { stroke: "#10b981", gradient: ["#10b981", "#059669"] },
  violet: { stroke: "#8b5cf6", gradient: ["#8b5cf6", "#7c3aed"] },
  amber: { stroke: "#f59e0b", gradient: ["#f59e0b", "#d97706"] },
  slate: { stroke: "#64748b", gradient: ["#64748b", "#475569"] },
};

export function ProgressRing({
  value,
  size = "md",
  color = "teal",
  label,
  sublabel,
  className,
}: ProgressRingProps) {
  const config = SIZE_CONFIG[size];
  const colorConfig = COLOR_CONFIG[color];

  const radius = (config.width - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, value));
  const offset = circumference - (progress / 100) * circumference;

  const gradientId = `progress-gradient-${color}-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative" style={{ width: config.width, height: config.width }}>
        <svg
          width={config.width}
          height={config.width}
          className="transform -rotate-90"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colorConfig.gradient[0]} />
              <stop offset="100%" stopColor={colorConfig.gradient[1]} />
            </linearGradient>
          </defs>

          {/* Background circle */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={config.strokeWidth}
          />

          {/* Progress circle */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="progress-ring-animated"
            style={{
              transition: "stroke-dashoffset 1s ease-out",
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn(config.fontSize, "font-semibold text-slate-100")}>
            {label || `${Math.round(progress)}%`}
          </span>
          {sublabel && (
            <span className={cn(config.sublabelSize, "text-slate-400 mt-0.5")}>
              {sublabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact version for inline stats
interface MiniProgressRingProps {
  value: number;
  color?: "teal" | "emerald" | "violet" | "amber" | "slate";
  className?: string;
}

export function MiniProgressRing({ value, color = "teal", className }: MiniProgressRingProps) {
  const colorConfig = COLOR_CONFIG[color];
  const size = 24;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, value));
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      className={cn("transform -rotate-90", className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255, 255, 255, 0.08)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={colorConfig.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.5s ease-out" }}
      />
    </svg>
  );
}
