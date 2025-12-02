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
import { ExecutiveReport, generateReportData, type ExecutiveReportData, type ScheduleBlock } from "./ExecutiveReport";

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
  hasRejectedTrip: boolean; // true if ANY trip in block has Trip Stage = "Rejected" → RED on calendar
}

// Detected data format type
type DataFormat = "block_level" | "trip_level" | "unknown";

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (files: ImportFile[], importType: "new_week" | "actuals" | "both") => void;
  onPasteImport?: (blocks: ParsedBlock[], importType: "new_week" | "actuals") => void;
  onImportComplete?: (dominantWeekStart?: Date) => void; // Called after successful import to refresh calendar and navigate to imported week
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

  // Extract unique block IDs first (B- prefix only, not T- trips)
  // Block IDs are B- followed by 8 or more alphanumeric characters (e.g., B-Q5B44Z199)
  const blockIdMatches = (text.match(/B-[A-Z0-9]{8,}/gi) || []).map(id => id.toUpperCase());
  const blockIds = [...new Set(blockIdMatches)];

  // Check for trip-level indicators
  const hasBlockIds = blockIds.length > 0;
  const hasOperatorIdPattern = /FTIM_MKC_Solo[12]/i.test(text);

  // Simple detection: if we have Block IDs AND Operator IDs, it's trip-level
  const isTriplevel = hasBlockIds && hasOperatorIdPattern;

  // Count data rows (excluding header)
  const rowCount = lines.length - 1;

  // Debug: log detection results
  console.log('[CSV Detection] hasBlockIds:', hasBlockIds, 'hasOperatorIdPattern:', hasOperatorIdPattern, 'isTriplevel:', isTriplevel);
  console.log('[CSV Detection] Unique block IDs found:', blockIds.length, blockIds.slice(0, 5), blockIds.length > 5 ? '...' : '');

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

export function ImportWizard({ open, onOpenChange, onImport, onPasteImport, onImportComplete, currentWeekStart }: ImportWizardProps) {
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
    replaced?: number;
    totalProcessed?: number;
    assignments?: number;
    skipped?: number;
    rejectedLoads?: number; // Trip Stage = "Rejected" (RED on calendar)
    unassignedBlocks?: number; // No driver, not rejected (YELLOW on calendar)
    unmatchedDrivers?: number;
    errors?: string[];
  } | null>(null);

  // Executive Report state
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState<ExecutiveReportData | null>(null);


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

  // Chat with Milo about the reconstruction - AI-first natural language processing
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatting) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsChatting(true);

    try {
      // Get unique dates and contracts for context
      const uniqueDates = [...new Set(reconstructedBlocks.map(b => b.startDate))].sort();
      const uniqueContracts = [...new Set(reconstructedBlocks.map(b => b.contract))];
      const uniqueDrivers = [...new Set(reconstructedBlocks.map(b => b.primaryDriver).filter(Boolean))];

      // Infer year from data
      const years = [...new Set(reconstructedBlocks.map(b => b.startDate.slice(0, 4)))];
      const dataYear = years.length > 0 ? years[0] : new Date().getFullYear().toString();

      // Build AI prompt that returns structured JSON for filter actions
      const prompt = `You are Milo, an AI assistant helping filter schedule blocks before import.

AVAILABLE BLOCKS DATA:
- Total blocks: ${reconstructedBlocks.length}
- Date range: ${uniqueDates[0] || 'N/A'} to ${uniqueDates[uniqueDates.length - 1] || 'N/A'}
- Unique dates: ${uniqueDates.join(', ')}
- Contracts: ${uniqueContracts.join(', ')}
- Drivers: ${uniqueDrivers.slice(0, 10).join(', ')}${uniqueDrivers.length > 10 ? ` (+${uniqueDrivers.length - 10} more)` : ''}
- Year context: ${dataYear}

USER REQUEST: "${userMessage}"

IMPORTANT: You MUST respond with valid JSON in this exact format:
{
  "action": "filter" | "clear" | "info",
  "filterType": "date" | "dateRange" | "dayOfWeek" | "contract" | "driver" | null,
  "filterValue": "<the filter value>" | null,
  "comparison": "on" | "after" | "before" | null,
  "message": "<friendly response to user>"
}

FILTER EXAMPLES:
- "only Dec 1" → {"action":"filter","filterType":"date","filterValue":"2025-12-01","comparison":"on","message":"Filtering to December 1st only"}
- "starting Dec 30" → {"action":"filter","filterType":"date","filterValue":"2025-12-30","comparison":"after","message":"Showing blocks starting December 30th and later"}
- "show Tuesday" → {"action":"filter","filterType":"dayOfWeek","filterValue":"tuesday","comparison":null,"message":"Showing Tuesday blocks"}
- "Solo2 only" → {"action":"filter","filterType":"contract","filterValue":"Solo2","comparison":null,"message":"Filtering to Solo2 contracts"}
- "show all" → {"action":"clear","filterType":null,"filterValue":null,"comparison":null,"message":"Showing all blocks"}
- "how many blocks?" → {"action":"info","filterType":null,"filterValue":null,"comparison":null,"message":"You have ${reconstructedBlocks.length} blocks total"}

DATE FORMAT: Always use YYYY-MM-DD format for filterValue when filterType is "date". Use the year ${dataYear} for dates.

Respond ONLY with the JSON object, no other text.`;

      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: prompt,
          context: "import-filter"
        }),
      });

      const data = await response.json();
      const aiResponse = data.response || data.output || data.message || '';

      // Parse AI response as JSON
      let parsed: {
        action: 'filter' | 'clear' | 'info';
        filterType: 'date' | 'dateRange' | 'dayOfWeek' | 'contract' | 'driver' | null;
        filterValue: string | null;
        comparison: 'on' | 'after' | 'before' | null;
        message: string;
      } | null = null;

      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('[Milo] Failed to parse AI response as JSON:', aiResponse);
      }

      if (parsed) {
        // Apply the filter based on AI's structured response
        let filtered: ReconstructedBlock[] | null = null;

        if (parsed.action === 'clear') {
          filtered = reconstructedBlocks;
          setActiveFilter("");
        } else if (parsed.action === 'filter' && parsed.filterType) {
          switch (parsed.filterType) {
            case 'date':
              if (parsed.filterValue && parsed.comparison) {
                filtered = filterBlocksByDate(reconstructedBlocks, parsed.filterValue, parsed.comparison);
                setActiveFilter(`${parsed.comparison === 'on' ? 'On' : parsed.comparison === 'after' ? 'After' : 'Before'}: ${parsed.filterValue}`);
              }
              break;
            case 'dayOfWeek':
              if (parsed.filterValue) {
                filtered = filterBlocksByDay(reconstructedBlocks, parsed.filterValue);
                setActiveFilter(`Day: ${parsed.filterValue}`);
              }
              break;
            case 'contract':
              if (parsed.filterValue) {
                filtered = filterBlocksByContract(reconstructedBlocks, parsed.filterValue);
                setActiveFilter(`Contract: ${parsed.filterValue}`);
              }
              break;
            case 'driver':
              if (parsed.filterValue) {
                const driverFilter = parsed.filterValue.toLowerCase();
                filtered = reconstructedBlocks.filter(b =>
                  b.primaryDriver.toLowerCase().includes(driverFilter)
                );
                setActiveFilter(`Driver: ${parsed.filterValue}`);
              }
              break;
          }
        }

        if (filtered !== null) {
          setFilteredBlocks(filtered);
          const countMsg = parsed.action === 'clear'
            ? `${parsed.message} (${filtered.length} blocks)`
            : `${parsed.message} - ${filtered.length} block${filtered.length !== 1 ? 's' : ''} found`;
          setChatMessages(prev => [...prev, { role: "assistant", content: countMsg }]);
        } else {
          // Info action or no filter applied
          setChatMessages(prev => [...prev, { role: "assistant", content: parsed.message }]);
        }
      } else {
        // Couldn't parse - show raw response
        setChatMessages(prev => [...prev, { role: "assistant", content: aiResponse || "I'm not sure how to help with that. Try: 'only Dec 1' or 'show Tuesday' or 'filter Solo2'" }]);
      }
    } catch (error) {
      console.error('[Milo] Chat error:', error);
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, I had trouble processing that. Please try again." }]);
    } finally {
      setIsChatting(false);
    }
  };

  // Generate Executive Report from imported blocks
  const handleGenerateReport = () => {
    if (filteredBlocks.length === 0) return;

    // Convert reconstructed blocks to ScheduleBlock format
    const scheduleBlocks: ScheduleBlock[] = filteredBlocks.map(block => ({
      blockId: block.blockId,
      startDate: block.startDate,
      startTime: block.canonicalStartTime,
      driverName: block.primaryDriver,
      blockType: block.contract.toLowerCase().includes("solo2") ? "solo2" : "solo1",
      contract: block.contract,
      duration: block.duration,
      cost: block.cost,
    }));

    // Find the dominant week (week with most blocks)
    const weekStart = getDominantWeekStart(filteredBlocks);

    // Generate report data
    const data = generateReportData(scheduleBlocks, weekStart);
    setReportData(data);
    setShowReport(true);
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
          replaced: data.replaced,
          totalProcessed: data.totalProcessed,
          assignments: data.assignments,
          skipped: data.skipped,
          rejectedLoads: data.rejectedLoads,
          unassignedBlocks: data.unassignedBlocks,
          unmatchedDrivers: data.unmatchedDrivers,
          errors: data.errors,
        });
        // Add success message to chat
        const totalBlocks = data.created || 0;
        const replaceInfo = data.replaced > 0 ? ` (${data.replaced} replaced existing)` : '';
        const rejectedInfo = data.rejectedLoads > 0 ? ` ${data.rejectedLoads} rejected loads (RED).` : '';
        const unassignedInfo = data.unassignedBlocks > 0 ? ` ${data.unassignedBlocks} need driver assignment (YELLOW).` : '';
        const unmatchedInfo = data.unmatchedDrivers > 0 ? ` ${data.unmatchedDrivers} unassigned (driver not in system).` : '';
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: `Successfully imported ${totalBlocks} blocks${replaceInfo} with ${data.assignments} driver assignments to your calendar!${data.skipped > 0 ? ` (${data.skipped} skipped)` : ''}${rejectedInfo}${unassignedInfo}${unmatchedInfo}`
        }]);
        // Notify parent to refresh calendar data and navigate to the dominant imported week
        const dominantWeek = getDominantWeekStart(filteredBlocks);
        onImportComplete?.(dominantWeek);
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
    setShowReport(false);
    setReportData(null);
    onOpenChange(false);
  };

  const getBlockTypeBadge = (type: string) => {
    switch (type) {
      case "solo2":
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">Solo2</span>;
      case "solo1":
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">Solo1</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-600">Team</span>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl bg-white shadow-xl p-6 border-0">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            {step === "upload" && "Import Schedule Data"}
            {step === "identify" && "What are you importing?"}
            {step === "confirm" && "Confirm Import"}
            {step === "reconstruct" && "Block Reconstruction"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload Files or Paste Data */}
        {step === "upload" && (
          <div className="space-y-4">
            {/* Milo's greeting */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-sm">
                <p className="font-medium text-gray-900 mb-1">Hi! I'm Milo.</p>
                <p className="text-gray-600 leading-relaxed">
                  {inputMode === "file"
                    ? "Drop your Amazon schedule file(s) below, or paste block data directly."
                    : "Paste your Amazon block data below. I'll parse the block IDs, times, and driver assignments."}
                </p>
              </div>
            </div>

            {/* Tabs for File Upload vs Paste */}
            <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as "file" | "paste")}>
              <TabsList className="grid w-full grid-cols-2 h-10 bg-gray-100 rounded-lg p-1">
                <TabsTrigger
                  value="file"
                  className="flex items-center gap-2 rounded-md text-gray-700 data-[state=active]:bg-blue-500 data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  <Upload className="w-4 h-4" />
                  Upload File
                </TabsTrigger>
                <TabsTrigger
                  value="paste"
                  className="flex items-center gap-2 rounded-md text-gray-700 data-[state=active]:bg-blue-500 data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  Paste Data
                </TabsTrigger>
              </TabsList>

              <TabsContent value="file" className="space-y-4 mt-4">
                {/* Drop zone - using label for better click handling */}
                <label
                  htmlFor="file-upload-input"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  className="border-2 border-gray-300 p-8 text-center bg-gray-50 hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer block"
                >
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                    <Upload className="w-7 h-7 text-blue-600" />
                  </div>
                  <p className="text-base font-semibold text-gray-900 mb-2">
                    Drag & drop files here, or click to browse
                  </p>
                  <p className="text-sm text-gray-500">
                    Supports .xlsx, .xls, .csv
                  </p>
                  <input
                    id="file-upload-input"
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
                    <Label className="text-sm font-medium text-gray-700">Selected Files:</Label>
                    {files.map((f, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 border border-gray-200 p-3">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                          <span className="text-sm text-gray-900 truncate max-w-[250px]">{f.file.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          className="h-6 w-6 p-0 text-gray-500 hover:text-gray-700"
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
                    <div className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 p-3">
                      <Label className="text-sm font-medium flex items-center gap-2 text-gray-700">
                        <Brain className="w-4 h-4 text-blue-600" />
                        Trip-Level CSV Detected
                      </Label>
                      <p className="text-xs text-gray-600 mt-1">
                        Found {tripLevelInfo.rowCount} load rows across {tripLevelInfo.blockIds.length} unique block{tripLevelInfo.blockIds.length !== 1 ? 's' : ''}.
                        Milo will reconstruct these into calendar-ready blocks.
                      </p>
                    </div>
                    <div className="max-h-[100px] overflow-y-auto space-y-1 pr-2">
                      {tripLevelInfo.blockIds.slice(0, 10).map((blockId, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm bg-gray-50 border border-gray-100 px-2 py-1">
                          <FileText className="w-3 h-3 text-blue-600" />
                          <span className="font-mono text-xs text-gray-700">{blockId}</span>
                        </div>
                      ))}
                      {tripLevelInfo.blockIds.length > 10 && (
                        <p className="text-xs text-gray-500">
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
                  className="min-h-[200px] font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400"
                />
                {pastedText && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { accumulatedCsvRef.current = ''; setPastedText(''); setDataFormat('unknown'); setTripLevelInfo({ rowCount: 0, blockIds: [] }); }}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear all
                    </Button>
                  </div>
                )}

                {/* Trip-level CSV detected */}
                {dataFormat === "trip_level" && tripLevelInfo.blockIds.length > 0 && (
                  <div className="space-y-2">
                    <div className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 p-3">
                      <Label className="text-sm font-medium flex items-center gap-2 text-gray-700">
                        <Brain className="w-4 h-4 text-blue-600" />
                        Trip-Level CSV Detected
                      </Label>
                      <p className="text-xs text-gray-600 mt-1">
                        Found {tripLevelInfo.rowCount} load rows across {tripLevelInfo.blockIds.length} unique block{tripLevelInfo.blockIds.length !== 1 ? 's' : ''}.
                        Milo will reconstruct these into calendar-ready blocks.
                      </p>
                    </div>
                    <div className="max-h-[100px] overflow-y-auto space-y-1 pr-2">
                      {tripLevelInfo.blockIds.slice(0, 10).map((blockId, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm bg-gray-50 border border-gray-100 px-2 py-1">
                          <FileText className="w-3 h-3 text-blue-600" />
                          <span className="font-mono text-xs text-gray-700">{blockId}</span>
                        </div>
                      ))}
                      {tripLevelInfo.blockIds.length > 10 && (
                        <p className="text-xs text-gray-500">
                          +{tripLevelInfo.blockIds.length - 10} more blocks...
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Block-level parsed preview */}
                {dataFormat === "block_level" && parsedBlocks.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2 text-gray-700">
                      <Check className="w-4 h-4 text-blue-600" />
                      Parsed {parsedBlocks.length} block{parsedBlocks.length !== 1 ? 's' : ''}:
                    </Label>
                    <div className="max-h-[150px] overflow-y-auto space-y-2 pr-2">
                      {parsedBlocks.map((block, index) => (
                        <div key={index} className="flex items-center justify-between bg-gray-50 border border-gray-200 p-3 text-sm">
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-blue-600" />
                            <div>
                              <span className="font-mono font-medium text-gray-900">{block.blockId}</span>
                              {block.startTime && (
                                <span className="text-gray-500 ml-2">
                                  {format(block.startTime, "EEE MMM d, h:mm a")}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {getBlockTypeBadge(block.blockType)}
                            {block.driverName && (
                              <span className="text-xs text-gray-500">{block.driverName}</span>
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
            <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-gray-100">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleContinueFromUpload}
                disabled={
                  inputMode === "file"
                    ? files.length === 0
                    : (dataFormat === "block_level" ? parsedBlocks.length === 0 : dataFormat !== "trip_level")
                }
                className="px-4 py-2 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                {dataFormat === "trip_level" ? (
                  <>
                    <Brain className="w-4 h-4" />
                    Reconstruct Blocks
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Identify Import Type */}
        {step === "identify" && (
          <div className="space-y-4">
            {/* Milo asks */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-sm">
                  <p className="text-gray-700">
                    {inputMode === "file"
                      ? <>I see you're uploading <strong className="text-gray-900">{files.length} file{files.length > 1 ? 's' : ''}</strong>. Which type of import is this?</>
                      : <>I found <strong className="text-gray-900">{parsedBlocks.length} block{parsedBlocks.length !== 1 ? 's' : ''}</strong> in your pasted data. Which type of import is this?</>
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
                importType === "new_week" ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300"
              }`}>
                <RadioGroupItem value="new_week" id="new_week" className="mt-1" />
                <Label htmlFor="new_week" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-4 h-4 text-blue-600" />
                    <span className="font-medium text-gray-900">New Work Week</span>
                  </div>
                  <p className="text-sm text-gray-600">
                    Upcoming assignments: {format(nextWeekStart, "MMM d")} - {format(nextWeekEnd, "MMM d, yyyy")}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    This will create new shifts and auto-assign drivers based on patterns.
                  </p>
                </Label>
              </div>

              {/* Actuals Option */}
              <div className={`relative flex items-start space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                importType === "actuals" ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300"
              }`}>
                <RadioGroupItem value="actuals" id="actuals" className="mt-1" />
                <Label htmlFor="actuals" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <History className="w-4 h-4 text-amber-600" />
                    <span className="font-medium text-gray-900">Last Week's Actuals</span>
                  </div>
                  <p className="text-sm text-gray-600">
                    Ground truth: {format(lastWeekStart, "MMM d")} - {format(lastWeekEnd, "MMM d, yyyy")}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Updates records with what actually happened (no-shows, swaps, etc.)
                  </p>
                </Label>
              </div>
            </RadioGroup>

            {/* Warning for actuals */}
            {importType === "actuals" && (
              <Alert className="border-amber-300 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm text-gray-700">
                  Importing actuals will compare against existing records and may overwrite data.
                  You can undo this action after import.
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-4 mt-2 border-t border-gray-100">
              <button
                onClick={() => setStep("upload")}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConfirmType}
                disabled={importType === "unknown"}
                className="px-4 py-2 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === "confirm" && (
          <div className="space-y-4">
            {/* Milo summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-sm">
                  <p className="font-medium text-gray-900 mb-1">Ready to import!</p>
                  <p className="text-gray-600 leading-relaxed">
                    {importType === "new_week"
                      ? "I'll process this data and auto-assign drivers based on historical patterns. After import, click 'Analyze Now' to review assignments."
                      : "I'll compare this against your existing records and show you any differences. You can review changes before confirming."}
                  </p>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  {inputMode === "file" ? "Files to import:" : "Blocks to import:"}
                </span>
                <span className="text-sm font-medium text-gray-900">
                  {inputMode === "file" ? files.length : parsedBlocks.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Import type:</span>
                <span className="text-sm font-medium text-gray-900">
                  {importType === "new_week" ? "New Work Week" : "Last Week's Actuals"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Week:</span>
                <span className="text-sm font-medium text-gray-900">
                  {importType === "new_week"
                    ? `${format(nextWeekStart, "MMM d")} - ${format(nextWeekEnd, "MMM d")}`
                    : `${format(lastWeekStart, "MMM d")} - ${format(lastWeekEnd, "MMM d")}`}
                </span>
              </div>
              {inputMode === "paste" && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Solo2 blocks:</span>
                    <span className="text-sm font-medium text-gray-900">{parsedBlocks.filter(b => b.blockType === "solo2").length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Solo1 blocks:</span>
                    <span className="text-sm font-medium text-gray-900">{parsedBlocks.filter(b => b.blockType === "solo1").length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">With driver assigned:</span>
                    <span className="text-sm font-medium text-gray-900">{parsedBlocks.filter(b => b.driverName).length}</span>
                  </div>
                </>
              )}
            </div>

            {/* File/Block list */}
            <div className="space-y-2 max-h-[150px] overflow-y-auto">
              {inputMode === "file" ? (
                files.map((f, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm text-gray-700">
                    <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                    <span className="truncate">{f.file.name}</span>
                  </div>
                ))
              ) : (
                parsedBlocks.map((block, index) => (
                  <div key={index} className="flex items-center justify-between text-sm bg-gray-50 border border-gray-100 rounded p-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      <span className="font-mono text-gray-900">{block.blockId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {getBlockTypeBadge(block.blockType)}
                      <span className="text-gray-500">
                        {block.driverName || "Unassigned"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-4 mt-2 border-t border-gray-100">
              <button
                onClick={() => setStep("identify")}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                className="px-4 py-2 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Import {inputMode === "file"
                  ? (files.length > 1 ? "Files" : "File")
                  : `${parsedBlocks.length} Block${parsedBlocks.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Step: Block Reconstruction (Trip-Level CSV) */}
        {step === "reconstruct" && (
          <div className="space-y-3">
            {/* Milo thinking/response - Hide when showing import result */}
            {!importResult && (
              <div className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    {isReconstructing ? (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    ) : (
                      <Brain className="w-4 h-4 text-blue-600" />
                    )}
                  </div>
                  <div className="text-sm flex-1">
                    <p className="font-medium text-gray-800 mb-1">
                      {isReconstructing ? "Milo is analyzing..." : `Reconstructed ${reconstructedBlocks.length} Blocks`}
                    </p>
                    {isReconstructing ? (
                      <p className="text-gray-600">
                        Parsing {tripLevelInfo.rowCount} loads across {tripLevelInfo.blockIds.length} blocks...
                      </p>
                    ) : (
                      <p className="text-gray-600">
                        Ready to import with canonical start times and driver assignments.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* MILO CHAT - Prominent position right after header */}
            {!isReconstructing && reconstructedBlocks.length > 0 && !importResult?.success && (
              <div className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-800">Ask Milo</span>
                  <span className="text-xs text-gray-500">- Filter blocks before import</span>
                </div>
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask anything: 'only Dec 1', 'import starting Dec 30', 'show Solo2 blocks'..."
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    disabled={isChatting || isImporting}
                  />
                  <button
                    type="submit"
                    disabled={isChatting || isImporting || !chatInput.trim()}
                    className="px-3 py-2 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
                {/* Chat responses */}
                {chatMessages.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-16 overflow-y-auto">
                    {chatMessages.slice(-2).map((msg, i) => (
                      <p key={i} className={`text-xs ${msg.role === 'user' ? 'text-gray-500' : 'text-blue-700'}`}>
                        {msg.role === 'assistant' ? '→ ' : '? '}{msg.content}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Filter indicator - show when filter is active, hide after import */}
            {activeFilter && !importResult && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-amber-700">
                    Filtered: <strong>{activeFilter}</strong> ({filteredBlocks.length} of {reconstructedBlocks.length})
                  </span>
                  <button
                    onClick={() => { setFilteredBlocks(reconstructedBlocks); setActiveFilter(""); setChatMessages(prev => [...prev, { role: "assistant", content: `Filter cleared - showing all ${reconstructedBlocks.length} blocks` }]); }}
                    className="p-1 text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded transition-colors"
                    title="Clear filter"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => { setFilteredBlocks(reconstructedBlocks); setActiveFilter(""); setChatMessages(prev => [...prev, { role: "assistant", content: `Filter cleared - showing all ${reconstructedBlocks.length} blocks` }]); }}
                  className="px-2 py-1 text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 rounded font-medium transition-colors"
                >
                  Show All
                </button>
              </div>
            )}

            {/* Block List Display - Hide when import result is showing */}
            {filteredBlocks.length > 0 && !isReconstructing && !importResult && (
              <ScrollArea className="h-[180px] rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="space-y-3">
                    {filteredBlocks.slice(0, 20).map((block, index) => (
                      <div key={index} className="border-b border-gray-200 pb-3 last:border-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-sm font-medium text-gray-900">{block.blockId}</span>
                          <span className="text-xs text-gray-500">{block.contract}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 text-xs text-gray-600">
                          <span>Start: {block.startDate}, {block.canonicalStartTime}</span>
                          <span>Duration: {block.duration}</span>
                          <span>Driver: {block.primaryDriver}</span>
                          <span>Cost: ${block.cost?.toFixed(2) || '0.00'}</span>
                        </div>
                        {block.relayDrivers?.length > 0 && (
                          <div className="text-xs text-amber-600 mt-1">
                            Relay: {block.relayDrivers.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {filteredBlocks.length > 20 && (
                      <p className="text-xs text-gray-500 text-center pt-2">
                        ... and {filteredBlocks.length - 20} more blocks
                      </p>
                    )}
                  </div>
              </ScrollArea>
            )}

            {/* Loading state */}
            {isReconstructing && (
              <div className="flex items-center justify-center py-8">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                  <p className="text-sm text-gray-700">
                    Milo is thinking...
                  </p>
                  <p className="text-xs text-gray-500">
                    Analyzing {tripLevelInfo.rowCount} rows across {tripLevelInfo.blockIds.length} blocks
                  </p>
                </div>
              </div>
            )}

            {/* Import Result - Enterprise Style */}
            {importResult && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  {importResult.success ? "Import Complete" : "Import Failed"}
                </h3>

                {importResult.success ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      Successfully imported <span className="font-bold text-gray-900">{importResult.created || 0} blocks</span> to your calendar.
                    </p>
                    {(importResult.created || 0) > 0 && (
                      <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                        <li><span className="font-semibold text-gray-900">{importResult.created}</span> blocks imported with <span className="font-semibold text-gray-900">{importResult.assignments || 0}</span> driver assignments</li>
                        {(importResult.replaced || 0) > 0 && (
                          <li className="text-gray-500">({importResult.replaced} replaced existing blocks)</li>
                        )}
                        {(importResult.rejectedLoads || 0) > 0 && (
                          <li className="text-red-600">
                            <span className="font-semibold">{importResult.rejectedLoads}</span> rejected loads (Trip Stage = Rejected, shown in RED)
                          </li>
                        )}
                        {(importResult.unassignedBlocks || 0) > 0 && (
                          <li className="text-amber-600">
                            <span className="font-semibold">{importResult.unassignedBlocks}</span> need driver assignment (shown in YELLOW)
                          </li>
                        )}
                        {(importResult.unmatchedDrivers || 0) > 0 && (
                          <li className="text-amber-600">
                            <span className="font-semibold">{importResult.unmatchedDrivers}</span> driver not found in system
                          </li>
                        )}
                      </ul>
                    )}

                    {importResult.skipped !== undefined && importResult.skipped > 0 && (
                      <p className="text-sm text-amber-600">
                        {importResult.skipped} blocks skipped (missing data or duplicates)
                      </p>
                    )}

                    {importResult.errors && importResult.errors.length > 0 && (
                      <div className="text-xs text-red-600 max-h-20 overflow-y-auto">
                        {importResult.errors.slice(0, 5).map((err, i) => (
                          <p key={i}>{err}</p>
                        ))}
                        {importResult.errors.length > 5 && (
                          <p>...and {importResult.errors.length - 5} more errors</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-red-600">{importResult.message}</p>
                    {importResult.errors && importResult.errors.length > 0 && (
                      <div className="text-xs text-red-500 max-h-20 overflow-y-auto">
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
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-4 mt-2 border-t border-gray-100">
              <button
                onClick={() => setStep("upload")}
                disabled={isImporting}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 transition-colors"
              >
                Back
              </button>
              <div className="flex gap-2">
                {!isReconstructing && reconstructedBlocks.length > 0 && !importResult?.success && (
                  <>
                    <button
                      onClick={handleReconstructBlocks}
                      disabled={isImporting}
                      className="px-3 py-2 text-sm border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors flex items-center gap-1"
                    >
                      <Brain className="w-4 h-4" />
                      Re-analyze
                    </button>
                    <button
                      onClick={handleImportToCalendar}
                      disabled={isImporting || filteredBlocks.length === 0}
                      className="px-3 py-2 text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center gap-1"
                    >
                      {isImporting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Calendar className="w-4 h-4" />
                          Import to Calendar
                        </>
                      )}
                    </button>
                  </>
                )}
                {importResult?.success && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleClose}
                      className="px-4 py-2 text-sm border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      Done
                    </button>
                    <button
                      onClick={handleClose}
                      className="px-3 py-2 text-sm bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-1"
                    >
                      <Calendar className="w-4 h-4" />
                      View Calendar
                    </button>
                  </div>
                )}
                {!reconstructedBlocks.length && !isReconstructing && (
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Executive Report Modal */}
      <ExecutiveReport
        open={showReport}
        onOpenChange={setShowReport}
        data={reportData}
      />

    </Dialog>
  );
}

// Find the dominant week from a set of blocks (week with most blocks)
function getDominantWeekStart(blocks: ReconstructedBlock[]): Date {
  if (blocks.length === 0) {
    return startOfWeek(new Date(), { weekStartsOn: 0 });
  }

  // Count blocks per week
  const weekCounts = new Map<string, { count: number; weekStart: Date }>();

  for (const block of blocks) {
    const blockDate = new Date(block.startDate);
    const weekStart = startOfWeek(blockDate, { weekStartsOn: 0 });
    const weekKey = weekStart.toISOString();

    const existing = weekCounts.get(weekKey);
    if (existing) {
      existing.count++;
    } else {
      weekCounts.set(weekKey, { count: 1, weekStart });
    }
  }

  // Find week with most blocks
  let dominantWeek: { count: number; weekStart: Date } | undefined = undefined;
  for (const week of weekCounts.values()) {
    if (!dominantWeek || week.count > dominantWeek.count) {
      dominantWeek = week;
    }
  }

  return dominantWeek?.weekStart || startOfWeek(new Date(), { weekStartsOn: 0 });
}

// Export the ParsedBlock type for use in other components
export type { ParsedBlock };
