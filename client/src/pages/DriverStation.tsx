/**
 * Driver Station Page
 *
 * Full-screen kiosk page for driver iPads/phones.
 * Features:
 * - Auto-connects to WebSocket for presence
 * - Auto-joins Jitsi when dispatch drops in
 * - Designed for Guided Access mode on iOS
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wifi, WifiOff, Mic, PhoneOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WSMessage {
  type: string;
  payload?: any;
}

type ConnectionState = "connecting" | "connected" | "disconnected" | "in_call";

declare global {
  interface Window {
    JitsiMeetExternalAPI: any;
  }
}

export default function DriverStation() {
  const { driverId } = useParams<{ driverId: string }>();
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [driverName, setDriverName] = useState("Driver");
  const [dispatcherName, setDispatcherName] = useState("");
  const [roomName, setRoomName] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const wsRef = useRef<WebSocket | null>(null);
  const jitsiRef = useRef<any>(null);
  const jitsiContainerRef = useRef<HTMLDivElement>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch driver info
  const { data: driverData } = useQuery<{
    id: string;
    firstName: string;
    lastName: string;
    domicile?: string;
    phoneNumber?: string;
  }>({
    queryKey: [`/api/drivers/${driverId}`],
    enabled: !!driverId && driverId !== "test",
  });

  // Update driver name when data loads
  useEffect(() => {
    if (driverData?.firstName && driverData?.lastName) {
      setDriverName(`${driverData.firstName} ${driverData.lastName}`);
    } else if (driverId === "test") {
      setDriverName("Test Driver");
    }
  }, [driverData, driverId]);

  // Update current time
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  // WebSocket connection with auto-reconnect
  const connectWebSocket = useCallback(() => {
    if (!driverId) return;

    // Use a default tenant ID for testing, or get from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const tenantId = urlParams.get("tenantId") || "test-tenant";

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/fleet-comm?type=driver&id=${driverId}&tenantId=${tenantId}&name=${encodeURIComponent(driverName)}`;

    console.log("[DriverStation] Connecting to WebSocket...");
    setConnectionState("connecting");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[DriverStation] WebSocket connected");
      setConnectionState("connected");
      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        handleWSMessage(message);
      } catch (err) {
        console.error("[DriverStation] Error parsing message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[DriverStation] WebSocket disconnected");
      if (connectionState !== "in_call") {
        setConnectionState("disconnected");
      }
      // Auto-reconnect after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 5000);
    };

    ws.onerror = (error) => {
      console.error("[DriverStation] WebSocket error:", error);
    };
  }, [driverId, driverName, connectionState]);

  // Initial WebSocket connection
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket]);

  // Handle WebSocket messages
  const handleWSMessage = useCallback((message: WSMessage) => {
    console.log("[DriverStation] Message received:", message.type);

    switch (message.type) {
      case "connected":
        console.log("[DriverStation] Connection confirmed");
        break;

      case "join_drop_in":
        // Dispatch is dropping in - auto-join Jitsi
        console.log("[DriverStation] Joining drop-in:", message.payload);
        setDispatcherName(message.payload.dispatcherName || "Dispatch");
        setRoomName(message.payload.roomName);
        setConnectionState("in_call");
        setCallDuration(0);

        // Start duration counter
        durationIntervalRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);

        // Initialize Jitsi after a short delay
        setTimeout(() => {
          initJitsi(message.payload.roomName);
        }, 500);
        break;

      case "leave_drop_in":
        // Dispatch ended the call
        console.log("[DriverStation] Leaving drop-in");
        cleanupCall();
        break;
    }
  }, []);

  // Initialize Jitsi (auto-join, no user interaction needed)
  const initJitsi = (room: string) => {
    if (!jitsiContainerRef.current) {
      console.error("[DriverStation] Jitsi container not ready");
      return;
    }

    // Wait for Jitsi API to load
    if (!window.JitsiMeetExternalAPI) {
      console.log("[DriverStation] Waiting for Jitsi API...");
      setTimeout(() => initJitsi(room), 500);
      return;
    }

    // Clean up existing instance
    if (jitsiRef.current) {
      jitsiRef.current.dispose();
    }

    const options = {
      roomName: room,
      parentNode: jitsiContainerRef.current,
      width: "100%",
      height: "100%",
      configOverwrite: {
        // Critical: Skip all pre-join screens
        prejoinPageEnabled: false,
        startWithAudioMuted: false, // Start with mic ON
        startWithVideoMuted: true, // Audio only
        disableDeepLinking: true, // Don't try to open native app
        enableWelcomePage: false,
        disableInviteFunctions: true,
        toolbarButtons: ["microphone", "hangup"],
        notifications: [],
        disableModeratorIndicator: true,
        disableSelfView: true,
        hideConferenceSubject: true,
        hideConferenceTimer: false,
        // Mobile-friendly
        disablePolls: true,
        disableReactions: true,
        disableChat: true,
      },
      interfaceConfigOverwrite: {
        MOBILE_APP_PROMO: false,
        TOOLBAR_BUTTONS: ["microphone", "hangup"],
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
        SHOW_CHROME_EXTENSION_BANNER: false,
        HIDE_INVITE_MORE_HEADER: true,
        DISABLE_FOCUS_INDICATOR: true,
        DEFAULT_BACKGROUND: "#1a1a2e",
        TOOLBAR_ALWAYS_VISIBLE: true,
        FILM_STRIP_MAX_HEIGHT: 0,
      },
      userInfo: {
        displayName: driverName,
      },
    };

    try {
      console.log("[DriverStation] Initializing Jitsi with room:", room);
      jitsiRef.current = new window.JitsiMeetExternalAPI("meet.jit.si", options);

      jitsiRef.current.on("videoConferenceJoined", () => {
        console.log("[DriverStation] Joined Jitsi room");
        // Notify dispatch that we joined
        wsRef.current?.send(JSON.stringify({
          type: "drop_in_joined",
          payload: { roomName: room },
        }));
      });

      jitsiRef.current.on("videoConferenceLeft", () => {
        console.log("[DriverStation] Left Jitsi room");
        // Notify dispatch
        wsRef.current?.send(JSON.stringify({
          type: "drop_in_left",
          payload: { roomName: room },
        }));
        cleanupCall();
      });

      jitsiRef.current.on("readyToClose", () => {
        console.log("[DriverStation] Jitsi ready to close");
        cleanupCall();
      });
    } catch (error) {
      console.error("[DriverStation] Error initializing Jitsi:", error);
      cleanupCall();
    }
  };

  // End call (driver-initiated)
  const endCall = () => {
    if (jitsiRef.current) {
      jitsiRef.current.executeCommand("hangup");
    }
    wsRef.current?.send(JSON.stringify({
      type: "drop_in_left",
      payload: { roomName },
    }));
    cleanupCall();
  };

  // Cleanup call state
  const cleanupCall = () => {
    if (jitsiRef.current) {
      jitsiRef.current.dispose();
      jitsiRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    setConnectionState("connected");
    setRoomName(null);
    setCallDuration(0);
    setDispatcherName("");
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Format time
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
      {/* Header */}
      <div className="p-4 text-center">
        <h1 className="text-2xl font-bold text-white tracking-wider">FREEDOM</h1>
        <p className="text-slate-400 text-sm">TRANSPORTATION</p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        {connectionState === "in_call" ? (
          // In Call View
          <div className="w-full max-w-lg space-y-6">
            {/* Live indicator */}
            <div className="flex items-center justify-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-lg font-semibold">
                LIVE WITH {dispatcherName.toUpperCase()}
              </span>
            </div>

            {/* Jitsi Container */}
            <div
              ref={jitsiContainerRef}
              className="rounded-xl overflow-hidden bg-black aspect-video"
              style={{ minHeight: 200 }}
            />

            {/* Call Info */}
            <div className="flex items-center justify-center gap-4 text-white">
              <Volume2 className="h-5 w-5 text-green-500 animate-pulse" />
              <span className="text-2xl font-mono">{formatDuration(callDuration)}</span>
            </div>

            {/* End Call Button */}
            <Button
              size="lg"
              variant="destructive"
              className="w-full h-16 text-lg"
              onClick={endCall}
            >
              <PhoneOff className="h-6 w-6 mr-2" />
              End Call
            </Button>
          </div>
        ) : (
          // Waiting View
          <div className="text-center space-y-8">
            {/* Status Indicator */}
            <div
              className={cn(
                "mx-auto w-32 h-32 rounded-full flex items-center justify-center",
                "transition-all duration-500",
                connectionState === "connected"
                  ? "bg-green-500/20 ring-4 ring-green-500/50"
                  : connectionState === "connecting"
                  ? "bg-yellow-500/20 ring-4 ring-yellow-500/50"
                  : "bg-red-500/20 ring-4 ring-red-500/50"
              )}
            >
              {connectionState === "connecting" ? (
                <Loader2 className="h-12 w-12 text-yellow-500 animate-spin" />
              ) : connectionState === "connected" ? (
                <Wifi className="h-12 w-12 text-green-500" />
              ) : (
                <WifiOff className="h-12 w-12 text-red-500" />
              )}
            </div>

            {/* Status Text */}
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-white">
                {connectionState === "connected"
                  ? "CONNECTED"
                  : connectionState === "connecting"
                  ? "CONNECTING..."
                  : "DISCONNECTED"}
              </h2>
              <p className="text-slate-400 text-lg">
                {connectionState === "connected"
                  ? "Waiting for dispatch..."
                  : connectionState === "connecting"
                  ? "Establishing connection..."
                  : "Reconnecting..."}
              </p>
            </div>

            {/* Driver Info */}
            <div className="pt-8 space-y-1">
              <p className="text-xl text-white font-semibold">{driverName}</p>
              {driverData?.domicile && (
                <p className="text-slate-400">{driverData.domicile}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 flex items-center justify-between text-slate-500 text-sm">
        <span>{formatTime(currentTime)}</span>
        <span>
          {connectionState === "connected" ? (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-gray-500" />
              {connectionState === "connecting" ? "Connecting" : "Offline"}
            </span>
          )}
        </span>
      </div>

      {/* Hidden Jitsi container for waiting state (pre-load) */}
      {connectionState !== "in_call" && (
        <div ref={jitsiContainerRef} className="hidden" />
      )}
    </div>
  );
}
