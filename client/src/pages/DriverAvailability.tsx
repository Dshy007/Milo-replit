import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Search, ChevronLeft, ChevronRight, Save, Users, Calendar, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, getISOWeek } from "date-fns";
import type { Driver, DriverAvailabilityPreference, Contract } from "@shared/schema";

// Contract time grouped by block type for tree display
type ContractTimeRow = {
  startTime: string;
  blockType: "solo1" | "solo2" | "team";
  blockTypeLabel: string;
  locationCode: string;
  timezone: string;
  contracts: Contract[];
};

export default function DriverAvailability() {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const { toast } = useToast();

  // Fetch all drivers
  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Fetch all contracts to get unique start times
  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  // Fetch preferences for selected driver
  const { data: preferences = [], isLoading: preferencesLoading } = useQuery<DriverAvailabilityPreference[]>({
    queryKey: ["/api/driver-availability-preferences", selectedDriverId],
    queryFn: () => 
      selectedDriverId 
        ? fetch(`/api/driver-availability-preferences?driverId=${selectedDriverId}`).then(r => r.json())
        : Promise.resolve([]),
    enabled: !!selectedDriverId,
  });

  // Mutation to update preferences
  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: { driverId: string; preferences: Array<{ blockType: string; startTime: string; dayOfWeek: string; isAvailable: boolean }> }) => {
      return await apiRequest("POST", "/api/driver-availability-preferences/bulk", data);
    },
    onSuccess: () => {
      queryClient.refetchQueries({ 
        queryKey: ["/api/driver-availability-preferences", selectedDriverId] 
      });
      toast({
        title: "Preferences saved",
        description: "Driver availability preferences updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to save preferences",
        description: error.message,
      });
    },
  });

  // Filter drivers by search query
  const filteredDrivers = drivers.filter((driver) =>
    driver.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    driver.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    driver.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedDriver = drivers.find((d) => d.id === selectedDriverId);

  // Normalize contract type to lowercase
  const normalizeBlockType = (type: string): "solo1" | "solo2" | "team" => {
    const normalized = type.toLowerCase();
    if (normalized === "solo1" || normalized === "solo2" || normalized === "team") {
      return normalized as "solo1" | "solo2" | "team";
    }
    return "solo1";
  };

  // Group contracts by start time and block type (matches Special Requests logic)
  const contractTimeRows: ContractTimeRow[] = useMemo(() => {
    if (!contracts || contracts.length === 0) return [];
    
    const grouped = new Map<string, ContractTimeRow>();
    
    contracts.forEach(contract => {
      const blockType = normalizeBlockType(contract.type);
      const key = `${contract.startTime}-${blockType}`;
      
      if (!grouped.has(key)) {
        const blockTypeLabel = blockType === "solo1" ? "Solo1" : 
                               blockType === "solo2" ? "Solo2" : "Team";
        
        // Extract location and timezone from first contract in group
        // Normalize domicile code to uppercase for display and timezone lookup
        const locationCode = (contract.domicile || "N/A").toUpperCase();
        
        // TODO: Timezone should be configurable per domicile or added to contract schema
        // For now, using a simple mapping based on common US domiciles
        const timezoneMap: Record<string, string> = {
          "HKC": "GMT-6", // Kansas City - Central
          "MKC": "GMT-6", // Kansas City - Central
          "PHX": "GMT-7", // Phoenix - Mountain
          "LAX": "GMT-8", // Los Angeles - Pacific
          "DFW": "GMT-6", // Dallas - Central
          "NYC": "GMT-5", // New York - Eastern
          "ATL": "GMT-5", // Atlanta - Eastern
          "ORD": "GMT-6", // Chicago - Central
          "DEN": "GMT-7", // Denver - Mountain
          "SEA": "GMT-8", // Seattle - Pacific
        };
        const timezone = timezoneMap[locationCode] || "GMT-6"; // Default to Central time
        
        grouped.set(key, {
          startTime: contract.startTime,
          blockType,
          blockTypeLabel,
          locationCode,
          timezone,
          contracts: []
        });
      }
      
      grouped.get(key)!.contracts.push(contract);
    });
    
    // Sort by block type (Solo1, Solo2, Team), then by time
    return Array.from(grouped.values()).sort((a, b) => {
      const typeOrder = { solo1: 1, solo2: 2, team: 3 };
      if (a.blockType !== b.blockType) {
        return typeOrder[a.blockType] - typeOrder[b.blockType];
      }
      return a.startTime.localeCompare(b.startTime);
    });
  }, [contracts]);

  // Get week days for column headers
  const weekDays = useMemo(() => {
    const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: currentWeekStart, end: weekEnd });
  }, [currentWeekStart]);

  // Get day of week string (lowercase for API compatibility)
  const getDayOfWeek = (date: Date): string => {
    return format(date, 'EEEE').toLowerCase();
  };

  // Build preference state from API data
  const preferenceMap = new Map<string, boolean>();
  for (const pref of preferences) {
    const key = `${pref.blockType}:${pref.startTime}:${pref.dayOfWeek}`;
    preferenceMap.set(key, pref.isAvailable);
  }

  // Check if a specific preference is enabled
  const isAvailable = (blockType: string, startTime: string, dayOfWeek: string): boolean => {
    const key = `${blockType}:${startTime}:${dayOfWeek}`;
    return preferenceMap.get(key) ?? true; // Default to available if not set
  };

  // Track local changes (uncommitted edits)
  const [localPreferences, setLocalPreferences] = useState<Map<string, boolean>>(new Map());

  // Reset local state when preferences change or driver changes
  useEffect(() => {
    setLocalPreferences(new Map());
  }, [selectedDriverId, preferences]);

  const togglePreference = (blockType: string, startTime: string, dayOfWeek: string) => {
    const key = `${blockType}:${startTime}:${dayOfWeek}`;
    const currentAvailable = localPreferences.get(key) ?? isAvailable(blockType, startTime, dayOfWeek);
    const newAvailable = !currentAvailable;
    const serverAvailable = isAvailable(blockType, startTime, dayOfWeek);
    
    const newPreferences = new Map(localPreferences);
    
    if (newAvailable === serverAvailable) {
      newPreferences.delete(key);
    } else {
      newPreferences.set(key, newAvailable);
    }
    
    setLocalPreferences(newPreferences);
  };

  const getPreferenceValue = (blockType: string, startTime: string, dayOfWeek: string): boolean => {
    const key = `${blockType}:${startTime}:${dayOfWeek}`;
    const available = localPreferences.get(key) ?? isAvailable(blockType, startTime, dayOfWeek);
    return available;
  };

  // Save preferences
  const handleSave = () => {
    if (!selectedDriverId) return;

    const preferencesToSave = [];
    const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    
    // Save all contract time + day combinations
    for (const row of contractTimeRows) {
      for (const dayOfWeek of daysOfWeek) {
        const key = `${row.blockType}:${row.startTime}:${dayOfWeek}`;
        const value = localPreferences.get(key) ?? isAvailable(row.blockType, row.startTime, dayOfWeek);
        preferencesToSave.push({
          blockType: row.blockType,
          startTime: row.startTime,
          dayOfWeek,
          isAvailable: value,
        });
      }
    }

    updatePreferencesMutation.mutate({
      driverId: selectedDriverId,
      preferences: preferencesToSave,
    });
  };

  // Reset to server state
  const handleReset = () => {
    setLocalPreferences(new Map());
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = localPreferences.size > 0;

  // Week navigation
  const goToPreviousWeek = () => {
    setCurrentWeekStart(prev => subWeeks(prev, 1));
  };

  const goToNextWeek = () => {
    setCurrentWeekStart(prev => addWeeks(prev, 1));
  };

  const goToCurrentWeek = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };

  const weekNumber = getISOWeek(currentWeekStart);

  // Group rows by block type for tree display
  const rowsByBlockType = useMemo(() => {
    const grouped = new Map<string, ContractTimeRow[]>();
    contractTimeRows.forEach(row => {
      if (!grouped.has(row.blockTypeLabel)) {
        grouped.set(row.blockTypeLabel, []);
      }
      grouped.get(row.blockTypeLabel)!.push(row);
    });
    return grouped;
  }, [contractTimeRows]);

  return (
    <div className="flex h-full">
      {/* Left Sidebar - Driver List */}
      <div className="w-80 border-r border-border flex flex-col bg-card/50">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold" data-testid="text-page-title">Driver Availability</h2>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search drivers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-drivers"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-driver-count">
            {filteredDrivers.length} driver{filteredDrivers.length !== 1 ? "s" : ""} found
          </p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {driversLoading ? (
              <div className="text-center text-muted-foreground py-8" data-testid="text-loading">
                Loading drivers...
              </div>
            ) : filteredDrivers.length === 0 ? (
              <div className="text-center text-muted-foreground py-8" data-testid="text-no-drivers">
                No drivers found
              </div>
            ) : (
              filteredDrivers.map((driver) => (
                <button
                  key={driver.id}
                  onClick={() => {
                    setSelectedDriverId(driver.id);
                    setLocalPreferences(new Map());
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors hover-elevate ${
                    selectedDriverId === driver.id
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground"
                  }`}
                  data-testid={`button-driver-${driver.id}`}
                >
                  <div className="font-medium">{driver.firstName} {driver.lastName}</div>
                  {driver.email && (
                    <div className="text-xs text-muted-foreground">{driver.email}</div>
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right Panel - Availability Grid */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedDriverId ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground" data-testid="text-no-selection">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">Select a driver</p>
              <p className="text-sm">Choose a driver from the list to manage their availability preferences</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header with Actions */}
            <div className="p-4 border-b border-border bg-card/50">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-bold" data-testid="text-selected-driver">
                    {selectedDriver && `${selectedDriver.firstName} ${selectedDriver.lastName}`}
                  </h2>
                  <p className="text-sm text-muted-foreground" data-testid="text-instructions">
                    Check boxes to mark driver as AVAILABLE for that shift
                  </p>
                </div>
                
                {/* Week Navigation */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={goToPreviousWeek}
                    data-testid="button-previous-week"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={goToCurrentWeek}
                    className="min-w-[120px]"
                    data-testid="button-current-week"
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    Week {weekNumber}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={goToNextWeek}
                    data-testid="button-next-week"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleSave}
                  disabled={!hasUnsavedChanges || updatePreferencesMutation.isPending}
                  data-testid="button-save"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={!hasUnsavedChanges}
                  data-testid="button-reset"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
              </div>

              {/* Unsaved Changes Warning */}
              {hasUnsavedChanges && (
                <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-md">
                  <p className="text-sm font-medium text-primary" data-testid="text-unsaved-changes">
                    You have unsaved changes. Click "Save Changes" to apply your modifications.
                  </p>
                </div>
              )}
            </div>

            {/* Grid Container */}
            <div className="flex-1 overflow-auto">
              {preferencesLoading || contractsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-muted-foreground" data-testid="text-loading-preferences">
                    Loading preferences...
                  </div>
                </div>
              ) : contractTimeRows.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-muted-foreground" data-testid="text-no-start-times">
                    <p className="text-lg font-medium">No contracts configured</p>
                    <p className="text-sm">Please add contracts with start times to manage driver availability.</p>
                  </div>
                </div>
              ) : (
                <div className="p-4">
                  {/* Date Column Headers */}
                  <div className="flex mb-4">
                    <div className="w-72 flex-shrink-0" />
                    <div className="flex-1 grid grid-cols-7 gap-2">
                      {weekDays.map(day => (
                        <div 
                          key={day.toISOString()} 
                          className="text-center"
                          data-testid={`header-date-${format(day, 'yyyy-MM-dd')}`}
                        >
                          <div className="text-sm font-medium">{format(day, 'EEE')}</div>
                          <div className="text-xs text-muted-foreground">{format(day, 'MMM d')}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Contract Time Rows Grouped by Block Type */}
                  <div className="space-y-6">
                    {Array.from(rowsByBlockType.entries()).map(([blockTypeLabel, rows]) => (
                      <Card key={blockTypeLabel}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Badge variant="outline" className="font-medium">
                              {blockTypeLabel}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {rows.map(row => (
                            <div 
                              key={`${row.blockType}-${row.startTime}`} 
                              className="flex items-center"
                              data-testid={`row-${row.blockType}-${row.startTime}`}
                            >
                              {/* Contract Time Label */}
                              <div className="w-72 flex-shrink-0 pr-4">
                                <div className="text-sm font-medium">
                                  {row.startTime} {row.timezone}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {row.locationCode} • {row.blockTypeLabel}
                                </div>
                              </div>

                              {/* Day Checkboxes */}
                              <div className="flex-1 grid grid-cols-7 gap-2">
                                {weekDays.map(day => {
                                  const dayOfWeek = getDayOfWeek(day);
                                  const isChecked = getPreferenceValue(row.blockType, row.startTime, dayOfWeek);
                                  
                                  return (
                                    <div 
                                      key={day.toISOString()} 
                                      className="flex items-center justify-center"
                                    >
                                      <Checkbox
                                        checked={isChecked}
                                        onCheckedChange={() => togglePreference(row.blockType, row.startTime, dayOfWeek)}
                                        data-testid={`checkbox-${row.blockType}-${row.startTime}-${dayOfWeek}`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
