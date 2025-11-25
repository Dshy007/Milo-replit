import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Send, User, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Chat() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [model, setModel] = useState<"openai" | "claude">("claude");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingMessage]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    
    // Add user message immediately
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    
    // Start streaming
    setIsStreaming(true);
    setStreamingMessage("");

    try {
      const endpoint = model === "claude" ? "/api/chat/claude" : "/api/chat";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          history: messages.slice(-10),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedMessage = "";
      let buffer = ""; // Buffer for incomplete lines

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;

          // Decode chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete lines
          const lines = buffer.split('\n');
          
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                // Trim to handle CRLF line endings
                const lineData = line.slice(6).trim();
                if (!lineData) continue;
                
                const data = JSON.parse(lineData);
                
                if (data.error) {
                  throw new Error(data.error);
                }
                
                if (data.done) {
                  // Streaming complete - add to messages and clean up
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: accumulatedMessage },
                  ]);
                  setStreamingMessage("");
                  setIsStreaming(false);
                  await reader.cancel(); // Explicitly cancel reader
                  return;
                }
                
                if (data.content) {
                  accumulatedMessage += data.content;
                  setStreamingMessage(accumulatedMessage);
                }
              } catch (parseError) {
                console.error("Failed to parse SSE data:", line, parseError);
              }
            }
          }
        }
        
        // If loop exits without done signal, clean up
        await reader.cancel();
      } catch (readerError) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel errors
        }
        throw readerError;
      }
    } catch (error: any) {
      console.error("Chat error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to get AI response",
      });
      setIsStreaming(false);
      setStreamingMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <Sparkles className="w-5 h-5 text-primary" data-testid="chat-icon" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
                Milo AI Assistant
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
                Your intelligent trucking operations assistant
              </p>
            </div>
          </div>

          {/* Model Selector */}
          <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
            <button
              onClick={() => setModel("openai")}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                model === "openai"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              disabled={isStreaming}
            >
              GPT-5
            </button>
            <button
              onClick={() => setModel("claude")}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                model === "claude"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              disabled={isStreaming}
            >
              Claude Sonnet 4
            </button>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="px-6 py-6 space-y-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4" data-testid="empty-state">
                <div className="flex items-center justify-center w-20 h-20 rounded-full bg-primary/5">
                  <Sparkles className="w-10 h-10 text-primary/50" />
                </div>
                <div className="text-center max-w-md">
                  <h2 className="text-xl font-semibold text-foreground mb-2">
                    Welcome to Milo
                  </h2>
                  <p className="text-muted-foreground">
                    Ask me anything about your trucking operations, drivers, schedules, routes, or fleet management.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 max-w-2xl w-full">
                  <button
                    onClick={() => setInput("What can you help me with?")}
                    className="p-4 text-left rounded-lg border border-border bg-card hover-elevate active-elevate-2 transition-colors"
                    data-testid="suggestion-what-help"
                  >
                    <p className="font-medium text-foreground">What can you help me with?</p>
                    <p className="text-sm text-muted-foreground mt-1">Learn about Milo's capabilities</p>
                  </button>
                  <button
                    onClick={() => setInput("Explain DOT compliance requirements")}
                    className="p-4 text-left rounded-lg border border-border bg-card hover-elevate active-elevate-2 transition-colors"
                    data-testid="suggestion-dot-compliance"
                  >
                    <p className="font-medium text-foreground">DOT Compliance</p>
                    <p className="text-sm text-muted-foreground mt-1">Learn about regulations</p>
                  </button>
                  <button
                    onClick={() => setInput("How do I optimize my route planning?")}
                    className="p-4 text-left rounded-lg border border-border bg-card hover-elevate active-elevate-2 transition-colors"
                    data-testid="suggestion-route-planning"
                  >
                    <p className="font-medium text-foreground">Route Planning</p>
                    <p className="text-sm text-muted-foreground mt-1">Get optimization tips</p>
                  </button>
                  <button
                    onClick={() => setInput("Best practices for driver scheduling")}
                    className="p-4 text-left rounded-lg border border-border bg-card hover-elevate active-elevate-2 transition-colors"
                    data-testid="suggestion-scheduling"
                  >
                    <p className="font-medium text-foreground">Driver Scheduling</p>
                    <p className="text-sm text-muted-foreground mt-1">Learn scheduling best practices</p>
                  </button>
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${msg.role}-${idx}`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 flex items-start">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
                        <Sparkles className="w-4 h-4 text-primary" />
                      </div>
                    </div>
                  )}
                  <Card className={`max-w-2xl ${msg.role === "user" ? "bg-primary/5 border-primary/20" : ""}`}>
                    <CardContent className="p-4">
                      <p className="text-foreground whitespace-pre-wrap">{msg.content}</p>
                    </CardContent>
                  </Card>
                  {msg.role === "user" && (
                    <div className="flex-shrink-0 flex items-start">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            
            {/* Streaming message */}
            {isStreaming && streamingMessage && (
              <div className="flex gap-4 justify-start" data-testid="message-streaming">
                <div className="flex-shrink-0 flex items-start">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-foreground whitespace-pre-wrap">{streamingMessage}</p>
                    <div className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse" />
                  </CardContent>
                </Card>
              </div>
            )}
            
            {/* Loading indicator */}
            {isStreaming && !streamingMessage && (
              <div className="flex gap-4 justify-start" data-testid="message-loading">
                <div className="flex-shrink-0 flex items-start">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <p>Thinking...</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
      </div>

      {/* Input Area */}
      <div className="border-t border-border bg-card/50 backdrop-blur-sm px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Milo anything about your trucking operations..."
              className="min-h-[60px] resize-none"
              disabled={isStreaming}
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              size="icon"
              className="h-[60px] w-[60px] flex-shrink-0"
              data-testid="button-send-message"
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Milo can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}
