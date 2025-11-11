import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function Hero() {
  const floatingDates = [
    { date: 1, top: '10%', left: '15%', blur: '2px', opacity: 0.2, size: 'text-4xl' },
    { date: 5, top: '15%', left: '75%', blur: '3px', opacity: 0.15, size: 'text-5xl' },
    { date: 11, top: '25%', left: '85%', blur: '1.5px', opacity: 0.3, size: 'text-3xl' },
    { date: 14, top: '35%', left: '20%', blur: '2.5px', opacity: 0.18, size: 'text-6xl' },
    { date: 16, top: '20%', left: '45%', blur: '2px', opacity: 0.25, size: 'text-4xl' },
    { date: 21, top: '45%', left: '10%', blur: '3px', opacity: 0.15, size: 'text-5xl' },
    { date: 23, top: '55%', left: '80%', blur: '2px', opacity: 0.22, size: 'text-7xl' },
    { date: 27, top: '65%', left: '25%', blur: '2.5px', opacity: 0.2, size: 'text-4xl' },
    { date: 30, top: '75%', left: '70%', blur: '1.5px', opacity: 0.28, size: 'text-3xl' },
    { date: 7, top: '80%', left: '40%', blur: '3px', opacity: 0.16, size: 'text-5xl' },
    { date: 12, top: '30%', left: '60%', blur: '2px', opacity: 0.2, size: 'text-4xl' },
    { date: 18, top: '70%', left: '55%', blur: '2.5px', opacity: 0.18, size: 'text-6xl' },
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-slate-50 to-background">
      <div className="absolute inset-0 pointer-events-none">
        {floatingDates.map((item, index) => (
          <div
            key={index}
            className={`absolute ${item.size} font-bold text-primary/30`}
            style={{
              top: item.top,
              left: item.left,
              filter: `blur(${item.blur})`,
              opacity: item.opacity,
              transform: `rotate(${Math.random() * 30 - 15}deg)`
            }}
          >
            {item.date}
          </div>
        ))}
      </div>

      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-orange-200/30 via-primary/10 to-transparent rounded-full blur-[120px]"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="mb-16">
          <div className="relative inline-block">
            <div className="absolute -inset-32 bg-gradient-radial from-orange-200/40 via-orange-100/20 to-transparent rounded-full blur-[100px] -z-10"></div>
            <div className="absolute -inset-40 bg-gradient-radial from-primary/15 via-primary/5 to-transparent rounded-full blur-[140px] -z-10"></div>
            
            <h1 className="text-8xl md:text-9xl lg:text-[12rem] font-bold mb-4 text-foreground tracking-tighter" style={{
              textShadow: `
                0 0 20px rgba(255, 255, 255, 0.9),
                0 0 40px rgba(255, 255, 255, 0.6),
                0 0 60px rgba(255, 255, 255, 0.4),
                0 0 80px hsl(195 100% 50% / 0.8),
                0 0 120px hsl(195 100% 50% / 0.6),
                0 0 160px hsl(195 100% 50% / 0.5),
                0 0 200px hsl(195 100% 50% / 0.4)
              `,
              filter: 'drop-shadow(0 0 60px rgba(255, 255, 255, 0.5)) drop-shadow(0 0 100px hsl(195 100% 50% / 0.6))'
            }}>
              Milo
            </h1>
          </div>
          
          <div className="inline-block">
            <p className="text-2xl md:text-3xl text-primary font-medium tracking-wide mb-12" style={{
              filter: 'drop-shadow(0 0 20px hsl(195 100% 50% / 0.5))'
            }}>
              AI-Powered Trucking Operations
            </p>
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
          </div>
          
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto font-light leading-relaxed mt-8">
            Transform scheduling, operations, and decision-making into something effortless, fast, and spectacular
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-5 justify-center items-center">
          <Button 
            size="lg" 
            className="text-base px-14 h-14 rounded-full font-medium shadow-[0_0_40px_hsl(195_100%_50%/0.4)] border-2 border-primary/50"
            data-testid="button-start-trial"
            onClick={() => console.log('Start trial clicked')}
          >
            Get Started Free
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
        
        <p className="text-sm text-muted-foreground mt-6">
          No credit card required • 5 minute setup
        </p>
      </div>
    </section>
  );
}
