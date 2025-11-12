import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Upload, Download, FileText, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface CSVRow {
  "Driver Name": string;
  "Contract Name": string;
  "Solo Type": string;
  "Day of Week": string;
  "Start Time": string;
  "End Time": string;
}

interface ValidationResult {
  rowIndex: number;
  originalRow: CSVRow;
  status: "valid" | "warning" | "error";
  errors: string[];
  warnings: string[];
  driverId?: string;
  blockId?: string;
  contractName?: string;
  blockDisplayId?: string;
}

export default function CSVImport() {
  const { toast } = useToast();
  const [csvRows, setCSVRows] = useState<CSVRow[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  // Mutation for validation
  const validateMutation = useMutation({
    mutationFn: async (rows: CSVRow[]) => {
      const response = await apiRequest("POST", "/api/schedules/import-validate", { csvRows: rows });
      return response.json() as Promise<ValidationResult[]>;
    },
    onSuccess: (data) => {
      setValidationResults(data);
      const validCount = data.filter((r) => r.status === "valid").length;
      const warningCount = data.filter((r) => r.status === "warning").length;
      const errorCount = data.filter((r) => r.status === "error").length;

      toast({
        title: "Validation Complete",
        description: `✅ ${validCount} valid, ⚠️ ${warningCount} warnings, ❌ ${errorCount} errors`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Validation Failed",
        description: error.message || "Failed to validate CSV",
        variant: "destructive",
      });
    },
  });

  // Mutation for commit
  const commitMutation = useMutation({
    mutationFn: async (rows: ValidationResult[]) => {
      const response = await apiRequest("POST", "/api/schedules/import-commit", { validatedRows: rows });
      return response.json() as Promise<{ 
        created: number; 
        failed: number; 
        errors: string[];
        warnings: string[];
        committedWithWarnings: number;
      }>;
    },
    onSuccess: (data) => {
      const messages = [];
      if (data.created > 0) {
        messages.push(`✅ Created ${data.created} assignments`);
      }
      if (data.committedWithWarnings > 0) {
        messages.push(`⚠️ ${data.committedWithWarnings} with warnings`);
      }
      if (data.failed > 0) {
        messages.push(`❌ ${data.failed} failed`);
      }

      toast({
        title: "Import Complete",
        description: messages.join(", "),
      });

      // Show warnings if any
      if (data.warnings.length > 0) {
        console.log("Import warnings:", data.warnings);
      }

      // Reset state
      setCSVRows([]);
      setValidationResults([]);
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import CSV",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    // Handle Excel files (.xlsx, .xls)
    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const data = event.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet) as CSVRow[];
          
          setCSVRows(jsonData);
          setValidationResults([]);
          
          toast({
            title: "Excel File Loaded",
            description: `Parsed ${jsonData.length} rows from ${file.name}`,
          });
        } catch (error: any) {
          toast({
            title: "Parse Error",
            description: error.message || "Failed to parse Excel file",
            variant: "destructive",
          });
        }
      };
      
      reader.readAsBinaryString(file);
    } 
    // Handle CSV files
    else if (fileExtension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as CSVRow[];
          setCSVRows(rows);
          setValidationResults([]);
          
          toast({
            title: "CSV Loaded",
            description: `Parsed ${rows.length} rows from ${file.name}`,
          });
        },
        error: (error) => {
          toast({
            title: "Parse Error",
            description: error.message,
            variant: "destructive",
          });
        },
      });
    } else {
      toast({
        title: "Invalid File Type",
        description: "Please upload a CSV or Excel (.xlsx, .xls) file",
        variant: "destructive",
      });
    }
  };

  const handleValidate = () => {
    if (csvRows.length === 0) {
      toast({
        title: "No Data",
        description: "Please upload a CSV file first",
        variant: "destructive",
      });
      return;
    }

    setIsValidating(true);
    validateMutation.mutate(csvRows);
    setIsValidating(false);
  };

  const handleCommit = () => {
    const validRows = validationResults.filter(
      (r) => r.status === "valid" || r.status === "warning"
    );

    if (validRows.length === 0) {
      toast({
        title: "No Valid Rows",
        description: "There are no valid rows to import. Fix errors and try again.",
        variant: "destructive",
      });
      return;
    }

    // Only commit valid/warning rows, not error rows
    commitMutation.mutate(validRows);
  };

  const downloadTemplate = () => {
    const template = `Driver Name,Contract Name,Solo Type,Day of Week,Start Time,End Time
John Smith,Freedom Transportation #1,Solo1,Monday,08:00,16:00
Sarah Jones,Freedom Transportation #3,Solo2,Monday,14:00,22:00
Mike Davis,Freedom Transportation #2,Solo1,Tuesday,08:00,16:00`;

    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schedule_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = validationResults.filter((r) => r.status === "valid").length;
  const warningCount = validationResults.filter((r) => r.status === "warning").length;
  const errorCount = validationResults.filter((r) => r.status === "error").length;

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">CSV/Excel Schedule Import</h1>
        <p className="text-muted-foreground">
          Bulk import driver schedules from a CSV or Excel file
        </p>
      </div>

      {/* Step 1: Upload CSV */}
      <Card className="mb-6" data-testid="card-csv-upload">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Step 1: Upload File
          </CardTitle>
          <CardDescription>
            Upload a CSV or Excel file (.csv, .xlsx, .xls) with driver schedules. Make sure it includes the required columns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                data-testid="input-csv-file"
              />
            </div>
            <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          {csvRows.length > 0 && (
            <Alert className="mt-4">
              <FileText className="h-4 w-4" />
              <AlertDescription>
                Loaded {csvRows.length} rows from CSV
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleValidate}
            disabled={csvRows.length === 0 || isValidating}
            data-testid="button-validate"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Validate
          </Button>
        </CardFooter>
      </Card>

      {/* Step 2: Validation Results */}
      {validationResults.length > 0 && (
        <Card className="mb-6" data-testid="card-validation-results">
          <CardHeader>
            <CardTitle>Step 2: Review Validation Results</CardTitle>
            <CardDescription>
              {validCount > 0 && (
                <span className="text-green-600 font-medium">
                  ✅ {validCount} valid
                </span>
              )}
              {warningCount > 0 && (
                <span className="text-yellow-600 font-medium ml-4">
                  ⚠️ {warningCount} warnings
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-red-600 font-medium ml-4">
                  ❌ {errorCount} errors
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Contract</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Block</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Messages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validationResults.map((result) => (
                    <TableRow
                      key={result.rowIndex}
                      className={
                        result.status === "error"
                          ? "bg-red-50 dark:bg-red-950/20"
                          : result.status === "warning"
                          ? "bg-yellow-50 dark:bg-yellow-950/20"
                          : ""
                      }
                      data-testid={`row-validation-${result.rowIndex}`}
                    >
                      <TableCell>{result.rowIndex}</TableCell>
                      <TableCell className="font-medium">
                        {result.originalRow["Driver Name"]}
                      </TableCell>
                      <TableCell className="text-sm">
                        {result.originalRow["Contract Name"]}
                      </TableCell>
                      <TableCell>{result.originalRow["Solo Type"]}</TableCell>
                      <TableCell>{result.originalRow["Day of Week"]}</TableCell>
                      <TableCell className="text-sm">
                        {result.originalRow["Start Time"]} - {result.originalRow["End Time"]}
                      </TableCell>
                      <TableCell className="text-sm">
                        {result.blockDisplayId || "-"}
                      </TableCell>
                      <TableCell>
                        {result.status === "valid" && (
                          <Badge variant="default" className="bg-green-600" data-testid="badge-status-valid">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Valid
                          </Badge>
                        )}
                        {result.status === "warning" && (
                          <Badge variant="secondary" className="bg-yellow-600 text-white" data-testid="badge-status-warning">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Warning
                          </Badge>
                        )}
                        {result.status === "error" && (
                          <Badge variant="destructive" data-testid="badge-status-error">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Error
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {result.errors.length > 0 && (
                          <div className="text-red-600 dark:text-red-400">
                            {result.errors.map((err, idx) => (
                              <div key={idx}>• {err}</div>
                            ))}
                          </div>
                        )}
                        {result.warnings.length > 0 && (
                          <div className="text-yellow-600 dark:text-yellow-400">
                            {result.warnings.map((warn, idx) => (
                              <div key={idx}>• {warn}</div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setValidationResults([]);
                setCSVRows([]);
              }}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCommit}
              disabled={validCount === 0 || commitMutation.isPending}
              data-testid="button-commit"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {commitMutation.isPending ? "Importing..." : `Import ${validCount} Valid Rows`}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>CSV Format Requirements</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-2">Your CSV must include the following columns (in any order):</p>
          <ul className="list-disc list-inside space-y-1 mb-4">
            <li><strong>Driver Name</strong>: Full name (e.g., "John Smith")</li>
            <li><strong>Contract Name</strong>: Exact contract name (e.g., "Freedom Transportation #1")</li>
            <li><strong>Solo Type</strong>: Solo1, Solo2, or Team</li>
            <li><strong>Day of Week</strong>: Monday, Tuesday, etc.</li>
            <li><strong>Start Time</strong>: HH:MM format (e.g., "08:00", "14:00")</li>
            <li><strong>End Time</strong>: HH:MM format (optional, for reference)</li>
          </ul>
          <p className="text-xs">
            <strong>Note</strong>: The system will automatically match these to existing blocks in the database.
            Make sure drivers and contracts exist before importing.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
