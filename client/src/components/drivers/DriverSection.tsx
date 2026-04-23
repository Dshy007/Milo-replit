import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface DriverSectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  description?: string;
  children: ReactNode;
  icon?: LucideIcon;
}

export function DriverSection({
  title,
  count,
  defaultOpen = true,
  description,
  children,
  icon: Icon,
}: DriverSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card data-testid={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left hover-elevate transition-all duration-200"
          >
            <div className="flex items-center gap-3 min-w-0">
              {Icon && <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground truncate">
                    {title}
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    {count}
                  </Badge>
                </div>
                {description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                )}
              </div>
            </div>
            <ChevronDown
              className={cn(
                "w-5 h-5 text-muted-foreground flex-shrink-0 transition-transform duration-200",
                open && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-6">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
