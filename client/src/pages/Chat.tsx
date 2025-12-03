import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Send, User, Loader2, Users, Calendar, TrendingUp, Clock, AlertTriangle, Zap, BarChart3, UserCheck, Sun, Moon, MessageSquare, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
};

type ChatSession = {
  id: string;
  title: string | null;
  lastMessageAt: string;
  messageCount: number;
  isActive: boolean;
  createdAt: string;
};

export default function Chat() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [model, setModel] = useState<"openai" | "claude">("claude");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch chat sessions (last 6 weeks)
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<ChatSession[]>({
    queryKey: ["chatSessions"],
    queryFn: async () => {
      const response = await fetch("/api/chat/sessions?weeksBack=6", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch sessions");
      return response.json();
    },
  });

  // Create new session mutation
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Failed to create session");
      return response.json();
    },
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ["chatSessions"] });
      setCurrentSessionId(newSession.id);
      setMessages([]);
    },
  });

  // Save message mutation
  const saveMessageMutation = useMutation({
    mutationFn: async ({ sessionId, role, content }: { sessionId: string; role: string; content: string }) => {
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role, content }),
      });
      if (!response.ok) throw new Error("Failed to save message");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chatSessions"] });
    },
  });

  // Archive session mutation
  const archiveSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to archive session");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chatSessions"] });
      if (sessions.length > 1) {
        const remaining = sessions.filter(s => s.id !== currentSessionId);
        if (remaining.length > 0) {
          loadSession(remaining[0].id);
        } else {
          startNewChat();
        }
      } else {
        startNewChat();
      }
    },
  });

  // Load a session's messages
  const loadSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load session");
      const data = await response.json();
      setCurrentSessionId(sessionId);
      setMessages(data.messages.map((m: any) => ({ id: m.id, role: m.role, content: m.content })));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load conversation",
      });
    }
  };

  // Start a new chat
  const startNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
  };

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

    // Create session if needed
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const session = await createSessionMutation.mutateAsync();
        sessionId = session.id;
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to start conversation",
        });
        return;
      }
    }

    // Add user message immediately
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    // Save user message to database
    saveMessageMutation.mutate({ sessionId: sessionId!, role: "user", content: userMessage });

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
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const lineData = line.slice(6).trim();
                if (!lineData) continue;

                const data = JSON.parse(lineData);

                if (data.error) {
                  throw new Error(data.error);
                }

                if (data.done) {
                  // Save assistant message to database
                  saveMessageMutation.mutate({ sessionId: sessionId!, role: "assistant", content: accumulatedMessage });

                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: accumulatedMessage },
                  ]);
                  setStreamingMessage("");
                  setIsStreaming(false);
                  await reader.cancel();
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
    <div className="flex h-full">
      {/* Sidebar - Chat History */}
      <div className={`border-r border-border bg-card/30 transition-all duration-300 ${sidebarOpen ? "w-64" : "w-0"} overflow-hidden flex flex-col`}>
        <div className="p-3 border-b border-border">
          <Button
            onClick={startNewChat}
            className="w-full"
            variant="outline"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No previous conversations
              </p>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    currentSessionId === session.id
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => loadSession(session.id)}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {session.title || "New conversation"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(session.lastMessageAt), "MMM d, h:mm a")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      archiveSessionMutation.mutate(session.id);
                    }}
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t border-border text-xs text-muted-foreground text-center">
          Last 6 weeks
        </div>
      </div>

      {/* Sidebar Toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-card border border-border rounded-r-md p-1 hover:bg-muted transition-colors"
        style={{ left: sidebarOpen ? "256px" : "0" }}
      >
        {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Compact Header */}
        <div className="relative border-b border-border bg-card/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" data-testid="page-title">
                Milo AI Assistant
                <Sparkles className="w-5 h-5 text-primary animate-pulse" />
              </h1>
              <p className="text-sm text-muted-foreground mt-1" data-testid="page-subtitle">
                {isStreaming ? "Thinking..." : "Your intelligent trucking operations assistant"}
              </p>
            </div>

            {/* Model Selector */}
            <div className="flex items-center gap-2 bg-muted/50 rounded-full p-1 shadow-md border border-border">
              <button
                onClick={() => setModel("openai")}
                className={`px-3 py-1.5 text-xs font-bold rounded-full transition-all ${
                  model === "openai"
                    ? "bg-gradient-to-r from-green-400 to-emerald-400 text-white shadow-md scale-105"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }`}
                disabled={isStreaming}
              >
                GPT-5
              </button>
              <button
                onClick={() => setModel("claude")}
                className={`px-3 py-1.5 text-xs font-bold rounded-full transition-all ${
                  model === "claude"
                    ? "bg-gradient-to-r from-purple-400 to-pink-400 text-white shadow-md scale-105"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }`}
                disabled={isStreaming}
              >
                Claude
              </button>
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-hidden relative">
          <ScrollArea className="h-full">
            <div className="px-6 py-6 space-y-6">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] gap-6" data-testid="empty-state">
                  {/* Milo greeting */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 ring-4 ring-primary/5">
                      <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <div className="text-left">
                      <h2 className="text-2xl font-bold text-foreground">
                        Hi, I'm Milo!
                      </h2>
                      <p className="text-muted-foreground">
                        Your AI dispatch assistant for Freedom Transportation
                      </p>
                    </div>
                  </div>

                  {/* Quick Actions Grid */}
                  <div className="w-full max-w-4xl space-y-4">
                    {/* Solo1 Drivers (Day Shifts) */}
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Sun className="w-3 h-3 text-blue-500" /> Solo1 Drivers (Day Shifts - 4:30 PM)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <button
                          onClick={() => setInput("Show me all Solo1 drivers and their schedules this week")}
                          className="p-3 text-left rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100/50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400">Solo1 schedules</p>
                          <p className="text-xs text-muted-foreground mt-0.5">View day shift assignments</p>
                        </button>
                        <button
                          onClick={() => setInput("Which Solo1 drivers have the lightest workload this week?")}
                          className="p-3 text-left rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100/50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400">Solo1 availability</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Find drivers with capacity</p>
                        </button>
                        <button
                          onClick={() => setInput("Show me unassigned Solo1 blocks for this week")}
                          className="p-3 text-left rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100/50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400">Open Solo1 blocks</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Day shifts needing drivers</p>
                        </button>
                      </div>
                    </div>

                    {/* Solo2 Drivers (Night Shifts) */}
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Moon className="w-3 h-3 text-purple-500" /> Solo2 Drivers (Night Shifts - 10:00 PM)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <button
                          onClick={() => setInput("Show me all Solo2 drivers and their schedules this week")}
                          className="p-3 text-left rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/30 hover:bg-purple-100/50 dark:hover:bg-purple-900/30 hover:border-purple-300 dark:hover:border-purple-700 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-purple-600 dark:group-hover:text-purple-400">Solo2 schedules</p>
                          <p className="text-xs text-muted-foreground mt-0.5">View night shift assignments</p>
                        </button>
                        <button
                          onClick={() => setInput("Which Solo2 drivers are available for extra shifts?")}
                          className="p-3 text-left rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/30 hover:bg-purple-100/50 dark:hover:bg-purple-900/30 hover:border-purple-300 dark:hover:border-purple-700 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-purple-600 dark:group-hover:text-purple-400">Solo2 availability</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Night drivers with capacity</p>
                        </button>
                        <button
                          onClick={() => setInput("Show me unassigned Solo2 blocks for this week")}
                          className="p-3 text-left rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/30 hover:bg-purple-100/50 dark:hover:bg-purple-900/30 hover:border-purple-300 dark:hover:border-purple-700 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-purple-600 dark:group-hover:text-purple-400">Open Solo2 blocks</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Night shifts needing drivers</p>
                        </button>
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                        <Zap className="w-3 h-3" /> Quick Actions
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <button
                          onClick={() => setInput("Give me a summary of today's operations - how many drivers working, any gaps?")}
                          className="p-3 text-left rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-primary">Today's summary</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Quick operations overview</p>
                        </button>
                        <button
                          onClick={() => setInput("Help me find a replacement for a Solo1 shift on Monday")}
                          className="p-3 text-left rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-primary">Find replacement</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Cover a shift</p>
                        </button>
                        <button
                          onClick={() => setInput("What are the busiest and slowest days this week?")}
                          className="p-3 text-left rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 transition-all group"
                        >
                          <p className="font-medium text-foreground text-sm group-hover:text-primary">Weekly pattern</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Identify peak days</p>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Tip */}
                  <div className="text-center text-xs text-muted-foreground max-w-md mt-2">
                    <p>Conversations are saved for 6 weeks so I can remember our previous discussions!</p>
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
    </div>
  );
}
