import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";

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
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-orange-200/30 via-primary/10 to-transparent rounded-full blur-[120px]"></div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-8 py-20">
        <Card className="p-8 bg-background/60 backdrop-blur-xl border-2 border-primary/20 shadow-[0_0_60px_hsl(195_100%_50%/0.2)]">
          <div className="mb-6 text-center">
            <h2 className="text-3xl font-bold text-foreground mb-2">{monthNames[currentMonth]} {currentYear}</h2>
          </div>
          
          <div className="grid grid-cols-7 gap-4 mb-4">
            {daysOfWeek.map((day) => (
              <div key={day} className="text-center font-semibold text-primary text-sm">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-4">
            {calendarDays.map((day, index) => (
              <div
                key={index}
                className={`aspect-square flex items-center justify-center rounded-md text-lg font-medium transition-all ${
                  day === today
                    ? 'bg-primary text-primary-foreground shadow-[0_0_20px_hsl(195_100%_50%/0.6)]'
                    : day
                    ? 'bg-card hover-elevate active-elevate-2 cursor-pointer'
                    : ''
                }`}
                data-testid={day ? `calendar-day-${day}` : undefined}
              >
                {day}
              </div>
            ))}
          </div>
        </Card>

        <div className="mt-12 text-center">
          <div className="flex justify-center">
            <Button 
              size="lg" 
              className="text-base px-14 h-14 rounded-full font-medium shadow-[0_0_40px_hsl(195_100%_50%/0.4)] border-2 border-primary/50"
              data-testid="button-start-trial"
              onClick={() => console.log('Start trial clicked')}
            >
              Get Started Free
              <ArrowRight className="ml-2 w-5 h-5" />
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
