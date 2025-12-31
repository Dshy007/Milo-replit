/**
 * Phone Call Modal - Active call display with hangup functionality
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, PhoneCall, PhoneOff, Clock, Loader2 } from "lucide-react";
import type { ActiveCall } from "./types";

interface PhoneCallModalProps {
  open: boolean;
  activeCall: ActiveCall | null;
  callDuration: number;
  isHangingUp: boolean;
  onHangup: () => void;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function PhoneCallModal({
  open,
  activeCall,
  callDuration,
  isHangingUp,
  onHangup,
}: PhoneCallModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onHangup()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {activeCall?.status === "dialing" && (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                Dialing...
              </>
            )}
            {activeCall?.status === "ringing" && (
              <>
                <Phone className="h-6 w-6 text-green-500 animate-bounce" />
                Ringing...
              </>
            )}
            {activeCall?.status === "in-progress" && (
              <>
                <PhoneCall className="h-6 w-6 text-green-500" />
                Connected
              </>
            )}
            {activeCall?.status === "failed" && (
              <>
                <PhoneOff className="h-6 w-6 text-red-500" />
                Call Failed
              </>
            )}
            {activeCall?.status === "completed" && (
              <>
                <PhoneOff className="h-6 w-6 text-gray-500" />
                Call Ended
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-lg">
            {activeCall?.driverName}
          </DialogDescription>
        </DialogHeader>

        <div className="py-8 text-center space-y-6">
          {/* Phone number */}
          <p className="text-2xl font-mono tracking-wider text-muted-foreground">
            {activeCall?.phoneNumber}
          </p>

          {/* Call duration */}
          <div className="flex items-center justify-center gap-2 text-3xl font-mono">
            <Clock className="h-6 w-6 text-muted-foreground" />
            {formatDuration(callDuration)}
          </div>

          {/* Status message */}
          <p className="text-sm text-muted-foreground">
            {activeCall?.status === "dialing" && "Connecting to phone network..."}
            {activeCall?.status === "ringing" && "Waiting for driver to answer..."}
            {activeCall?.status === "in-progress" && "Call is in progress"}
            {activeCall?.status === "failed" && "Unable to connect the call"}
            {activeCall?.status === "completed" && "The call has ended"}
          </p>
        </div>

        <DialogFooter className="sm:justify-center">
          <Button
            size="lg"
            variant="destructive"
            className="w-full h-14 text-lg gap-2"
            onClick={onHangup}
            disabled={isHangingUp}
          >
            {isHangingUp ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <PhoneOff className="h-5 w-5" />
            )}
            Hang Up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
