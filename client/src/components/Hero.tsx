import { Button } from "@/components/ui/button";
import { MessageSquare, ArrowRight } from "lucide-react";
import heroImage from "@assets/generated_images/Milo_dashboard_hero_screenshot_7a7d009d.png";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImage})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-background/95 via-background/85 to-background/95"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/5 mb-8">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">DOT Compliant Scheduling</span>
        </div>

        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 text-foreground">
          AI-Powered Trucking<br />Operations
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed">
          Meet Milo, your intelligent scheduling assistant. Automate driver assignments, ensure DOT compliance, and optimize your fleet operations with natural language commands.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button 
            size="lg" 
            className="text-lg px-8"
            data-testid="button-start-trial"
            onClick={() => console.log('Start trial clicked')}
          >
            Start Free Trial
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button 
            size="lg" 
            variant="outline"
            className="text-lg px-8 backdrop-blur-sm"
            data-testid="button-watch-demo"
            onClick={() => console.log('Watch demo clicked')}
          >
            Watch Demo
          </Button>
        </div>
      </div>
    </section>
  );
}
