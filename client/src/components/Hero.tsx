import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import calendarBg from "@assets/generated_images/Calendar_background_with_text_only_52a55f42.png";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(${calendarBg})`,
          opacity: 0.6
        }}
      ></div>
      
      <div className="absolute inset-0 bg-gradient-to-br from-background/80 via-transparent to-background/80"></div>

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
              AI-Powered
            </p>
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
          </div>
          
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto font-light leading-relaxed">
            An intelligent, self-adapting AI that transforms scheduling, operations, and decision-making into something effortless, fast, and spectacular
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
