import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, AlertCircle, CheckCircle2, Download } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

type EntityType = "schedules" | "drivers" | "trucks" | "startTimes";

interface PreviewRow {
  data: Record<string, any>;
  rowIndex: number;
  errors?: string[];
}

export default function Import() {
  const { toast } = useToast();
  const [entityType, setEntityType] = useState<EntityType>("drivers");
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [fullData, setFullData] = useState<any[]>([]); // Store all parsed rows for import

  const importMutation = useMutation({
    mutationFn: async (data: { entityType: EntityType; rows: any[]; file?: File }) => {
      // For schedules, use specialized Excel import endpoint
      if (data.entityType === "schedules" && data.file) {
        const formData = new FormData();
        formData.append("file", data.file);
        
        const response = await fetch("/api/schedules/excel-import", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to import schedule");
        }
        
        return response.json();
      }
      
      // Map startTimes to contracts endpoint
      const endpoint = data.entityType === "startTimes" ? "contracts" : data.entityType;
      
      // For other entity types, use generic import endpoint
      const response = await apiRequest("POST", `/api/import/${endpoint}`, {
        rows: data.rows,
      });
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/${entityType}`] });

      // Check if there were any validation errors
      if (result.errors && result.errors.length > 0) {
        // Partial success - some rows failed
        const errorMessages = result.errors.slice(0, 20).map((err: any) => 
          `Row ${err.row}: ${err.errors.join(', ')}`
        );
        setValidationErrors(errorMessages);
        
        toast({
          title: "Partial Import",
          description: result.message || `Imported ${result.count} of ${result.total} rows. ${result.errors.length} rows had errors.`,
          variant: result.count > 0 ? "default" : "destructive",
        });
      } else {
        // Full success - all rows imported
        toast({
          title: "Success",
          description: result.message || `Imported ${result.count} ${entityType} successfully`,
        });
        
        // Only reset state on full success
        setFile(null);
        setPreviewData([]);
        setHeaders([]);
        setValidationErrors([]);
        setFullData([]);
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: error.message || "Failed to import data",
      });
    },
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && isValidFile(files[0])) {
      processFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && isValidFile(files[0])) {
      processFile(files[0]);
    }
  };

  const isValidFile = (file: File): boolean => {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    
    // Check file extension
    const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (fileExt !== '.csv' && fileExt !== '.xlsx') {
      toast({
        variant: "destructive",
        title: "Invalid File Type",
        description: "Please upload a CSV or Excel (.xlsx) file",
      });
      return false;
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      toast({
        variant: "destructive",
        title: "File Too Large",
        description: "File size must be less than 10MB",
      });
      return false;
    }

    return true;
  };

  const processFile = (selectedFile: File) => {
    setFile(selectedFile);
    setValidationErrors([]);

    const fileExt = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
    
    if (fileExt === '.xlsx') {
      // Parse Excel file
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
          
          if (jsonData.length < 2) {
            toast({
              variant: "destructive",
              title: "Empty File",
              description: "The uploaded file contains no data",
            });
            return;
          }
          
          const headers = jsonData[0] as string[];
          const rows = jsonData.slice(1) as any[][];
          
          const MAX_ROWS = 5000;
          if (rows.length > MAX_ROWS) {
            toast({
              variant: "destructive",
              title: "Too Many Rows",
              description: `File contains ${rows.length} rows. Maximum allowed is ${MAX_ROWS}.`,
            });
            return;
          }
          
          const csvData = rows.map(row => {
            const obj: any = {};
            headers.forEach((header, index) => {
              obj[header] = row[index];
            });
            return obj;
          });
          
          setHeaders(headers);
          setFullData(csvData); // Store full data for import
          const preview = csvData.slice(0, 10).map((row, index) => ({
            data: row,
            rowIndex: index + 1,
          }));
          setPreviewData(preview);
          validateData(csvData, headers);
        } catch (error: any) {
          toast({
            variant: "destructive",
            title: "Parse Error",
            description: error.message,
          });
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    } else {
      // Parse CSV file
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            const MAX_ROWS = 5000;
            
            if (results.data.length > MAX_ROWS) {
              toast({
                variant: "destructive",
                title: "Too Many Rows",
                description: `File contains ${results.data.length} rows. Maximum allowed is ${MAX_ROWS}.`,
              });
              return;
            }

            const headers = Object.keys(results.data[0] as object);
            setHeaders(headers);
            setFullData(results.data as any[]); // Store full data for import

            const preview = results.data.slice(0, 10).map((row, index) => ({
              data: row as Record<string, any>,
              rowIndex: index + 1,
            }));
            setPreviewData(preview);

            validateData(results.data as any[], headers);
          } else {
            toast({
              variant: "destructive",
              title: "Empty File",
              description: "The uploaded file contains no data",
            });
          }
        },
        error: (error) => {
          toast({
            variant: "destructive",
            title: "Parse Error",
            description: error.message,
          });
        },
      });
    }
  };

  const validateData = (data: any[], headers: string[]) => {
    // Skip validation for schedules - specialized endpoint handles it
    if (entityType === "schedules") {
      setValidationErrors([]);
      return;
    }
    
    const errors: string[] = [];
    const requiredFields = getRequiredFields(entityType);

    // Check for missing required columns
    const missingFields = requiredFields.filter((field) => !headers.includes(field));
    if (missingFields.length > 0) {
      errors.push(`Missing required columns: ${missingFields.join(', ')}`);
    }

    // Check for empty required fields (limit error display to first 20)
    const maxErrorsToShow = 20;
    let errorCount = 0;

    for (let index = 0; index < data.length && errorCount < maxErrorsToShow; index++) {
      const row = data[index];
      for (const field of requiredFields) {
        const value = row[field];
        const isEmpty = value === null || 
                       value === undefined || 
                       (typeof value === 'string' && value.trim() === '');
        
        if (isEmpty) {
          errors.push(`Row ${index + 1}: Missing required field "${field}"`);
          errorCount++;
          if (errorCount >= maxErrorsToShow) break;
        }
      }
    }

    setValidationErrors(errors);
  };

  const getRequiredFields = (type: EntityType): string[] => {
    switch (type) {
      case "schedules":
        return []; // Specialized endpoint handles validation
      case "drivers":
        return ["firstName", "lastName"];
      case "trucks":
        return ["truckNumber", "make", "model"];
      case "startTimes":
        return ["operatorId", "soloType", "domicile", "startTime"];
      default:
        return [];
    }
  };

  const handleImport = () => {
    if (!file || previewData.length === 0) {
      toast({
        variant: "destructive",
        title: "No Data",
        description: "Please upload a file first",
      });
      return;
    }

    // Skip validation for schedules - specialized endpoint handles it
    if (entityType !== "schedules" && validationErrors.length > 0) {
      toast({
        variant: "destructive",
        title: "Validation Errors",
        description: "Please fix validation errors before importing",
      });
      return;
    }

    // Use stored full data instead of re-parsing (supports both CSV and Excel)
    importMutation.mutate({
      entityType,
      rows: fullData,
      file: entityType === "schedules" ? file : undefined,
    });
  };

  const downloadTemplate = () => {
    const templates = {
      schedules: "Block ID,Driver Name,Operator ID,Stop 1 Planned Arrival Date,Stop 1 Planned Arrival Time,Stop 2 Planned Arrival Date,Stop 2 Planned Arrival Time\nB-ABC123,John Doe,FTIM_MKC_Solo1_Tractor_1_d1,2025-11-10,08:00,2025-11-10,22:00\n",
      drivers: "firstName,lastName,email,phoneNumber,licenseNumber,licenseExpiry\nJohn,Doe,john@example.com,555-1234,DL123456,2025-12-31\n",
      trucks: "truckNumber,make,model,year,vin,licensePlate,status,lastInspection\nTRK-001,Freightliner,Cascadia,2022,1FUJGHDV8MLJA1234,IL-ABC123,active,2024-01-15\n",
      startTimes: "operatorId,soloType,domicile,startTime,tractorId\nFTIM_MKC_Solo1_Tractor_1_d1,Solo1,MKC,08:00,Tractor_1\n",
    };

    const csvContent = templates[entityType];
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entityType}_template.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <Upload className="w-5 h-5 text-primary" data-testid="import-icon" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
              Import Data
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
              Upload CSV files to import data
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={downloadTemplate}
          data-testid="button-download-template"
        >
          <Download className="w-4 h-4 mr-2" />
          Download Template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Entity Type</CardTitle>
          <CardDescription>Choose what type of data you want to import</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={entityType}
            onValueChange={(value) => {
              setEntityType(value as EntityType);
              // Reset state when changing entity type
              setFile(null);
              setPreviewData([]);
              setHeaders([]);
              setValidationErrors([]);
              setFullData([]);
            }}
          >
            <SelectTrigger className="w-[280px]" data-testid="select-entity-type">
              <SelectValue placeholder="Select entity type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="schedules">Schedules (Amazon Excel)</SelectItem>
              <SelectItem value="drivers">Drivers</SelectItem>
              <SelectItem value="trucks">Trucks</SelectItem>
              <SelectItem value="startTimes">Start Times (Contracts)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
          <CardDescription>Drag and drop your CSV file or click to browse</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`
              min-h-64 border-2 border-dashed rounded-lg
              flex flex-col items-center justify-center gap-4 p-8
              transition-all cursor-pointer hover-elevate
              ${isDragging ? 'border-primary bg-primary/5' : 'border-border bg-card'}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input')?.click()}
            data-testid="file-upload-zone"
          >
            <Upload className={`w-12 h-12 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
            
            <div className="text-center">
              <p className="text-lg font-medium text-foreground mb-1">
                {file ? `Uploaded: ${file.name}` : 'Drag CSV file here'}
              </p>
              <p className="text-sm text-muted-foreground">
                or click to browse
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="w-4 h-4" />
              <span>CSV or Excel files (.xlsx)</span>
            </div>

            <input
              id="file-input"
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="file-input"
            />
          </div>
        </CardContent>
      </Card>

      {validationErrors.length > 0 && (
        <Alert variant="destructive" data-testid="validation-errors">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Validation Errors</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {validationErrors.slice(0, 5).map((error, index) => (
                <li key={index}>{error}</li>
              ))}
              {validationErrors.length > 5 && (
                <li>...and {validationErrors.length - 5} more errors</li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {previewData.length > 0 && validationErrors.length === 0 && (
        <Alert data-testid="validation-success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Validation Passed</AlertTitle>
          <AlertDescription>
            Your data looks good! Review the preview below and click Import to proceed.
          </AlertDescription>
        </Alert>
      )}

      {previewData.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Data Preview</CardTitle>
              <CardDescription>
                Showing first {previewData.length} rows
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setFile(null);
                  setPreviewData([]);
                  setHeaders([]);
                  setValidationErrors([]);
                }}
                data-testid="button-clear"
              >
                Clear
              </Button>
              <Button
                onClick={handleImport}
                disabled={importMutation.isPending || validationErrors.length > 0}
                data-testid="button-import"
              >
                {importMutation.isPending ? "Importing..." : "Import Data"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">Row</TableHead>
                    {headers.map((header) => (
                      <TableHead key={header}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.map((row) => (
                    <TableRow key={row.rowIndex} data-testid={`preview-row-${row.rowIndex}`}>
                      <TableCell className="font-medium">{row.rowIndex}</TableCell>
                      {headers.map((header) => (
                        <TableCell key={header} data-testid={`cell-${row.rowIndex}-${header}`}>
                          {row.data[header] || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
