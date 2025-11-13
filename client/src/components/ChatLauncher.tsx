import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Send, User, Loader2, X } from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ChatLauncher() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
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
      const response = await fetch("/api/chat", {
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
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;
            
            try {
              const jsonStr = line.slice(6);
              const data = JSON.parse(jsonStr);
              
              if (data.content) {
                accumulatedMessage += data.content;
                setStreamingMessage(accumulatedMessage);
              }
              
              if (data.done) {
                setMessages(prev => [...prev, { role: "assistant", content: accumulatedMessage }]);
                setStreamingMessage("");
                setIsStreaming(false);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to get response from Milo",
        variant: "destructive",
      });
      setIsStreaming(false);
      setStreamingMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation(); // Prevent event bubbling to parent forms
      handleSend();
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
          data-testid="button-chat-launcher"
        >
          <Sparkles className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      {isOpen && (
        <SheetContent side="right" className="w-full sm:w-[540px] sm:max-w-[540px] p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Milo AI Assistant
            </SheetTitle>
            <SheetDescription>
              Ask questions about your drivers, schedules, and operations
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 p-6">
          <div className="space-y-4">
            {messages.length === 0 && !streamingMessage && (
              <div className="text-center py-12">
                <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Welcome to Milo!</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  I can help you find drivers, check schedules, analyze workloads, and answer questions about your trucking operations.
                </p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-3 ${msg.role === "assistant" ? "justify-start" : "justify-end"}`}
                data-testid={`message-${msg.role}-${idx}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === "assistant"
                      ? "bg-muted text-foreground"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}

            {streamingMessage && (
              <div className="flex gap-3 justify-start" data-testid="message-streaming">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted text-foreground">
                  <p className="text-sm whitespace-pre-wrap">{streamingMessage}</p>
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-4">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Milo anything..."
              className="resize-none"
              rows={2}
              disabled={isStreaming}
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              size="icon"
              className="flex-shrink-0"
              data-testid="button-send-message"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
      )}
    </Sheet>
  );
}
