import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";
import { Mail, Phone, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Driver } from "@shared/schema";

interface DriverCardProps {
  driver: Driver;
  variant?: "in_pool" | "leaving" | "admin" | "off_roster";
  onClick: () => void;
}

function getInitials(first: string, last: string) {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase();
}

function getRiskDot(risk: string | null | undefined) {
  if (risk === "critical") {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-destructive"
        title="Critical retention risk"
        aria-label="Critical retention risk"
      />
    );
  }
  if (risk === "watch") {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-amber-500"
        title="Watch retention risk"
        aria-label="Watch retention risk"
      />
    );
  }
  return null;
}

export function DriverCard({ driver, variant = "in_pool", onClick }: DriverCardProps) {
  const initials = getInitials(driver.firstName, driver.lastName);

  return (
    <Card
      className="hover-elevate transition-all duration-200"
      data-testid={`driver-card-${driver.id}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
              "bg-primary/10 text-primary text-sm font-semibold"
            )}
            aria-hidden
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {driver.firstName} {driver.lastName}
              </h3>
              {getRiskDot(driver.retentionRisk)}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {driver.soloType ? (
                <ContractTypeBadge contractType={driver.soloType} size="sm" />
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20"
                >
                  Unassigned
                </Badge>
              )}
              {variant === "leaving" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Leaving
                </Badge>
              )}
              {variant === "admin" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Admin
                </Badge>
              )}
              {variant === "off_roster" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Off roster
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          {driver.domicile && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{driver.domicile}</span>
            </div>
          )}
          {driver.phoneNumber && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{driver.phoneNumber}</span>
            </div>
          )}
          {driver.email && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{driver.email}</span>
            </div>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onClick}
          data-testid={`button-view-driver-${driver.id}`}
        >
          View
        </Button>
      </CardContent>
    </Card>
  );
}
