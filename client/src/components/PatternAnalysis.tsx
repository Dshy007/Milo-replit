import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Brain, Sparkles, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

type AnalysisType = 'scheduling' | 'code' | 'unified';

interface PatternAnalysisResponse {
  success: boolean;
  analysisType: string;
  promptTemplate: string;
  questions: string;
  systemPromptPreview: string;
}

export function PatternAnalysis() {
  const [selectedType, setSelectedType] = useState<AnalysisType>('scheduling');
  const [analysisResult, setAnalysisResult] = useState<PatternAnalysisResponse | null>(null);
  const { toast } = useToast();

  const analysisMutation = useMutation({
    mutationFn: async (type: AnalysisType) => {
      const res = await apiRequest("POST", "/api/analysis/pattern-questions", {
        analysisType: type,
        context: {
          source: "dashboard",
          timestamp: new Date().toISOString(),
        }
      });
      return res.json();
    },
    onSuccess: (data: PatternAnalysisResponse) => {
      setAnalysisResult(data);
      toast({
        title: "Pattern Analysis Ready",
        description: "Milo has generated systematic analysis questions",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to generate pattern analysis",
        variant: "destructive",
      });
    },
  });

  const handleAnalyze = () => {
    setAnalysisResult(null);
    analysisMutation.mutate(selectedType);
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              Pattern Recognition Analysis
            </CardTitle>
            <CardDescription>
              Systematic tree-branch analysis for scheduling, code debugging, and operations
            </CardDescription>
          </div>
          <Sparkles className="w-6 h-6 text-primary opacity-50" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Analysis Type Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            Analysis Type
          </label>
          <div className="flex gap-2">
            <Button
              variant={selectedType === 'scheduling' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedType('scheduling')}
              disabled={analysisMutation.isPending}
              data-testid="button-analysis-scheduling"
            >
              Driver Scheduling
            </Button>
            <Button
              variant={selectedType === 'code' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedType('code')}
              disabled={analysisMutation.isPending}
              data-testid="button-analysis-code"
            >
              Code Debugging
            </Button>
            <Button
              variant={selectedType === 'unified' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedType('unified')}
              disabled={analysisMutation.isPending}
              data-testid="button-analysis-unified"
            >
              Unified Analysis
            </Button>
          </div>
        </div>

        {/* Analyze Button */}
        <Button
          onClick={handleAnalyze}
          disabled={analysisMutation.isPending}
          className="w-full"
          size="lg"
          data-testid="button-start-analysis"
        >
          {analysisMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing with Pattern Recognition...
            </>
          ) : (
            <>
              <Brain className="w-4 h-4 mr-2" />
              Start Pattern Analysis
            </>
          )}
        </Button>

        {/* Analysis Results */}
        {analysisResult && (
          <div className="mt-6 space-y-4 border-t pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <h3 className="font-semibold">Analysis Questions Generated</h3>
            </div>

            <div className="flex gap-2">
              <Badge variant="outline">
                {analysisResult.analysisType}
              </Badge>
              <Badge variant="secondary">
                {analysisResult.promptTemplate}
              </Badge>
            </div>

            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-primary mt-1 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium mb-2">
                    Systematic Questions to Answer:
                  </p>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {analysisResult.questions}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Copy questions to clipboard
                  navigator.clipboard.writeText(analysisResult.questions);
                  toast({
                    title: "Copied to Clipboard",
                    description: "Analysis questions copied",
                  });
                }}
                data-testid="button-copy-questions"
              >
                Copy Questions
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  // Navigate to chat with pre-loaded context
                  window.location.href = '/chat';
                }}
                data-testid="button-continue-chat"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Continue in Chat
              </Button>
            </div>
          </div>
        )}

        {/* Methodology Info */}
        <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>Tree-Branch Thinking:</strong> This analysis considers multiple perspectives simultaneously
            (Driver, Block, Balance) and never guesses. Milo will ask systematic questions to gather evidence
            before making recommendations.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
