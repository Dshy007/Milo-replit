/**
 * MILO Chat - Conversational interface for schedule intelligence
 *
 * Features:
 * - Natural language queries about drivers and schedules
 * - Floating window that can be moved anywhere on screen
 * - Resizable by dragging edges/corners
 * - Minimizable to icon
 *
 * Examples:
 * - "Who worked last Sunday?"
 * - "Show me all solo2 drivers"
 * - "Which blocks are unassigned this week?"
 * - "What are Firas's scheduling preferences?"
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import {
  MessageSquare,
  Send,
  Loader2,
  Trash2,
  Sparkles,
  X,
  Minimize2,
  Maximize2,
  GripHorizontal,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface MiloChatProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Position {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 550;

export function MiloChat({ isOpen, onClose }: MiloChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<Position>({
    x: typeof window !== 'undefined' ? window.innerWidth - DEFAULT_WIDTH - 20 : 20,
    y: typeof window !== 'undefined' ? window.innerHeight - DEFAULT_HEIGHT - 20 : 20
  });
  const dragOffset = useRef<Position>({ x: 0, y: 0 });

  // Resizing state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");
  const [size, setSize] = useState<Size>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const resizeStart = useRef<{ x: number; y: number; width: number; height: number; posX: number; posY: number }>({
    x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, posX: 0, posY: 0
  });

  // Pre-maximize state for restore
  const preMaximizeState = useRef<{ position: Position; size: Size } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  // Handle dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  }, [position, isMaximized]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const newX = Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - size.height, e.clientY - dragOffset.current.y));
      setPosition({ x: newX, y: newY });
    } else if (isResizing) {
      const deltaX = e.clientX - resizeStart.current.x;
      const deltaY = e.clientY - resizeStart.current.y;

      let newWidth = resizeStart.current.width;
      let newHeight = resizeStart.current.height;
      let newX = resizeStart.current.posX;
      let newY = resizeStart.current.posY;

      // Handle width changes
      if (resizeDirection.includes('e')) {
        newWidth = Math.max(MIN_WIDTH, resizeStart.current.width + deltaX);
      }
      if (resizeDirection.includes('w')) {
        const maxDeltaX = resizeStart.current.width - MIN_WIDTH;
        const actualDeltaX = Math.min(deltaX, maxDeltaX);
        newWidth = resizeStart.current.width - actualDeltaX;
        newX = resizeStart.current.posX + actualDeltaX;
      }

      // Handle height changes
      if (resizeDirection.includes('s')) {
        newHeight = Math.max(MIN_HEIGHT, resizeStart.current.height + deltaY);
      }
      if (resizeDirection.includes('n')) {
        const maxDeltaY = resizeStart.current.height - MIN_HEIGHT;
        const actualDeltaY = Math.min(deltaY, maxDeltaY);
        newHeight = resizeStart.current.height - actualDeltaY;
        newY = resizeStart.current.posY + actualDeltaY;
      }

      // Constrain to viewport
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);
      newWidth = Math.min(newWidth, window.innerWidth - newX);
      newHeight = Math.min(newHeight, window.innerHeight - newY);

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    }
  }, [isDragging, isResizing, resizeDirection, size.width, size.height]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection("");
  }, []);

  // Global mouse event listeners
  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  // Resize handle mouse down
  const handleResizeMouseDown = useCallback((direction: string) => (e: React.MouseEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y
    };
  }, [size, position, isMaximized]);

  // Maximize/restore toggle
  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      // Restore
      if (preMaximizeState.current) {
        setPosition(preMaximizeState.current.position);
        setSize(preMaximizeState.current.size);
      }
      setIsMaximized(false);
    } else {
      // Save current state and maximize
      preMaximizeState.current = { position, size };
      setPosition({ x: 0, y: 0 });
      setSize({ width: window.innerWidth, height: window.innerHeight });
      setIsMaximized(true);
    }
  }, [isMaximized, position, size]);

  // Chat mutation
  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", "/api/milo/chat", {
        message,
        sessionId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setSessionId(data.sessionId);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            timestamp: new Date(),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${data.message}`,
            timestamp: new Date(),
          },
        ]);
      }
    },
    onError: (error: Error) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${error.message}`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  // Clear chat mutation
  const clearMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/milo/chat/clear", {
        sessionId,
      });
      return response.json();
    },
    onSuccess: () => {
      setMessages([]);
      setSessionId(null);
    },
  });

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;

    const userMessage = input.trim();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
        timestamp: new Date(),
      },
    ]);
    setInput("");
    chatMutation.mutate(userMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div
        className="fixed z-50"
        style={{ left: position.x, top: position.y }}
      >
        <Button
          onClick={() => setIsMinimized(false)}
          className="h-12 w-12 rounded-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 shadow-lg"
        >
          <MessageSquare className="w-6 h-6" />
        </Button>
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {messages.length}
          </span>
        )}
      </div>
    );
  }

  // Resize handles component
  const ResizeHandles = () => (
    <>
      {/* Edge handles */}
      <div
        className="absolute top-0 left-2 right-2 h-1 cursor-n-resize hover:bg-purple-400/30"
        onMouseDown={handleResizeMouseDown('n')}
      />
      <div
        className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize hover:bg-purple-400/30"
        onMouseDown={handleResizeMouseDown('s')}
      />
      <div
        className="absolute left-0 top-2 bottom-2 w-1 cursor-w-resize hover:bg-purple-400/30"
        onMouseDown={handleResizeMouseDown('w')}
      />
      <div
        className="absolute right-0 top-2 bottom-2 w-1 cursor-e-resize hover:bg-purple-400/30"
        onMouseDown={handleResizeMouseDown('e')}
      />
      {/* Corner handles */}
      <div
        className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize hover:bg-purple-400/50"
        onMouseDown={handleResizeMouseDown('nw')}
      />
      <div
        className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize hover:bg-purple-400/50"
        onMouseDown={handleResizeMouseDown('ne')}
      />
      <div
        className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize hover:bg-purple-400/50"
        onMouseDown={handleResizeMouseDown('sw')}
      />
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize hover:bg-purple-400/50"
        onMouseDown={handleResizeMouseDown('se')}
      />
    </>
  );

  return (
    <Card
      ref={cardRef}
      className="fixed z-50 flex flex-col shadow-2xl border-purple-200 dark:border-purple-800 overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Resize handles - only show when not maximized */}
      {!isMaximized && <ResizeHandles />}

      {/* Header - Draggable */}
      <div
        className={`flex items-center justify-between p-3 border-b bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-t-lg select-none ${!isMaximized ? 'cursor-move' : ''}`}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-4 h-4 opacity-60" />
          <Sparkles className="w-5 h-5" />
          <span className="font-semibold">MILO Chat</span>
        </div>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-white/20"
            onClick={() => clearMutation.mutate()}
            disabled={messages.length === 0 || clearMutation.isPending}
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-white/20"
            onClick={() => setIsMinimized(true)}
            title="Minimize"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-white/20"
            onClick={toggleMaximize}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-white/20"
            onClick={onClose}
            title="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Sparkles className="w-12 h-12 mx-auto mb-3 text-purple-400" />
            <p className="font-medium">Ask MILO anything!</p>
            <p className="text-sm mt-2">Examples:</p>
            <div className="mt-2 space-y-1 text-xs">
              <p className="italic">"Who worked last Sunday?"</p>
              <p className="italic">"Show me all solo2 drivers"</p>
              <p className="italic">"What drivers prefer 16:30?"</p>
              <p className="italic">"What are Firas's scheduling preferences?"</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 ${
                    msg.role === "user"
                      ? "bg-purple-600 text-white"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          table: ({ node, ...props }) => (
                            <div className="overflow-x-auto">
                              <table className="text-xs" {...props} />
                            </div>
                          ),
                          th: ({ node, ...props }) => (
                            <th className="px-2 py-1 border text-left" {...props} />
                          ),
                          td: ({ node, ...props }) => (
                            <td className="px-2 py-1 border" {...props} />
                          ),
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm">{msg.content}</p>
                  )}
                  <span className="text-[10px] opacity-60 mt-1 block">
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about drivers or schedules..."
            disabled={chatMutation.isPending}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {chatMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * MILO Chat Toggle Button - Use this to open the chat from anywhere
 */
export function MiloChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      variant="outline"
      size="sm"
      className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white border-0"
    >
      <MessageSquare className="w-4 h-4 mr-2" />
      Ask MILO
    </Button>
  );
}
