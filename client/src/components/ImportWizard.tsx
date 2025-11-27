import { useState, useCallback } from "react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { Upload, FileSpreadsheet, Calendar, History, Sparkles, X, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ImportFile {
  file: File;
  type: "new_week" | "actuals" | "unknown";
  detectedWeek?: { start: Date; end: Date };
}

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (files: ImportFile[], importType: "new_week" | "actuals" | "both") => void;
  currentWeekStart: Date;
}

export function ImportWizard({ open, onOpenChange, onImport, currentWeekStart }: ImportWizardProps) {
  const [step, setStep] = useState<"upload" | "identify" | "confirm">("upload");
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [importType, setImportType] = useState<"new_week" | "actuals" | "unknown">("unknown");

  // Calculate week ranges for display
  const thisWeekStart = startOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const thisWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const nextWeekStart = addWeeks(thisWeekStart, 1);
  const nextWeekEnd = addWeeks(thisWeekEnd, 1);
  const lastWeekStart = subWeeks(thisWeekStart, 1);
  const lastWeekEnd = subWeeks(thisWeekEnd, 1);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const newFiles: ImportFile[] = Array.from(selectedFiles).map(file => ({
        file,
        type: "unknown" as const,
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleContinueFromUpload = () => {
    if (files.length === 0) return;
    setStep("identify");
  };

  const handleConfirmType = () => {
    if (importType === "unknown") return;

    // Update all files with the selected type
    const updatedFiles = files.map(f => ({ ...f, type: importType }));
    setFiles(updatedFiles);
    setStep("confirm");
  };

  const handleImport = () => {
    onImport(files, importType as "new_week" | "actuals" | "both");
    handleClose();
  };

  const handleClose = () => {
    setStep("upload");
    setFiles([]);
    setImportType("unknown");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {step === "upload" && "Import Schedule Files"}
            {step === "identify" && "What are you importing?"}
            {step === "confirm" && "Confirm Import"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload Files */}
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
                    Drop your Amazon schedule file(s) below. You can upload multiple files at once -
                    I'll help you identify what each one is.
                  </p>
                </div>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">
                Drag & drop files here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Supports .xlsx, .xls, .csv
              </p>
              <input
                id="file-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

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

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleContinueFromUpload}
                disabled={files.length === 0}
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-1" />
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
                    I see you're uploading <strong>{files.length} file{files.length > 1 ? 's' : ''}</strong>.
                    Which type of import is this?
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
                      ? "I'll process these files and auto-assign drivers based on historical patterns. After import, click 'Analyze Now' to review assignments."
                      : "I'll compare this against your existing records and show you any differences. You can review changes before confirming."}
                  </p>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Files to import:</span>
                <span className="text-sm font-medium">{files.length}</span>
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
            </div>

            {/* File list */}
            <div className="space-y-2">
              {files.map((f, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                  <span className="truncate">{f.file.name}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep("identify")}>
                Back
              </Button>
              <Button onClick={handleImport}>
                <Upload className="w-4 h-4 mr-2" />
                Import {files.length > 1 ? "Files" : "File"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
