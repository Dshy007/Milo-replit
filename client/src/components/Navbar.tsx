import { Button } from "@/components/ui/button";
import { MessageSquare, Menu } from "lucide-react";
import { useState } from "react";

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-8 h-8 text-primary" data-testid="logo-icon" />
            <span className="text-2xl font-bold text-foreground">Milo</span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-foreground hover-elevate px-3 py-2 rounded-md transition-colors" data-testid="link-features">
              Features
            </a>
            <a href="#compliance" className="text-foreground hover-elevate px-3 py-2 rounded-md transition-colors" data-testid="link-compliance">
              Compliance
            </a>
            <a href="#pricing" className="text-foreground hover-elevate px-3 py-2 rounded-md transition-colors" data-testid="link-pricing">
              Pricing
            </a>
            <Button variant="outline" size="sm" data-testid="button-sign-in" onClick={() => console.log('Sign in clicked')}>
              Sign In
            </Button>
            <Button size="sm" data-testid="button-try-free" onClick={() => console.log('Try free clicked')}>
              Try Free
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            data-testid="button-mobile-menu"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="w-6 h-6" />
          </Button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border" data-testid="mobile-menu">
            <div className="flex flex-col gap-2">
              <a href="#features" className="px-4 py-2 text-foreground hover-elevate rounded-md">Features</a>
              <a href="#compliance" className="px-4 py-2 text-foreground hover-elevate rounded-md">Compliance</a>
              <a href="#pricing" className="px-4 py-2 text-foreground hover-elevate rounded-md">Pricing</a>
              <div className="flex flex-col gap-2 px-4 pt-2">
                <Button variant="outline" className="w-full" onClick={() => console.log('Sign in clicked')}>Sign In</Button>
                <Button className="w-full" onClick={() => console.log('Try free clicked')}>Try Free</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
