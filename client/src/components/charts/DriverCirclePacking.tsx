import { useState, useCallback, useMemo } from "react";
import { ResponsiveCirclePacking } from "@nivo/circle-packing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

// Types for the CirclePacking data structure
export interface MatchedBlock {
  blockId: string;
  serviceDate: string;
  dayOfWeek: string;
  startTime: string;
  contractType: string; // "Solo1" or "Solo2"
  score: number; // 0-1
  tractorId?: string;
}

interface CirclePackingNode {
  name: string;
  value?: number;
  contractType?: string;
  blockId?: string;
  serviceDate?: string;
  startTime?: string;
  children?: CirclePackingNode[];
}

interface DriverCirclePackingProps {
  driverName: string;
  matchedBlocks: MatchedBlock[];
  onApply: (blockIds: string[]) => void;
  isApplying?: boolean;
  height?: number;
}

// Color functions based on match score
function getScoreColor(score: number): string {
  if (score >= 0.9) return "#10b981"; // Emerald - Owner match
  if (score >= 0.7) return "#22c55e"; // Green - Strong match
  if (score >= 0.5) return "#f59e0b"; // Amber - Fair match
  return "#f97316"; // Orange - Weak match
}

function getContractColor(contractType: string): string {
  return contractType?.toLowerCase() === "solo2" ? "#3b82f6" : "#06b6d4"; // Blue for Solo2, Cyan for Solo1
}

// Transform matched blocks to Nivo CirclePacking format
function transformToCirclePackingData(
  driverName: string,
  blocks: MatchedBlock[]
): CirclePackingNode {
  // Group blocks by day
  const byDay = blocks.reduce((acc, block) => {
    const day = block.dayOfWeek;
    if (!acc[day]) acc[day] = [];
    acc[day].push(block);
    return acc;
  }, {} as Record<string, MatchedBlock[]>);

  // Create hierarchy: Driver → Days → Times
  const children = Object.entries(byDay).map(([day, dayBlocks]) => ({
    name: day,
    children: dayBlocks.map((block) => ({
      name: block.startTime,
      value: Math.round(block.score * 100), // Score determines circle size
      contractType: block.contractType,
      blockId: block.blockId,
      serviceDate: block.serviceDate,
      startTime: block.startTime,
    })),
  }));

  return {
    name: driverName,
    children,
  };
}

export function DriverCirclePacking({
  driverName,
  matchedBlocks,
  onApply,
  isApplying = false,
  height = 280,
}: DriverCirclePackingProps) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(
    new Set(matchedBlocks.map((b) => b.blockId))
  );

  // Transform data for Nivo
  const data = useMemo(
    () => transformToCirclePackingData(driverName, matchedBlocks),
    [driverName, matchedBlocks]
  );

  // Handle circle click - zoom or select
  const handleClick = useCallback(
    (node: any) => {
      // If it's a leaf node (has blockId), toggle selection
      if (node.data.blockId) {
        setSelectedBlockIds((prev) => {
          const next = new Set(prev);
          if (next.has(node.data.blockId)) {
            next.delete(node.data.blockId);
          } else {
            next.add(node.data.blockId);
          }
          return next;
        });
      } else {
        // It's a parent node (day) - zoom in/out
        setZoomedId(zoomedId === node.id ? null : node.id);
      }
    },
    [zoomedId]
  );

  // Reset zoom
  const handleReset = useCallback(() => {
    setZoomedId(null);
  }, []);

  // Select all / deselect all
  const handleSelectAll = useCallback(() => {
    setSelectedBlockIds(new Set(matchedBlocks.map((b) => b.blockId)));
  }, [matchedBlocks]);

  const handleDeselectAll = useCallback(() => {
    setSelectedBlockIds(new Set());
  }, []);

  // Apply selected blocks
  const handleApply = useCallback(() => {
    onApply(Array.from(selectedBlockIds));
  }, [selectedBlockIds, onApply]);

  const selectedCount = selectedBlockIds.size;
  const totalCount = matchedBlocks.length;

  if (matchedBlocks.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No matching blocks found
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header with controls */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {selectedCount}/{totalCount} selected
          </Badge>
          {zoomedId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-6 px-2 text-xs"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectAll}
            className="h-6 px-2 text-xs"
            disabled={selectedCount === totalCount}
          >
            All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeselectAll}
            className="h-6 px-2 text-xs"
            disabled={selectedCount === 0}
          >
            None
          </Button>
        </div>
      </div>

      {/* CirclePacking visualization */}
      <div style={{ height }} className="w-full">
        <ResponsiveCirclePacking
          data={data}
          id="name"
          value="value"
          colors={(node: any) => {
            // Root node (driver name) - transparent
            if (node.depth === 0) return "transparent";
            // Day nodes
            if (node.depth === 1) return "#374151"; // Gray for days
            // Time nodes - color by contract type
            if (node.data.contractType) {
              return getContractColor(node.data.contractType);
            }
            return "#64748b";
          }}
          padding={4}
          enableLabels={true}
          labelsSkipRadius={12}
          labelTextColor={(node: any) => {
            // Make text readable
            if (node.depth === 0) return "transparent";
            return "#ffffff";
          }}
          labelComponent={({ node, style }: any) => {
            // Custom label showing time and Solo type
            const isSelected = node.data.blockId && selectedBlockIds.has(node.data.blockId);
            const isLeaf = node.depth === 2;

            // Hide root node label but return empty group instead of null
            if (node.depth === 0) {
              return <g />;
            }

            return (
              <g transform={`translate(${node.x},${node.y})`}>
                {/* Selection ring for leaf nodes */}
                {isLeaf && (
                  <circle
                    r={node.radius + 2}
                    fill="none"
                    stroke={isSelected ? "#8b5cf6" : "transparent"}
                    strokeWidth={2}
                  />
                )}
                {/* Label text */}
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: node.depth === 1 ? 11 : 9,
                    fontWeight: node.depth === 1 ? 600 : 500,
                    fill: "#ffffff",
                    pointerEvents: "none",
                  }}
                >
                  {node.depth === 1 ? node.id.slice(0, 3) : node.id}
                </text>
                {/* Contract type badge for leaf nodes */}
                {isLeaf && node.data.contractType && node.radius > 20 && (
                  <text
                    y={12}
                    textAnchor="middle"
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      fill: "#ffffff",
                      opacity: 0.9,
                    }}
                  >
                    {node.data.contractType}
                  </text>
                )}
              </g>
            );
          }}
          borderWidth={2}
          borderColor={(node: any) => {
            if (node.data.blockId && selectedBlockIds.has(node.data.blockId)) {
              return "#8b5cf6"; // Purple for selected
            }
            return "rgba(255,255,255,0.2)";
          }}
          zoomedId={zoomedId}
          motionConfig="gentle"
          onClick={handleClick}
          tooltip={({ id, value, data }: any) => (
            <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-lg text-sm">
              <div className="font-semibold">{id}</div>
              {data.contractType && (
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded text-xs font-bold",
                      data.contractType === "Solo2"
                        ? "bg-blue-500/30 text-blue-300"
                        : "bg-cyan-500/30 text-cyan-300"
                    )}
                  >
                    {data.contractType}
                  </span>
                  <span className="text-slate-400">Score: {value}%</span>
                </div>
              )}
              {data.serviceDate && (
                <div className="text-xs text-slate-400 mt-1">
                  {data.serviceDate}
                </div>
              )}
              <div className="text-xs text-slate-500 mt-1">
                Click to {data.blockId ? "select/deselect" : "zoom"}
              </div>
            </div>
          )}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground px-2">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-cyan-500" />
          Solo1
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-blue-500" />
          Solo2
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full border-2 border-purple-500" />
          Selected
        </span>
      </div>

      {/* Apply button */}
      <Button
        className="w-full bg-green-600 hover:bg-green-700"
        onClick={handleApply}
        disabled={selectedCount === 0 || isApplying}
      >
        {isApplying ? (
          "Applying..."
        ) : (
          <>
            <Check className="w-4 h-4 mr-2" />
            Apply to Calendar ({selectedCount})
          </>
        )}
      </Button>
    </div>
  );
}
