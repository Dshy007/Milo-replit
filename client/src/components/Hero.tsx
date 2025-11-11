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
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wed', 'Thur', 'Fri', 'Sat'];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-slate-50 to-background">
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-gradient-radial from-orange-200/30 via-primary/10 to-transparent rounded-full blur-[120px]"></div>
      </div>

      {/* Calendar in background with perspective */}
      <div 
        className="absolute inset-0 flex items-center justify-center"
        style={{
          perspective: '1500px',
          perspectiveOrigin: 'center center'
        }}
      >
        <div 
          className="w-[1200px] opacity-30 blur-[2px]"
          style={{
            transform: 'rotateX(65deg) translateY(200px)',
            transformStyle: 'preserve-3d'
          }}
        >
          <div className="bg-background/40 backdrop-blur-sm border border-primary/20 rounded-lg p-8">
            <div className="mb-6 text-center">
              <h2 className="text-4xl font-bold text-foreground">{monthNames[currentMonth]} {currentYear}</h2>
            </div>
            
            <div className="grid grid-cols-7 gap-6 mb-4">
              {daysOfWeek.map((day) => (
                <div key={day} className="text-center font-semibold text-primary text-lg">
                  {day}
                </div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-6">
              {calendarDays.map((day, index) => (
                <div
                  key={index}
                  className={`aspect-square flex items-center justify-center rounded-md text-2xl font-bold ${
                    day === today
                      ? 'bg-primary/80 text-primary-foreground shadow-[0_0_30px_hsl(195_100%_50%/0.8)]'
                      : day
                      ? 'bg-card/60 text-foreground'
                      : ''
                  }`}
                >
                  {day}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Foreground content */}
      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="mb-16">
          <div className="relative inline-block">
            <div className="absolute -inset-32 bg-gradient-radial from-primary/40 via-primary/20 to-transparent rounded-full blur-[100px]"></div>
            <div className="absolute -inset-40 bg-gradient-radial from-blue-400/30 via-cyan-300/15 to-transparent rounded-full blur-[140px]"></div>
            
            <h1 className="relative text-7xl md:text-8xl font-bold mb-6 tracking-tight" style={{
              background: 'linear-gradient(135deg, hsl(220, 100%, 60%), hsl(195, 100%, 45%), hsl(180, 100%, 50%))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textShadow: '0 0 60px rgba(59, 130, 246, 0.5)',
              filter: 'drop-shadow(0 0 40px hsl(195 100% 50% / 0.4)) drop-shadow(0 0 80px hsl(220 100% 60% / 0.3))'
            }}>
              Milo
            </h1>
          </div>
          
          <p className="text-3xl md:text-4xl text-primary/90 font-semibold mb-6">
            Your AI Operations Brain
          </p>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            Stop wasting hours every week on scheduling.
          </p>

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
              className="text-base px-14 h-14 rounded-full font-medium border-2 border-primary/30 bg-background/50 backdrop-blur-xl"
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
