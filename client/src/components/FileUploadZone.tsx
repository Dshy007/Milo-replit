import { Upload, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";

export default function FileUploadZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);

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
    if (files.length > 0) {
      setUploadedFile(files[0].name);
      console.log('File dropped:', files[0].name);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setUploadedFile(files[0].name);
      console.log('File selected:', files[0].name);
    }
  };

  return (
    <div className="w-full">
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
            {uploadedFile ? `Uploaded: ${uploadedFile}` : 'Drag CSV or Excel files here'}
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <FileText className="w-4 h-4" />
            <span>CSV</span>
          </div>
          <div className="flex items-center gap-1">
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </div>
        </div>

        <input
          id="file-input"
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={handleFileSelect}
          data-testid="file-input"
        />
      </div>

      {uploadedFile && (
        <div className="mt-4 p-4 rounded-lg border border-border bg-card" data-testid="upload-preview">
          <p className="text-sm font-medium text-foreground mb-2">File Preview</p>
          <p className="text-xs text-muted-foreground">
            Ready to parse and validate. Click "Process File" to continue.
          </p>
        </div>
      )}
    </div>
  );
}
