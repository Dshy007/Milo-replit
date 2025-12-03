import { Badge } from "@/components/ui/badge";
import { Dna } from "lucide-react";
import { cn } from "@/lib/utils";

interface DNAPatternBadgeProps {
  pattern?: string | null;
  size?: "sm" | "default";
  showIcon?: boolean;
}

const patternColors: Record<string, { bg: string; text: string; border: string }> = {
  sunWed: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-700",
  },
  wedSat: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-300 dark:border-purple-700",
  },
  mixed: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
  },
};

const patternLabels: Record<string, string> = {
  sunWed: "Sun-Wed",
  wedSat: "Wed-Sat",
  mixed: "Mixed",
};

// Short labels for small size badge
const patternLabelsShort: Record<string, string> = {
  sunWed: "S-W",
  wedSat: "W-S",
  mixed: "Mix",
};

export function DNAPatternBadge({ pattern, size = "default", showIcon = true }: DNAPatternBadgeProps) {
  if (!pattern) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "text-muted-foreground border-dashed flex-shrink-0 whitespace-nowrap",
          size === "sm" && "text-[10px] px-1.5 py-0"
        )}
      >
        {showIcon && <Dna className={cn("mr-1", size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />}
        {size === "sm" ? "—" : "No Profile"}
      </Badge>
    );
  }

  const colors = patternColors[pattern] || patternColors.mixed;
  const label = size === "sm"
    ? (patternLabelsShort[pattern] || pattern.slice(0, 3))
    : (patternLabels[pattern] || pattern);

  return (
    <Badge
      variant="outline"
      className={cn(
        colors.bg,
        colors.text,
        colors.border,
        "border flex-shrink-0 whitespace-nowrap",
        size === "sm" && "text-[10px] px-1.5 py-0"
      )}
    >
      {showIcon && <Dna className={cn("mr-1", size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />}
      {label}
    </Badge>
  );
}
