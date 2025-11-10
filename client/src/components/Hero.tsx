import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px',
          color: 'hsl(var(--foreground))'
        }}></div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-8 py-32 text-center">
        <div className="mb-20">
          <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold mb-8 text-foreground tracking-tight">
            Milo
          </h1>
          
          <p className="text-2xl md:text-3xl text-muted-foreground mb-4 font-light">
            AI-Powered Trucking Operations
          </p>
          
          <p className="text-lg text-muted-foreground/80 max-w-2xl mx-auto font-light leading-relaxed">
            Intelligent scheduling, DOT compliance, and fleet optimization through natural conversation
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button 
            size="lg" 
            className="text-base px-12 h-14 rounded-full font-medium"
            data-testid="button-start-trial"
            onClick={() => console.log('Start trial clicked')}
          >
            Get Started
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </div>
    </section>
  );
}
