import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Mail, Phone, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Driver } from "@shared/schema";
import { getBucketByNumber } from "@/lib/onboarding-buckets";

interface OnboardingDriverCardProps {
  driver: Driver;
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

export function OnboardingDriverCard({ driver, onClick }: OnboardingDriverCardProps) {
  const { toast } = useToast();
  const initials = getInitials(driver.firstName, driver.lastName);
  const bucketNum = driver.onboardingBucket ?? 0;
  const bucket = getBucketByNumber(driver.onboardingBucket);
  const bucketName = driver.onboardingBucketName ?? bucket?.name ?? "Not started";
  const progressPct = bucketNum > 0 ? (bucketNum / 10) * 100 : 0;

  const handleAdvance = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Phase 1 stub — wired to PATCH /api/drivers/:id/pool-status in Phase 2
    toast({
      title: "Advance queued",
      description: `${driver.firstName} ${driver.lastName} pending pipeline advance (not yet wired).`,
    });
  };

  return (
    <Card
      className="hover-elevate transition-all duration-200"
      data-testid={`onboarding-driver-card-${driver.id}`}
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
            {driver.domicile && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {driver.domicile}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-primary truncate">
              Bucket {bucketNum || "—"} of 10: {bucketName}
            </span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {Math.round(progressPct)}%
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
          {driver.onboardingBlockingReason && (
            <p className="text-xs text-muted-foreground italic truncate">
              {driver.onboardingBlockingReason}
            </p>
          )}
        </div>

        <div className="space-y-1">
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
          {!driver.phoneNumber && !driver.email && driver.domicile && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{driver.domicile}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onClick}
            data-testid={`button-view-onboarding-${driver.id}`}
          >
            View
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={handleAdvance}
            data-testid={`button-advance-onboarding-${driver.id}`}
          >
            Advance
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
