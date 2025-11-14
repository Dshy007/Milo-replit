import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, Info, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";

interface ImportResult {
  created: number;
  failed: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  committedWithWarnings: number;
  debugLog?: string[];
}

interface ScheduleImportPanelProps {
  file: File | null;
  onImport: (formData: FormData) => Promise<ImportResult>;
  isImporting: boolean;
}

export function ScheduleImportPanel({ file, onImport, isImporting }: ScheduleImportPanelProps) {
  const [importMode, setImportMode] = useState<'block' | 'shift'>('block');
  const [debugMode, setDebugMode] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    if (!file) return;

    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('importMode', importMode);
      formData.append('debugMode', String(debugMode));

      const importResult = await onImport(formData);
      setResult(importResult);
    } catch (error: any) {
      setResult({
        created: 0,
        failed: 1,
        skipped: 0,
        committedWithWarnings: 0,
        errors: [error.message || 'Import failed'],
        warnings: [],
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Import Mode Toggle */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="import-mode" className="text-base font-medium">
              Import Mode
            </Label>
            <p className="text-sm text-muted-foreground">
              {importMode === 'block' 
                ? 'Block Mode: Use Amazon Block IDs for assignment tracking'
                : 'Shift Mode: Use Contract Slots (operatorId + tractorId) for tracking'}
            </p>
          </div>
          <Switch
            id="import-mode"
            checked={importMode === 'shift'}
            onCheckedChange={(checked) => setImportMode(checked ? 'shift' : 'block')}
            disabled={isImporting}
            data-testid="switch-import-mode"
          />
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {importMode === 'block' ? (
              <>
                <strong>Block Mode (Recommended):</strong> Tracks assignments using Amazon's Block IDs. 
                This is the proven approach for weekly re-imports and DOT compliance.
              </>
            ) : (
              <>
                <strong>Shift Mode (Experimental):</strong> Tracks assignments using Contract Slots (operatorId + tractorId + start time). 
                This approach is under development for future multi-week scheduling.
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>

      {/* Debug Mode Toggle */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="debug-mode" className="text-base font-medium">
              Debug Mode
            </Label>
            <p className="text-sm text-muted-foreground">
              {debugMode 
                ? 'Enabled: Detailed logging will be included in the import report'
                : 'Disabled: Standard logging only'}
            </p>
          </div>
          <Switch
            id="debug-mode"
            checked={debugMode}
            onCheckedChange={setDebugMode}
            disabled={isImporting}
            data-testid="switch-debug-mode"
          />
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {debugMode ? (
              <>
                <strong>Debug Mode:</strong> Shows detailed information about each row including Operator ID parsing, 
                truck extraction, contract matching, driver lookup, and time overlap analysis. Useful for troubleshooting import issues.
              </>
            ) : (
              <>
                <strong>Standard Mode:</strong> Shows summary results and error messages only.
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>

      {/* Import Button */}
      <Button
        onClick={handleImport}
        disabled={!file || isImporting}
        className="w-full"
        data-testid="button-import-schedule"
      >
        {isImporting ? (
          <>Importing...</>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Import Schedule
          </>
        )}
      </Button>

      {/* Results */}
      {result && (
        <div className="space-y-4 mt-6">
          {/* Summary Header */}
          <div className="flex items-center gap-2">
            {result.created > 0 && result.failed === 0 ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold">Import Successful</h3>
              </>
            ) : result.created > 0 && result.failed > 0 ? (
              <>
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                <h3 className="font-semibold">Partial Import</h3>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-red-600" />
                <h3 className="font-semibold">Import Failed</h3>
              </>
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-4">
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
              <div className="text-2xl font-bold text-blue-600">
                {result.skipped}
              </div>
              <div className="text-sm text-muted-foreground">Skipped</div>
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

          {/* Debug Log */}
          {result.debugLog && result.debugLog.length > 0 && (
            <Alert data-testid="alert-debug-log">
              <Info className="h-4 w-4" />
              <AlertTitle>Debug Log ({result.debugLog.length} entries)</AlertTitle>
              <AlertDescription>
                <div className="mt-2 max-h-96 overflow-y-auto">
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-muted p-3 rounded">
                    {result.debugLog.join('\n')}
                  </pre>
                </div>
                <p className="text-sm mt-2">
                  You can copy and paste this debug log to troubleshoot import issues.
                </p>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
