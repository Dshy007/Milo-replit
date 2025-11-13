import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Search, CheckCircle2, XCircle, RefreshCw, Save, Users } from "lucide-react";
import type { Driver, DriverAvailabilityPreference, Contract } from "@shared/schema";

export default function DriverAvailability() {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
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
      queryClient.invalidateQueries({ queryKey: ["/api/driver-availability-preferences"] });
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

  // Mutation to clear all preferences for a driver
  const clearPreferencesMutation = useMutation({
    mutationFn: async (driverId: string) => {
      return await apiRequest("DELETE", `/api/driver-availability-preferences/${driverId}`);
    },
    onSuccess: () => {
      // Refetch preferences for the selected driver to update UI
      queryClient.refetchQueries({ 
        queryKey: ["/api/driver-availability-preferences", selectedDriverId] 
      });
      toast({
        title: "Preferences cleared",
        description: "All availability preferences removed for this driver",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to clear preferences",
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

  // Block configurations - dynamically determined from contracts
  const blockTypes = ["solo1", "solo2", "team"];
  const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  
  // Build a map of block type → sorted start times from contracts
  // This ensures we only show valid combinations that exist in the system
  const blockTypeStartTimes = new Map<string, string[]>();
  for (const blockType of blockTypes) {
    const startTimesForType = Array.from(
      new Set(
        contracts
          .filter(c => c.type === blockType)
          .map(c => c.startTime)
      )
    ).sort((a, b) => {
      const [aHour, aMin] = a.split(':').map(Number);
      const [bHour, bMin] = b.split(':').map(Number);
      return (aHour * 60 + aMin) - (bHour * 60 + bMin);
    });
    blockTypeStartTimes.set(blockType, startTimesForType);
  }
  
  // Check if any block types have start times
  const hasStartTimes = Array.from(blockTypeStartTimes.values()).some(times => times.length > 0);

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
    const currentValue = localPreferences.get(key) ?? isAvailable(blockType, startTime, dayOfWeek);
    const newValue = !currentValue;
    const serverValue = isAvailable(blockType, startTime, dayOfWeek);
    
    const newPreferences = new Map(localPreferences);
    
    // If new value matches server state, remove from local changes
    // Otherwise, track the change
    if (newValue === serverValue) {
      newPreferences.delete(key);
    } else {
      newPreferences.set(key, newValue);
    }
    
    setLocalPreferences(newPreferences);
  };

  const getPreferenceValue = (blockType: string, startTime: string, dayOfWeek: string): boolean => {
    const key = `${blockType}:${startTime}:${dayOfWeek}`;
    return localPreferences.get(key) ?? isAvailable(blockType, startTime, dayOfWeek);
  };

  // Save preferences
  const handleSave = () => {
    if (!selectedDriverId) return;

    const preferencesToSave = [];
    
    // Only save valid block type + start time combinations
    for (const blockType of blockTypes) {
      const startTimesForType = blockTypeStartTimes.get(blockType) || [];
      for (const startTime of startTimesForType) {
        for (const dayOfWeek of daysOfWeek) {
          const key = `${blockType}:${startTime}:${dayOfWeek}`;
          const value = localPreferences.get(key) ?? isAvailable(blockType, startTime, dayOfWeek);
          preferencesToSave.push({
            blockType,
            startTime,
            dayOfWeek,
            isAvailable: value,
          });
        }
      }
    }

    updatePreferencesMutation.mutate({
      driverId: selectedDriverId,
      preferences: preferencesToSave,
    });
  };

  // Clear all preferences
  const handleClear = () => {
    if (!selectedDriverId) return;
    clearPreferencesMutation.mutate(selectedDriverId);
    setLocalPreferences(new Map());
  };

  // Reset to server state
  const handleReset = () => {
    setLocalPreferences(new Map());
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = localPreferences.size > 0;

  // Set all blocks to available
  const handleSetAllAvailable = () => {
    const newPreferences = new Map<string, boolean>();
    for (const blockType of blockTypes) {
      const startTimesForType = blockTypeStartTimes.get(blockType) || [];
      for (const startTime of startTimesForType) {
        for (const dayOfWeek of daysOfWeek) {
          const key = `${blockType}:${startTime}:${dayOfWeek}`;
          const serverValue = isAvailable(blockType, startTime, dayOfWeek);
          // Only track if different from server state
          if (!serverValue) {
            newPreferences.set(key, true);
          }
        }
      }
    }
    setLocalPreferences(newPreferences);
  };

  // Set all blocks to unavailable
  const handleSetAllUnavailable = () => {
    const newPreferences = new Map<string, boolean>();
    for (const blockType of blockTypes) {
      const startTimesForType = blockTypeStartTimes.get(blockType) || [];
      for (const startTime of startTimesForType) {
        for (const dayOfWeek of daysOfWeek) {
          const key = `${blockType}:${startTime}:${dayOfWeek}`;
          const serverValue = isAvailable(blockType, startTime, dayOfWeek);
          // Only track if different from server state
          if (serverValue) {
            newPreferences.set(key, false);
          }
        }
      }
    }
    setLocalPreferences(newPreferences);
  };

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
      <div className="flex-1 overflow-auto">
        {!selectedDriverId ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground" data-testid="text-no-selection">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">Select a driver</p>
              <p className="text-sm">Choose a driver from the list to manage their availability preferences</p>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-1" data-testid="text-selected-driver">
                {selectedDriver && `${selectedDriver.firstName} ${selectedDriver.lastName}`}
              </h2>
              <p className="text-sm text-muted-foreground" data-testid="text-instructions">
                Check the blocks this driver is available to work. Unchecked blocks will be excluded from auto-build suggestions.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
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
              <Separator orientation="vertical" className="h-8" />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSetAllAvailable}
                data-testid="button-all-available"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                All Available
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSetAllUnavailable}
                data-testid="button-all-unavailable"
              >
                <XCircle className="w-4 h-4 mr-2" />
                All Unavailable
              </Button>
              <Separator orientation="vertical" className="h-8" />
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClear}
                disabled={clearPreferencesMutation.isPending}
                data-testid="button-clear"
              >
                Clear All Preferences
              </Button>
            </div>

            {preferencesLoading || contractsLoading ? (
              <div className="text-center text-muted-foreground py-12" data-testid="text-loading-preferences">
                Loading preferences...
              </div>
            ) : !hasStartTimes ? (
              <div className="text-center text-muted-foreground py-12" data-testid="text-no-start-times">
                <p className="text-lg font-medium">No start times configured</p>
                <p className="text-sm">Please add contracts with start times to manage driver availability.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Availability Grid - Organized by Day */}
                {daysOfWeek.map((day) => (
                  <Card key={day}>
                    <CardHeader>
                      <CardTitle className="text-lg capitalize" data-testid={`text-day-${day}`}>
                        {day}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4">
                        {blockTypes.map((blockType) => {
                          const startTimesForType = blockTypeStartTimes.get(blockType) || [];
                          
                          // Only show block type if it has start times
                          if (startTimesForType.length === 0) {
                            return (
                              <div key={blockType} className="space-y-2">
                                <div className="flex items-center gap-2 mb-3">
                                  <Badge variant="secondary" className="uppercase text-xs">
                                    {blockType}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  No contracts configured
                                </div>
                              </div>
                            );
                          }
                          
                          return (
                            <div key={blockType} className="space-y-2">
                              <div className="flex items-center gap-2 mb-3">
                                <Badge variant="secondary" className="uppercase text-xs">
                                  {blockType}
                                </Badge>
                              </div>
                              <div className="space-y-2">
                                {startTimesForType.map((startTime) => {
                                  const available = getPreferenceValue(blockType, startTime, day);
                                  return (
                                    <div
                                      key={startTime}
                                      className="flex items-center space-x-2"
                                    >
                                      <Checkbox
                                        id={`${blockType}-${startTime}-${day}`}
                                        checked={available}
                                        onCheckedChange={() => togglePreference(blockType, startTime, day)}
                                        data-testid={`checkbox-${blockType}-${startTime}-${day}`}
                                      />
                                      <Label
                                        htmlFor={`${blockType}-${startTime}-${day}`}
                                        className="text-sm font-normal cursor-pointer"
                                      >
                                        {startTime}
                                      </Label>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Save Reminder */}
            {hasUnsavedChanges && (
              <div className="mt-6 p-4 bg-primary/10 border border-primary/20 rounded-md">
                <p className="text-sm font-medium text-primary" data-testid="text-unsaved-changes">
                  You have unsaved changes. Click "Save Changes" to apply your modifications.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
