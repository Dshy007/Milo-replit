import { MessageSquare } from "lucide-react";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-card/30 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-6 h-6 text-primary" />
              <span className="text-xl font-bold text-foreground">Milo</span>
            </div>
            <p className="text-sm text-muted-foreground">
              AI-powered trucking operations platform for modern fleet management.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-3">Product</h3>
            <ul className="space-y-2">
              <li><a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a></li>
              <li><a href="#integrations" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Integrations</a></li>
              <li><a href="#security" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Security</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-3">Resources</h3>
            <ul className="space-y-2">
              <li><a href="#documentation" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Documentation</a></li>
              <li><a href="#api" className="text-sm text-muted-foreground hover:text-foreground transition-colors">API Reference</a></li>
              <li><a href="#support" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Support</a></li>
              <li><a href="#blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Blog</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-3">Company</h3>
            <ul className="space-y-2">
              <li><a href="#about" className="text-sm text-muted-foreground hover:text-foreground transition-colors">About</a></li>
              <li><a href="#contact" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a></li>
              <li><a href="#privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</a></li>
              <li><a href="#terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">
            © {currentYear} Milo. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
