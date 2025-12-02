import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Dna,
  RefreshCw,
  Search,
  Calendar,
  Clock,
  Truck,
  ChevronRight,
  Zap,
  User,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Types
interface DNAProfile {
  id: string;
  driverId: string;
  driverName: string;
  preferredDays: string[] | null;
  preferredStartTimes: string[] | null;
  preferredTractors: string[] | null;
  preferredContractType: string | null;
  consistencyScore: string | null;
  patternGroup: string | null;
  assignmentsAnalyzed: number | null;
  aiSummary: string | null;
  insights: string[] | null;
  lastAnalyzedAt: string | null;
}

interface FleetStats {
  totalProfiles: number;
  sunWedCount: number;
  wedSatCount: number;
  mixedCount: number;
  avgConsistency: number;
  totalAssignmentsAnalyzed: number;
  lastAnalyzedAt: string | null;
}

interface DNAResponse {
  profiles: DNAProfile[];
  stats: FleetStats;
}

// Helpers
const formatDay = (day: string) => {
  const map: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat",
  };
  return map[day.toLowerCase()] || day.slice(0, 3);
};

const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minutes} ${ampm}`;
};

const getPatternBadge = (pattern: string | null) => {
  switch (pattern) {
    case "sunWed": return { label: "Sun-Wed", color: "bg-violet-100 text-violet-700 border-violet-200" };
    case "wedSat": return { label: "Wed-Sat", color: "bg-blue-100 text-blue-700 border-blue-200" };
    default: return { label: "Flexible", color: "bg-slate-100 text-slate-700 border-slate-200" };
  }
};

// Flip Card for Driver DNA Profile
function DriverCard({ profile }: { profile: DNAProfile }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const consistency = Math.round(parseFloat(profile.consistencyScore || "0") * 100);
  const pattern = getPatternBadge(profile.patternGroup);

  return (
    <div
      className="h-64 cursor-pointer"
      style={{ perspective: "1000px" }}
      onClick={() => setIsFlipped(!isFlipped)}
      data-driver-card
    >
      <div
        className={cn(
          "relative w-full h-full transition-transform duration-500",
        )}
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front Face */}
        <Card
          className="absolute inset-0 hover:shadow-lg hover:-translate-y-1 transition-all duration-200"
          style={{ backfaceVisibility: "hidden" }}
        >
          <CardContent className="p-4 h-full flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">{profile.driverName}</h3>
                  <Badge variant="outline" className={cn("text-xs", pattern.color)}>
                    {pattern.label}
                  </Badge>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-emerald-600">
                  {consistency}%
                </div>
                <div className="text-xs text-muted-foreground">match</div>
              </div>
            </div>

            <div className="space-y-2 text-sm flex-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4" />
                <span>{profile.preferredDays?.map(formatDay).join(", ") || "No pattern"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>{profile.preferredStartTimes?.slice(0, 2).map(formatTime).join(", ") || "Varies"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Truck className="w-4 h-4" />
                <span>{profile.preferredContractType?.toUpperCase() || "Any contract"}</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground border-t pt-2 mt-auto">
              Click to flip for details
            </p>
          </CardContent>
        </Card>

        {/* Back Face */}
        <Card
          className="absolute inset-0 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <CardContent className="p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">{profile.driverName}</h3>
              <Badge variant="outline" className={cn("text-xs", pattern.color)}>
                {pattern.label}
              </Badge>
            </div>

            <div className="flex-1 overflow-y-auto">
              <h4 className="text-xs font-medium text-violet-700 dark:text-violet-300 mb-1">AI Summary</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {profile.aiSummary || "No AI summary available yet."}
              </p>

              {profile.insights && profile.insights.length > 0 && (
                <>
                  <h4 className="text-xs font-medium text-violet-700 dark:text-violet-300 mb-1">Insights</h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    {profile.insights.map((insight, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <Sparkles className="w-3 h-3 mt-0.5 text-violet-500 flex-shrink-0" />
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <p className="text-xs text-muted-foreground border-t pt-2 mt-auto">
              Click to flip back
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Main Page
export default function ScheduleIntelligence() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sunWed" | "wedSat" | "mixed">("all");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<DNAResponse>({
    queryKey: ["/api/driver-dna"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/driver-dna/analyze", {});
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-dna"] });
      toast({
        title: "Analysis Complete",
        description: `Analyzed ${result.totalDrivers} drivers successfully.`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Analysis Failed", description: error.message, variant: "destructive" });
    },
  });

  const profiles = data?.profiles?.filter((p) => {
    const matchesSearch = p.driverName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === "all" || p.patternGroup === filter;
    return matchesSearch && matchesFilter;
  }) || [];

  const stats = data?.stats;
  const hasProfiles = stats && stats.totalProfiles > 0;

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Dna className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Driver DNA</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered scheduling preferences
            </p>
          </div>
        </div>
        {hasProfiles && (
          <Button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
          >
            {analyzeMutation.isPending ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {analyzeMutation.isPending ? "Analyzing..." : "Re-analyze"}
          </Button>
        )}
      </div>

      {/* Analyzing Progress */}
      {analyzeMutation.isPending && (
        <Card className="mb-6 border-violet-300 dark:border-violet-700 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30">
          <CardContent className="py-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center animate-pulse">
                <Sparkles className="w-6 h-6 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Analyzing Driver Patterns...</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Scanning 12 weeks of assignment history with AI
                </p>
                {/* Animated progress bar with glowing effect */}
                <div className="relative h-2 bg-violet-100 dark:bg-violet-900/50 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-violet-500 to-transparent"
                    style={{
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 6s ease-in-out infinite',
                    }}
                  />
                  <style>{`
                    @keyframes shimmer {
                      0% { transform: translateX(-100%); }
                      100% { transform: translateX(100%); }
                    }
                  `}</style>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Row */}
      {hasProfiles && !analyzeMutation.isPending && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{stats.totalProfiles}</div>
              <div className="text-xs text-muted-foreground">Drivers</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600">{Math.round(stats.avgConsistency * 100)}%</div>
              <div className="text-xs text-muted-foreground">Avg Match</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{stats.totalAssignmentsAnalyzed}</div>
              <div className="text-xs text-muted-foreground">Assignments</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">
                {stats.lastAnalyzedAt ? format(new Date(stats.lastAnalyzedAt), "MMM d") : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Last Run</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {!hasProfiles && !isLoading && (
        <Card className="mb-6 shadow-lg shadow-violet-500/20 hover:shadow-xl hover:shadow-violet-500/30 transition-shadow duration-300 border-violet-200 dark:border-violet-800">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center mx-auto mb-4">
              <Dna className="w-8 h-8 text-violet-600 dark:text-violet-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No DNA Profiles Yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Scan your historical data and generate AI-powered
              scheduling preferences for each driver.
            </p>
            <Button
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              size="lg"
              className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 mb-6"
            >
              {analyzeMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              {analyzeMutation.isPending ? "Analyzing..." : "Analyze Fleet"}
            </Button>
            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span>Preferred days</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>Start times</span>
              </div>
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4" />
                <span>Contract types</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search & Filter */}
      {hasProfiles && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search drivers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            {[
              { key: "all", label: "All" },
              { key: "sunWed", label: "Sun-Wed" },
              { key: "wedSat", label: "Wed-Sat" },
              { key: "mixed", label: "Flexible" },
            ].map((f) => (
              <Button
                key={f.key}
                variant={filter === f.key ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f.key as any)}
                className={filter === f.key ? "bg-violet-600 hover:bg-violet-700" : ""}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="h-48 animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-muted rounded w-3/4 mb-3" />
                <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                <div className="h-3 bg-muted rounded w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Driver Cards */}
      {!isLoading && profiles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((profile) => (
            <DriverCard key={profile.id} profile={profile} />
          ))}
        </div>
      )}

      {/* No Results */}
      {!isLoading && hasProfiles && profiles.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No drivers match your search</p>
          </CardContent>
        </Card>
      )}

      {/* How It Works - Clickable to scroll to cards */}
      {hasProfiles && (
        <Card
          className="mt-8 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 border-violet-200 dark:border-violet-800 cursor-pointer hover:border-violet-400 dark:hover:border-violet-600 transition-colors group"
          onClick={() => {
            const firstCard = document.querySelector('[data-driver-card]');
            if (firstCard) {
              firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Review Driver Preferences</h3>
                <p className="text-sm text-muted-foreground">
                  Click on any driver card above to flip and review their full AI summary and insights.
                  This data powers smarter auto-assignments in the Schedule Builder.
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-violet-600 dark:text-violet-400 flex-shrink-0 mt-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
