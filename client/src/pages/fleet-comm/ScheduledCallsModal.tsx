/**
 * Scheduled Calls Modal - List and manage scheduled calls
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CalendarClock,
  Clock,
  Phone,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import type { ScheduledCall } from "./types";

interface ScheduledCallsModalProps {
  open: boolean;
  scheduledCalls: ScheduledCall[];
  onClose: () => void;
  onRefresh: () => void;
}

export function ScheduledCallsModal({
  open,
  scheduledCalls,
  onClose,
  onRefresh,
}: ScheduledCallsModalProps) {
  const { toast } = useToast();

  // Edit state
  const [editingCall, setEditingCall] = useState<ScheduledCall | null>(null);
  const [editCallDate, setEditCallDate] = useState("");
  const [editCallTime, setEditCallTime] = useState("");

  // Mutation for updating scheduled call time
  const updateMutation = useMutation({
    mutationFn: async ({ callId, scheduledFor }: { callId: string; scheduledFor: string }) => {
      const response = await apiRequest("PATCH", `/api/fleet-comm/scheduled/${callId}`, {
        scheduledFor
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Call Updated",
          description: "Scheduled time has been updated",
        });
        setEditingCall(null);
        onRefresh();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Update Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation for calling now
  const callNowMutation = useMutation({
    mutationFn: async (callId: string) => {
      const response = await apiRequest("POST", `/api/fleet-comm/call-now/${callId}`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Calling Now",
          description: "Call is being placed...",
        });
        onRefresh();
      } else {
        toast({
          title: "Call Failed",
          description: data.message || "Could not place call",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Call Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation for cancelling scheduled call
  const cancelMutation = useMutation({
    mutationFn: async (callId: string) => {
      const response = await apiRequest("DELETE", `/api/fleet-comm/scheduled/${callId}`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Call Cancelled",
          description: "Scheduled call has been cancelled",
        });
        onRefresh();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Cancel Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const startEditing = (call: ScheduledCall) => {
    const scheduledDate = new Date(call.scheduledFor);
    setEditingCall(call);
    setEditCallDate(format(scheduledDate, "yyyy-MM-dd"));
    setEditCallTime(format(scheduledDate, "HH:mm"));
  };

  const saveEdit = () => {
    if (!editingCall || !editCallDate || !editCallTime) return;
    const scheduledFor = new Date(`${editCallDate}T${editCallTime}`).toISOString();
    updateMutation.mutate({ callId: editingCall.id, scheduledFor });
  };

  const pendingCalls = scheduledCalls.filter(c => c.status === "pending");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Scheduled Calls
          </DialogTitle>
          <DialogDescription>
            {pendingCalls.length} pending calls
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 py-4">
          {scheduledCalls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarClock className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No scheduled calls</p>
              <p className="text-sm">Click "Schedule" on a driver card to schedule a call</p>
            </div>
          ) : (
            scheduledCalls
              .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
              .map((call) => (
                <div
                  key={call.id}
                  className={`p-3 rounded-lg border ${
                    call.status === "pending"
                      ? "bg-blue-50/50 border-blue-200"
                      : call.status === "completed"
                      ? "bg-green-50/50 border-green-200"
                      : call.status === "failed"
                      ? "bg-red-50/50 border-red-200"
                      : "bg-gray-50/50 border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{call.driverName}</p>
                      <p className="text-sm text-muted-foreground font-mono">
                        {call.phoneNumber}
                      </p>

                      {/* Edit mode for time */}
                      {editingCall?.id === call.id ? (
                        <div className="flex items-center gap-2 mt-2">
                          <Input
                            type="date"
                            value={editCallDate}
                            onChange={(e) => setEditCallDate(e.target.value)}
                            className="h-8 text-sm w-32"
                            min={format(new Date(), "yyyy-MM-dd")}
                          />
                          <Input
                            type="time"
                            value={editCallTime}
                            onChange={(e) => setEditCallTime(e.target.value)}
                            className="h-8 text-sm w-24"
                          />
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={saveEdit}
                            disabled={updateMutation.isPending}
                          >
                            {updateMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => setEditingCall(null)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm mt-1">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {format(new Date(call.scheduledFor), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      )}

                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {call.message}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge
                        variant={
                          call.status === "pending"
                            ? "default"
                            : call.status === "completed"
                            ? "secondary"
                            : call.status === "failed"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {call.status}
                      </Badge>
                      {call.status === "pending" && (
                        <div className="flex items-center gap-1">
                          {/* Call Now button */}
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs bg-green-600 hover:bg-green-700"
                            onClick={() => callNowMutation.mutate(call.id)}
                            disabled={callNowMutation.isPending}
                          >
                            {callNowMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <Phone className="h-3 w-3 mr-1" />
                            )}
                            Call Now
                          </Button>
                          {/* Edit button */}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => startEditing(call)}
                            disabled={editingCall !== null}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {/* Delete button */}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => cancelMutation.mutate(call.id)}
                            disabled={cancelMutation.isPending}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
