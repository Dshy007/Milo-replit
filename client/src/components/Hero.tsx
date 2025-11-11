import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function Hero() {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  const today = currentDate.getDate();
  
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  
  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      <div 
        className="absolute inset-0 flex items-center justify-center pointer-events-none p-8"
        style={{
          opacity: 0.15,
          filter: 'blur(0.3px) saturate(0.6)',
          transform: 'scale(1.5)'
        }}
      >
        <div className="max-w-5xl w-full">
          <div className="text-center mb-8">
            <h3 className="text-3xl font-bold text-foreground tracking-wide">
              {monthNames[currentMonth]} {currentYear}
            </h3>
          </div>
          
          <div className="grid grid-cols-7 gap-5 mb-5">
            {daysOfWeek.map((day) => (
              <div key={day} className="text-center text-base font-semibold text-foreground">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-5">
            {calendarDays.map((day, index) => (
              <div
                key={index}
                className={`aspect-square flex items-center justify-center text-2xl font-semibold rounded-xl ${
                  day === today 
                    ? 'bg-foreground/40 border-2 border-foreground/60 text-foreground' 
                    : day 
                    ? 'bg-foreground/20 border border-foreground/30 text-foreground' 
                    : 'bg-transparent'
                }`}
              >
                {day}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute inset-0">
        <div className="absolute top-1/3 left-1/3 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[150px]"></div>
        <div className="absolute bottom-1/3 right-1/3 w-[600px] h-[600px] bg-primary/15 rounded-full blur-[150px]"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="mb-16">
          <div className="relative inline-block">
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
            <div className="absolute -inset-16 bg-primary/15 rounded-full blur-[100px] -z-10"></div>
            <div className="absolute -inset-24 bg-primary/10 rounded-full blur-[140px] -z-10"></div>
            <div className="absolute -inset-32 bg-primary/5 rounded-full blur-[180px] -z-10"></div>
          </div>
          
          <p className="text-2xl md:text-3xl text-primary font-medium tracking-wide mb-12" style={{
            filter: 'drop-shadow(0 0 20px hsl(195 100% 50% / 0.5))'
          }}>
            AI-Powered
          </p>
          
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
