import { Card, CardContent } from "@/components/ui/card";
import { Users, Truck, GraduationCap, UserMinus, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface DriverSummaryPillsProps {
  total: number;
  inPool: number;
  onboarding: number;
  leaving: number;
  admin: number;
}

interface Pill {
  label: string;
  value: number;
  icon: LucideIcon;
  testId: string;
}

export function DriverSummaryPills({
  total,
  inPool,
  onboarding,
  leaving,
  admin,
}: DriverSummaryPillsProps) {
  const pills: Pill[] = [
    { label: "Total", value: total, icon: Users, testId: "pill-total" },
    { label: "In Pool", value: inPool, icon: Truck, testId: "pill-in-pool" },
    { label: "Onboarding", value: onboarding, icon: GraduationCap, testId: "pill-onboarding" },
    { label: "Leaving", value: leaving, icon: UserMinus, testId: "pill-leaving" },
    { label: "Admin", value: admin, icon: Shield, testId: "pill-admin" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {pills.map(({ label, value, icon: Icon, testId }) => (
        <Card key={label} data-testid={testId}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
                  {label}
                </p>
                <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
              </div>
              <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
