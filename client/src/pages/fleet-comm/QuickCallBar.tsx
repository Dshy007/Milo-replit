/**
 * Quick Call Bar - Natural language input for quick calls
 * Now with Gemini Vision image parsing support
 * Supports direct paste of images (Ctrl+V)
 */

import { useState, useCallback, useEffect } from "react";
import { Bot, Loader2, Send, Camera, X, Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { ImageUpload, type ParsedImageData } from "./ImageUpload";

interface QuickCallBarProps {
  onCallScheduled: () => void;
}

export function QuickCallBar({ onCallScheduled }: QuickCallBarProps) {
  const { toast } = useToast();
  const [quickCallPrompt, setQuickCallPrompt] = useState("");
  const [isProcessingQuickCall, setIsProcessingQuickCall] = useState(false);
  const [showImageUpload, setShowImageUpload] = useState(false);

  // Pasted image state
  const [pastedImage, setPastedImage] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // Process a pasted image file
  const processImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    setIsProcessingImage(true);

    // Create preview
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPastedImage(dataUrl);

      try {
        const response = await apiRequest("POST", "/api/fleet-comm/parse-image", {
          imageData: dataUrl,
          mimeType: file.type
        });

        const result = await response.json();

        if (result.success && result.data) {
          handleImageParsed(result.data);
          toast({
            title: "Image Parsed",
            description: `Found ${result.data.drivers?.length || 0} driver(s)`,
          });
        } else {
          toast({
            title: "Parse Failed",
            description: result.message || "Could not parse image",
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
        setIsProcessingImage(false);
      }
    };

    reader.readAsDataURL(file);
  }, [toast]);

  // Global paste listener - detect image paste anywhere
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Only handle if we're not already processing
      if (isProcessingImage || pastedImage) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processImageFile(file);
            break;
          }
        }
      }
    };

    document.addEventListener("paste", handleGlobalPaste);
    return () => document.removeEventListener("paste", handleGlobalPaste);
  }, [processImageFile, isProcessingImage, pastedImage]);

  const handleImageParsed = (data: ParsedImageData & { blocks?: any[] }) => {
    // Build a natural language prompt from parsed schedule data
    // Handle new "blocks" format from logistics-aware parsing
    if (data.blocks && data.blocks.length > 0) {
      const matchedBlocks = data.blocks.filter((b: any) => b.matchedDriver);

      if (matchedBlocks.length > 0) {
        // Build prompt for all matched drivers
        const driverNames = matchedBlocks.map((b: any) => b.matchedDriver.fullName);
        const uniqueDrivers = [...new Set(driverNames)];

        if (uniqueDrivers.length === 1) {
          const block = matchedBlocks[0];
          let prompt = `Call ${block.matchedDriver.fullName}`;
          if (block.route) {
            prompt += ` about their ${block.route} block`;
          }
          if (block.startTime) {
            prompt += ` starting ${block.startTime}`;
          }
          setQuickCallPrompt(prompt);
        } else {
          // Multiple drivers
          setQuickCallPrompt(`Call ${uniqueDrivers.join(", ")} about their scheduled blocks`);
        }

        toast({
          title: "Schedule Extracted",
          description: `Found ${matchedBlocks.length} block(s) for ${uniqueDrivers.length} driver(s)`,
        });
      } else {
        // Blocks found but no driver matches
        const driverNames = data.blocks.map((b: any) => b.driver).filter(Boolean);
        if (driverNames.length > 0) {
          setQuickCallPrompt(`Schedule found for: ${driverNames.join(", ")} (no database match)`);
        }
      }
    } else if (data.drivers && data.drivers.length > 0) {
      // Fallback to old driver format
      const firstDriver = data.drivers[0];

      if (firstDriver.matched && firstDriver.fullName) {
        let prompt = `Call ${firstDriver.fullName}`;

        if (firstDriver.origin && firstDriver.destination) {
          prompt += ` and remind them about their trip from ${firstDriver.origin} to ${firstDriver.destination}`;
        }
        if (firstDriver.startTime) {
          prompt += ` at ${firstDriver.startTime}`;
        }

        setQuickCallPrompt(prompt);
        toast({
          title: "Schedule Extracted",
          description: `Created call prompt for ${firstDriver.fullName}`,
        });
      } else if (firstDriver.name) {
        setQuickCallPrompt(`Call ${firstDriver.name} about their schedule`);
      }
    } else if (data.rawText) {
      setQuickCallPrompt(`Based on schedule: ${data.rawText.slice(0, 100)}...`);
    }

    setShowImageUpload(false);
  };

  const clearPastedImage = () => {
    setPastedImage(null);
    setQuickCallPrompt("");
  };

  const processQuickCall = async () => {
    if (!quickCallPrompt.trim()) return;

    setIsProcessingQuickCall(true);
    try {
      const response = await apiRequest("POST", "/api/fleet-comm/quick-call", {
        prompt: quickCallPrompt
      });
      const data = await response.json();

      if (data.success) {
        toast({
          title: data.callNow ? "Calling Now" : "Call Scheduled",
          description: `${data.driverName}: ${data.scheduledFor ? `Scheduled for ${format(new Date(data.scheduledFor), "h:mm a")}` : "Placing call..."}`,
        });
        setQuickCallPrompt("");
        setPastedImage(null);
        onCallScheduled();
      } else {
        toast({
          title: "Quick Call Failed",
          description: data.message || "Could not process request",
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
      setIsProcessingQuickCall(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
      {/* Pasted Image Preview */}
      {pastedImage && (
        <div className="mb-3 relative">
          <div className="flex items-start gap-3 p-2 bg-white rounded-lg border border-purple-200">
            <img
              src={pastedImage}
              alt="Pasted schedule"
              className="h-16 w-auto rounded border object-contain"
            />
            <div className="flex-1 min-w-0">
              {isProcessingImage ? (
                <div className="flex items-center gap-2 text-purple-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Analyzing image...</span>
                </div>
              ) : quickCallPrompt ? (
                <p className="text-sm text-gray-700 truncate">{quickCallPrompt}</p>
              ) : (
                <p className="text-sm text-gray-500">Processing...</p>
              )}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-gray-400 hover:text-red-500"
              onClick={clearPastedImage}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <Bot className="h-6 w-6 text-purple-600" />
        </div>
        <div className="flex-1">
          <Input
            placeholder='Quick call: "Call Dan in 20 minutes" or paste an image (Ctrl+V)'
            value={quickCallPrompt}
            onChange={(e) => setQuickCallPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isProcessingQuickCall) {
                processQuickCall();
              }
            }}
            disabled={isProcessingQuickCall || isProcessingImage}
            className="bg-white/80 border-purple-200 focus:border-purple-400"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowImageUpload(!showImageUpload)}
          className="text-purple-600 hover:text-purple-700 hover:bg-purple-100"
          title="Upload schedule image"
        >
          <Camera className="h-4 w-4" />
        </Button>
        <Button
          onClick={processQuickCall}
          disabled={!quickCallPrompt.trim() || isProcessingQuickCall || isProcessingImage}
          className="bg-purple-600 hover:bg-purple-700"
        >
          {isProcessingQuickCall ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Image Upload Section */}
      {showImageUpload && (
        <div className="mt-3 ml-9">
          <ImageUpload
            onParsed={handleImageParsed}
            onTextExtracted={(text) => setQuickCallPrompt(`Based on schedule: ${text.slice(0, 100)}...`)}
          />
        </div>
      )}

      <p className="text-xs text-purple-600 mt-2 ml-9">
        Paste image (Ctrl+V) • "Call Dan now" • "Call Richard in 30 min with safety reminder"
      </p>
    </div>
  );
}
