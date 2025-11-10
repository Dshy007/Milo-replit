import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, hsl(195 100% 50%) 1.5px, transparent 1.5px),
            linear-gradient(to bottom, hsl(195 100% 50%) 1.5px, transparent 1.5px)
          `,
          backgroundSize: '80px 80px',
          filter: 'drop-shadow(0 0 20px hsl(195 100% 50% / 0.4))'
        }}></div>
      </div>

      <div className="absolute inset-0 opacity-15">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, hsl(195 100% 45%) 3px, transparent 3px),
            linear-gradient(to bottom, hsl(195 100% 45%) 3px, transparent 3px)
          `,
          backgroundSize: '400px 400px',
          filter: 'drop-shadow(0 0 30px hsl(195 100% 45% / 0.5)) drop-shadow(0 0 60px hsl(195 100% 45% / 0.3))'
        }}></div>
      </div>

      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/15 rounded-full blur-[120px]"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border-2 border-primary/40 bg-primary/10 backdrop-blur-xl mb-12 shadow-lg shadow-primary/30">
          <Sparkles className="w-4 h-4 text-primary drop-shadow-[0_0_8px_hsl(195_100%_50%)]" />
          <span className="text-sm font-medium text-foreground">AI-Powered Fleet Intelligence</span>
        </div>

        <div className="mb-16">
          <h1 className="text-7xl md:text-8xl lg:text-9xl font-bold mb-10 text-foreground tracking-tighter drop-shadow-[0_0_40px_hsl(195_100%_50%/0.3)]">
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
            className="text-base px-14 h-14 rounded-full font-medium shadow-[0_0_40px_hsl(195_100%_50%/0.4)] border-2 border-primary/50"
            data-testid="button-start-trial"
            onClick={() => console.log('Start trial clicked')}
          >
            Get Started
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button 
            size="lg" 
            variant="outline"
            className="text-base px-14 h-14 rounded-full font-medium border-2 border-primary/30 bg-background/50 backdrop-blur-xl shadow-lg shadow-primary/10"
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
