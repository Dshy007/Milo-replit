/**
 * Drop-In Modal - Jitsi-based live audio connection with drivers
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PhoneCall, PhoneOff, Clock, Mic, MicOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ActiveDropIn } from "./types";

declare global {
  interface Window {
    JitsiMeetExternalAPI: any;
  }
}

interface DropInModalProps {
  open: boolean;
  activeDropIn: ActiveDropIn | null;
  onEnd: () => void;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function DropInModal({ open, activeDropIn, onEnd }: DropInModalProps) {
  const { toast } = useToast();
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const jitsiRef = useRef<any>(null);
  const jitsiContainerRef = useRef<HTMLDivElement>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Jitsi when modal opens with active drop-in
  useEffect(() => {
    if (open && activeDropIn && jitsiContainerRef.current) {
      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);

      // Initialize Jitsi after a short delay
      const initTimeout = setTimeout(() => {
        initJitsi(activeDropIn.roomName);
      }, 500);

      return () => {
        clearTimeout(initTimeout);
      };
    }
  }, [open, activeDropIn]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      cleanup();
    }
  }, [open]);

  const initJitsi = (roomName: string) => {
    if (!jitsiContainerRef.current || !window.JitsiMeetExternalAPI) {
      toast({
        title: "Error",
        description: "Jitsi not loaded. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    if (jitsiRef.current) {
      jitsiRef.current.dispose();
    }

    const options = {
      roomName,
      parentNode: jitsiContainerRef.current,
      width: "100%",
      height: 300,
      configOverwrite: {
        prejoinPageEnabled: false,
        startWithAudioMuted: false,
        startWithVideoMuted: true,
        disableDeepLinking: true,
        enableWelcomePage: false,
        disableInviteFunctions: true,
        toolbarButtons: ["microphone", "hangup"],
        notifications: [],
        disableModeratorIndicator: true,
        disableSelfView: true,
        hideConferenceSubject: true,
      },
      interfaceConfigOverwrite: {
        MOBILE_APP_PROMO: false,
        TOOLBAR_BUTTONS: ["microphone", "hangup"],
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
        SHOW_CHROME_EXTENSION_BANNER: false,
        HIDE_INVITE_MORE_HEADER: true,
      },
      userInfo: {
        displayName: "Dispatch",
      },
    };

    try {
      jitsiRef.current = new window.JitsiMeetExternalAPI("meet.jit.si", options);
      jitsiRef.current.on("videoConferenceLeft", () => {
        handleEnd();
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start call",
        variant: "destructive",
      });
      handleEnd();
    }
  };

  const cleanup = () => {
    if (jitsiRef.current) {
      jitsiRef.current.dispose();
      jitsiRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    setCallDuration(0);
    setIsMuted(false);
  };

  const handleEnd = () => {
    cleanup();
    onEnd();
  };

  const toggleMute = () => {
    if (jitsiRef.current) {
      jitsiRef.current.executeCommand("toggleAudio");
      setIsMuted(!isMuted);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleEnd()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-green-500 animate-pulse" />
            Live Drop-In
          </DialogTitle>
          <DialogDescription>
            {activeDropIn?.driverName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            ref={jitsiContainerRef}
            className="rounded-lg overflow-hidden bg-gray-900"
            style={{ minHeight: 300 }}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {formatDuration(callDuration)}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={isMuted ? "destructive" : "outline"}
                onClick={toggleMute}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleEnd}
              >
                <PhoneOff className="h-4 w-4 mr-1" />
                End
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
