/**
 * AI Call Planner Modal - Multi-step wizard for bulk AI-generated calls
 *
 * Improved UX with:
 * - Clear driver selection with checkboxes
 * - Visible "Schedule for" datetime picker
 * - AI Script Generator on each card (like Schedule Call modal)
 * - Better visual hierarchy showing who calls are for
 */

import { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Loader2,
  ArrowLeft,
  Check,
  Pencil,
  Trash2,
  Clock,
  Phone,
  CheckCircle2,
  AlertCircle,
  Users,
  User,
  Calendar,
  Camera,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import type { DriverWithStatus, GeneratedScript } from "./types";
import { ImageUpload, type ParsedImageData } from "./ImageUpload";

type PlannerStep = "select" | "review" | "summary";

interface AICallPlannerModalProps {
  open: boolean;
  drivers: DriverWithStatus[];
  onClose: () => void;
  onScheduled: () => void;
}

function estimateDuration(script: string): string {
  const words = script.split(/\s+/).length;
  const seconds = Math.round((words / 150) * 60);
  return `~${seconds}s`;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function AICallPlannerModal({
  open,
  drivers,
  onClose,
  onScheduled,
}: AICallPlannerModalProps) {
  const { toast } = useToast();

  // Wizard state
  const [step, setStep] = useState<PlannerStep>("select");

  // Step 1: Selection state
  const [selectedDriverIds, setSelectedDriverIds] = useState<Set<string>>(new Set());
  const [aiPrompt, setAIPrompt] = useState("");
  const [callTime, setCallTime] = useState<"now" | "scheduled">("scheduled");
  const [scheduledDate, setScheduledDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [scheduledTimeValue, setScheduledTimeValue] = useState("09:00");

  // Step 2: Review state
  const [generatedScripts, setGeneratedScripts] = useState<GeneratedScript[]>([]);
  const [cardPrompts, setCardPrompts] = useState<Record<string, string>>({});
  const [regeneratingScript, setRegeneratingScript] = useState<string | null>(null);

  // Image upload states
  const [showMainImageUpload, setShowMainImageUpload] = useState(false);
  const [showCardImageUpload, setShowCardImageUpload] = useState<Record<string, boolean>>({});

  // Step 3: Summary state
  const [scheduledCallIds, setScheduledCallIds] = useState<string[]>([]);

  // Loading states
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedSchedule, setParsedSchedule] = useState<any>(null);

  // Filter drivers with phone numbers
  const driversWithPhones = drivers.filter(d => d.phoneNumber);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setStep("select");
      setSelectedDriverIds(new Set());
      setAIPrompt("");
      setCallTime("scheduled");
      setScheduledDate(format(new Date(), "yyyy-MM-dd"));
      setScheduledTimeValue("09:00");
      setGeneratedScripts([]);
      setCardPrompts({});
      setScheduledCallIds([]);
      setShowMainImageUpload(false);
      setShowCardImageUpload({});
      setParsedSchedule(null);
    }
  }, [open]);

  const resetPlanner = () => {
    onClose();
  };

  // Parse pasted text using Gemini and auto-trigger script generation
  const parseAndGenerate = async (text: string) => {
    // Only parse if text looks like schedule data (has driver names, times, or codes)
    if (!text || text.length < 20) return;

    setIsParsing(true);
    setParsedSchedule(null);

    try {
      // Call the text parser endpoint
      const response = await apiRequest("POST", "/api/fleet-comm/parse-text", { text });
      const result = await response.json();

      if (result.success && result.data) {
        setParsedSchedule(result.data);

        // Auto-select matched drivers
        const matchedDrivers = result.data.drivers?.filter((d: any) => d.matched && d.driverId) || [];
        if (matchedDrivers.length > 0) {
          const matchedIds = new Set(matchedDrivers.map((d: any) => d.driverId));
          setSelectedDriverIds(matchedIds);

          // Build prompt from parsed data
          const routeInfo = matchedDrivers
            .map((d: any) => {
              const parts: string[] = [];
              if (d.fullName) parts.push(d.fullName);
              if (d.origin && d.destination) parts.push(`${d.origin} → ${d.destination}`);
              if (d.startTime) parts.push(`at ${d.startTime}`);
              return parts.join(": ");
            })
            .join("; ");

          const autoPrompt = routeInfo
            ? `Remind each driver about their route: ${routeInfo}. Be friendly and wish them safe travels.`
            : text;

          setAIPrompt(autoPrompt);

          toast({
            title: "Schedule Parsed!",
            description: `Found ${matchedDrivers.length} driver(s). Generating scripts...`,
          });

          // AUTO-TRIGGER: Generate scripts immediately
          setIsGenerating(true);
          try {
            const genResponse = await apiRequest("POST", "/api/fleet-comm/generate-scripts", {
              driverIds: Array.from(matchedIds),
              prompt: autoPrompt
            });
            const genData = await genResponse.json();

            if (genData.success) {
              setGeneratedScripts(genData.scripts.map((s: any) => ({
                ...s,
                approved: true,
                editing: false,
                scheduledDate: scheduledDate,
                scheduledTime: scheduledTimeValue,
                variationNumber: s.variationNumber
              })));
              setStep("review"); // Jump straight to review!
            } else {
              toast({
                title: "Script Generation Failed",
                description: genData.message || "Could not generate scripts",
                variant: "destructive",
              });
            }
          } catch (genError: any) {
            toast({
              title: "Error",
              description: genError.message,
              variant: "destructive",
            });
          } finally {
            setIsGenerating(false);
          }
        } else {
          toast({
            title: "No Drivers Matched",
            description: result.data.summary || "Could not match drivers from the schedule",
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      console.error("Parse error:", error);
      toast({
        title: "Parse Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsParsing(false);
    }
  };

  // Handle image parsed - also auto-trigger generation
  const handleMainImageParsedAndGenerate = async (data: ParsedImageData) => {
    setParsedSchedule(data);
    setShowMainImageUpload(false);

    const matchedDrivers = data.drivers?.filter(d => d.matched && d.driverId) || [];
    if (matchedDrivers.length > 0) {
      const matchedIds = new Set(matchedDrivers.map(d => d.driverId as string));
      setSelectedDriverIds(matchedIds);

      // Build prompt from parsed data
      const routeInfo = matchedDrivers
        .map(d => {
          const parts: string[] = [];
          if (d.fullName) parts.push(d.fullName);
          if (d.origin && d.destination) parts.push(`${d.origin} → ${d.destination}`);
          if (d.startTime) parts.push(`at ${d.startTime}`);
          return parts.join(": ");
        })
        .join("; ");

      const autoPrompt = routeInfo
        ? `Remind each driver about their route: ${routeInfo}. Be friendly and wish them safe travels.`
        : data.rawText || "";

      setAIPrompt(autoPrompt);

      toast({
        title: "Image Parsed!",
        description: `Found ${matchedDrivers.length} driver(s). Generating scripts...`,
      });

      // AUTO-TRIGGER: Generate scripts immediately
      setIsGenerating(true);
      try {
        const genResponse = await apiRequest("POST", "/api/fleet-comm/generate-scripts", {
          driverIds: Array.from(matchedIds),
          prompt: autoPrompt
        });
        const genData = await genResponse.json();

        if (genData.success) {
          setGeneratedScripts(genData.scripts.map((s: any) => ({
            ...s,
            approved: true,
            editing: false,
            scheduledDate: scheduledDate,
            scheduledTime: scheduledTimeValue,
            variationNumber: s.variationNumber
          })));
          setStep("review"); // Jump straight to review!
        } else {
          toast({
            title: "Script Generation Failed",
            description: genData.message || "Could not generate scripts",
            variant: "destructive",
          });
        }
      } catch (genError: any) {
        toast({
          title: "Error",
          description: genError.message,
          variant: "destructive",
        });
      } finally {
        setIsGenerating(false);
      }
    } else {
      toast({
        title: "No Drivers Matched",
        description: data.summary || "Could not match drivers from the image",
        variant: "destructive",
      });
    }
  };

  // Toggle driver selection
  const toggleDriver = (driverId: string) => {
    setSelectedDriverIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(driverId)) {
        newSet.delete(driverId);
      } else {
        newSet.add(driverId);
      }
      return newSet;
    });
  };

  // Select/deselect all
  const selectAll = () => {
    setSelectedDriverIds(new Set(driversWithPhones.map(d => d.id)));
  };

  const deselectAll = () => {
    setSelectedDriverIds(new Set());
  };

  // Generate AI scripts
  const generateScripts = async () => {
    if (selectedDriverIds.size === 0) {
      toast({
        title: "No drivers selected",
        description: "Please select at least one driver to call",
        variant: "destructive",
      });
      return;
    }

    if (!aiPrompt.trim()) {
      toast({
        title: "No message",
        description: "Please describe what you want Milo to say",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const response = await apiRequest("POST", "/api/fleet-comm/generate-scripts", {
        driverIds: Array.from(selectedDriverIds),
        prompt: aiPrompt
      });
      const data = await response.json();

      if (data.success) {
        setGeneratedScripts(data.scripts.map((s: any) => ({
          ...s,
          approved: true,
          editing: false,
          scheduledDate: scheduledDate,
          scheduledTime: scheduledTimeValue,
          variationNumber: s.variationNumber
        })));
        setStep("review");
      } else {
        toast({
          title: "Generation Failed",
          description: data.message || "Could not generate scripts",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Schedule approved calls
  const scheduleApprovedCalls = async () => {
    const approvedScripts = generatedScripts.filter(s => s.approved);
    if (approvedScripts.length === 0) {
      toast({
        title: "No Calls",
        description: "No scripts approved for calling",
        variant: "destructive",
      });
      return;
    }

    setIsScheduling(true);
    try {
      const calls = approvedScripts.map(s => {
        let scheduledFor: string;
        if (callTime === "now") {
          scheduledFor = new Date(Date.now() + 60000).toISOString();
        } else {
          scheduledFor = new Date(`${s.scheduledDate}T${s.scheduledTime}`).toISOString();
        }
        return {
          driverId: s.driverId,
          driverName: s.driverName,
          phoneNumber: s.phoneNumber,
          message: s.script,
          scheduledFor
        };
      });

      const response = await apiRequest("POST", "/api/fleet-comm/schedule-batch", { calls });
      const data = await response.json();

      if (data.success) {
        setScheduledCallIds(data.callIds);
        setStep("summary");
        onScheduled();
        toast({
          title: "Calls Scheduled",
          description: `${data.scheduled} call${data.scheduled !== 1 ? 's' : ''} scheduled`,
        });
      } else {
        toast({
          title: "Scheduling Failed",
          description: data.message || "Could not schedule calls",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsScheduling(false);
    }
  };

  // Script manipulation functions
  const updateScript = (driverId: string, variationNumber: number | undefined, newScript: string) => {
    setGeneratedScripts(prev =>
      prev.map(s => (s.driverId === driverId && s.variationNumber === variationNumber)
        ? { ...s, script: newScript, editing: false } : s)
    );
  };

  const toggleScriptEditing = (driverId: string, variationNumber: number | undefined) => {
    setGeneratedScripts(prev =>
      prev.map(s => (s.driverId === driverId && s.variationNumber === variationNumber)
        ? { ...s, editing: !s.editing } : s)
    );
  };

  const toggleScriptApproval = (driverId: string, variationNumber: number | undefined) => {
    setGeneratedScripts(prev =>
      prev.map(s => (s.driverId === driverId && s.variationNumber === variationNumber)
        ? { ...s, approved: !s.approved } : s)
    );
  };

  const removeScript = (driverId: string, variationNumber: number | undefined) => {
    setGeneratedScripts(prev =>
      prev.filter(s => !(s.driverId === driverId && s.variationNumber === variationNumber))
    );
  };

  const updateScriptDate = (driverId: string, variationNumber: number | undefined, newDate: string) => {
    setGeneratedScripts(prev =>
      prev.map(s => (s.driverId === driverId && s.variationNumber === variationNumber)
        ? { ...s, scheduledDate: newDate } : s)
    );
  };

  const updateScriptTime = (driverId: string, variationNumber: number | undefined, newTime: string) => {
    setGeneratedScripts(prev =>
      prev.map(s => (s.driverId === driverId && s.variationNumber === variationNumber)
        ? { ...s, scheduledTime: newTime } : s)
    );
  };

  const updateCardPrompt = (cardKey: string, prompt: string) => {
    setCardPrompts(prev => ({ ...prev, [cardKey]: prompt }));
  };

  const toggleCardImageUpload = (cardKey: string) => {
    setShowCardImageUpload(prev => ({ ...prev, [cardKey]: !prev[cardKey] }));
  };

  // Handle image parsed data for per-card regeneration (Step 2)
  const handleCardImageParsed = (data: ParsedImageData, script: GeneratedScript) => {
    const cardKey = `${script.driverId}-${script.variationNumber || 0}`;

    // Find this driver in the parsed data
    const driverData = data.drivers?.find(d =>
      d.driverId === script.driverId ||
      d.fullName?.toLowerCase().includes(script.driverName.toLowerCase().split(' ')[0]) ||
      d.name?.toLowerCase().includes(script.driverName.toLowerCase().split(' ')[0])
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
        const prompt = `Remind ${script.driverName.split(' ')[0]} about their schedule: ${promptParts.join(", ")}. Keep it friendly.`;
        setCardPrompts(prev => ({ ...prev, [cardKey]: prompt }));
        toast({
          title: "Schedule Extracted",
          description: `Found schedule info for ${script.driverName.split(' ')[0]}`,
        });
      }
    } else if (data.rawText) {
      setCardPrompts(prev => ({
        ...prev,
        [cardKey]: `Based on this schedule info: ${data.rawText}. Create a brief reminder.`
      }));
    }

    setShowCardImageUpload(prev => ({ ...prev, [cardKey]: false }));
  };

  const regenerateScript = async (script: GeneratedScript) => {
    const cardKey = `${script.driverId}-${script.variationNumber || 0}`;
    const prompt = cardPrompts[cardKey];

    if (!prompt?.trim()) {
      toast({
        title: "Enter a prompt",
        description: "Type what you want Milo to say",
        variant: "destructive",
      });
      return;
    }

    setRegeneratingScript(cardKey);
    try {
      const response = await apiRequest("POST", "/api/fleet-comm/generate-scripts", {
        driverIds: [script.driverId],
        prompt: prompt
      });
      const data = await response.json();

      if (data.success && data.scripts.length > 0) {
        const newScript = data.scripts[0].script;
        setGeneratedScripts(prev =>
          prev.map(s => (s.driverId === script.driverId && s.variationNumber === script.variationNumber)
            ? { ...s, script: newScript } : s)
        );
        setCardPrompts(prev => ({ ...prev, [cardKey]: "" }));
        toast({
          title: "Script updated",
          description: `New script generated for ${script.driverName}`,
        });
      } else {
        toast({
          title: "Generation Failed",
          description: data.message || "Could not generate script",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRegeneratingScript(null);
    }
  };

  const approvedCount = generatedScripts.filter(s => s.approved).length;
  const selectedDriverNames = Array.from(selectedDriverIds).map(id => {
    const driver = drivers.find(d => d.id === id);
    return driver ? `${driver.firstName} ${driver.lastName}` : '';
  }).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && resetPlanner()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "review" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("select")}
                className="mr-2 h-8 w-8 p-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Sparkles className="h-5 w-5 text-purple-500" />
            {step === "select" && "AI Call Planner"}
            {step === "review" && "Review & Edit Scripts"}
            {step === "summary" && "Calls Scheduled!"}
          </DialogTitle>
          <DialogDescription>
            {step === "select" && "Paste schedule info and instructions - AI will find the drivers"}
            {step === "review" && (
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {generatedScripts.length} script{generatedScripts.length !== 1 ? 's' : ''} for:
                <span className="font-medium text-foreground">
                  {generatedScripts.map(s => s.driverName.split(' ')[0]).join(', ')}
                </span>
              </span>
            )}
            {step === "summary" && `${scheduledCallIds.length} calls scheduled successfully`}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Select Drivers & Message */}
        {step === "select" && (
          <>
            <div className="flex-1 overflow-y-auto space-y-4 py-4">
              {/* Driver Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Select Drivers to Call
                  </Label>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={selectAll}>
                      Select All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={deselectAll}>
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto p-2 border rounded-lg bg-muted/30">
                  {driversWithPhones.map(driver => (
                    <div
                      key={driver.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        selectedDriverIds.has(driver.id)
                          ? "bg-purple-100 border border-purple-300"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => toggleDriver(driver.id)}
                    >
                      <Checkbox
                        checked={selectedDriverIds.has(driver.id)}
                        onCheckedChange={() => toggleDriver(driver.id)}
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-purple-200 flex items-center justify-center text-xs font-medium text-purple-700">
                          {getInitials(driver.firstName, driver.lastName)}
                        </div>
                        <span className="text-sm truncate">
                          {driver.firstName} {driver.lastName}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {selectedDriverIds.size > 0 && (
                  <div className="flex items-center gap-2 text-sm text-purple-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {selectedDriverIds.size} driver{selectedDriverIds.size !== 1 ? 's' : ''} selected
                  </div>
                )}
              </div>

              {/* AI Script Generator - Same style as Schedule Call modal */}
              <div className="space-y-3 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 text-purple-700">
                    <Sparkles className="h-4 w-4" />
                    Paste schedule or describe what to say
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                    onClick={() => setShowMainImageUpload(!showMainImageUpload)}
                  >
                    <Camera className="h-3 w-3 mr-1" />
                    {showMainImageUpload ? "Hide" : "Upload Image"}
                  </Button>
                </div>

                {/* Image Upload Section */}
                {showMainImageUpload && (
                  <ImageUpload
                    onParsed={handleMainImageParsedAndGenerate}
                    onTextExtracted={(text) => parseAndGenerate(text)}
                  />
                )}

                <textarea
                  className="w-full min-h-[120px] rounded-md border border-purple-200 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2"
                  value={aiPrompt}
                  onChange={(e) => setAIPrompt(e.target.value)}
                  onPaste={(e) => {
                    // Let the paste happen, then parse after a short delay
                    setTimeout(() => {
                      const text = e.currentTarget.value;
                      if (text && text.length > 30) {
                        parseAndGenerate(text);
                      }
                    }, 100);
                  }}
                  disabled={isParsing || isGenerating}
                  placeholder={`Paste schedule text here - AI will auto-parse and generate scripts!

Example:
Today's schedule:
- Dan starts at 6:00 AM, MCI to DEN
- Natasha starts at 7:30 AM, ORD to LAX`}
                />

                {/* Parse & Generate Button */}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => parseAndGenerate(aiPrompt)}
                    disabled={!aiPrompt.trim() || isParsing || isGenerating || aiPrompt.length < 20}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {isParsing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Parsing...
                      </>
                    ) : isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating Scripts...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Parse & Generate Scripts
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Paste schedule → Auto-parse → Generate call scripts
                  </p>
                </div>
              </div>

              {/* When to Call - Improved Layout */}
              <div className="space-y-3 p-4 border rounded-lg">
                <Label className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  When to call
                </Label>

                <div className="flex flex-col gap-3">
                  {/* Now option */}
                  <label
                    className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      callTime === "now"
                        ? "border-purple-500 bg-purple-50"
                        : "border-transparent bg-muted/50 hover:bg-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="callTime"
                      checked={callTime === "now"}
                      onChange={() => setCallTime("now")}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      callTime === "now" ? "border-purple-500" : "border-gray-400"
                    }`}>
                      {callTime === "now" && <div className="w-2 h-2 rounded-full bg-purple-500" />}
                    </div>
                    <div>
                      <p className="font-medium">Call Now</p>
                      <p className="text-xs text-muted-foreground">Calls will be placed immediately</p>
                    </div>
                  </label>

                  {/* Schedule option */}
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      callTime === "scheduled"
                        ? "border-purple-500 bg-purple-50"
                        : "border-transparent bg-muted/50 hover:bg-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="callTime"
                      checked={callTime === "scheduled"}
                      onChange={() => setCallTime("scheduled")}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-1 ${
                      callTime === "scheduled" ? "border-purple-500" : "border-gray-400"
                    }`}>
                      {callTime === "scheduled" && <div className="w-2 h-2 rounded-full bg-purple-500" />}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Schedule for later</p>
                      <p className="text-xs text-muted-foreground mb-2">Set a specific date and time</p>

                      {/* Always visible date/time inputs */}
                      <div className="flex gap-2 mt-2">
                        <Input
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          min={format(new Date(), "yyyy-MM-dd")}
                          className="flex-1"
                          disabled={callTime !== "scheduled"}
                        />
                        <Input
                          type="time"
                          value={scheduledTimeValue}
                          onChange={(e) => setScheduledTimeValue(e.target.value)}
                          className="w-32"
                          disabled={callTime !== "scheduled"}
                        />
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetPlanner}>
                Cancel
              </Button>
              <Button
                onClick={generateScripts}
                disabled={selectedDriverIds.size === 0 || !aiPrompt.trim() || isGenerating}
                className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Generate {selectedDriverIds.size} Script{selectedDriverIds.size !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2: Review Scripts */}
        {step === "review" && (
          <>
            {/* Summary bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-lg mb-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4 text-purple-500" />
                  <strong>{generatedScripts.length}</strong> drivers
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-blue-500" />
                  {callTime === "now" ? "Calling now" : format(new Date(`${scheduledDate}T${scheduledTimeValue}`), "MMM d, h:mm a")}
                </span>
              </div>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                {approvedCount} approved
              </Badge>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 py-2">
              {generatedScripts.map((script) => {
                const cardKey = `${script.driverId}-${script.variationNumber || 0}`;
                const isRegenerating = regeneratingScript === cardKey;

                return (
                  <div
                    key={cardKey}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      script.approved
                        ? "border-green-200 bg-green-50/30"
                        : "border-gray-200 bg-gray-50/50 opacity-60"
                    }`}
                  >
                    {/* Driver Header - More prominent */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-purple-200 flex items-center justify-center text-sm font-bold text-purple-700">
                          {getInitials(script.driverName.split(' ')[0], script.driverName.split(' ')[1] || '')}
                        </div>
                        <div>
                          <p className="font-semibold text-base">{script.driverName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{script.phoneNumber}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant={script.approved ? "default" : "outline"}
                          className={`h-8 w-8 ${script.approved ? "bg-green-500 hover:bg-green-600" : ""}`}
                          onClick={() => toggleScriptApproval(script.driverId, script.variationNumber)}
                          title={script.approved ? "Approved" : "Click to approve"}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() => toggleScriptEditing(script.driverId, script.variationNumber)}
                          title="Edit script"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => removeScript(script.driverId, script.variationNumber)}
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Per-card schedule time (only in scheduled mode) */}
                    {callTime === "scheduled" && (
                      <div className="flex items-center gap-2 mb-3 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <Input
                          type="date"
                          value={script.scheduledDate}
                          onChange={(e) => updateScriptDate(script.driverId, script.variationNumber, e.target.value)}
                          className="h-8 w-36"
                          min={format(new Date(), "yyyy-MM-dd")}
                        />
                        <Input
                          type="time"
                          value={script.scheduledTime}
                          onChange={(e) => updateScriptTime(script.driverId, script.variationNumber, e.target.value)}
                          className="h-8 w-28"
                        />
                      </div>
                    )}

                    {/* Script Content */}
                    {script.editing ? (
                      <div className="space-y-2 mb-3">
                        <Label className="text-xs">Edit Message (TTS)</Label>
                        <textarea
                          className="w-full min-h-[80px] rounded-md border border-input bg-white px-3 py-2 text-sm"
                          defaultValue={script.script}
                          onBlur={(e) => updateScript(script.driverId, script.variationNumber, e.target.value)}
                        />
                        <Button
                          size="sm"
                          onClick={() => toggleScriptEditing(script.driverId, script.variationNumber)}
                        >
                          Done Editing
                        </Button>
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-3 border mb-3">
                        <p className="text-sm text-gray-700 italic">"{script.script}"</p>
                        <p className="text-right text-xs text-muted-foreground mt-1">
                          {estimateDuration(script.script)}
                        </p>
                      </div>
                    )}

                    {/* AI Regenerate - Same style as Schedule Call modal */}
                    <div className="p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs text-purple-700 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          AI Script Generator
                        </Label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                          onClick={() => toggleCardImageUpload(cardKey)}
                        >
                          <Camera className="h-3 w-3 mr-1" />
                          {showCardImageUpload[cardKey] ? "Hide" : "Upload"}
                        </Button>
                      </div>

                      {/* Image Upload Section */}
                      {showCardImageUpload[cardKey] && (
                        <div className="mb-2">
                          <ImageUpload
                            onParsed={(data) => handleCardImageParsed(data, script)}
                            onTextExtracted={(text) => updateCardPrompt(cardKey, `Based on this schedule: ${text}. Create a brief reminder.`)}
                          />
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Input
                          placeholder="e.g., Make it more friendly and add a safety reminder..."
                          value={cardPrompts[cardKey] || ""}
                          onChange={(e) => updateCardPrompt(cardKey, e.target.value)}
                          className="flex-1 h-9 text-sm bg-white"
                          disabled={isRegenerating}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && cardPrompts[cardKey]?.trim()) {
                              regenerateScript(script);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() => regenerateScript(script)}
                          disabled={isRegenerating || !cardPrompts[cardKey]?.trim()}
                          className="h-9 bg-purple-600 hover:bg-purple-700"
                        >
                          {isRegenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Describe what you want Milo to say, or upload a schedule image
                      </p>
                    </div>
                  </div>
                );
              })}

              {generatedScripts.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No scripts to review</p>
                </div>
              )}
            </div>

            <DialogFooter className="border-t pt-4">
              <div className="flex-1 text-sm text-muted-foreground">
                {approvedCount} of {generatedScripts.length} approved
              </div>
              <Button variant="outline" onClick={resetPlanner}>
                Cancel
              </Button>
              <Button
                onClick={scheduleApprovedCalls}
                disabled={approvedCount === 0 || isScheduling}
                className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
              >
                {isScheduling ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Phone className="h-4 w-4 mr-2" />
                )}
                {callTime === "now" ? "Call" : "Schedule"} {approvedCount} Driver{approvedCount !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 3: Summary */}
        {step === "summary" && (
          <>
            <div className="flex-1 overflow-y-auto py-4">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                </div>
                <h3 className="text-xl font-semibold text-green-700">
                  {scheduledCallIds.length} Call{scheduledCallIds.length !== 1 ? 's' : ''} {callTime === "now" ? "Placed" : "Scheduled"}!
                </h3>
                <p className="text-muted-foreground">
                  {callTime === "now"
                    ? "Calls are being placed now"
                    : `Scheduled for ${format(new Date(`${scheduledDate}T${scheduledTimeValue}`), "MMMM d 'at' h:mm a")}`
                  }
                </p>
              </div>

              <div className="space-y-2 p-4 bg-muted/30 rounded-lg">
                <p className="font-medium text-sm mb-3">Drivers being called:</p>
                {generatedScripts.filter(s => s.approved).map(script => (
                  <div key={script.driverId} className="flex items-center gap-3 p-2 bg-white rounded border">
                    <div className="w-8 h-8 rounded-full bg-purple-200 flex items-center justify-center text-xs font-medium text-purple-700">
                      {getInitials(script.driverName.split(' ')[0], script.driverName.split(' ')[1] || '')}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{script.driverName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{script.phoneNumber}</p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  </div>
                ))}
              </div>

              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800">
                  <AlertCircle className="h-4 w-4 inline mr-1" />
                  Check the "Scheduled" button in the header for call status updates.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={resetPlanner} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
