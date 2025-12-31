/**
 * Phone Call Hook
 * Manages phone call state and Twilio integration
 */

import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DriverWithStatus, ActiveCall } from "./types";

interface UsePhoneCallReturn {
  activeCall: ActiveCall | null;
  showCallModal: boolean;
  callDuration: number;
  isHangingUp: boolean;
  callDriver: (driver: DriverWithStatus) => void;
  hangupCall: () => void;
}

export function usePhoneCall(): UsePhoneCallReturn {
  const { toast } = useToast();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Mutation for making phone calls via Twilio
  const phoneCallMutation = useMutation({
    mutationFn: async (data: { driverId: string; phoneNumber: string; driverName: string }) => {
      const response = await apiRequest("POST", "/api/fleet-comm/call", {
        driverId: data.driverId,
        phoneNumber: data.phoneNumber,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setActiveCall((prev) =>
          prev ? { ...prev, callSid: data.callSid, status: "ringing" } : null
        );
      } else {
        setActiveCall((prev) =>
          prev ? { ...prev, status: "failed" } : null
        );
        toast({
          title: "Call Failed",
          description: data.message || "Could not initiate call",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      setActiveCall((prev) =>
        prev ? { ...prev, status: "failed" } : null
      );
      toast({
        title: "Call Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to hang up a call
  const hangupMutation = useMutation({
    mutationFn: async (callSid: string) => {
      const response = await apiRequest("POST", "/api/fleet-comm/hangup", {
        callSid,
      });
      return response.json();
    },
    onSuccess: () => {
      endPhoneCall();
    },
    onError: () => {
      // Even if hangup fails on server, clean up locally
      endPhoneCall();
    },
  });

  const endPhoneCall = useCallback(() => {
    if (callDurationIntervalRef.current) {
      clearInterval(callDurationIntervalRef.current);
      callDurationIntervalRef.current = null;
    }
    setActiveCall(null);
    setShowCallModal(false);
    setCallDuration(0);
  }, []);

  const callDriver = useCallback((driver: DriverWithStatus) => {
    if (!driver.phoneNumber) {
      toast({
        title: "No Phone Number",
        description: `${driver.firstName} has no phone number on file`,
        variant: "destructive",
      });
      return;
    }

    const newCall: ActiveCall = {
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      phoneNumber: driver.phoneNumber,
      callSid: null,
      status: "dialing",
      startedAt: new Date(),
    };
    setActiveCall(newCall);
    setShowCallModal(true);
    setCallDuration(0);

    // Start call duration timer
    callDurationIntervalRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    // Make the call
    phoneCallMutation.mutate({
      driverId: driver.id,
      phoneNumber: driver.phoneNumber,
      driverName: `${driver.firstName} ${driver.lastName}`,
    });
  }, [phoneCallMutation, toast]);

  const hangupCall = useCallback(() => {
    if (activeCall?.callSid) {
      hangupMutation.mutate(activeCall.callSid);
    } else {
      // No call SID yet, just end locally
      endPhoneCall();
    }
  }, [activeCall, hangupMutation, endPhoneCall]);

  return {
    activeCall,
    showCallModal,
    callDuration,
    isHangingUp: hangupMutation.isPending,
    callDriver,
    hangupCall,
  };
}
