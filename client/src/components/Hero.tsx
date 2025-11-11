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
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="absolute inset-0 pointer-events-none">
        {floatingDates.map((item, index) => (
          <div
            key={index}
            className={`absolute ${item.size} font-bold text-primary/40`}
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
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-orange-400/20 via-primary/15 to-transparent rounded-full blur-[120px]"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="mb-16">
          <div className="relative inline-block">
            <div className="absolute -inset-32 bg-gradient-radial from-orange-300/30 via-orange-400/10 to-transparent rounded-full blur-[100px] -z-10"></div>
            <div className="absolute -inset-40 bg-gradient-radial from-primary/20 via-primary/5 to-transparent rounded-full blur-[140px] -z-10"></div>
            
            <h1 className="text-8xl md:text-9xl lg:text-[12rem] font-bold mb-4 text-slate-900 tracking-tighter" style={{
              textShadow: `
                0 4px 20px rgba(251, 146, 60, 0.4),
                0 0 40px rgba(6, 182, 212, 0.2)
              `
            }}>
              Milo
            </h1>
          </div>
          
          <div className="inline-block">
            <p className="text-2xl md:text-3xl text-slate-300 font-medium tracking-wide mb-12">
              AI-Powered
            </p>
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-slate-400 to-transparent"></div>
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
