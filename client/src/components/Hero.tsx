import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import calendarBg from "@assets/generated_images/Clean_calendar_background_no_text_af738dc0.png";

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
        <div className="min-h-[60vh] flex flex-col justify-end">
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
      </div>
    </section>
  );
}
