import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { useState } from "react";

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
      <div className="max-w-7xl mx-auto px-8">
        <div className="flex items-center justify-between h-20">
          <div className="flex items-center">
            <span className="text-2xl font-bold text-foreground tracking-tight">Milo</span>
          </div>

          <div className="hidden md:flex items-center gap-12">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium" data-testid="link-features">
              Features
            </a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium" data-testid="link-pricing">
              Pricing
            </a>
            <Button variant="ghost" size="sm" className="font-medium" data-testid="button-sign-in" onClick={() => console.log('Sign in clicked')}>
              Sign In
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            data-testid="button-mobile-menu"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="w-5 h-5" />
          </Button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden pb-4 border-t border-border/50" data-testid="mobile-menu">
            <div className="flex flex-col gap-1 pt-4">
              <a href="#features" className="px-4 py-3 text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="#pricing" className="px-4 py-3 text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
              <div className="px-4 pt-2">
                <Button variant="ghost" className="w-full justify-start" onClick={() => console.log('Sign in clicked')}>Sign In</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
