import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User } from "lucide-react";
import { useState } from "react";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'user',
      content: "show me J. Smith upcoming week"
    },
    {
      id: '2',
      role: 'assistant',
      content: "Here's J. Smith's schedule for the upcoming week:\n\n📅 Monday, Nov 11 - Block #1234, 6:00 AM - 2:00 PM\n📅 Tuesday, Nov 12 - Block #1245, 2:00 PM - 10:00 PM\n📅 Wednesday, Nov 13 - Off\n📅 Thursday, Nov 14 - Block #1256, 6:00 AM - 2:00 PM\n📅 Friday, Nov 15 - Block #1267, 2:00 PM - 10:00 PM\n📅 Saturday, Nov 16 - Block #1278, 10:00 AM - 6:00 PM\n📅 Sunday, Nov 17 - Off\n\n✅ All shifts are DOT compliant with proper rest periods."
    }
  ]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input
    };

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: "I'd help you with that in the full application. This is a design prototype."
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    console.log('Message sent:', input);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[500px] bg-muted/30 rounded-2xl backdrop-blur-sm border border-border/50 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-4" data-testid="chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[85%] px-4 py-3 rounded-2xl
                ${message.role === 'user' 
                  ? 'bg-primary text-primary-foreground rounded-br-sm' 
                  : 'bg-card/80 text-foreground border border-border/50 rounded-bl-sm'
                }
              `}
              data-testid={`message-${message.role}`}
              style={{
                backdropFilter: 'blur(8px)',
                boxShadow: message.role === 'user' 
                  ? '0 0 20px hsl(195 100% 50% / 0.3)' 
                  : '0 2px 8px hsl(0 0% 0% / 0.05)'
              }}
            >
              <p className="text-sm leading-relaxed whitespace-pre-line">{message.content}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 bg-card/50 backdrop-blur-sm border-t border-border/50">
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Chat input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            data-testid="input-chat"
            className="flex-1 bg-background/80 border-border/50 rounded-xl"
          />
          <Button
            size="icon"
            onClick={handleSend}
            data-testid="button-send-message"
            className="rounded-xl"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
