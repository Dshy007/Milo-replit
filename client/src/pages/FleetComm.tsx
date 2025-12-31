/**
 * Fleet Communication Dashboard
 *
 * Simple card-based layout for calling drivers.
 * "Grandma mode" - big buttons, easy to use.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Wifi,
  WifiOff,
  Loader2,
  CalendarClock,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Import modular components
import {
  DriverWithStatus,
  DriversResponse,
  ScheduledCallsResponse,
  ActiveDropIn,
  QuickCallBar,
  DriverCard,
  PhoneCallModal,
  ScheduleCallModal,
  ScheduledCallsModal,
  AICallPlannerModal,
  DropInModal,
  useFleetCommWebSocket,
  usePhoneCall,
} from "./fleet-comm";

export default function FleetComm() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDriver, setScheduleDriver] = useState<DriverWithStatus | null>(null);
  const [showScheduledList, setShowScheduledList] = useState(false);
  const [showAIPlanner, setShowAIPlanner] = useState(false);

  // Drop-in state
  const [activeDropIn, setActiveDropIn] = useState<ActiveDropIn | null>(null);
  const [showDropInModal, setShowDropInModal] = useState(false);

  // Custom hooks
  const { wsConnected, sendMessage } = useFleetCommWebSocket();
  const {
    activeCall,
    showCallModal,
    callDuration,
    isHangingUp,
    callDriver,
    hangupCall,
  } = usePhoneCall();

  // Fetch drivers with status
  const { data: driversData, isLoading: driversLoading } = useQuery<DriversResponse>({
    queryKey: ["/api/fleet-comm/drivers"],
    refetchInterval: 30000,
  });

  const drivers: DriverWithStatus[] = driversData?.drivers || [];

  // Fetch scheduled calls
  const { data: scheduledCallsData, refetch: refetchScheduledCalls } = useQuery<ScheduledCallsResponse>({
    queryKey: ["/api/fleet-comm/scheduled"],
    refetchInterval: 60000,
  });

  const scheduledCalls = scheduledCallsData?.scheduledCalls || [];

  // Load Jitsi script
  useEffect(() => {
    if (!document.getElementById("jitsi-script")) {
      const script = document.createElement("script");
      script.id = "jitsi-script";
      script.src = "https://meet.jit.si/external_api.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // Filter and sort drivers
  const filteredDrivers = drivers.filter((driver) => {
    const fullName = `${driver.firstName} ${driver.lastName}`.toLowerCase();
    return fullName.includes(searchQuery.toLowerCase());
  });

  const sortedDrivers = [...filteredDrivers].sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
  });

  // Handler functions
  const openScheduleModal = (driver: DriverWithStatus) => {
    if (!driver.phoneNumber) {
      toast({
        title: "No Phone Number",
        description: `${driver.firstName} has no phone number on file`,
        variant: "destructive",
      });
      return;
    }
    setScheduleDriver(driver);
    setShowScheduleModal(true);
  };

  const startDropIn = (driver: DriverWithStatus) => {
    const roomName = `freedom-${driver.id}-${Date.now()}`;

    setActiveDropIn({
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      roomName,
      startedAt: new Date(),
    });
    setShowDropInModal(true);

    sendMessage({
      type: "start_drop_in",
      payload: {
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
      },
    });
  };

  const endDropIn = () => {
    if (activeDropIn) {
      sendMessage({
        type: "end_drop_in",
        payload: { driverId: activeDropIn.driverId },
      });
    }
    setActiveDropIn(null);
    setShowDropInModal(false);
  };

  const pendingCallsCount = scheduledCalls.filter(c => c.status === "pending").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fleet Communication</h1>
          <p className="text-muted-foreground">
            {filteredDrivers.length} driver{filteredDrivers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* AI Call Planner Button */}
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowAIPlanner(true)}
            className="gap-2 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
          >
            <Sparkles className="h-4 w-4" />
            AI Call Planner
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowScheduledList(true)}
            className="gap-2"
          >
            <CalendarClock className="h-4 w-4" />
            Scheduled
            {pendingCallsCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {pendingCallsCount}
              </Badge>
            )}
          </Button>
          {wsConnected ? (
            <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
              <Wifi className="h-3 w-3" />
              Live
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-red-600 border-red-600">
              <WifiOff className="h-3 w-3" />
              Offline
            </Badge>
          )}
        </div>
      </div>

      {/* Quick Call - Natural Language Input */}
      <QuickCallBar onCallScheduled={refetchScheduledCalls} />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search drivers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Driver Cards Grid */}
      {driversLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : sortedDrivers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No drivers found</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {sortedDrivers.map((driver) => (
            <DriverCard
              key={driver.id}
              driver={driver}
              isOnCall={activeCall?.driverId === driver.id}
              onCall={callDriver}
              onSchedule={openScheduleModal}
              onDropIn={startDropIn}
            />
          ))}
        </div>
      )}

      {/* Phone Call Modal */}
      <PhoneCallModal
        open={showCallModal}
        activeCall={activeCall}
        callDuration={callDuration}
        isHangingUp={isHangingUp}
        onHangup={hangupCall}
      />

      {/* Drop-In Modal */}
      <DropInModal
        open={showDropInModal}
        activeDropIn={activeDropIn}
        onEnd={endDropIn}
      />

      {/* Schedule Call Modal */}
      <ScheduleCallModal
        open={showScheduleModal}
        driver={scheduleDriver}
        onClose={() => {
          setShowScheduleModal(false);
          setScheduleDriver(null);
        }}
        onScheduled={refetchScheduledCalls}
      />

      {/* Scheduled Calls List Modal */}
      <ScheduledCallsModal
        open={showScheduledList}
        scheduledCalls={scheduledCalls}
        onClose={() => setShowScheduledList(false)}
        onRefresh={refetchScheduledCalls}
      />

      {/* AI Call Planner Modal */}
      <AICallPlannerModal
        open={showAIPlanner}
        drivers={drivers}
        onClose={() => setShowAIPlanner(false)}
        onScheduled={refetchScheduledCalls}
      />
    </div>
  );
}
