import { useState, useRef, useEffect } from "react";
import { Home, Users, Calendar, Route, Truck, FileText, Upload, Sparkles, Settings, LogOut, MessageSquare, Brain, FileSpreadsheet, CalendarCheck, GitBranch, Send, Loader2, ChevronDown, ChevronUp, User, Trash2, RotateCcw, Dna } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

const navItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
    testId: "nav-dashboard",
  },
  {
    title: "Drivers",
    url: "/drivers",
    icon: Users,
    testId: "nav-drivers",
  },
  {
    title: "Schedules",
    url: "/schedules",
    icon: Calendar,
    testId: "nav-schedules",
  },
  {
    title: "Trucks",
    url: "/trucks",
    icon: Truck,
    testId: "nav-trucks",
  },
  {
    title: "Start Times",
    url: "/contracts",
    icon: FileText,
    testId: "nav-contracts",
  },
  {
    title: "Import Data",
    url: "/import",
    icon: Upload,
    testId: "nav-import",
  },
  {
    title: "AI Assistant",
    url: "/chat",
    icon: Sparkles,
    testId: "nav-chat",
  },
  {
    title: "Special Requests",
    url: "/special-requests",
    icon: MessageSquare,
    testId: "nav-special-requests",
  },
  {
    title: "Driver Profile",
    url: "/schedule-intelligence",
    icon: Dna,
    testId: "nav-schedule-intelligence",
  },
  {
    title: "Auto-Build",
    url: "/auto-build",
    icon: Brain,
    testId: "nav-auto-build",
  },
  {
    title: "Driver Availability",
    url: "/driver-availability",
    icon: CalendarCheck,
    testId: "nav-driver-availability",
  },
];

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Chat state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resizable chat panel state
  const [chatHeight, setChatHeight] = useState(192); // Default h-48 = 12rem = 192px
  const isResizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Handle resize drag
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startY.current = e.clientY;
    startHeight.current = chatHeight;
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const delta = startY.current - e.clientY; // Dragging up increases height
    const newHeight = Math.max(100, Math.min(500, startHeight.current + delta));
    setChatHeight(newHeight);
  };

  const handleResizeEnd = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  };

  // Create session mutation
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

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingMessage]);

  const getUserInitials = () => {
    if (!user?.username) return "U";
    return user.username.substring(0, 2).toUpperCase();
  };

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

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    saveMessageMutation.mutate({ sessionId: sessionId!, role: "user", content: userMessage });

    setIsStreaming(true);
    setStreamingMessage("");

    try {
      const response = await fetch("/api/chat/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          history: messages.slice(-10),
        }),
      });

      if (!response.ok) throw new Error("Failed to get AI response");
      if (!response.body) throw new Error("No response body");

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
              const lineData = line.slice(6).trim();
              if (!lineData) continue;
              const data = JSON.parse(lineData);

              if (data.error) throw new Error(data.error);

              if (data.done) {
                saveMessageMutation.mutate({ sessionId: sessionId!, role: "assistant", content: accumulatedMessage });
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
            } catch (parseError) {
              console.error("Failed to parse SSE data:", line, parseError);
            }
          }
        }
      }
      await reader.cancel();
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

  const quickActions = [
    "Who's available today?",
    "Unassigned blocks this week",
    "Workload summary",
  ];

  // Clear conversation
  const handleClearChat = () => {
    setMessages([]);
    setStreamingMessage("");
    setCurrentSessionId(null);
  };

  // Delete a single message
  const handleDeleteMessage = (index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-primary" data-testid="sidebar-logo" />
          <div>
            <h2 className="text-lg font-bold text-foreground" data-testid="sidebar-title">Milo</h2>
            <p className="text-xs text-muted-foreground" data-testid="sidebar-subtitle">AI Operations</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="flex flex-col">
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={item.testId}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Milo Quick Chat Section */}
        <SidebarGroup className="mt-auto border-t border-border">
          <div className="flex items-center justify-between px-3 py-2">
            <button
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Sparkles className="w-4 h-4 text-primary" />
              <span>Ask Milo</span>
              {isStreaming && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
              {isChatOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            {isChatOpen && messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                title="Clear conversation"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {isChatOpen && (
            <div className="px-2 pb-2">
              {/* Resize Handle */}
              <div
                onMouseDown={handleResizeStart}
                className="h-2 cursor-ns-resize flex items-center justify-center hover:bg-muted/50 rounded-t-md transition-colors group"
              >
                <div className="w-8 h-1 bg-border rounded-full group-hover:bg-primary/50 transition-colors" />
              </div>
              {/* Messages Area */}
              <ScrollArea
                className="mb-2 rounded-md border border-border bg-background/50"
                style={{ height: `${chatHeight}px` }}
              >
                <div className="p-2 space-y-2">
                  {messages.length === 0 && !streamingMessage ? (
                    <div className="text-center py-3">
                      <p className="text-xs text-muted-foreground mb-2">Quick questions:</p>
                      <div className="space-y-1">
                        {quickActions.map((action, idx) => (
                          <button
                            key={idx}
                            onClick={() => setInput(action)}
                            className="w-full p-1.5 text-xs text-left rounded border border-border hover:bg-muted/50 transition-colors truncate"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg, idx) => (
                        <div key={idx} className={`group flex gap-1.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          {msg.role === "assistant" && (
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                              <Sparkles className="w-2.5 h-2.5 text-primary" />
                            </div>
                          )}
                          <div className={`relative max-w-[85%] rounded p-1.5 text-xs ${
                            msg.role === "user" ? "bg-primary/10" : "bg-muted"
                          }`}>
                            <p className="whitespace-pre-wrap break-words pr-4">{msg.content}</p>
                            <button
                              onClick={() => handleDeleteMessage(idx)}
                              className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-opacity"
                              title="Delete message"
                            >
                              <Trash2 className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
                            </button>
                          </div>
                          {msg.role === "user" && (
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                              <User className="w-2.5 h-2.5" />
                            </div>
                          )}
                        </div>
                      ))}

                      {isStreaming && streamingMessage && (
                        <div className="flex gap-1.5 justify-start">
                          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                            <Sparkles className="w-2.5 h-2.5 text-primary" />
                          </div>
                          <div className="max-w-[85%] rounded p-1.5 text-xs bg-muted">
                            <p className="whitespace-pre-wrap break-words">{streamingMessage}</p>
                            <span className="inline-block w-1 h-2.5 bg-primary ml-0.5 animate-pulse" />
                          </div>
                        </div>
                      )}

                      {isStreaming && !streamingMessage && (
                        <div className="flex gap-1.5 justify-start">
                          <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                            <Sparkles className="w-2.5 h-2.5 text-primary" />
                          </div>
                          <div className="rounded p-1.5 text-xs bg-muted flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>Thinking...</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <div ref={scrollRef} />
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="flex gap-1">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Milo..."
                  className="min-h-[32px] max-h-[60px] resize-none text-xs"
                  disabled={isStreaming}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  size="sm"
                  className="h-8 w-8 p-0 flex-shrink-0"
                >
                  <Send className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-border">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8" data-testid="sidebar-avatar">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {getUserInitials()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate" data-testid="text-user-name">
              {user?.username}
            </p>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
              {user?.email}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => logout()}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
