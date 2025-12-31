/**
 * Image Upload Component with Gemini Vision OCR
 *
 * Supports:
 * - Drag and drop
 * - Click to upload
 * - Paste from clipboard
 * - Returns extracted schedule data
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Image as ImageIcon,
  Upload,
  Loader2,
  X,
  CheckCircle2,
  AlertCircle,
  Camera,
  Clipboard
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export interface ParsedDriver {
  name: string;
  matched: boolean;
  driverId: string | null;
  phoneNumber: string | null;
  fullName: string;
  origin?: string;
  destination?: string;
  startTime?: string;
  notes?: string;
}

export interface ParsedImageData {
  drivers: ParsedDriver[];
  rawText: string;
  summary: string;
  error?: string;
}

interface ImageUploadProps {
  onParsed: (data: ParsedImageData) => void;
  onTextExtracted?: (text: string) => void;
  compact?: boolean;
}

export function ImageUpload({ onParsed, onTextExtracted, compact = false }: ImageUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedImageData | null>(null);

  const processImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setParsedData(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPreviewUrl(dataUrl);

      try {
        const response = await apiRequest("POST", "/api/fleet-comm/parse-image", {
          imageData: dataUrl,
          mimeType: file.type
        });

        const result = await response.json();

        if (result.success && result.data) {
          setParsedData(result.data);
          onParsed(result.data);

          // Also pass raw text if available
          if (onTextExtracted && result.data.rawText) {
            onTextExtracted(result.data.rawText);
          }

          const matchedCount = result.data.drivers?.filter((d: ParsedDriver) => d.matched).length || 0;
          toast({
            title: "Image Parsed",
            description: `Found ${result.data.drivers?.length || 0} drivers (${matchedCount} matched)`,
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
        setIsProcessing(false);
      }
    };

    reader.readAsDataURL(file);
  }, [onParsed, onTextExtracted, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      processImage(file);
    }
  }, [processImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImage(file);
    }
  }, [processImage]);

  const handlePaste = useCallback((e: React.ClipboardEvent | ClipboardEvent) => {
    const clipboardData = 'clipboardData' in e ? e.clipboardData : (e as ClipboardEvent).clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processImage(file);
          break;
        }
      }
    }
  }, [processImage]);

  // Global paste listener - allows Ctrl+V anywhere when component is visible
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Only handle if we're not already processing and no preview
      if (isProcessing || previewUrl) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processImage(file);
            toast({
              title: "Image Pasted",
              description: "Processing pasted image...",
            });
            break;
          }
        }
      }
    };

    document.addEventListener("paste", handleGlobalPaste);
    return () => document.removeEventListener("paste", handleGlobalPaste);
  }, [processImage, isProcessing, previewUrl, toast]);

  // Manual paste from clipboard button
  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], "pasted-image.png", { type: imageType });
          processImage(file);
          return;
        }
      }
      toast({
        title: "No Image Found",
        description: "No image found in clipboard. Copy an image first (Ctrl+C or screenshot)",
        variant: "destructive",
      });
    } catch (error: any) {
      // Fallback message if clipboard API not available
      toast({
        title: "Paste with Ctrl+V",
        description: "Click the upload area and press Ctrl+V to paste an image",
      });
    }
  }, [processImage, toast]);

  const clearImage = useCallback(() => {
    setPreviewUrl(null);
    setParsedData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Compact mode for inline use in text inputs
  if (compact) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          title="Upload schedule image"
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
        </Button>
        {parsedData && parsedData.drivers?.length > 0 && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {parsedData.drivers.length}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Upload Area */}
      {!previewUrl ? (
        <div className="space-y-2">
          {/* Main drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
              isDragging
                ? "border-purple-500 bg-purple-50"
                : "border-gray-300 hover:border-purple-400 hover:bg-purple-50/50"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            onPaste={handlePaste}
            tabIndex={0}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="flex flex-col items-center gap-2 py-2">
              {isProcessing ? (
                <>
                  <Loader2 className="h-8 w-8 text-purple-500 animate-spin" />
                  <p className="text-sm text-purple-600 font-medium">Analyzing image with AI...</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Upload className="h-6 w-6 text-purple-500" />
                    <ImageIcon className="h-6 w-6 text-purple-500" />
                  </div>
                  <p className="text-sm font-medium text-gray-700">
                    Drop schedule image here or click to upload
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Paste button - prominent action */}
          {!isProcessing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePasteFromClipboard}
              className="w-full border-purple-300 text-purple-600 hover:bg-purple-50 hover:text-purple-700"
            >
              <Clipboard className="h-4 w-4 mr-2" />
              Paste from Clipboard (Ctrl+V)
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Preview */}
          <div className="relative">
            <img
              src={previewUrl}
              alt="Schedule preview"
              className="w-full max-h-48 object-contain rounded-lg border"
            />
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="absolute top-2 right-2 h-6 w-6"
              onClick={clearImage}
            >
              <X className="h-3 w-3" />
            </Button>
            {isProcessing && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
                <Loader2 className="h-8 w-8 text-purple-500 animate-spin" />
              </div>
            )}
          </div>

          {/* Parsed Results */}
          {parsedData && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 mb-2 text-green-700 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Extracted from image:
              </div>

              {parsedData.summary && (
                <p className="text-gray-600 mb-2 text-xs">{parsedData.summary}</p>
              )}

              {parsedData.drivers && parsedData.drivers.length > 0 ? (
                <div className="space-y-1">
                  {parsedData.drivers.map((driver, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between p-2 rounded ${
                        driver.matched ? "bg-green-100" : "bg-yellow-100"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {driver.matched ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-yellow-600" />
                        )}
                        <span className="font-medium">{driver.fullName || driver.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        {driver.origin && driver.destination && (
                          <span>{driver.origin} → {driver.destination}</span>
                        )}
                        {driver.startTime && (
                          <span>{driver.startTime}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-yellow-600 text-xs">No drivers found in image</p>
              )}

              {parsedData.error && (
                <p className="text-red-600 text-xs mt-2">{parsedData.error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
