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
    <div className="flex flex-col h-full max-h-[600px] border border-border rounded-lg bg-card">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="w-6 h-6 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">Milo AI</h3>
            <p className="text-xs text-muted-foreground">Your scheduling assistant</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
          >
            {message.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-primary" />
              </div>
            )}
            
            <div
              className={`
                max-w-[80%] p-3 rounded-lg
                ${message.role === 'user' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-muted text-foreground'
                }
              `}
              data-testid={`message-${message.role}`}
            >
              <p className="text-sm leading-relaxed">{message.content}</p>
            </div>

            {message.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <Input
            placeholder="Ask Milo anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            data-testid="input-chat"
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={handleSend}
            data-testid="button-send-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
