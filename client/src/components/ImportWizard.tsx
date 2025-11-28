import { useState, useCallback, useRef } from "react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, parse } from "date-fns";
import { Upload, FileSpreadsheet, Calendar, History, Sparkles, X, ChevronRight, AlertTriangle, ClipboardPaste, FileText, Check, Brain, Loader2, Send, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImportFile {
  file: File;
  type: "new_week" | "actuals" | "unknown";
  detectedWeek?: { start: Date; end: Date };
}

interface ParsedBlock {
  blockId: string;
  startTime: Date;
  duration: number; // in hours
  rate: number;
  driverName: string | null;
  blockType: "solo1" | "solo2" | "team";
}

// Reconstructed block from trip-level data
interface ReconstructedBlock {
  blockId: string;
  contract: string;
  canonicalStartTime: string;
  startDate: string;
  endDate: string;
  duration: string;
  cost: number;
  primaryDriver: string;
  relayDrivers: string[];
  loadCount: number;
  route: string;
}

// Detected data format type
type DataFormat = "block_level" | "trip_level" | "unknown";

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (files: ImportFile[], importType: "new_week" | "actuals" | "both") => void;
  onPasteImport?: (blocks: ParsedBlock[], importType: "new_week" | "actuals") => void;
  currentWeekStart: Date;
}

// Parse pasted Amazon block data
function parseBlockData(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let currentBlock: Partial<ParsedBlock> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Block ID pattern: B-XXXXXXXXX
    const blockIdMatch = line.match(/^(B-[A-Z0-9]+)$/);
    if (blockIdMatch) {
      // Save previous block if complete
      if (currentBlock.blockId && currentBlock.startTime) {
        blocks.push(currentBlock as ParsedBlock);
      }
      currentBlock = { blockId: blockIdMatch[1], driverName: null };
      continue;
    }

    // Date/time pattern: "Fri, Nov 28, 15:30 CST" or similar
    const dateTimeMatch = line.match(/^([A-Za-z]+),\s+([A-Za-z]+)\s+(\d+),\s+(\d{1,2}:\d{2})\s+([A-Z]{2,4})$/);
    if (dateTimeMatch && currentBlock.blockId) {
      const [, , month, day, time] = dateTimeMatch;
      const year = new Date().getFullYear();
      // Parse the date - handle year rollover
      const dateStr = `${month} ${day}, ${year} ${time}`;
      try {
        const parsedDate = parse(dateStr, "MMM d, yyyy H:mm", new Date());
        // If the date is in the past by more than 6 months, assume next year
        if (parsedDate < subWeeks(new Date(), 26)) {
          currentBlock.startTime = parse(dateStr.replace(String(year), String(year + 1)), "MMM d, yyyy H:mm", new Date());
        } else {
          currentBlock.startTime = parsedDate;
        }
      } catch {
        // Try alternate format
      }
      continue;
    }

    // Duration pattern: "38h" or "14h"
    const durationMatch = line.match(/^(\d+)h$/);
    if (durationMatch && currentBlock.blockId) {
      currentBlock.duration = parseInt(durationMatch[1]);
      // Determine block type based on duration
      if (currentBlock.duration >= 30) {
        currentBlock.blockType = "solo2";
      } else if (currentBlock.duration >= 10) {
        currentBlock.blockType = "solo1";
      } else {
        currentBlock.blockType = "team";
      }
      continue;
    }

    // Rate pattern: "$980.64" or similar
    const rateMatch = line.match(/^\$?([\d,]+\.?\d*)$/);
    if (rateMatch && currentBlock.blockId) {
      currentBlock.rate = parseFloat(rateMatch[1].replace(',', ''));
      continue;
    }

    // Driver name pattern: "M. FREEMAN" or "J. SMITH" (initial + last name in caps)
    const driverMatch = line.match(/^([A-Z])\.\s+([A-Z]+)$/);
    if (driverMatch && currentBlock.blockId) {
      currentBlock.driverName = `${driverMatch[1]}. ${driverMatch[2]}`;
      continue;
    }

    // Also check for full driver names or "Unassigned"
    if (line.toLowerCase() === "unassigned" && currentBlock.blockId) {
      currentBlock.driverName = null;
      continue;
    }
  }

  // Don't forget the last block
  if (currentBlock.blockId && currentBlock.startTime) {
    blocks.push(currentBlock as ParsedBlock);
  }

  return blocks;
}

// Detect if pasted data is trip-level CSV format
function detectTripLevelCSV(text: string): { isTriplevel: boolean; rowCount: number; blockIds: string[] } {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return { isTriplevel: false, rowCount: 0, blockIds: [] };

  // Check for trip-level indicators
  const hasBlockIdPattern = /B-[A-Z0-9]{8,}/i.test(text);
  const hasOperatorIdPattern = /FTIM_MKC_Solo[12]/i.test(text);
  const hasLoadIdPattern = /\d{9,}[A-Z0-9]+/i.test(text);  // Load IDs like 116MPB4D0
  const hasTabSeparation = /\t.*\t.*\t/.test(text);
  const hasFacilityPattern = /MKC\d+|CHI\d+|TFC\d+/i.test(text);

  // If we have operator IDs and multiple tabs, it's likely trip-level
  const isTriplevel = hasOperatorIdPattern && (hasTabSeparation || hasLoadIdPattern) && hasFacilityPattern;

  // Extract unique block IDs
  const blockIdMatches = text.match(/B-[A-Z0-9]{8,}/gi) || [];
  const blockIds = [...new Set(blockIdMatches)];

  // Count data rows (excluding header)
  const rowCount = lines.length - 1;

  return { isTriplevel, rowCount, blockIds };
}

// Canonical start times lookup
const CANONICAL_START_TIMES: Record<string, string> = {
  "Solo1_Tractor_1": "16:30",
  "Solo1_Tractor_2": "20:30",
  "Solo1_Tractor_3": "20:30",
  "Solo1_Tractor_4": "17:30",
  "Solo1_Tractor_5": "21:30",
  "Solo1_Tractor_6": "01:30",
  "Solo1_Tractor_7": "18:30",
  "Solo1_Tractor_8": "00:30",
  "Solo1_Tractor_9": "16:30",
  "Solo1_Tractor_10": "20:30",
  "Solo2_Tractor_1": "18:30",
  "Solo2_Tractor_2": "23:30",
  "Solo2_Tractor_3": "21:30",
  "Solo2_Tractor_4": "08:30",
  "Solo2_Tractor_5": "15:30",
  "Solo2_Tractor_6": "11:30",
  "Solo2_Tractor_7": "16:30",
};

// Parse operator ID to extract solo type and tractor
function parseOperatorId(operatorId: string): { soloType: string; tractor: string; contractKey: string } | null {
  // Format: FTIM_MKC_Solo2_Tractor_6_d1
  const match = operatorId.match(/FTIM_MKC_(Solo[12])_(Tractor_\d+)/i);
  if (!match) return null;

  const soloType = match[1];
  const tractor = match[2];
  const contractKey = `${soloType}_${tractor}`;

  return { soloType, tractor, contractKey };
}

export function ImportWizard({ open, onOpenChange, onImport, onPasteImport, currentWeekStart }: ImportWizardProps) {
  const [step, setStep] = useState<"upload" | "identify" | "confirm" | "reconstruct">("upload");
  const [inputMode, setInputMode] = useState<"file" | "paste">("file");
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [parsedBlocks, setParsedBlocks] = useState<ParsedBlock[]>([]);
  const [importType, setImportType] = useState<"new_week" | "actuals" | "unknown">("unknown");

  // Trip-level CSV state
  const [dataFormat, setDataFormat] = useState<DataFormat>("unknown");
  const [tripLevelInfo, setTripLevelInfo] = useState<{ rowCount: number; blockIds: string[] }>({ rowCount: 0, blockIds: [] });
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [reconstructedBlocks, setReconstructedBlocks] = useState<ReconstructedBlock[]>([]);
  const [filteredBlocks, setFilteredBlocks] = useState<ReconstructedBlock[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("");
  const [miloResponse, setMiloResponse] = useState<string>("");

  // Chat state for concierge experience
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [isChatting, setIsChatting] = useState(false);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    message: string;
    created?: number;
    assignments?: number;
    skipped?: number;
    errors?: string[];
  } | null>(null);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track paste events to prevent onChange from overwriting
  const isPastingRef = useRef(false);
  // Accumulated CSV data - use ref to avoid stale closure in handleFileSelect
  const accumulatedCsvRef = useRef<string>("");

  // Calculate week ranges for display
  const thisWeekStart = startOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const thisWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const nextWeekStart = addWeeks(thisWeekStart, 1);
  const nextWeekEnd = addWeeks(thisWeekEnd, 1);
  const lastWeekStart = subWeeks(thisWeekStart, 1);
  const lastWeekEnd = subWeeks(thisWeekEnd, 1);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv')
    );

    if (droppedFiles.length > 0) {
      const newFiles: ImportFile[] = droppedFiles.map(file => ({
        file,
        type: "unknown" as const,
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const newFiles: ImportFile[] = Array.from(selectedFiles).map(file => ({
        file,
        type: "unknown" as const,
      }));
      setFiles(prev => [...prev, ...newFiles]);

      // Collect all CSV content and combine for trip-level detection
      // IMPORTANT: Use ref to get current accumulated value (avoids stale closure)
      let combinedCsvText = accumulatedCsvRef.current;
      let foundTripLevel = false;
      const hasExistingData = combinedCsvText.length > 0;
      console.log('[DEBUG] handleFileSelect - starting with accumulated length:', combinedCsvText.length);
      console.log('[DEBUG] selectedFiles count:', selectedFiles.length);
      console.log('[DEBUG] selectedFiles names:', Array.from(selectedFiles).map(f => f.name));

      for (const file of selectedFiles) {
        console.log('[DEBUG] Processing file:', file.name, 'ends with .csv:', file.name.toLowerCase().endsWith('.csv'));
        if (file.name.toLowerCase().endsWith('.csv')) {
          const text = await file.text();
          const tripDetection = detectTripLevelCSV(text);
          console.log('[DEBUG] File:', file.name, 'tripDetection.isTriplevel:', tripDetection.isTriplevel, 'hasExistingData:', hasExistingData);

          // If we already have trip-level data, append any CSV that has block IDs
          // (more lenient for subsequent files since they're part of the same export)
          const hasBlockIds = /B-[A-Z0-9]{8,}/i.test(text);
          const shouldAppend = tripDetection.isTriplevel || (hasExistingData && hasBlockIds);

          if (shouldAppend) {
            foundTripLevel = true;
            // Append CSV content (skip header if already have data)
            if (hasExistingData || combinedCsvText.length > 0) {
              // Skip the header line of subsequent files
              const lines = text.split('\n');
              const withoutHeader = lines.slice(1).join('\n');
              combinedCsvText = combinedCsvText + '\n' + withoutHeader;
              console.log('[DEBUG] File upload - appending file:', file.name, '(skipped header)');
            } else {
              combinedCsvText = text;
              console.log('[DEBUG] File upload - first file:', file.name, '(with header)');
            }
            console.log('[DEBUG] File upload - combined length:', combinedCsvText.length);
          } else {
            console.log('[DEBUG] File upload - SKIPPED file:', file.name, '(not trip-level and no existing data)');
          }
        }
      }

      // If we found trip-level data, update state with combined text
      if (foundTripLevel) {
        const combinedDetection = detectTripLevelCSV(combinedCsvText);
        console.log('[DEBUG] File upload - TOTAL:', combinedDetection.rowCount, 'rows,', combinedDetection.blockIds.length, 'blocks');
        console.log('[DEBUG] accumulatedCsvRef BEFORE update:', accumulatedCsvRef.current.length);
        // Update BOTH ref and state
        accumulatedCsvRef.current = combinedCsvText;
        console.log('[DEBUG] accumulatedCsvRef AFTER update:', accumulatedCsvRef.current.length);
        setPastedText(combinedCsvText);
        setDataFormat("trip_level");
        setTripLevelInfo({ rowCount: combinedDetection.rowCount, blockIds: combinedDetection.blockIds });
        // Don't switch tabs - keep user on file tab so they can upload more files
        // setInputMode("paste"); // Switch to paste mode to show reconstruction UI
      }
    }

    // Reset file input so the same file can be selected again if needed
    if (e.target) {
      e.target.value = '';
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handlePasteChange = (text: string) => {
    console.log('[DEBUG] handlePasteChange called, text length:', text.length);
    // Keep ref in sync with state for file upload accumulation
    accumulatedCsvRef.current = text;
    setPastedText(text);

    // First check if it's trip-level CSV
    const tripDetection = detectTripLevelCSV(text);
    console.log('[DEBUG] tripDetection:', tripDetection.rowCount, 'rows,', tripDetection.blockIds.length, 'blocks');
    if (tripDetection.isTriplevel) {
      setDataFormat("trip_level");
      setTripLevelInfo({ rowCount: tripDetection.rowCount, blockIds: tripDetection.blockIds });
      setParsedBlocks([]);
      return;
    }

    // Otherwise try block-level parsing
    const blocks = parseBlockData(text);
    if (blocks.length > 0) {
      setDataFormat("block_level");
      setParsedBlocks(blocks);
      setTripLevelInfo({ rowCount: 0, blockIds: [] });
    } else {
      setDataFormat("unknown");
      setParsedBlocks([]);
      setTripLevelInfo({ rowCount: 0, blockIds: [] });
    }
  };

  const handleContinueFromUpload = () => {
    // For trip-level data (from either file upload or paste), go straight to reconstruction
    // since dates are extracted from the CSV itself
    if (dataFormat === "trip_level" && tripLevelInfo.blockIds.length > 0) {
      setStep("reconstruct");
      handleReconstructBlocks();
      return;
    }

    if (inputMode === "file") {
      if (files.length === 0) return;
      setStep("identify");
    } else {
      // For paste mode with block-level data
      if (dataFormat === "block_level" && parsedBlocks.length > 0) {
        setStep("identify");
      }
    }
  };

  // Reconstruct blocks using Gemini API
  const handleReconstructBlocks = async () => {
    setIsReconstructing(true);
    setMiloResponse("Analyzing CSV with Gemini AI...");

    try {
      const response = await fetch("/api/gemini/reconstruct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ csvData: pastedText }),
      });

      const data = await response.json();

      if (data.success && data.blocks) {
        // Build display output from Gemini's response
        let output = `# Block Reconstruction Results\n\nReconstructed ${data.blockCount} blocks using Gemini AI.\n\n`;

        for (const block of data.blocks.slice(0, 20)) {
          output += `───────────────────────────────\n`;
          output += `Block: ${block.blockId}\n`;
          output += `Contract: ${block.contract}\n`;
          output += `Start: ${block.startDate}, ${block.canonicalStartTime} CST\n`;
          output += `Duration: ${block.duration}\n`;
          output += `Cost: $${block.cost?.toFixed(2) || '0.00'}\n`;
          output += `Primary Driver: ${block.primaryDriver}\n`;
          if (block.relayDrivers?.length > 0) {
            output += `Relay Driver(s): ${block.relayDrivers.join(', ')}\n`;
          }
          output += `Loads: ${block.loadCount}\n`;
          output += `Route: ${block.route}\n`;
          output += `───────────────────────────────\n\n`;
        }

        if (data.blockCount > 20) {
          output += `... and ${data.blockCount - 20} more blocks\n`;
        }

        setMiloResponse(output);
        setReconstructedBlocks(data.blocks);
        setFilteredBlocks(data.blocks); // Initially show all blocks
        setActiveFilter(""); // No filter active
      } else {
        setMiloResponse(`Error: ${data.message || "Failed to reconstruct blocks"}\n\n${data.rawResponse || ""}`);
      }
    } catch (error) {
      console.error("Reconstruction error:", error);
      setMiloResponse(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsReconstructing(false);
    }
  };

  // Helper to filter blocks by day of week
  const filterBlocksByDay = (blocks: ReconstructedBlock[], dayName: string): ReconstructedBlock[] => {
    const dayMap: Record<string, number> = {
      sunday: 0, sun: 0,
      monday: 1, mon: 1,
      tuesday: 2, tue: 2, tues: 2,
      wednesday: 3, wed: 3,
      thursday: 4, thu: 4, thur: 4, thurs: 4,
      friday: 5, fri: 5,
      saturday: 6, sat: 6
    };
    const dayNum = dayMap[dayName.toLowerCase()];
    if (dayNum === undefined) return blocks;

    return blocks.filter(block => {
      const date = new Date(block.startDate + 'T00:00:00');
      return date.getDay() === dayNum;
    });
  };

  // Helper to filter blocks by date comparison
  const filterBlocksByDate = (blocks: ReconstructedBlock[], dateStr: string, comparison: 'after' | 'before' | 'on'): ReconstructedBlock[] => {
    const targetDate = new Date(dateStr + 'T00:00:00');
    if (isNaN(targetDate.getTime())) return blocks;

    return blocks.filter(block => {
      const blockDate = new Date(block.startDate + 'T00:00:00');
      if (comparison === 'after') return blockDate >= targetDate;
      if (comparison === 'before') return blockDate <= targetDate;
      return blockDate.getTime() === targetDate.getTime();
    });
  };

  // Helper to filter by contract type
  const filterBlocksByContract = (blocks: ReconstructedBlock[], contractFilter: string): ReconstructedBlock[] => {
    const filter = contractFilter.toLowerCase();
    return blocks.filter(block => block.contract.toLowerCase().includes(filter));
  };

  // Chat with Milo about the reconstruction
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatting) return;

    const userMessage = chatInput.trim();
    const lowerMessage = userMessage.toLowerCase();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsChatting(true);

    try {
      // Check for filter commands first (local processing - fast!)
      const dayMatch = lowerMessage.match(/(?:show|filter|only|just|get)?\s*(?:me\s+)?(?:blocks?\s+)?(?:on|for|from)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)/i);
      const afterMatch = lowerMessage.match(/(?:after|from|starting|since)\s+(\d{4}-\d{2}-\d{2}|nov(?:ember)?\s*\d+|dec(?:ember)?\s*\d+)/i);
      const beforeMatch = lowerMessage.match(/(?:before|until|through|up\s+to)\s+(\d{4}-\d{2}-\d{2}|nov(?:ember)?\s*\d+|dec(?:ember)?\s*\d+)/i);
      const contractMatch = lowerMessage.match(/(?:show|filter|only)?\s*(?:me\s+)?(solo[12]|tractor[_\s]?\d+)/i);
      const clearMatch = lowerMessage.match(/(?:show\s+all|clear\s+filter|reset|all\s+blocks)/i);

      let filtered: ReconstructedBlock[] | null = null;
      let filterDescription = "";

      if (clearMatch) {
        filtered = reconstructedBlocks;
        filterDescription = "Showing all blocks";
        setActiveFilter("");
      } else if (dayMatch) {
        const day = dayMatch[1];
        filtered = filterBlocksByDay(reconstructedBlocks, day);
        filterDescription = `Showing ${filtered.length} blocks starting on ${day}`;
        setActiveFilter(`Day: ${day}`);
      } else if (afterMatch) {
        // Parse date like "Nov 25" or "2025-11-25"
        let dateStr = afterMatch[1];
        if (/nov|dec/i.test(dateStr)) {
          const monthMatch = dateStr.match(/(nov|dec)\w*\s*(\d+)/i);
          if (monthMatch) {
            const month = monthMatch[1].toLowerCase().startsWith('nov') ? '11' : '12';
            const day = monthMatch[2].padStart(2, '0');
            dateStr = `2025-${month}-${day}`;
          }
        }
        filtered = filterBlocksByDate(reconstructedBlocks, dateStr, 'after');
        filterDescription = `Showing ${filtered.length} blocks starting on or after ${dateStr}`;
        setActiveFilter(`After: ${dateStr}`);
      } else if (beforeMatch) {
        let dateStr = beforeMatch[1];
        if (/nov|dec/i.test(dateStr)) {
          const monthMatch = dateStr.match(/(nov|dec)\w*\s*(\d+)/i);
          if (monthMatch) {
            const month = monthMatch[1].toLowerCase().startsWith('nov') ? '11' : '12';
            const day = monthMatch[2].padStart(2, '0');
            dateStr = `2025-${month}-${day}`;
          }
        }
        filtered = filterBlocksByDate(reconstructedBlocks, dateStr, 'before');
        filterDescription = `Showing ${filtered.length} blocks starting on or before ${dateStr}`;
        setActiveFilter(`Before: ${dateStr}`);
      } else if (contractMatch) {
        const contract = contractMatch[1];
        filtered = filterBlocksByContract(reconstructedBlocks, contract);
        filterDescription = `Showing ${filtered.length} blocks matching "${contract}"`;
        setActiveFilter(`Contract: ${contract}`);
      }

      if (filtered !== null) {
        setFilteredBlocks(filtered);
        setChatMessages(prev => [...prev, { role: "assistant", content: filterDescription }]);
        setIsChatting(false);
        return;
      }

      // Fall back to AI for complex questions
      const blocksJson = JSON.stringify(reconstructedBlocks.slice(0, 20)); // Limit for context
      const context = `The user uploaded trip-level CSV data. Here are the reconstructed blocks (JSON):
${blocksJson}

Total blocks: ${reconstructedBlocks.length}
Currently showing: ${filteredBlocks.length} blocks${activeFilter ? ` (filter: ${activeFilter})` : ''}

User question: ${userMessage}

You can help with:
- Filtering: "show Tuesday blocks", "filter to Solo2", "blocks after Nov 25"
- Analysis: "which driver has most blocks?", "total cost?"
- Actions: "import to calendar", "export to CSV"

Answer concisely.`;

      const response = await fetch("/api/neural/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          input: context,
          forceAgent: "architect"
        }),
      });

      const data = await response.json();
      const assistantMessage = data.output || data.response || "I'm not sure how to help with that.";
      setChatMessages(prev => [...prev, { role: "assistant", content: assistantMessage }]);
    } catch (error) {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, I had trouble processing that. Please try again." }]);
    } finally {
      setIsChatting(false);
    }
  };

  // Import reconstructed blocks to calendar
  const handleImportToCalendar = async () => {
    if (filteredBlocks.length === 0) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const response = await fetch("/api/schedules/import-reconstructed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blocks: filteredBlocks }),
      });

      const data = await response.json();

      if (data.success) {
        setImportResult({
          success: true,
          message: data.message,
          created: data.created,
          assignments: data.assignments,
          skipped: data.skipped,
          errors: data.errors,
        });
        // Add success message to chat
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `Successfully imported ${data.created} blocks with ${data.assignments} driver assignments to your calendar!${data.skipped > 0 ? ` (${data.skipped} skipped)` : ''}`
        }]);
      } else {
        setImportResult({
          success: false,
          message: data.message || "Import failed",
          errors: data.errors,
        });
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `Import failed: ${data.message}`
        }]);
      }
    } catch (error) {
      setImportResult({
        success: false,
        message: error instanceof Error ? error.message : "Import failed",
      });
      setChatMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, there was an error importing the blocks. Please try again."
      }]);
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmType = () => {
    if (importType === "unknown") return;

    if (inputMode === "file") {
      // Update all files with the selected type
      const updatedFiles = files.map(f => ({ ...f, type: importType }));
      setFiles(updatedFiles);
    }
    setStep("confirm");
  };

  const handleImport = () => {
    if (inputMode === "file") {
      onImport(files, importType as "new_week" | "actuals" | "both");
    } else {
      // Use paste import handler
      onPasteImport?.(parsedBlocks, importType as "new_week" | "actuals");
    }
    handleClose();
  };

  const handleClose = () => {
    setStep("upload");
    setInputMode("file");
    setFiles([]);
    // Reset both ref and state
    accumulatedCsvRef.current = "";
    setPastedText("");
    setParsedBlocks([]);
    setImportType("unknown");
    setDataFormat("unknown");
    setTripLevelInfo({ rowCount: 0, blockIds: [] });
    setIsReconstructing(false);
    setReconstructedBlocks([]);
    setFilteredBlocks([]);
    setActiveFilter("");
    setMiloResponse("");
    setChatMessages([]);
    setChatInput("");
    setIsImporting(false);
    setImportResult(null);
    onOpenChange(false);
  };

  const getBlockTypeBadge = (type: string) => {
    switch (type) {
      case "solo2":
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400">Solo2</span>;
      case "solo1":
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">Solo1</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">Team</span>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {step === "upload" && "Import Schedule Data"}
            {step === "identify" && "What are you importing?"}
            {step === "confirm" && "Confirm Import"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload Files or Paste Data */}
        {step === "upload" && (
          <div className="space-y-4">
            {/* Milo's greeting */}
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground mb-1">Hi! I'm Milo.</p>
                  <p className="text-muted-foreground">
                    {inputMode === "file"
                      ? "Drop your Amazon schedule file(s) below, or paste block data directly."
                      : "Paste your Amazon block data below. I'll parse the block IDs, times, and driver assignments."}
                  </p>
                </div>
              </div>
            </div>

            {/* Tabs for File Upload vs Paste */}
            <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as "file" | "paste")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="file" className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Upload File
                </TabsTrigger>
                <TabsTrigger value="paste" className="flex items-center gap-2">
                  <ClipboardPaste className="w-4 h-4" />
                  Paste Data
                </TabsTrigger>
              </TabsList>

              <TabsContent value="file" className="space-y-4 mt-4">
                {/* Drop zone - using label for better click handling */}
                <label
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  className="border-2 border-dashed border-primary rounded-lg p-8 text-center bg-primary hover:bg-primary/90 transition-all cursor-pointer block"
                >
                  <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
                    <Upload className="w-7 h-7 text-white" />
                  </div>
                  <p className="text-base font-semibold text-white mb-2">
                    Drag & drop files here, or click to browse
                  </p>
                  <p className="text-sm text-white/80">
                    Supports .xlsx, .xls, .csv
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>

                {/* File list */}
                {files.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Selected Files:</Label>
                    {files.map((f, index) => (
                      <div key={index} className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-green-600" />
                          <span className="text-sm truncate max-w-[250px]">{f.file.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          className="h-6 w-6 p-0"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Trip-level CSV detected from file upload */}
                {dataFormat === "trip_level" && tripLevelInfo.blockIds.length > 0 && (
                  <div className="space-y-2">
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                      <Label className="text-sm font-medium flex items-center gap-2 text-purple-400">
                        <Brain className="w-4 h-4" />
                        Trip-Level CSV Detected
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Found {tripLevelInfo.rowCount} load rows across {tripLevelInfo.blockIds.length} unique block{tripLevelInfo.blockIds.length !== 1 ? 's' : ''}.
                        Milo will reconstruct these into calendar-ready blocks.
                      </p>
                    </div>
                    <div className="max-h-[100px] overflow-y-auto space-y-1 pr-2">
                      {tripLevelInfo.blockIds.slice(0, 10).map((blockId, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm bg-muted/30 rounded px-2 py-1">
                          <FileText className="w-3 h-3 text-purple-400" />
                          <span className="font-mono text-xs">{blockId}</span>
                        </div>
                      ))}
                      {tripLevelInfo.blockIds.length > 10 && (
                        <p className="text-xs text-muted-foreground">
                          +{tripLevelInfo.blockIds.length - 10} more blocks...
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="paste" className="space-y-4 mt-4">
                {/* Paste text area with append on paste */}
                <Textarea
                  placeholder="Paste Amazon block data or trip-level CSV here... (paste multiple times to combine)"
                  value={pastedText}
                  onChange={(e) => {
                    // Skip if we just handled a paste event
                    if (isPastingRef.current) {
                      isPastingRef.current = false;
                      return;
                    }
                    // Only handle manual typing
                    handlePasteChange(e.target.value);
                  }}
                  onPaste={(e) => {
                    // Append pasted content instead of replacing
                    e.preventDefault();
                    isPastingRef.current = true;
                    const clipboardData = e.clipboardData.getData('text');
                    console.log('[DEBUG] Upload paste - current length:', pastedText.length, 'new clipboard length:', clipboardData.length);
                    const newText = pastedText ? pastedText + '\n' + clipboardData : clipboardData;
                    console.log('[DEBUG] Upload paste - combined length:', newText.length);
                    handlePasteChange(newText);
                  }}
                  className="min-h-[200px] font-mono text-sm bg-muted/30"
                />
                {pastedText && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { accumulatedCsvRef.current = ''; setPastedText(''); setDataFormat('unknown'); setTripLevelInfo({ rowCount: 0, blockIds: [] }); }}
                      className="text-xs text-muted-foreground"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear all
                    </Button>
                  </div>
                )}

                {/* Trip-level CSV detected */}
                {dataFormat === "trip_level" && tripLevelInfo.blockIds.length > 0 && (
                  <div className="space-y-2">
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                      <Label className="text-sm font-medium flex items-center gap-2 text-purple-400">
                        <Brain className="w-4 h-4" />
                        Trip-Level CSV Detected
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Found {tripLevelInfo.rowCount} load rows across {tripLevelInfo.blockIds.length} unique block{tripLevelInfo.blockIds.length !== 1 ? 's' : ''}.
                        Milo will reconstruct these into calendar-ready blocks.
                      </p>
                    </div>
                    <div className="max-h-[100px] overflow-y-auto space-y-1 pr-2">
                      {tripLevelInfo.blockIds.slice(0, 10).map((blockId, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm bg-muted/30 rounded px-2 py-1">
                          <FileText className="w-3 h-3 text-purple-400" />
                          <span className="font-mono text-xs">{blockId}</span>
                        </div>
                      ))}
                      {tripLevelInfo.blockIds.length > 10 && (
                        <p className="text-xs text-muted-foreground">
                          +{tripLevelInfo.blockIds.length - 10} more blocks...
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Block-level parsed preview */}
                {dataFormat === "block_level" && parsedBlocks.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      Parsed {parsedBlocks.length} block{parsedBlocks.length !== 1 ? 's' : ''}:
                    </Label>
                    <div className="max-h-[150px] overflow-y-auto space-y-2 pr-2">
                      {parsedBlocks.map((block, index) => (
                        <div key={index} className="flex items-center justify-between bg-muted/50 rounded-lg p-3 text-sm">
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-primary" />
                            <div>
                              <span className="font-mono font-medium">{block.blockId}</span>
                              {block.startTime && (
                                <span className="text-muted-foreground ml-2">
                                  {format(block.startTime, "EEE MMM d, h:mm a")}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {getBlockTypeBadge(block.blockType)}
                            {block.driverName && (
                              <span className="text-xs text-muted-foreground">{block.driverName}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleContinueFromUpload}
                disabled={
                  inputMode === "file"
                    ? files.length === 0
                    : (dataFormat === "block_level" ? parsedBlocks.length === 0 : dataFormat !== "trip_level")
                }
              >
                {dataFormat === "trip_level" ? (
                  <>
                    <Brain className="w-4 h-4 mr-1" />
                    Reconstruct Blocks
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Identify Import Type */}
        {step === "identify" && (
          <div className="space-y-4">
            {/* Milo asks */}
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="text-sm">
                  <p className="text-muted-foreground">
                    {inputMode === "file"
                      ? <>I see you're uploading <strong>{files.length} file{files.length > 1 ? 's' : ''}</strong>. Which type of import is this?</>
                      : <>I found <strong>{parsedBlocks.length} block{parsedBlocks.length !== 1 ? 's' : ''}</strong> in your pasted data. Which type of import is this?</>
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Import type selection */}
            <RadioGroup
              value={importType}
              onValueChange={(value) => setImportType(value as typeof importType)}
              className="space-y-3"
            >
              {/* New Week Option */}
              <div className={`relative flex items-start space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                importType === "new_week" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}>
                <RadioGroupItem value="new_week" id="new_week" className="mt-1" />
                <Label htmlFor="new_week" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-4 h-4 text-blue-500" />
                    <span className="font-medium">New Work Week</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Upcoming assignments: {format(nextWeekStart, "MMM d")} - {format(nextWeekEnd, "MMM d, yyyy")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This will create new shifts and auto-assign drivers based on patterns.
                  </p>
                </Label>
              </div>

              {/* Actuals Option */}
              <div className={`relative flex items-start space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                importType === "actuals" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}>
                <RadioGroupItem value="actuals" id="actuals" className="mt-1" />
                <Label htmlFor="actuals" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <History className="w-4 h-4 text-amber-500" />
                    <span className="font-medium">Last Week's Actuals</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Ground truth: {format(lastWeekStart, "MMM d")} - {format(lastWeekEnd, "MMM d, yyyy")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Updates records with what actually happened (no-shows, swaps, etc.)
                  </p>
                </Label>
              </div>
            </RadioGroup>

            {/* Warning for actuals */}
            {importType === "actuals" && (
              <Alert className="border-amber-500/50 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-sm">
                  Importing actuals will compare against existing records and may overwrite data.
                  You can undo this action after import.
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={handleConfirmType}
                disabled={importType === "unknown"}
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === "confirm" && (
          <div className="space-y-4">
            {/* Milo summary */}
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground mb-1">Ready to import!</p>
                  <p className="text-muted-foreground">
                    {importType === "new_week"
                      ? "I'll process this data and auto-assign drivers based on historical patterns. After import, click 'Analyze Now' to review assignments."
                      : "I'll compare this against your existing records and show you any differences. You can review changes before confirming."}
                  </p>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {inputMode === "file" ? "Files to import:" : "Blocks to import:"}
                </span>
                <span className="text-sm font-medium">
                  {inputMode === "file" ? files.length : parsedBlocks.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Import type:</span>
                <span className="text-sm font-medium">
                  {importType === "new_week" ? "New Work Week" : "Last Week's Actuals"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Week:</span>
                <span className="text-sm font-medium">
                  {importType === "new_week"
                    ? `${format(nextWeekStart, "MMM d")} - ${format(nextWeekEnd, "MMM d")}`
                    : `${format(lastWeekStart, "MMM d")} - ${format(lastWeekEnd, "MMM d")}`}
                </span>
              </div>
              {inputMode === "paste" && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Solo2 blocks:</span>
                    <span className="text-sm font-medium">{parsedBlocks.filter(b => b.blockType === "solo2").length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Solo1 blocks:</span>
                    <span className="text-sm font-medium">{parsedBlocks.filter(b => b.blockType === "solo1").length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">With driver assigned:</span>
                    <span className="text-sm font-medium">{parsedBlocks.filter(b => b.driverName).length}</span>
                  </div>
                </>
              )}
            </div>

            {/* File/Block list */}
            <div className="space-y-2 max-h-[150px] overflow-y-auto">
              {inputMode === "file" ? (
                files.map((f, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <FileSpreadsheet className="w-4 h-4 text-green-600" />
                    <span className="truncate">{f.file.name}</span>
                  </div>
                ))
              ) : (
                parsedBlocks.map((block, index) => (
                  <div key={index} className="flex items-center justify-between text-sm bg-muted/30 rounded p-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="font-mono">{block.blockId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {getBlockTypeBadge(block.blockType)}
                      <span className="text-muted-foreground">
                        {block.driverName || "Unassigned"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep("identify")}>
                Back
              </Button>
              <Button onClick={handleImport}>
                <Upload className="w-4 h-4 mr-2" />
                Import {inputMode === "file"
                  ? (files.length > 1 ? "Files" : "File")
                  : `${parsedBlocks.length} Block${parsedBlocks.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Block Reconstruction (Trip-Level CSV) */}
        {step === "reconstruct" && (
          <div className="space-y-4">
            {/* Milo thinking/response */}
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  {isReconstructing ? (
                    <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4 text-purple-400" />
                  )}
                </div>
                <div className="text-sm flex-1">
                  <p className="font-medium text-purple-300 mb-1">
                    {isReconstructing ? "Milo is analyzing..." : "Block Reconstruction Complete"}
                  </p>
                  {isReconstructing ? (
                    <p className="text-muted-foreground">
                      Parsing {tripLevelInfo.rowCount} loads across {tripLevelInfo.blockIds.length} blocks.
                      Looking up canonical start times and driver assignments...
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      Reconstructed {tripLevelInfo.blockIds.length} blocks with canonical start times and driver assignments.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Add More Data - collapsible paste area */}
            {!isReconstructing && reconstructedBlocks.length > 0 && (
              <div className="border border-dashed border-muted-foreground/30 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Paste additional CSV data here to combine with existing data:
                </p>
                <Textarea
                  placeholder="Paste more CSV data here..."
                  className="min-h-[60px] font-mono text-xs bg-muted/20 mb-2"
                  onPaste={(e) => {
                    e.preventDefault();
                    const clipboardData = e.clipboardData.getData('text');
                    console.log('[DEBUG] Reconstruct step paste - clipboard length:', clipboardData.length);
                    console.log('[DEBUG] Current pastedText length:', pastedText.length);
                    const newText = pastedText + '\n' + clipboardData;
                    console.log('[DEBUG] Combined text length:', newText.length);
                    handlePasteChange(newText);
                    // Clear the textarea after paste (data is in pastedText state)
                    (e.target as HTMLTextAreaElement).value = '';
                  }}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Total data: {tripLevelInfo.rowCount} rows, {tripLevelInfo.blockIds.length} blocks
                  </p>
                  <Button size="sm" variant="outline" onClick={handleReconstructBlocks}>
                    <Brain className="w-3 h-3 mr-1" />
                    Re-analyze All
                  </Button>
                </div>
              </div>
            )}

            {/* Milo's Response - Dynamic Block Display */}
            {filteredBlocks.length > 0 && !isReconstructing && (
              <div className="space-y-2">
                {/* Filter indicator */}
                {activeFilter && (
                  <div className="flex items-center justify-between bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-2">
                    <span className="text-sm text-purple-400">
                      Filter: {activeFilter} ({filteredBlocks.length} of {reconstructedBlocks.length} blocks)
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setFilteredBlocks(reconstructedBlocks); setActiveFilter(""); }}
                      className="h-6 text-xs"
                    >
                      Clear filter
                    </Button>
                  </div>
                )}
                <ScrollArea className="h-[220px] rounded-lg border bg-muted/30 p-4">
                  <div className="space-y-3">
                    {filteredBlocks.slice(0, 20).map((block, index) => (
                      <div key={index} className="border-b border-border/50 pb-3 last:border-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-sm font-medium">{block.blockId}</span>
                          <span className="text-xs text-muted-foreground">{block.contract}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                          <span>Start: {block.startDate}, {block.canonicalStartTime}</span>
                          <span>Duration: {block.duration}</span>
                          <span>Driver: {block.primaryDriver}</span>
                          <span>Cost: ${block.cost?.toFixed(2) || '0.00'}</span>
                        </div>
                        {block.relayDrivers?.length > 0 && (
                          <div className="text-xs text-amber-500 mt-1">
                            Relay: {block.relayDrivers.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {filteredBlocks.length > 20 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">
                        ... and {filteredBlocks.length - 20} more blocks
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Loading state */}
            {isReconstructing && (
              <div className="flex items-center justify-center py-8">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Milo is thinking...
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    Analyzing {tripLevelInfo.rowCount} rows across {tripLevelInfo.blockIds.length} blocks
                  </p>
                </div>
              </div>
            )}

            {/* Chat Messages */}
            {chatMessages.length > 0 && (
              <div className="space-y-2 max-h-[120px] overflow-y-auto">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-3 h-3 text-purple-400" />
                      </div>
                    )}
                    <div className={`rounded-lg px-3 py-2 text-sm max-w-[80%] ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isChatting && (
                  <div className="flex gap-2 justify-start">
                    <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                      <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />
                    </div>
                    <div className="rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground">
                      Thinking...
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Chat Input - Concierge */}
            {!isReconstructing && reconstructedBlocks.length > 0 && !importResult?.success && (
              <form onSubmit={handleChatSubmit} className="flex gap-2">
                <div className="flex-1 relative">
                  <MessageCircle className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Try: 'show Tuesday blocks' or 'filter to Solo2' or 'after Nov 25'"
                    className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    disabled={isChatting || isImporting}
                  />
                </div>
                <Button type="submit" size="sm" disabled={isChatting || isImporting || !chatInput.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            )}

            {/* Import Result */}
            {importResult && (
              <div className={`rounded-lg p-3 ${importResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                <div className="flex items-center gap-2 mb-1">
                  {importResult.success ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${importResult.success ? 'text-green-500' : 'text-red-500'}`}>
                    {importResult.success ? 'Import Successful!' : 'Import Failed'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{importResult.message}</p>
                {importResult.success && (
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                    <div className="bg-background/50 rounded p-2 text-center">
                      <span className="block font-bold text-green-500">{importResult.created}</span>
                      <span className="text-muted-foreground">Created</span>
                    </div>
                    <div className="bg-background/50 rounded p-2 text-center">
                      <span className="block font-bold text-blue-500">{importResult.assignments}</span>
                      <span className="text-muted-foreground">Assigned</span>
                    </div>
                    <div className="bg-background/50 rounded p-2 text-center">
                      <span className="block font-bold text-amber-500">{importResult.skipped}</span>
                      <span className="text-muted-foreground">Skipped</span>
                    </div>
                  </div>
                )}
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="mt-2 text-xs text-red-400 max-h-20 overflow-y-auto">
                    {importResult.errors.slice(0, 5).map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                    {importResult.errors.length > 5 && (
                      <p>...and {importResult.errors.length - 5} more errors</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep("upload")} disabled={isImporting}>
                Back
              </Button>
              <div className="flex gap-2">
                {!isReconstructing && reconstructedBlocks.length > 0 && !importResult?.success && (
                  <>
                    <Button variant="outline" onClick={handleReconstructBlocks} disabled={isImporting}>
                      <Brain className="w-4 h-4 mr-2" />
                      Re-analyze
                    </Button>
                    <Button
                      onClick={handleImportToCalendar}
                      disabled={isImporting || filteredBlocks.length === 0}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {isImporting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Calendar className="w-4 h-4 mr-2" />
                          Import {filteredBlocks.length} Blocks
                        </>
                      )}
                    </Button>
                  </>
                )}
                {importResult?.success && (
                  <Button onClick={handleClose}>
                    <Check className="w-4 h-4 mr-2" />
                    Done
                  </Button>
                )}
                {!reconstructedBlocks.length && !isReconstructing && (
                  <Button onClick={handleClose}>
                    Close
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Export the ParsedBlock type for use in other components
export type { ParsedBlock };
