import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ImportResult {
  success: boolean;
  message: string;
  created: number;
  failed: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  committedWithWarnings: number;
}

export default function ScheduleImport() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importMode, setImportMode] = useState<'block' | 'shift'>('shift'); // Default to new shift-based mode
  const { toast } = useToast();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        setSelectedFile(file);
        setResult(null);
      } else {
        toast({
          variant: "destructive",
          title: "Invalid file",
          description: "Please select an Excel file (.xlsx or .xls)",
        });
      }
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      toast({
        variant: "destructive",
        title: "No file selected",
        description: "Please select an Excel file to import",
      });
      return;
    }

    setImporting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('importMode', importMode);

      const response = await fetch('/api/schedules/excel-import', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = await response.json();

      // Show results even if some rows failed
      setResult(data);
      
      if (data.created > 0) {
        toast({
          title: data.failed > 0 ? "Partial import" : "Import successful",
          description: data.message,
          variant: data.failed > 0 ? "default" : "default",
        });
      } else if (data.failed > 0) {
        toast({
          variant: "destructive",
          title: "Import failed",
          description: "No assignments were created. See errors below.",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error.message || "Failed to import schedule",
      });
      setResult({
        success: false,
        message: error.message || "Failed to import schedule",
        created: 0,
        failed: 0,
        skipped: 0,
        errors: [error.message || "Unknown error occurred"],
        warnings: [],
        committedWithWarnings: 0,
      });
    } finally {
      setImporting(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setResult(null);
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Schedule Import</h1>
        <p className="text-muted-foreground mt-2">
          Import driver schedules from Excel files. The system will validate assignments and enforce all scheduling rules.
        </p>
      </div>

      <div className="space-y-6">
        {/* File Upload Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Upload Excel File
            </CardTitle>
            <CardDescription>
              Expected columns: Block ID, Driver Name, Operator ID
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* File Input */}
            <div className="flex items-center gap-4">
              <label
                htmlFor="file-upload"
                className="flex-1 cursor-pointer border-2 border-dashed rounded-lg p-8 text-center hover-elevate transition-colors"
                data-testid="label-file-upload"
              >
                <input
                  id="file-upload"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-file-upload"
                />
                <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                {selectedFile ? (
                  <div>
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {(selectedFile.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium">Click to upload Excel file</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      .xlsx or .xls format
                    </p>
                  </div>
                )}
              </label>
            </div>

            {/* Import Mode Toggle */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="import-mode" className="text-base font-medium">
                    Import Mode
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {importMode === 'shift' 
                      ? 'Contract Slot Mode (Recommended): Uses stable operator IDs for weekly re-imports'
                      : 'Legacy Block Mode: Uses transient block IDs (for backward compatibility)'}
                  </p>
                </div>
                <Switch
                  id="import-mode"
                  checked={importMode === 'shift'}
                  onCheckedChange={(checked) => setImportMode(checked ? 'shift' : 'block')}
                  disabled={importing}
                  data-testid="switch-import-mode"
                />
              </div>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {importMode === 'shift' ? (
                    <>
                      <strong>Contract Slot Mode:</strong> Creates shift templates and occurrences based on operator IDs. 
                      Supports weekly re-imports while preserving historical data for rolling 6-day DOT compliance.
                    </>
                  ) : (
                    <>
                      <strong>Legacy Block Mode:</strong> Creates assignments using Amazon's block IDs. 
                      Compatible with older imports but requires manual cleanup for weekly re-imports.
                    </>
                  )}
                </AlertDescription>
              </Alert>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleImport}
                disabled={!selectedFile || importing}
                className="flex-1"
                data-testid="button-import"
              >
                {importing ? (
                  <>Importing...</>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import Schedule ({importMode === 'shift' ? 'Contract Slot' : 'Legacy'})
                  </>
                )}
              </Button>
              {selectedFile && (
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={importing}
                  data-testid="button-reset"
                >
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Results Card */}
        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.created > 0 && result.failed === 0 ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    Import Successful
                  </>
                ) : result.created > 0 && result.failed > 0 ? (
                  <>
                    <AlertTriangle className="w-5 h-5 text-yellow-600" />
                    Partial Import
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5 text-red-600" />
                    Import Failed
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {result.created}
                  </div>
                  <div className="text-sm text-muted-foreground">Created</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-red-600">
                    {result.failed}
                  </div>
                  <div className="text-sm text-muted-foreground">Failed</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">
                    {result.committedWithWarnings}
                  </div>
                  <div className="text-sm text-muted-foreground">Warnings</div>
                </div>
              </div>

              {/* Errors */}
              {result.errors.length > 0 && (
                <Alert variant="destructive" data-testid="alert-errors">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>Errors ({result.errors.length})</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                      {result.errors.map((error, index) => (
                        <li key={index} className="text-sm">
                          • {error}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <Alert data-testid="alert-warnings">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Warnings ({result.warnings.length})</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                      {result.warnings.map((warning, index) => (
                        <li key={index} className="text-sm">
                          • {warning}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* Instructions Card */}
        <Card>
          <CardHeader>
            <CardTitle>Excel Format Requirements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <h4 className="font-medium mb-2">Required Columns:</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• <strong>Block ID</strong> - Block identifier (e.g., "B-00000001")</li>
                <li>• <strong>Driver Name</strong> - Full driver name (e.g., "John Smith")</li>
                <li>• <strong>Operator ID</strong> - Contract identifier (e.g., "FTIM_MKC_Solo1_Tractor_2_d2")</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Validation:</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• Block IDs must exist in the system</li>
                <li>• Driver names must match exactly (first + last name)</li>
                <li>• Blocks cannot be assigned to multiple drivers</li>
                <li>• Drivers cannot have time overlaps</li>
                <li>• All DOT compliance and rolling-6 rules are enforced</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
