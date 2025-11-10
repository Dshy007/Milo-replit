export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border/50 py-16 px-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-12 mb-12">
          <div>
            <span className="text-xl font-bold text-foreground tracking-tight">Milo</span>
          </div>

          <div>
            <h3 className="font-medium text-foreground mb-4 text-sm">Product</h3>
            <ul className="space-y-3">
              <li><a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-light">Features</a></li>
              <li><a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-light">Pricing</a></li>
              <li><a href="#security" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-light">Security</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-foreground mb-4 text-sm">Resources</h3>
            <ul className="space-y-3">
              <li><a href="#documentation" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-light">Documentation</a></li>
              <li><a href="#support" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-light">Support</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-foreground mb-4 text-sm">Company</h3>
            <ul className="space-y-3">
              <li><a href="#about" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-light">About</a></li>
              <li><a href="#privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-light">Privacy</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-border/50">
          <p className="text-sm text-muted-foreground font-light">
            © {currentYear} Milo
          </p>
        </div>
      </div>
    </footer>
  );
}
