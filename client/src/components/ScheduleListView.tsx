import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Search, Download, CheckSquare, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ShiftOccurrence = {
  occurrenceId: string;
  serviceDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  blockId: string;
  driverName: string | null;
  contractType: string | null;
  status: string;
  tractorId: string | null;
  assignmentId: string | null;
  bumpMinutes: number;
  isCarryover: boolean;
};

interface ScheduleListViewProps {
  occurrences: ShiftOccurrence[];
  onAssignDriver?: (occurrenceId: string, driverName: string) => void;
  onExport?: () => void;
  showRate?: boolean;
  sortBy?: "time" | "type";
  filterType?: "all" | "solo1" | "solo2" | "team";
}

export function ScheduleListView({
  occurrences,
  onAssignDriver,
  onExport,
  showRate = true,
  sortBy: parentSortBy = "time",
  filterType: parentFilterType = "all"
}: ScheduleListViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDomicile, setSelectedDomicile] = useState<string>("all");
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Handle column header click for sorting
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // New column, default to ascending
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Extract unique domiciles from occurrences
  const domiciles = useMemo(() => {
    const unique = new Set(occurrences.map(occ => "MKC")); // Default to MKC for now
    return Array.from(unique);
  }, [occurrences]);

  // Filter and sort occurrences
  const filteredOccurrences = useMemo(() => {
    let filtered = [...occurrences];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(occ =>
        occ.blockId.toLowerCase().includes(query) ||
        occ.driverName?.toLowerCase().includes(query) ||
        occ.tractorId?.toLowerCase().includes(query)
      );
    }

    // Domicile filter
    if (selectedDomicile !== "all") {
      // Filter by domicile when we have that data
      // For now, all are MKC
    }

    // Work type filter (from parent)
    if (parentFilterType !== "all") {
      filtered = filtered.filter(occ =>
        occ.contractType?.toLowerCase() === parentFilterType.toLowerCase()
      );
    }

    // Show unassigned only
    if (showUnassignedOnly) {
      filtered = filtered.filter(occ => !occ.driverName);
    }

    // Sort by column if specified
    if (sortColumn) {
      filtered.sort((a, b) => {
        let compareResult = 0;

        switch (sortColumn) {
          case "blockId":
            compareResult = a.blockId.localeCompare(b.blockId);
            break;
          case "starts":
            const dateA = `${a.serviceDate} ${a.startTime}`;
            const dateB = `${b.serviceDate} ${b.startTime}`;
            compareResult = dateA.localeCompare(dateB);
            break;
          case "type":
            const typeA = a.contractType || "zzz";
            const typeB = b.contractType || "zzz";
            compareResult = typeA.localeCompare(typeB);
            break;
          case "driver":
            const nameA = a.driverName || "zzz"; // Unassigned at end
            const nameB = b.driverName || "zzz";
            compareResult = nameA.localeCompare(nameB);
            break;
          case "tractor":
            const tractorA = a.tractorId || "zzz";
            const tractorB = b.tractorId || "zzz";
            compareResult = tractorA.localeCompare(tractorB);
            break;
          default:
            compareResult = 0;
        }

        return sortDirection === "asc" ? compareResult : -compareResult;
      });
    } else if (parentSortBy === "time") {
      // Default sorting by time from parent
      filtered.sort((a, b) => {
        const dateA = `${a.serviceDate} ${a.startTime}`;
        const dateB = `${b.serviceDate} ${b.startTime}`;
        return dateA.localeCompare(dateB);
      });
    } else if (parentSortBy === "type") {
      // Sort by type from parent
      filtered.sort((a, b) => {
        const typeA = a.contractType || "zzz";
        const typeB = b.contractType || "zzz";
        if (typeA !== typeB) {
          return typeA.localeCompare(typeB);
        }
        const dateA = `${a.serviceDate} ${a.startTime}`;
        const dateB = `${b.serviceDate} ${b.startTime}`;
        return dateA.localeCompare(dateB);
      });
    }

    return filtered;
  }, [occurrences, searchQuery, selectedDomicile, parentFilterType, showUnassignedOnly, sortColumn, sortDirection, parentSortBy]);

  const getTypeColor = (type: string | null) => {
    if (!type) return "bg-gray-500/20 text-gray-700";
    const normalized = type.toLowerCase();
    if (normalized === "solo1") return "bg-blue-500/20 text-blue-700";
    if (normalized === "solo2") return "bg-purple-500/20 text-purple-700";
    if (normalized === "team") return "bg-green-500/20 text-green-700";
    return "bg-gray-500/20 text-gray-700";
  };

  const formatDuration = (bumpMinutes: number) => {
    // This is a placeholder - we'd need actual duration from the block data
    return "14h"; // Default duration
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-4 h-4 ml-1 inline-block opacity-40" />;
    }
    return sortDirection === "asc"
      ? <ArrowUp className="w-4 h-4 ml-1 inline-block" />
      : <ArrowDown className="w-4 h-4 ml-1 inline-block" />;
  };

  const handleExport = () => {
    if (onExport) {
      onExport();
    } else {
      // Default export behavior - download as CSV
      const csvContent = generateCSV(filteredOccurrences);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schedule-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    }
  };

  const generateCSV = (data: ShiftOccurrence[]) => {
    const headers = ['Block ID', 'Service Date', 'Start Time', 'Driver', 'Tractor', 'Type', 'Status'];
    const rows = data.map(occ => [
      occ.blockId,
      occ.serviceDate,
      occ.startTime,
      occ.driverName || 'Unassigned',
      occ.tractorId || '',
      occ.contractType || '',
      occ.status
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Search and Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card border rounded-lg">
        {/* Search */}
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by IDs, location, drivers"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="search-input"
          />
        </div>

        {/* Domiciles Filter */}
        <Select value={selectedDomicile} onValueChange={setSelectedDomicile}>
          <SelectTrigger className="w-[150px]" data-testid="filter-domiciles">
            <SelectValue placeholder="Domiciles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Domiciles</SelectItem>
            {domiciles.map(domicile => (
              <SelectItem key={domicile} value={domicile}>{domicile}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Show Unassigned Only Toggle */}
        <div className="flex items-center gap-2 px-3 py-2 border rounded-md">
          <Switch
            id="show-unassigned"
            checked={showUnassignedOnly}
            onCheckedChange={setShowUnassignedOnly}
            data-testid="toggle-unassigned"
          />
          <Label htmlFor="show-unassigned" className="text-sm cursor-pointer">
            Show needs attention only
          </Label>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            data-testid="button-export"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between px-4">
        <div className="text-sm text-muted-foreground">
          {filteredOccurrences.length} of {occurrences.length} results
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setSelectedDomicile("all");
                setShowUnassignedOnly(false);
              }}
              className="ml-2"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* List Table */}
      <div className="flex-1 border rounded-lg overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="w-[140px]">
                <button
                  className="flex items-center hover:text-foreground transition-colors"
                  onClick={() => handleSort("blockId")}
                >
                  Block ID
                  {getSortIcon("blockId")}
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="flex items-center hover:text-foreground transition-colors"
                  onClick={() => handleSort("starts")}
                >
                  Starts
                  {getSortIcon("starts")}
                </button>
              </TableHead>
              <TableHead>Destination</TableHead>
              <TableHead className="text-center">
                <button
                  className="flex items-center justify-center hover:text-foreground transition-colors mx-auto"
                  onClick={() => handleSort("type")}
                >
                  Type
                  {getSortIcon("type")}
                </button>
              </TableHead>
              <TableHead className="text-center">Duration</TableHead>
              <TableHead>Trailer</TableHead>
              {showRate && <TableHead>Rate</TableHead>}
              <TableHead className="w-[200px]">
                <button
                  className="flex items-center hover:text-foreground transition-colors"
                  onClick={() => handleSort("driver")}
                >
                  Driver
                  {getSortIcon("driver")}
                </button>
              </TableHead>
              <TableHead className="w-[100px]">
                <button
                  className="flex items-center hover:text-foreground transition-colors"
                  onClick={() => handleSort("tractor")}
                >
                  Tractor
                  {getSortIcon("tractor")}
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOccurrences.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showRate ? 9 : 8} className="text-center py-12 text-muted-foreground">
                  No blocks found
                </TableCell>
              </TableRow>
            ) : (
              filteredOccurrences.map((occ) => (
                <TableRow
                  key={occ.occurrenceId}
                  className="hover:bg-muted/50"
                  data-testid={`block-row-${occ.blockId}`}
                >
                  <TableCell className="font-mono font-medium text-blue-600">
                    <button
                      className="hover:underline"
                      onClick={() => {/* TODO: Open detail modal */}}
                    >
                      {occ.blockId}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <div className="font-medium">
                        {format(parseISO(occ.serviceDate), 'EEE, MMM d, HH:mm')}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        MKC Kansas City, KS
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <div>LENEXA, KS</div>
                      <div className="text-muted-foreground text-xs">
                        {format(parseISO(occ.serviceDate), 'EEE, MMM d')}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {occ.contractType && (
                      <Badge className={getTypeColor(occ.contractType)}>
                        {occ.contractType}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {formatDuration(occ.bumpMinutes)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    53' Trailer
                  </TableCell>
                  {showRate && (
                    <TableCell className="text-sm">
                      <div className="font-medium">$498.42</div>
                      <div className="text-xs text-muted-foreground">+ Accessorials</div>
                    </TableCell>
                  )}
                  <TableCell>
                    {occ.driverName ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{occ.driverName}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => onAssignDriver?.(occ.occurrenceId, "")}
                        >
                          Change
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        Unassigned
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-blue-600">
                    {occ.tractorId || "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
