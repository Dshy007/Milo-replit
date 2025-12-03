import { Badge } from "@/components/ui/badge";
import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContractTypeBadgeProps {
  contractType?: string | null;
  size?: "sm" | "default";
  showIcon?: boolean;
}

const contractTypeStyles: Record<string, { bg: string; text: string; border: string; label: string; fullLabel: string }> = {
  solo1: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-700",
    label: "S1",
    fullLabel: "SOLO1",
  },
  solo2: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-300 dark:border-purple-700",
    label: "S2",
    fullLabel: "SOLO2",
  },
  team: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
    label: "TM",
    fullLabel: "TEAM",
  },
};

export function ContractTypeBadge({ contractType, size = "default", showIcon = true }: ContractTypeBadgeProps) {
  if (!contractType) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "text-muted-foreground border-dashed flex-shrink-0 whitespace-nowrap",
          size === "sm" && "text-[10px] px-1.5 py-0"
        )}
      >
        {showIcon && <Truck className={cn("mr-1", size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />}
        {size === "sm" ? "—" : "Any"}
      </Badge>
    );
  }

  const normalizedType = contractType.toLowerCase();
  const styles = contractTypeStyles[normalizedType] || contractTypeStyles.solo1;
  const label = size === "sm" ? styles.label : styles.fullLabel;

  return (
    <Badge
      variant="outline"
      className={cn(
        styles.bg,
        styles.text,
        styles.border,
        "border flex-shrink-0 whitespace-nowrap",
        size === "sm" && "text-[10px] px-1.5 py-0"
      )}
    >
      {showIcon && <Truck className={cn("mr-1", size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />}
      {label}
    </Badge>
  );
}
