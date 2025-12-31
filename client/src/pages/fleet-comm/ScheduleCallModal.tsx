/**
 * Schedule Call Modal - Schedule a call for a specific driver
 * Now with Gemini Vision image parsing support
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
import { Label } from "@/components/ui/label";
import { CalendarClock, Sparkles, Loader2, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import type { DriverWithStatus } from "./types";
import { ImageUpload, type ParsedImageData } from "./ImageUpload";

interface ScheduleCallModalProps {
  open: boolean;
  driver: DriverWithStatus | null;
  onClose: () => void;
  onScheduled: () => void;
}

export function ScheduleCallModal({
  open,
  driver,
  onClose,
  onScheduled,
}: ScheduleCallModalProps) {
  const { toast } = useToast();

  // Form state
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return format(tomorrow, "yyyy-MM-dd");
  });
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleMessage, setScheduleMessage] = useState(
    "Hello, this is dispatch from Freedom Transportation calling to check in with you."
  );
  const [scheduleAIPrompt, setScheduleAIPrompt] = useState("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showImageUpload, setShowImageUpload] = useState(false);

  const resetForm = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduleDate(format(tomorrow, "yyyy-MM-dd"));
    setScheduleTime("09:00");
    setScheduleMessage(
      "Hello, this is dispatch from Freedom Transportation calling to check in with you."
    );
    setScheduleAIPrompt("");
    setShowImageUpload(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const generateScript = async () => {
    if (!driver || !scheduleAIPrompt.trim()) return;

    setIsGeneratingScript(true);
    try {
      const response = await apiRequest("POST", "/api/fleet-comm/generate-scripts", {
        driverIds: [driver.id],
        prompt: scheduleAIPrompt,
      });

      const result = await response.json();
      if (result.success && result.scripts.length > 0) {
        setScheduleMessage(result.scripts[0].script);
        toast({
          title: "Script Generated",
          description: "AI script has been added to the message field",
        });
      } else {
        toast({
          title: "Generation Failed",
          description: result.message || "Could not generate script",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Script generation error:", error);
      toast({
        title: "Error",
        description: "Failed to generate script",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleImageParsed = (data: ParsedImageData) => {
    // Find this driver in the parsed data
    const driverData = data.drivers?.find(d =>
      d.driverId === driver?.id ||
      d.fullName?.toLowerCase().includes(driver?.firstName.toLowerCase() || "") ||
      d.name?.toLowerCase().includes(driver?.firstName.toLowerCase() || "")
    );

    if (driverData) {
      // Build a prompt from the extracted data
      let promptParts: string[] = [];

      if (driverData.origin && driverData.destination) {
        promptParts.push(`Route: ${driverData.origin} to ${driverData.destination}`);
      }
      if (driverData.startTime) {
        promptParts.push(`Start time: ${driverData.startTime}`);
      }
      if (driverData.notes) {
        promptParts.push(driverData.notes);
      }

      if (promptParts.length > 0) {
        const prompt = `Remind ${driver?.firstName} about their schedule: ${promptParts.join(", ")}. Keep it friendly and wish them a safe trip.`;
        setScheduleAIPrompt(prompt);
        toast({
          title: "Schedule Extracted",
          description: `Found schedule info for ${driver?.firstName}`,
        });
      }
    } else if (data.rawText) {
      // Use raw text as prompt
      setScheduleAIPrompt(`Based on this schedule info: ${data.rawText}. Create a brief reminder call.`);
    }

    setShowImageUpload(false);
  };

  const submitScheduledCall = async () => {
    if (!driver || !scheduleDate || !scheduleTime) return;

    setIsScheduling(true);
    try {
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();

      const response = await apiRequest("POST", "/api/fleet-comm/schedule", {
        driverId: driver.id,
        phoneNumber: driver.phoneNumber!,
        scheduledFor,
        message: scheduleMessage,
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Call Scheduled",
          description: `Call scheduled for ${format(new Date(data.scheduledCall.scheduledFor), "MMM d, h:mm a")}`,
        });
        handleClose();
        onScheduled();
      } else {
        toast({
          title: "Schedule Failed",
          description: data.message || "Could not schedule call",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Schedule Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-500" />
            Schedule Call
          </DialogTitle>
          <DialogDescription>
            {driver && `${driver.firstName} ${driver.lastName}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Phone number display */}
          <div className="text-sm text-muted-foreground font-mono">
            {driver?.phoneNumber}
          </div>

          {/* Date picker */}
          <div className="space-y-2">
            <Label htmlFor="schedule-date">Date</Label>
            <Input
              id="schedule-date"
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={format(new Date(), "yyyy-MM-dd")}
            />
          </div>

          {/* Time picker */}
          <div className="space-y-2">
            <Label htmlFor="schedule-time">Time</Label>
            <Input
              id="schedule-time"
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
            />
          </div>

          {/* AI Script Generator */}
          <div className="space-y-3 p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-purple-700">
                <Sparkles className="h-4 w-4" />
                AI Script Generator
              </Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                onClick={() => setShowImageUpload(!showImageUpload)}
              >
                <Camera className="h-3 w-3 mr-1" />
                {showImageUpload ? "Hide" : "Upload Image"}
              </Button>
            </div>

            {/* Image Upload Section */}
            {showImageUpload && (
              <ImageUpload
                onParsed={handleImageParsed}
                onTextExtracted={(text) => setScheduleAIPrompt(text)}
              />
            )}

            <div className="flex gap-2">
              <Input
                placeholder="e.g., Safety reminder about cold weather..."
                value={scheduleAIPrompt}
                onChange={(e) => setScheduleAIPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isGeneratingScript) {
                    generateScript();
                  }
                }}
                disabled={isGeneratingScript}
              />
              <Button
                size="sm"
                onClick={generateScript}
                disabled={!scheduleAIPrompt.trim() || isGeneratingScript}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isGeneratingScript ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Describe what you want Milo to say, or upload a schedule image
            </p>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="schedule-message">Message (TTS)</Label>
            <textarea
              id="schedule-message"
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={scheduleMessage}
              onChange={(e) => setScheduleMessage(e.target.value)}
              placeholder="Message that will be read to the driver..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={submitScheduledCall}
            disabled={!scheduleDate || !scheduleTime || isScheduling}
          >
            {isScheduling ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CalendarClock className="h-4 w-4 mr-2" />
            )}
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
