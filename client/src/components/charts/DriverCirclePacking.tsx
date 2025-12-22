import { useState, useMemo, useCallback } from "react";
import { ResponsiveCirclePacking } from "@nivo/circle-packing";
import { Button } from "@/components/ui/button";
import { Check, Loader2, ZoomOut } from "lucide-react";

// Type for matched blocks from the parent component
export interface MatchedBlock {
  blockId: string;
  serviceDate: string;
  dayOfWeek: string;
  startTime: string;
  contractType: string;
  score: number;
  tractorId?: string;
}

// Nivo CirclePacking data structure
interface CircleNode {
  name: string;
  value?: number;
  children?: CircleNode[];
  // Custom data for leaf nodes
  blockId?: string;
  serviceDate?: string;
  startTime?: string;
  contractType?: string;
  score?: number;
  tractorId?: string;
}

interface DriverCirclePackingProps {
  driverName: string;
  matchedBlocks: MatchedBlock[];
  onApply: (blockIds: string[]) => void;
  isApplying?: boolean;
  height?: number;
}

// Color scheme based on match score
function getScoreColor(score: number): string {
  if (score >= 0.9) return "#10b981"; // Emerald - owner match
  if (score >= 0.7) return "#22c55e"; // Green - strong match
  if (score >= 0.5) return "#f59e0b"; // Amber - fair match
  return "#f97316"; // Orange - weak match
}

// Day order for sorting
const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function DriverCirclePacking({
  driverName,
  matchedBlocks,
  onApply,
  isApplying = false,
  height = 280,
}: DriverCirclePackingProps) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());

  // Transform matched blocks into CirclePacking hierarchy
  // Root (invisible) -> Days -> Time slots
  const data: CircleNode = useMemo(() => {
    // Group blocks by day of week
    const byDay = new Map<string, MatchedBlock[]>();

    for (const block of matchedBlocks) {
      const day = block.dayOfWeek;
      if (!byDay.has(day)) {
        byDay.set(day, []);
      }
      byDay.get(day)!.push(block);
    }

    // Sort days in calendar order
    const sortedDays = Array.from(byDay.keys()).sort(
      (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)
    );

    // Build hierarchy
    const children: CircleNode[] = sortedDays.map((day) => {
      const dayBlocks = byDay.get(day)!;

      // Sort blocks by start time within each day
      dayBlocks.sort((a, b) => a.startTime.localeCompare(b.startTime));

      return {
        name: day,
        children: dayBlocks.map((block) => ({
          name: block.startTime,
          value: Math.round(block.score * 100), // Size by score
          blockId: block.blockId,
          serviceDate: block.serviceDate,
          startTime: block.startTime,
          contractType: block.contractType,
          score: block.score,
          tractorId: block.tractorId,
        })),
      };
    });

    return {
      name: driverName,
      children,
    };
  }, [matchedBlocks, driverName]);

  // Toggle block selection
  const toggleBlock = useCallback((blockId: string) => {
    setSelectedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  // Select all blocks
  const selectAll = useCallback(() => {
    setSelectedBlocks(new Set(matchedBlocks.map((b) => b.blockId)));
  }, [matchedBlocks]);

  // Handle apply
  const handleApply = useCallback(() => {
    const blockIds = Array.from(selectedBlocks);
    if (blockIds.length > 0) {
      onApply(blockIds);
    }
  }, [selectedBlocks, onApply]);

  if (matchedBlocks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No matching blocks
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between px-1 py-1 border-b border-purple-200 dark:border-purple-700">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={selectAll}
          >
            Select All ({matchedBlocks.length})
          </Button>
          {zoomedId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setZoomedId(null)}
            >
              <ZoomOut className="w-3 h-3 mr-1" />
              Reset
            </Button>
          )}
        </div>
        <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">
          {selectedBlocks.size} selected
        </span>
      </div>

      {/* CirclePacking */}
      <div className="flex-1 min-h-0" style={{ height: height - 70 }}>
        <ResponsiveCirclePacking
          data={data}
          id="name"
          value="value"
          colors={(node: any) => {
            if (node.depth === 0) return "transparent";
            if (node.depth === 1) return "#f1f5f9";
            return getScoreColor(node.data.score || 0.5);
          }}
          childColor={{ from: "color", modifiers: [["brighter", 0.4]] }}
          padding={4}
          enableLabels={true}
          labelsSkipRadius={12}
          labelTextColor={{ from: "color", modifiers: [["darker", 2]] }}
          borderWidth={1}
          borderColor={{ from: "color", modifiers: [["darker", 0.3]] }}
          animate={true}
          motionConfig="gentle"
          zoomedId={zoomedId}
          onClick={(node: any) => {
            if (node.depth === 1) {
              // Day node - toggle zoom
              setZoomedId(zoomedId === node.id ? null : node.id);
            } else if (node.depth === 2 && node.data.blockId) {
              // Time slot - toggle selection
              toggleBlock(node.data.blockId);
            }
          }}
          tooltip={({ id, value, data }: any) => {
            if (data.blockId) {
              // Leaf node (time slot)
              return (
                <div className="bg-slate-900 text-white px-2 py-1 rounded shadow-lg text-xs">
                  <div className="font-semibold">{data.startTime} - {data.contractType}</div>
                  <div className="text-slate-300">{data.serviceDate}</div>
                  {data.tractorId && <div className="text-slate-400">{data.tractorId}</div>}
                  <div className="text-emerald-400">Score: {Math.round((data.score || 0) * 100)}%</div>
                </div>
              );
            }
            // Day node
            return (
              <div className="bg-slate-900 text-white px-2 py-1 rounded shadow-lg text-xs">
                <div className="font-semibold">{id}</div>
                <div className="text-slate-300">{value} blocks</div>
              </div>
            );
          }}
        />
      </div>

      {/* Apply Button */}
      <div className="pt-1 border-t border-purple-200 dark:border-purple-700">
        <Button
          size="sm"
          className="w-full h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white"
          onClick={handleApply}
          disabled={selectedBlocks.size === 0 || isApplying}
        >
          {isApplying ? (
            <>
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              Applying...
            </>
          ) : (
            <>
              <Check className="w-3 h-3 mr-1.5" />
              Apply {selectedBlocks.size} Block{selectedBlocks.size !== 1 ? "s" : ""} to Calendar
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
