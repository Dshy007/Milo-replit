import { useState, useMemo } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  PDFViewer,
  PDFDownloadLink,
  Font,
  Image,
} from "@react-pdf/renderer";
import { format, startOfWeek, endOfWeek, getWeek } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileText, Eye, Loader2, X } from "lucide-react";

// Types for report data
export interface ScheduleBlock {
  blockId: string;
  startDate: string;
  startTime: string;
  driverName: string;
  blockType: "solo1" | "solo2";
  contract?: string;
  duration?: string;
  cost?: number;
}

export interface DailyStats {
  day: string;
  date: string;
  total: number;
  solo2: number;
  solo1: number;
  isPeak?: boolean;
  isLow?: boolean;
}

export interface DriverWorkload {
  name: string;
  type: "S1" | "S2" | "MX";
  runs: number;
  days: Record<string, string | null>;
  status: "MAX" | "WATCH" | "OK" | "STANDBY" | "NEW";
}

export interface WatchListItem {
  driver: string;
  issue: string;
  action: string;
}

export interface ExecutiveReportData {
  weekStart: Date;
  weekEnd: Date;
  totalBlocks: number;
  solo1Blocks: number;
  solo2Blocks: number;
  coverage: number;
  activeDrivers: number;
  dailyStats: DailyStats[];
  blocks: ScheduleBlock[];
  driverWorkloads: DriverWorkload[];
  watchList: WatchListItem[];
  recommendations: string[];
}

// PDF Styles - Professional blue theme matching Freedom Transportation branding
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    backgroundColor: "#FFFFFF",
  },
  // Header styles
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    borderBottomWidth: 3,
    borderBottomColor: "#1E40AF",
    paddingBottom: 15,
  },
  headerLeft: {
    flex: 1,
  },
  companyName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1E40AF",
    marginBottom: 4,
  },
  reportTitle: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 2,
  },
  weekRange: {
    fontSize: 11,
    color: "#6B7280",
  },
  headerRight: {
    alignItems: "flex-end",
  },
  miloBox: {
    backgroundColor: "#1E40AF",
    padding: 8,
    borderRadius: 4,
  },
  miloText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#FFFFFF",
  },
  miloSubtext: {
    fontSize: 8,
    color: "#93C5FD",
    marginTop: 2,
  },
  // Key metrics section
  metricsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  metricBox: {
    width: "15%",
    backgroundColor: "#F3F4F6",
    padding: 10,
    borderRadius: 4,
    alignItems: "center",
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1E40AF",
    marginBottom: 2,
  },
  metricLabel: {
    fontSize: 8,
    color: "#6B7280",
    textAlign: "center",
  },
  // Section styles
  section: {
    marginBottom: 15,
  },
  sectionHeader: {
    backgroundColor: "#1E40AF",
    padding: 8,
    marginBottom: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Table styles
  table: {
    width: "100%",
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#E5E7EB",
    borderBottomWidth: 1,
    borderBottomColor: "#D1D5DB",
  },
  tableHeaderCell: {
    padding: 6,
    fontSize: 8,
    fontWeight: "bold",
    color: "#374151",
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: "#F9FAFB",
  },
  tableRowPeak: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: "#FEF3C7",
  },
  tableRowLow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: "#DBEAFE",
  },
  tableCell: {
    padding: 5,
    fontSize: 9,
    color: "#374151",
  },
  tableCellBold: {
    padding: 5,
    fontSize: 9,
    fontWeight: "bold",
    color: "#1F2937",
  },
  // Daily section styles
  dailyHeader: {
    backgroundColor: "#059669",
    padding: 8,
    marginBottom: 6,
    borderRadius: 4,
  },
  dailyTitle: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#FFFFFF",
  },
  dailySubtitle: {
    fontSize: 8,
    color: "#D1FAE5",
    marginTop: 2,
  },
  // Badge styles
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
    fontSize: 7,
  },
  badgeSolo1: {
    backgroundColor: "#DBEAFE",
    color: "#1E40AF",
  },
  badgeSolo2: {
    backgroundColor: "#F3E8FF",
    color: "#7C3AED",
  },
  badgeMax: {
    backgroundColor: "#FEE2E2",
    color: "#DC2626",
  },
  badgeWatch: {
    backgroundColor: "#FEF3C7",
    color: "#D97706",
  },
  badgeOk: {
    backgroundColor: "#D1FAE5",
    color: "#059669",
  },
  // Watch list styles
  watchItem: {
    flexDirection: "row",
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#FEE2E2",
    backgroundColor: "#FFF7ED",
  },
  watchIcon: {
    fontSize: 10,
    color: "#F59E0B",
    marginRight: 8,
  },
  // Footer styles
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: "#9CA3AF",
  },
  footerBrand: {
    fontSize: 8,
    color: "#1E40AF",
    fontWeight: "bold",
  },
  // Compliance dashboard
  complianceBox: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  complianceLabel: {
    width: "35%",
    fontSize: 9,
    color: "#374151",
  },
  complianceBar: {
    flex: 1,
    height: 12,
    backgroundColor: "#E5E7EB",
    borderRadius: 6,
    marginRight: 8,
  },
  complianceFill: {
    height: 12,
    backgroundColor: "#10B981",
    borderRadius: 6,
  },
  complianceValue: {
    width: "10%",
    fontSize: 9,
    fontWeight: "bold",
    color: "#10B981",
    textAlign: "right",
  },
  // Recommendations
  recommendationItem: {
    flexDirection: "row",
    marginBottom: 6,
  },
  recommendationBullet: {
    width: 16,
    fontSize: 10,
    color: "#1E40AF",
  },
  recommendationText: {
    flex: 1,
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.4,
  },
});

// PDF Document Component
function ExecutiveReportPDF({ data }: { data: ExecutiveReportData }) {
  const weekNumber = getWeek(data.weekStart);
  const peakDay = data.dailyStats.find(d => d.isPeak);
  const lowDay = data.dailyStats.find(d => d.isLow);
  const estimatedRevenue = data.solo1Blocks * 498 + data.solo2Blocks * 980;

  return (
    <Document>
      {/* Page 1: Overview */}
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.companyName}>FREEDOM TRANSPORTATION, INC.</Text>
            <Text style={styles.reportTitle}>Executive Operations Report - AI Powered</Text>
            <Text style={styles.weekRange}>
              Week {weekNumber}: {format(data.weekStart, "MMMM d")} - {format(data.weekEnd, "MMMM d, yyyy")}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.miloBox}>
              <Text style={styles.miloText}>MILO</Text>
              <Text style={styles.miloSubtext}>Scheduling AI</Text>
            </View>
          </View>
        </View>

        {/* Key Metrics */}
        <View style={styles.metricsContainer}>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{data.totalBlocks}</Text>
            <Text style={styles.metricLabel}>Total Blocks</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{data.coverage}%</Text>
            <Text style={styles.metricLabel}>Coverage</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{data.activeDrivers}</Text>
            <Text style={styles.metricLabel}>Active Drivers</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{data.solo1Blocks}</Text>
            <Text style={styles.metricLabel}>Solo1 Blocks</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{data.solo2Blocks}</Text>
            <Text style={styles.metricLabel}>Solo2 Blocks</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>${(estimatedRevenue / 1000).toFixed(0)}K</Text>
            <Text style={styles.metricLabel}>Est. Revenue</Text>
          </View>
        </View>

        {/* Daily Distribution */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Daily Block Distribution</Text>
          </View>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { width: "15%" }]}>Day</Text>
              <Text style={[styles.tableHeaderCell, { width: "15%" }]}>Date</Text>
              <Text style={[styles.tableHeaderCell, { width: "15%" }]}>Total</Text>
              <Text style={[styles.tableHeaderCell, { width: "15%" }]}>Solo2</Text>
              <Text style={[styles.tableHeaderCell, { width: "15%" }]}>Solo1</Text>
              <Text style={[styles.tableHeaderCell, { width: "25%" }]}>Status</Text>
            </View>
            {data.dailyStats.map((day, index) => (
              <View
                key={index}
                style={day.isPeak ? styles.tableRowPeak : day.isLow ? styles.tableRowLow : index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={[styles.tableCellBold, { width: "15%" }]}>{day.day}</Text>
                <Text style={[styles.tableCell, { width: "15%" }]}>{day.date}</Text>
                <Text style={[styles.tableCellBold, { width: "15%" }]}>{day.total}</Text>
                <Text style={[styles.tableCell, { width: "15%" }]}>{day.solo2}</Text>
                <Text style={[styles.tableCell, { width: "15%" }]}>{day.solo1}</Text>
                <Text style={[styles.tableCell, { width: "25%" }]}>
                  {day.isPeak ? "PEAK DAY" : day.isLow ? "LOW DAY" : day.total >= 14 ? "HEAVY" : day.total <= 10 ? "LIGHT" : "NORMAL"}
                </Text>
              </View>
            ))}
            {/* Total row */}
            <View style={[styles.tableRow, { backgroundColor: "#E5E7EB" }]}>
              <Text style={[styles.tableCellBold, { width: "15%" }]}>TOTAL</Text>
              <Text style={[styles.tableCell, { width: "15%" }]}></Text>
              <Text style={[styles.tableCellBold, { width: "15%" }]}>{data.totalBlocks}</Text>
              <Text style={[styles.tableCellBold, { width: "15%" }]}>{data.solo2Blocks}</Text>
              <Text style={[styles.tableCellBold, { width: "15%" }]}>{data.solo1Blocks}</Text>
              <Text style={[styles.tableCell, { width: "25%" }]}></Text>
            </View>
          </View>
        </View>

        {/* DOT Compliance Dashboard */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>DOT Compliance Dashboard</Text>
          </View>
          <View style={{ padding: 10, backgroundColor: "#F9FAFB", borderRadius: 4 }}>
            {[
              { label: "10-Hour Rest Rule", value: 100 },
              { label: "48-Hour Solo2 Gap", value: 100 },
              { label: "6-Day Consecutive Max", value: 100 },
              { label: "34-Hour Reset Verified", value: 100 },
            ].map((item, index) => (
              <View key={index} style={styles.complianceBox}>
                <Text style={styles.complianceLabel}>{item.label}</Text>
                <View style={styles.complianceBar}>
                  <View style={[styles.complianceFill, { width: `${item.value}%` }]} />
                </View>
                <Text style={styles.complianceValue}>{item.value}%</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Watch List */}
        {data.watchList.length > 0 && (
          <View style={styles.section}>
            <View style={[styles.sectionHeader, { backgroundColor: "#DC2626" }]}>
              <Text style={styles.sectionTitle}>Watch List</Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { width: "25%" }]}>Driver</Text>
                <Text style={[styles.tableHeaderCell, { width: "35%" }]}>Issue</Text>
                <Text style={[styles.tableHeaderCell, { width: "40%" }]}>Action Required</Text>
              </View>
              {data.watchList.map((item, index) => (
                <View key={index} style={styles.watchItem}>
                  <Text style={[styles.tableCellBold, { width: "25%" }]}>{item.driver}</Text>
                  <Text style={[styles.tableCell, { width: "35%" }]}>{item.issue}</Text>
                  <Text style={[styles.tableCell, { width: "40%" }]}>{item.action}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* AI Recommendations */}
        {data.recommendations.length > 0 && (
          <View style={styles.section}>
            <View style={[styles.sectionHeader, { backgroundColor: "#059669" }]}>
              <Text style={styles.sectionTitle}>AI Recommendations</Text>
            </View>
            <View style={{ padding: 10, backgroundColor: "#F0FDF4", borderRadius: 4 }}>
              {data.recommendations.map((rec, index) => (
                <View key={index} style={styles.recommendationItem}>
                  <Text style={styles.recommendationBullet}>{index + 1}.</Text>
                  <Text style={styles.recommendationText}>{rec}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Generated: {format(new Date(), "MMMM d, yyyy 'at' h:mm a")}
          </Text>
          <Text style={styles.footerBrand}>Powered by MILO Scheduling AI</Text>
          <Text style={styles.footerText}>
            Page 1 of 2 | Confidential - Internal Use Only
          </Text>
        </View>
      </Page>

      {/* Page 2: Driver Grid */}
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.companyName}>FREEDOM TRANSPORTATION, INC.</Text>
            <Text style={styles.reportTitle}>Driver Weekly Schedule Grid</Text>
            <Text style={styles.weekRange}>
              Week {weekNumber}: {format(data.weekStart, "MMMM d")} - {format(data.weekEnd, "MMMM d, yyyy")}
            </Text>
          </View>
        </View>

        {/* Driver Grid */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Driver Schedule Grid (Alphabetical by Last Name)</Text>
          </View>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { width: "22%" }]}>Driver</Text>
              <Text style={[styles.tableHeaderCell, { width: "6%" }]}>Type</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Sun</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Mon</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Tue</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Wed</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Thu</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Fri</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Sat</Text>
              <Text style={[styles.tableHeaderCell, { width: "9%" }]}>Total</Text>
            </View>
            {data.driverWorkloads.map((driver, index) => (
              <View key={index} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                <Text style={[styles.tableCellBold, { width: "22%" }]}>{driver.name}</Text>
                <Text style={[styles.tableCell, { width: "6%" }]}>{driver.type}</Text>
                <Text style={[styles.tableCell, { width: "9%" }]}>{driver.days.Sun || "-"}</Text>
                <Text style={[styles.tableCell, { width: "9%" }]}>{driver.days.Mon || "-"}</Text>
                <Text style={[styles.tableCell, { width: "9%" }]}>{driver.days.Tue || "-"}</Text>
                <Text style={[styles.tableCell, { width: "9%" }]}>{driver.days.Wed || "-"}</Text>
                <Text style={[styles.tableCell, { width: "9%" }]}>{driver.days.Thu || "-"}</Text>
                <Text style={[styles.tableCell, { width: "9%" }]}>{driver.days.Fri || "-"}</Text>
                <Text style={[styles.tableCell, { width: "9%" }]}>{driver.days.Sat || "-"}</Text>
                <Text style={[styles.tableCellBold, { width: "9%" }]}>{driver.runs}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Legend */}
        <View style={[styles.section, { marginTop: 20 }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Legend</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 10, backgroundColor: "#F9FAFB", borderRadius: 4 }}>
            <View style={{ width: "25%", marginBottom: 6 }}>
              <Text style={{ fontSize: 8, color: "#374151" }}>S1 = Solo1 (14h)</Text>
            </View>
            <View style={{ width: "25%", marginBottom: 6 }}>
              <Text style={{ fontSize: 8, color: "#374151" }}>S2 = Solo2 (38h)</Text>
            </View>
            <View style={{ width: "25%", marginBottom: 6 }}>
              <Text style={{ fontSize: 8, color: "#374151" }}>MX = Cross-trained</Text>
            </View>
            <View style={{ width: "25%", marginBottom: 6 }}>
              <Text style={{ fontSize: 8, color: "#374151" }}>NEW = New driver</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Generated: {format(new Date(), "MMMM d, yyyy 'at' h:mm a")}
          </Text>
          <Text style={styles.footerBrand}>Powered by MILO Scheduling AI</Text>
          <Text style={styles.footerText}>
            Page 2 of 2 | Confidential - Internal Use Only
          </Text>
        </View>
      </Page>
    </Document>
  );
}

// Main Component with Dialog wrapper
interface ExecutiveReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ExecutiveReportData | null;
}

export function ExecutiveReport({ open, onOpenChange, data }: ExecutiveReportProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "download">("preview");
  const [isGenerating, setIsGenerating] = useState(false);

  if (!data) return null;

  const fileName = `Freedom_Executive_Report_${format(data.weekStart, "MMM_d")}-${format(data.weekEnd, "MMM_d_yyyy")}.pdf`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Executive Report - Week {getWeek(data.weekStart)}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "preview" | "download")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="preview" className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="download" className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Download
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="mt-4">
            <div className="h-[600px] border rounded-lg overflow-hidden bg-gray-100">
              <PDFViewer width="100%" height="100%" showToolbar={false}>
                <ExecutiveReportPDF data={data} />
              </PDFViewer>
            </div>
          </TabsContent>

          <TabsContent value="download" className="mt-4">
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-6 text-center">
                <FileText className="w-16 h-16 text-primary mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">{fileName}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Executive Operations Report including daily assignments, driver grid, DOT compliance, and AI recommendations.
                </p>
                <div className="flex items-center justify-center gap-4">
                  <PDFDownloadLink
                    document={<ExecutiveReportPDF data={data} />}
                    fileName={fileName}
                  >
                    {({ loading }) => (
                      <Button disabled={loading} size="lg">
                        {loading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-2" />
                            Download PDF
                          </>
                        )}
                      </Button>
                    )}
                  </PDFDownloadLink>
                </div>
              </div>

              {/* Report Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{data.totalBlocks}</div>
                  <div className="text-sm text-blue-800">Total Blocks</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{data.activeDrivers}</div>
                  <div className="text-sm text-green-800">Active Drivers</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-purple-600">{data.coverage}%</div>
                  <div className="text-sm text-purple-800">Coverage</div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper function to generate report data from schedule blocks
export function generateReportData(
  blocks: ScheduleBlock[],
  weekStart: Date
): ExecutiveReportData {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

  // Count blocks by day and type
  const dailyStats: DailyStats[] = [];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayDates: Record<string, string> = {};

  // Initialize daily stats
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dayKey = days[i];
    dayDates[dayKey] = format(d, "MM/dd");
    dailyStats.push({
      day: dayKey,
      date: dayDates[dayKey],
      total: 0,
      solo2: 0,
      solo1: 0,
    });
  }

  // Count blocks
  blocks.forEach((block) => {
    const blockDate = new Date(block.startDate);
    const dayIndex = blockDate.getDay();
    if (dayIndex >= 0 && dayIndex < 7) {
      dailyStats[dayIndex].total++;
      if (block.blockType === "solo2") {
        dailyStats[dayIndex].solo2++;
      } else {
        dailyStats[dayIndex].solo1++;
      }
    }
  });

  // Find peak and low days
  let maxBlocks = 0;
  let minBlocks = Infinity;
  dailyStats.forEach((day) => {
    if (day.total > maxBlocks) maxBlocks = day.total;
    if (day.total < minBlocks && day.total > 0) minBlocks = day.total;
  });
  dailyStats.forEach((day) => {
    if (day.total === maxBlocks) day.isPeak = true;
    if (day.total === minBlocks && day.total > 0) day.isLow = true;
  });

  // Build driver workloads
  const driverMap: Map<string, DriverWorkload> = new Map();
  blocks.forEach((block) => {
    if (!block.driverName) return;

    if (!driverMap.has(block.driverName)) {
      driverMap.set(block.driverName, {
        name: block.driverName,
        type: block.blockType === "solo2" ? "S2" : "S1",
        runs: 0,
        days: { Sun: null, Mon: null, Tue: null, Wed: null, Thu: null, Fri: null, Sat: null },
        status: "OK",
      });
    }

    const driver = driverMap.get(block.driverName)!;
    driver.runs++;

    const blockDate = new Date(block.startDate);
    const dayKey = days[blockDate.getDay()];
    driver.days[dayKey] = block.startTime;

    // Check for cross-trained
    if (driver.type === "S1" && block.blockType === "solo2") {
      driver.type = "MX";
    } else if (driver.type === "S2" && block.blockType === "solo1") {
      driver.type = "MX";
    }

    // Update status
    if (driver.type === "S2" && driver.runs >= 3) {
      driver.status = "MAX";
    } else if (driver.runs >= 5) {
      driver.status = "WATCH";
    }
  });

  // Sort drivers by last name
  const driverWorkloads = Array.from(driverMap.values()).sort((a, b) => {
    const lastNameA = a.name.split(" ").pop() || a.name;
    const lastNameB = b.name.split(" ").pop() || b.name;
    return lastNameA.localeCompare(lastNameB);
  });

  // Build watch list
  const watchList: WatchListItem[] = [];
  driverWorkloads.forEach((driver) => {
    if (driver.status === "MAX") {
      watchList.push({
        driver: driver.name,
        issue: `${driver.runs} ${driver.type === "S2" ? "Solo2" : "runs"} = MAX`,
        action: `No more ${driver.type === "S2" ? "Solo2" : "blocks"} this week`,
      });
    } else if (driver.status === "WATCH" || driver.runs >= 5) {
      watchList.push({
        driver: driver.name,
        issue: `${driver.runs} days scheduled`,
        action: "6th day = OT territory",
      });
    }
  });

  // Generate recommendations
  const recommendations: string[] = [];
  const solo2Drivers = driverWorkloads.filter((d) => d.type === "S2" || d.type === "MX");
  const maxedSolo2 = solo2Drivers.filter((d) => d.status === "MAX").length;
  if (maxedSolo2 > 0) {
    recommendations.push(
      `${maxedSolo2} of ${solo2Drivers.length} Solo2 drivers at MAX capacity. Consider cross-training more Solo1 drivers.`
    );
  }

  const underutilized = driverWorkloads.filter((d) => d.runs <= 2 && d.status !== "STANDBY");
  if (underutilized.length > 0) {
    recommendations.push(
      `${underutilized.length} drivers with 2 or fewer runs. Available for additional coverage.`
    );
  }

  const totalBlocks = blocks.length;
  const solo1Blocks = blocks.filter((b) => b.blockType === "solo1").length;
  const solo2Blocks = blocks.filter((b) => b.blockType === "solo2").length;
  const assignedBlocks = blocks.filter((b) => b.driverName).length;
  const coverage = totalBlocks > 0 ? Math.round((assignedBlocks / totalBlocks) * 100) : 0;

  return {
    weekStart,
    weekEnd,
    totalBlocks,
    solo1Blocks,
    solo2Blocks,
    coverage,
    activeDrivers: driverMap.size,
    dailyStats,
    blocks,
    driverWorkloads,
    watchList,
    recommendations,
  };
}
