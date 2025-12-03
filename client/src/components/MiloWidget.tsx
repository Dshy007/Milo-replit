import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Send, X, Loader2, Minimize2, Maximize2 } from "lucide-react";
import { useLocation } from "wouter";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function MiloWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();

  // Don't show widget on the chat page (it has its own full interface)
  if (location === "/chat") {
    return null;
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingMessage]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);
    setStreamingMessage("");

    try {
      const response = await fetch("/api/chat/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          history: messages.slice(-6),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to get AI response");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedMessage = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6).trim());
              if (data.done) {
                setMessages((prev) => [...prev, { role: "assistant", content: accumulatedMessage }]);
                setStreamingMessage("");
                setIsStreaming(false);
                await reader.cancel();
                return;
              }
              if (data.content) {
                accumulatedMessage += data.content;
                setStreamingMessage(accumulatedMessage);
              }
            } catch {}
          }
        }
      }
    } catch (error) {
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

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center group"
      >
        <Sparkles className="w-6 h-6 text-white group-hover:animate-pulse" />
      </button>
    );
  }

  return (
    <div
      className={`fixed z-50 bg-card border border-border rounded-xl shadow-2xl transition-all duration-300 ${
        isMinimized
          ? "bottom-6 right-6 w-72 h-14"
          : "bottom-6 right-6 w-96 h-[500px]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-sky-500/10 to-blue-500/10 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-foreground">Milo</span>
          {isStreaming && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsOpen(false)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content (hidden when minimized) */}
      {!isMinimized && (
        <>
          {/* Messages */}
          <ScrollArea className="h-[360px] px-4 py-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Sparkles className="w-10 h-10 text-sky-500 mb-3" />
                <p className="font-medium text-foreground">Hi! I'm Milo</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ask me anything about your operations
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                        msg.role === "user"
                          ? "bg-sky-500 text-white"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isStreaming && streamingMessage && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] px-3 py-2 rounded-lg text-sm bg-muted text-foreground">
                      {streamingMessage}
                      <span className="inline-block w-1.5 h-3 bg-sky-500 ml-1 animate-pulse" />
                    </div>
                  </div>
                )}
                {isStreaming && !streamingMessage && (
                  <div className="flex justify-start">
                    <div className="px-3 py-2 rounded-lg text-sm bg-muted text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="px-3 py-3 border-t border-border">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Milo..."
                className="min-h-[40px] max-h-[80px] resize-none text-sm"
                disabled={isStreaming}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                size="icon"
                className="h-10 w-10 bg-sky-500 hover:bg-sky-600"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
