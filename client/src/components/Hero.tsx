import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const CalendarBackground = () => {
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  
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

  return (
    <div className="absolute inset-0 flex items-center justify-center opacity-15 pointer-events-none">
      <div className="max-w-6xl w-full px-8">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-bold text-primary" style={{
            filter: 'drop-shadow(0 0 30px hsl(195 100% 50% / 0.6)) drop-shadow(0 0 60px hsl(195 100% 50% / 0.4))'
          }}>
            {monthNames[currentMonth]} {currentYear}
          </h2>
        </div>
        <div className="grid grid-cols-7 gap-4 mb-4">
          {daysOfWeek.map((day) => (
            <div key={day} className="text-center text-xl font-semibold text-primary" style={{
              filter: 'drop-shadow(0 0 20px hsl(195 100% 50% / 0.5))'
            }}>
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-4">
          {calendarDays.map((day, index) => (
            <div
              key={index}
              className={`aspect-square flex items-center justify-center text-2xl font-medium rounded-lg border-2 ${
                day === currentDate.getDate() 
                  ? 'bg-primary/20 border-primary text-primary' 
                  : 'bg-card/30 border-primary/30 text-primary/70'
              }`}
              style={{
                filter: day === currentDate.getDate() 
                  ? 'drop-shadow(0 0 40px hsl(195 100% 50% / 0.7)) drop-shadow(0 0 80px hsl(195 100% 50% / 0.5))' 
                  : 'drop-shadow(0 0 15px hsl(195 100% 50% / 0.3))',
                backdropFilter: 'blur(10px)'
              }}
            >
              {day}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      <CalendarBackground />

      <div className="absolute inset-0">
        <div className="absolute top-1/3 left-1/3 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[150px]"></div>
        <div className="absolute bottom-1/3 right-1/3 w-[600px] h-[600px] bg-primary/15 rounded-full blur-[150px]"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="mb-16">
          <div className="relative inline-block">
            <h1 className="text-8xl md:text-9xl lg:text-[12rem] font-bold mb-4 text-foreground tracking-tighter" style={{
              filter: 'drop-shadow(0 0 60px hsl(195 100% 50% / 0.6)) drop-shadow(0 0 120px hsl(195 100% 50% / 0.4)) drop-shadow(0 0 180px hsl(195 100% 50% / 0.3))'
            }}>
              Milo
            </h1>
            <div className="absolute -inset-12 bg-primary/10 rounded-full blur-3xl -z-10"></div>
            <div className="absolute -inset-20 bg-primary/5 rounded-full blur-[100px] -z-10"></div>
          </div>
          
          <p className="text-2xl md:text-3xl text-primary font-medium tracking-wide mb-12" style={{
            filter: 'drop-shadow(0 0 20px hsl(195 100% 50% / 0.5))'
          }}>
            AI-Powered
          </p>
          
          <p className="text-3xl md:text-4xl text-foreground/90 mb-6 font-light tracking-tight">
            The Future of Trucking Operations
          </p>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-light leading-relaxed">
            Intelligent scheduling, DOT compliance, and fleet optimization through conversation
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
