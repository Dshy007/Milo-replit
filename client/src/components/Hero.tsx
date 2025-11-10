import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 opacity-[0.08]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, hsl(195 100% 45% / 0.3) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(195 100% 45% / 0.3) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px'
        }}></div>
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, hsl(195 100% 45% / 0.15) 2px, transparent 2px),
            linear-gradient(to bottom, hsl(195 100% 45% / 0.15) 2px, transparent 2px)
          `,
          backgroundSize: '300px 300px'
        }}></div>
      </div>

      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5"></div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm mb-12">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">AI-Powered Fleet Intelligence</span>
        </div>

        <div className="mb-16">
          <h1 className="text-7xl md:text-8xl lg:text-9xl font-bold mb-10 text-foreground tracking-tighter">
            Milo
          </h1>
          
          <p className="text-3xl md:text-4xl text-foreground/90 mb-6 font-light tracking-tight">
            The Future of Trucking Operations
          </p>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-light leading-relaxed">
            Intelligent scheduling, DOT compliance, and fleet optimization through AI conversation
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-5 justify-center items-center">
          <Button 
            size="lg" 
            className="text-base px-14 h-14 rounded-full font-medium shadow-lg shadow-primary/20"
            data-testid="button-start-trial"
            onClick={() => console.log('Start trial clicked')}
          >
            Get Started
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button 
            size="lg" 
            variant="outline"
            className="text-base px-14 h-14 rounded-full font-medium border-2"
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
