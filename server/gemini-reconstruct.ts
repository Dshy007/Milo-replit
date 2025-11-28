import { GoogleGenerativeAI } from "@google/generative-ai";

// Canonical start times from contracts table (complete list)
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

const SYSTEM_PROMPT = `You are a block reconstruction assistant. Analyze trip-level CSV data and reconstruct into calendar blocks.

## CANONICAL START TIME LOOKUP TABLE
Extract contract from Operator ID column (format: FTIM_MKC_Solo1_Tractor_3_d1 → Solo1_Tractor_3)
Then look up the canonical start time:

Solo1_Tractor_1 = 16:30
Solo1_Tractor_2 = 20:30
Solo1_Tractor_3 = 20:30
Solo1_Tractor_4 = 17:30
Solo1_Tractor_5 = 21:30
Solo1_Tractor_6 = 01:30
Solo1_Tractor_7 = 18:30
Solo1_Tractor_8 = 00:30
Solo1_Tractor_9 = 16:30
Solo1_Tractor_10 = 20:30
Solo2_Tractor_1 = 18:30
Solo2_Tractor_2 = 23:30
Solo2_Tractor_3 = 21:30
Solo2_Tractor_4 = 08:30
Solo2_Tractor_5 = 15:30
Solo2_Tractor_6 = 11:30
Solo2_Tractor_7 = 16:30

## RULES
1. Group rows by Block ID column
2. For each block:
   - Extract contract from Operator ID: "FTIM_MKC_Solo2_Tractor_6_d1" → "Solo2_Tractor_6"
   - Look up "t" (canonical start time) from table above - DO NOT use departure time from CSV!
   - Solo1 = 14h duration, Solo2 = 38h duration
   - "d" = date of first load in block
   - "$" = sum of all Cost columns
   - "p" = driver with most loads, "r" = other drivers
   - "n" = count of loads, "rt" = origin-destination route

3. Output JSON array with compact keys:
[{"id":"B-XXX","c":"Solo2_Tractor_6","t":"11:30","d":"2025-11-25","h":"38h","$":1234.56,"p":"John Smith","r":["Jane"],"n":6,"rt":"MKC1-CHI5"}]

CRITICAL: "t" MUST come from lookup table above, NOT from CSV departure times!
Return ONLY JSON array. No markdown, no explanation.`;

export interface ReconstructedBlock {
  blockId: string;
  contract: string;
  canonicalStartTime: string;
  startDate: string;
  duration: string;
  cost: number;
  primaryDriver: string;
  relayDrivers: string[];
  loadCount: number;
  route: string;
}

// Compact format from Gemini
interface CompactBlock {
  id: string;      // blockId
  c: string;       // contract
  t: string;       // canonicalStartTime
  d: string;       // startDate
  h: string;       // duration
  $: number;       // cost
  p: string;       // primaryDriver
  r: string[];     // relayDrivers
  n: number;       // loadCount
  rt: string;      // route
}

// Transform compact format to full format
function expandCompactBlock(compact: CompactBlock | ReconstructedBlock): ReconstructedBlock {
  // Check if it's already in full format
  if ('blockId' in compact) {
    return compact as ReconstructedBlock;
  }

  const c = compact as CompactBlock;
  return {
    blockId: c.id || '',
    contract: c.c || '',
    canonicalStartTime: c.t || '',
    startDate: c.d || '',
    duration: c.h || '',
    cost: c.$ || 0,
    primaryDriver: c.p || '',
    relayDrivers: c.r || [],
    loadCount: c.n || 0,
    route: c.rt || '',
  };
}

export async function reconstructBlocksWithGemini(csvData: string): Promise<{
  success: boolean;
  blocks?: ReconstructedBlock[];
  error?: string;
  rawResponse?: string;
}> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: "GOOGLE_AI_API_KEY not configured. Please add it to your .env file.",
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        maxOutputTokens: 32768, // Increased for large block sets (90+ blocks)
      }
    });

    // Truncate if too large (Gemini has limits)
    const maxChars = 200000; // Increased limit
    const truncatedData = csvData.length > maxChars
      ? csvData.substring(0, maxChars) + "\n... (truncated)"
      : csvData;

    const prompt = `${SYSTEM_PROMPT}

CRITICAL: You MUST process ALL blocks in the data. Do not stop early. There should be approximately 80-100 blocks.

## CSV DATA TO RECONSTRUCT:
${truncatedData}

Reconstruct ALL blocks into JSON. Return ONLY a JSON array with ALL blocks.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Try to parse JSON from response
    let jsonStr = text.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith("```")) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Handle truncated JSON - try to fix incomplete array
    if (jsonStr.startsWith("[") && !jsonStr.endsWith("]")) {
      // Find the last complete object (ends with })
      const lastCompleteObj = jsonStr.lastIndexOf("}");
      if (lastCompleteObj > 0) {
        jsonStr = jsonStr.substring(0, lastCompleteObj + 1) + "]";
        console.log("[Gemini] Fixed truncated JSON array");
      }
    }

    try {
      const rawBlocks = JSON.parse(jsonStr) as (CompactBlock | ReconstructedBlock)[];
      const blocks = rawBlocks.map(expandCompactBlock);
      console.log(`[Gemini] Successfully parsed ${blocks.length} blocks`);
      return {
        success: true,
        blocks,
        rawResponse: text,
      };
    } catch (parseError) {
      // Try one more fix - remove trailing comma before ]
      try {
        const fixedJson = jsonStr.replace(/,\s*\]$/, "]");
        const rawBlocks = JSON.parse(fixedJson) as (CompactBlock | ReconstructedBlock)[];
        const blocks = rawBlocks.map(expandCompactBlock);
        console.log(`[Gemini] Successfully parsed ${blocks.length} blocks (after fix)`);
        return {
          success: true,
          blocks,
          rawResponse: text,
        };
      } catch {
        return {
          success: false,
          error: "Failed to parse Gemini response as JSON",
          rawResponse: text,
        };
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error calling Gemini API",
    };
  }
}
