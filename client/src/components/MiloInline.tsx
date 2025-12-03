import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Loader2, ChevronUp, CheckCircle2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string;
  actionExecuted?: boolean;
};

interface MiloInlineProps {
  placeholder?: string;
  initialPrompt?: string;
}

export function MiloInline({ placeholder = "Ask Milo to help with scheduling, time off, or driver analysis..." }: MiloInlineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);
    setIsExpanded(true);

    try {
      // Use the new Milo agent endpoint (Gemini-powered with actions)
      const response = await fetch("/api/milo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          history: messages.slice(-6),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const result = await response.json();

      // Add the response message
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message,
          actionExecuted: result.action && result.actionResult?.success
        }
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'm sorry, I encountered an error. Please try again."
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className={cn(
      "border-sky-200 dark:border-sky-800 bg-gradient-to-r from-sky-50/50 to-blue-50/50 dark:from-sky-950/20 dark:to-blue-950/20",
      "transition-all duration-300 ease-in-out",
      "hover:border-sky-400 dark:hover:border-sky-600",
      isFocused && "border-sky-400 dark:border-sky-500 shadow-[0_0_20px_rgba(14,165,233,0.3)] dark:shadow-[0_0_25px_rgba(14,165,233,0.4)]"
    )}>
      <CardContent className="p-4 flex flex-col">
        {/* Chat History - Now at top, messages read upward (newest at bottom) */}
        {(isExpanded || isLoading) && messages.length > 0 && (
          <div className="mb-4 border-b border-sky-200 dark:border-sky-800 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Conversation</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <ChevronUp className="w-3 h-3 mr-1" />
                <span className="text-xs">Hide</span>
              </Button>
            </div>
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-3 flex flex-col">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                        msg.role === "user"
                          ? "bg-sky-500 text-white"
                          : "bg-white dark:bg-muted text-foreground shadow-sm"
                      }`}
                    >
                      {msg.actionExecuted && (
                        <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs mb-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Action completed
                        </div>
                      )}
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="px-3 py-2 rounded-lg text-sm bg-white dark:bg-muted text-muted-foreground flex items-center gap-2 shadow-sm">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Input Row - Now at bottom */}
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0",
            "transition-all duration-300",
            isFocused && "shadow-[0_0_15px_rgba(14,165,233,0.6)]"
          )}>
            <Sparkles className={cn("w-5 h-5 text-white", isFocused && "animate-pulse")} />
          </div>
          <div className="flex-1">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={placeholder}
                className={cn(
                  "min-h-[40px] max-h-[40px] resize-none text-sm bg-white dark:bg-background",
                  "transition-all duration-300",
                  "focus:ring-2 focus:ring-sky-400 focus:border-sky-400",
                  "focus:shadow-[0_0_15px_rgba(14,165,233,0.4)]",
                  "caret-sky-500"
                )}
                disabled={isLoading}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                size="icon"
                className="h-10 w-10 bg-sky-500 hover:bg-sky-600 flex-shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            {messages.length === 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className="text-xs cursor-pointer hover:bg-sky-100 dark:hover:bg-sky-900" onClick={() => setInput("Add time off for ")}>
                  <Zap className="w-3 h-3 mr-1" /> Add time off
                </Badge>
                <Badge variant="outline" className="text-xs cursor-pointer hover:bg-sky-100 dark:hover:bg-sky-900" onClick={() => setInput("Find coverage for ")}>
                  <Zap className="w-3 h-3 mr-1" /> Find coverage
                </Badge>
                <Badge variant="outline" className="text-xs cursor-pointer hover:bg-sky-100 dark:hover:bg-sky-900" onClick={() => setInput("Show workload for ")}>
                  <Zap className="w-3 h-3 mr-1" /> Check workload
                </Badge>
              </div>
            )}
          </div>
          {messages.length > 0 && !isExpanded && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 flex-shrink-0"
              onClick={() => setIsExpanded(true)}
            >
              <ChevronUp className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
