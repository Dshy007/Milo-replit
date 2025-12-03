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
  CheckCircle2,
  Loader2,
  Settings2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MiloInline } from "@/components/MiloInline";
import { ContractTypeBadge } from "@/components/ContractTypeBadge";

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
const DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const sortDays = (days: string[] | null): string[] => {
  if (!days) return [];
  return [...days].sort((a, b) =>
    DAY_ORDER.indexOf(a.toLowerCase()) - DAY_ORDER.indexOf(b.toLowerCase())
  );
};

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
    case "sunWed": return { label: "Sun-Wed", color: "bg-blue-100 text-blue-700 border-blue-200" };
    case "wedSat": return { label: "Wed-Sat", color: "bg-sky-100 text-sky-700 border-sky-200" };
    default: return { label: "Flexible", color: "bg-slate-100 text-slate-700 border-slate-200" };
  }
};

// Parse insights to extract days, times, and tractors
const parseInsights = (insights: string[] | null): { days: string[]; times: string[]; tractors: string[] } => {
  const result = { days: [] as string[], times: [] as string[], tractors: [] as string[] };
  if (!insights) return result;

  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayAbbreviations: Record<string, string> = {
    sun: "sunday", mon: "monday", tue: "tuesday", wed: "wednesday",
    thu: "thursday", fri: "friday", sat: "saturday"
  };

  for (const insight of insights) {
    const lower = insight.toLowerCase();

    // Extract days - look for day names or abbreviations
    for (const day of dayNames) {
      if (lower.includes(day)) {
        if (!result.days.includes(day)) result.days.push(day);
      }
    }
    // Also check abbreviations
    for (const [abbr, full] of Object.entries(dayAbbreviations)) {
      // Match word boundary to avoid false positives
      const regex = new RegExp(`\\b${abbr}\\b`, 'i');
      if (regex.test(lower) && !result.days.includes(full)) {
        result.days.push(full);
      }
    }

    // Extract times - look for patterns like "16:30", "1630", "4:30 PM"
    const timePatterns = [
      /(\d{1,2}:\d{2})/g,  // HH:MM format
      /(\d{4})(?:\s*-|\s+(?:start|time))/gi,  // 1630 format near keywords
    ];
    for (const pattern of timePatterns) {
      const matches = insight.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleanTime = match.replace(/[^\d:]/g, '');
          // Convert 4-digit to HH:MM
          const formatted = cleanTime.includes(':') ? cleanTime :
            cleanTime.length === 4 ? `${cleanTime.slice(0, 2)}:${cleanTime.slice(2)}` : cleanTime;
          if (formatted && !result.times.includes(formatted)) {
            result.times.push(formatted);
          }
        }
      }
    }

    // Extract tractors - look for "Tractor_X" or similar patterns
    const tractorMatch = insight.match(/tractor[_\s]?(\w+)/gi);
    if (tractorMatch) {
      for (const match of tractorMatch) {
        const tractorId = match.replace(/tractor[_\s]?/i, 'Tractor_');
        if (!result.tractors.includes(tractorId)) {
          result.tractors.push(tractorId);
        }
      }
    }
  };

  // Sort days by day order
  result.days.sort((a, b) => dayNames.indexOf(a) - dayNames.indexOf(b));

  return result;
};

// All days for toggle buttons
const ALL_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Flip Card for Driver DNA Profile
function DriverCard({
  profile,
  onApplyInsights,
  isApplying
}: {
  profile: DNAProfile;
  onApplyInsights: (driverId: string, data: { days: string[]; times: string[]; tractors: string[] }) => void;
  isApplying: boolean;
}) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>(profile.preferredDays || []);

  const rawScore = parseFloat(profile.consistencyScore || "0");
  const consistency = Math.round(rawScore * 100);
  const hasData = profile.assignmentsAnalyzed && profile.assignmentsAnalyzed > 0;
  const pattern = getPatternBadge(profile.patternGroup);
  const parsedInsights = parseInsights(profile.insights);

  // Check if there are changes from current profile
  const currentDays = profile.preferredDays || [];
  const hasChanges = JSON.stringify(sortDays(selectedDays)) !== JSON.stringify(sortDays(currentDays));

  const toggleDay = (day: string) => {
    setSelectedDays(prev =>
      prev.includes(day)
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    onApplyInsights(profile.driverId, {
      days: selectedDays,
      times: profile.preferredStartTimes || [],
      tractors: profile.preferredTractors || []
    });
    setIsEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedDays(profile.preferredDays || []);
    setIsEditing(false);
  };

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
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
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
                <div className={`text-xl font-bold ${hasData ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {hasData ? `${consistency}%` : '—'}
                </div>
                <div className="text-xs text-muted-foreground">{hasData ? 'match' : 'no data'}</div>
              </div>
            </div>

            <div className="space-y-2 text-sm flex-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4" />
                <span>{sortDays(profile.preferredDays).map(formatDay).join(", ") || "No pattern"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>{profile.preferredStartTimes?.slice(0, 2).map(formatTime).join(", ") || "Varies"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Truck className="w-4 h-4" />
                <ContractTypeBadge contractType={profile.preferredContractType} size="sm" showIcon={false} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground border-t pt-2 mt-auto">
              Click to flip for details
            </p>
          </CardContent>
        </Card>

        {/* Back Face */}
        <Card
          className="absolute inset-0 bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/30"
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
              {isEditing ? (
                <>
                  <h4 className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">Select Work Days</h4>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {ALL_DAYS.map(day => (
                      <Button
                        key={day}
                        size="sm"
                        variant={selectedDays.includes(day) ? "default" : "outline"}
                        className={cn(
                          "h-7 px-2 text-xs",
                          selectedDays.includes(day)
                            ? "bg-blue-600 hover:bg-blue-700"
                            : "hover:bg-blue-50 dark:hover:bg-blue-900/30"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDay(day);
                        }}
                      >
                        {formatDay(day)}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Selected: {selectedDays.length > 0 ? sortDays(selectedDays).map(formatDay).join(", ") : "None"}
                  </p>
                </>
              ) : (
                <>
                  <h4 className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">AI Summary</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    {profile.aiSummary || "No AI summary available yet."}
                  </p>

                  {profile.insights && profile.insights.length > 0 && (
                    <>
                      <h4 className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">Insights</h4>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        {profile.insights.slice(0, 3).map((insight, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <Sparkles className="w-3 h-3 mt-0.5 text-blue-500 flex-shrink-0" />
                            <span>{insight}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="border-t pt-2 mt-auto flex items-center justify-between">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={handleCancel}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={handleSave}
                    disabled={isApplying || !hasChanges}
                  >
                    {isApplying ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                    )}
                    Save Days
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Click to flip back
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditing(true);
                    }}
                  >
                    Edit Days
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Analysis Confidence: 0-100% where 100% = most confident results (balanced threshold)
// User perspective: 100% = "I'm confident these are their true preferences"
//
// The threshold determines minimum week percentage a pattern must appear to be considered "preferred"
// - Low threshold (0.20) = patterns appearing 20%+ of weeks count → captures true preferences with some noise
// - High threshold (0.80) = patterns must appear 80%+ of weeks → misses real preferences, too strict
//
// Mapping: 100% confidence → 0.25 threshold (sweet spot for capturing real preferences)
//          0% confidence → 0.80 threshold (very strict, misses good data)
function accuracyToThreshold(accuracy: number): number {
  // Invert: Higher confidence = lower threshold = better results
  // 100% confidence → 0.25 threshold (captures preferences appearing 25%+ of weeks)
  // 50% confidence → 0.525 threshold
  // 0% confidence → 0.80 threshold (only patterns in 80%+ of weeks)
  const minThreshold = 0.25; // Best results (100% confidence)
  const maxThreshold = 0.80; // Strictest (0% confidence)
  return maxThreshold - (accuracy / 100) * (maxThreshold - minThreshold);
}

function getAccuracyLabel(accuracy: number): string {
  if (accuracy >= 90) return "High Confidence";
  if (accuracy >= 70) return "Confident";
  if (accuracy >= 50) return "Balanced";
  if (accuracy >= 30) return "Conservative";
  return "Very Strict";
}

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (accuracy >= 70) return "text-blue-600 dark:text-blue-400";
  if (accuracy >= 50) return "text-sky-600 dark:text-sky-400";
  if (accuracy >= 30) return "text-amber-600 dark:text-amber-400";
  return "text-orange-600 dark:text-orange-400";
}

// Main Page
export default function ScheduleIntelligence() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sunWed" | "wedSat" | "mixed">("all");
  const [applyingDriverId, setApplyingDriverId] = useState<string | null>(null);
  const [analysisAccuracy, setAnalysisAccuracy] = useState(75); // 0-100%, default 75% (confident)
  const { toast } = useToast();

  const { data, isLoading } = useQuery<DNAResponse>({
    queryKey: ["/api/driver-dna"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/driver-dna/analyze", {
        dayThreshold: accuracyToThreshold(analysisAccuracy),
      });
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

  const applyInsightsMutation = useMutation({
    mutationFn: async ({ driverId, data }: { driverId: string; data: { days: string[]; times: string[]; tractors: string[] } }) => {
      setApplyingDriverId(driverId);
      const res = await apiRequest("PATCH", `/api/driver-dna/${driverId}`, {
        preferredDays: data.days.length > 0 ? data.days : undefined,
        preferredStartTimes: data.times.length > 0 ? data.times : undefined,
        preferredTractors: data.tractors.length > 0 ? data.tractors : undefined,
      });
      return res.json();
    },
    onSuccess: (_result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-dna"] });
      toast({
        title: "Insights Applied!",
        description: "Driver profile updated with discovered patterns.",
      });
      setApplyingDriverId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to Apply", description: error.message, variant: "destructive" });
      setApplyingDriverId(null);
    },
  });

  const handleApplyInsights = (driverId: string, data: { days: string[]; times: string[]; tractors: string[] }) => {
    applyInsightsMutation.mutate({ driverId, data });
  };

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
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
            <Dna className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Driver Profile</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered scheduling preferences
            </p>
          </div>
        </div>
        {hasProfiles && (
          <div className="flex items-center gap-4">
            {/* Analysis Accuracy Slider */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-lg px-4 py-2">
                    <Settings2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex flex-col gap-1 min-w-[180px]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Analysis Accuracy</span>
                        <span className={cn("text-sm font-bold", getAccuracyColor(analysisAccuracy))}>
                          {analysisAccuracy}%
                        </span>
                      </div>
                      <Slider
                        value={[analysisAccuracy]}
                        onValueChange={([value]) => setAnalysisAccuracy(value)}
                        min={0}
                        max={100}
                        step={5}
                        className="w-full"
                      />
                      <span className={cn("text-[10px] text-center", getAccuracyColor(analysisAccuracy))}>
                        {getAccuracyLabel(analysisAccuracy)}
                      </span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-medium mb-1">Analysis Accuracy</p>
                  <p className="text-xs text-muted-foreground">
                    Higher % = stricter matching, only the most consistent days are detected.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lower % = more flexible, catches more potential days.
                  </p>
                  <p className="text-xs font-medium mt-2 text-sky-600">
                    Recommended: 50% for balanced results
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
            >
              {analyzeMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {analyzeMutation.isPending ? "Analyzing..." : "Re-analyze"}
            </Button>
          </div>
        )}
      </div>

      {/* Analyzing Progress */}
      {analyzeMutation.isPending && (
        <Card className="mb-6 border-blue-300 dark:border-blue-700 bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/30">
          <CardContent className="py-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center animate-pulse">
                <Sparkles className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Analyzing Driver Patterns...</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Scanning 12 weeks of assignment history with AI
                </p>
                {/* Animated progress bar with glowing effect */}
                <div className="relative h-2 bg-blue-100 dark:bg-blue-900/50 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500 to-transparent"
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

      {/* Milo AI Assistant */}
      {hasProfiles && !analyzeMutation.isPending && (
        <div className="mb-6">
          <MiloInline placeholder="Ask Milo about driver patterns, scheduling insights, or fleet analysis..." />
        </div>
      )}

      {/* Empty State */}
      {!hasProfiles && !isLoading && (
        <Card className="mb-6 shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/30 transition-shadow duration-300 border-blue-200 dark:border-blue-800">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center mx-auto mb-4">
              <Dna className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Driver Profiles Yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Scan your historical data and generate AI-powered
              scheduling preferences for each driver.
            </p>
            {/* Analysis Accuracy Slider - Empty State */}
            <div className="flex flex-col items-center gap-4 mb-6">
              <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-xl px-6 py-3 shadow-inner">
                <Settings2 className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col gap-1.5 min-w-[220px]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Analysis Accuracy</span>
                    <span className={cn("text-lg font-bold", getAccuracyColor(analysisAccuracy))}>
                      {analysisAccuracy}%
                    </span>
                  </div>
                  <Slider
                    value={[analysisAccuracy]}
                    onValueChange={([value]) => setAnalysisAccuracy(value)}
                    min={0}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <span className={cn("text-xs text-center font-medium", getAccuracyColor(analysisAccuracy))}>
                    {getAccuracyLabel(analysisAccuracy)}
                  </span>
                </div>
              </div>
              <Button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                size="lg"
                className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/30"
              >
                {analyzeMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                {analyzeMutation.isPending ? "Analyzing..." : "Analyze Fleet"}
              </Button>
            </div>
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
                className={filter === f.key ? "bg-blue-600 hover:bg-blue-700" : ""}
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
            <DriverCard
              key={profile.id}
              profile={profile}
              onApplyInsights={handleApplyInsights}
              isApplying={applyingDriverId === profile.driverId}
            />
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
          className="mt-8 bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-950/20 dark:to-sky-950/20 border-blue-200 dark:border-blue-800 cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 transition-colors group"
          onClick={() => {
            const firstCard = document.querySelector('[data-driver-card]');
            if (firstCard) {
              firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Review Driver Preferences</h3>
                <p className="text-sm text-muted-foreground">
                  Click on any driver card above to flip and review their full AI summary and insights.
                  This data powers smarter auto-assignments in the Schedule Builder.
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
