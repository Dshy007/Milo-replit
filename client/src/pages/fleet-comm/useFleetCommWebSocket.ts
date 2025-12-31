/**
 * Fleet Comm WebSocket Hook
 * Manages WebSocket connection for real-time dispatch communication
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WSMessage } from "./types";

interface UseFleetCommWebSocketReturn {
  wsConnected: boolean;
  wsRef: React.MutableRefObject<WebSocket | null>;
  sendMessage: (message: WSMessage) => void;
}

export function useFleetCommWebSocket(): UseFleetCommWebSocketReturn {
  const { user } = useAuth();
  const { toast } = useToast();
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const handleWSMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case "connected":
        queryClient.invalidateQueries({ queryKey: ["/api/fleet-comm/drivers"] });
        break;
      case "driver_online":
      case "driver_offline":
        queryClient.invalidateQueries({ queryKey: ["/api/fleet-comm/drivers"] });
        break;
      case "drop_in_joined":
        toast({
          title: "Connected",
          description: "Driver joined the call",
        });
        break;
      case "drop_in_ended":
        // This will be handled by the parent component
        break;
    }
  }, [toast]);

  useEffect(() => {
    if (!user) return;

    const tenantId = (user as any).tenantId;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/fleet-comm?type=dispatch&id=${user.id}&tenantId=${tenantId}&name=${encodeURIComponent(user.username)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        handleWSMessage(message);
      } catch (err) {
        console.error("[FleetComm] Error parsing message:", err);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [user, handleWSMessage]);

  const sendMessage = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return {
    wsConnected,
    wsRef,
    sendMessage,
  };
}
