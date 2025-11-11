import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function Hero() {
  const calendarNumbers = [23, 5, 16, 14, 27, 8, 19, 3, 12, 25, 7, 18, 29, 11, 22, 6, 15, 28, 9, 20];
  
  const randomPositions = calendarNumbers.map((num, index) => ({
    number: num,
    top: `${Math.random() * 90 + 5}%`,
    left: `${Math.random() * 90 + 5}%`,
    size: Math.random() * 60 + 40,
    opacity: Math.random() * 0.3 + 0.1,
    rotation: Math.random() * 40 - 20
  }));

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {randomPositions.map((item, index) => (
        <div
          key={index}
          className="absolute text-slate-400 font-bold pointer-events-none"
          style={{
            top: item.top,
            left: item.left,
            fontSize: `${item.size}px`,
            opacity: item.opacity,
            transform: `rotate(${item.rotation}deg)`,
            filter: 'blur(2px)'
          }}
        >
          {item.number}
        </div>
      ))}

      <div className="absolute inset-0 flex items-center justify-center">
        <div 
          className="w-[500px] h-[500px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(255, 150, 100, 0.4) 0%, rgba(255, 120, 80, 0.2) 30%, transparent 70%)',
            filter: 'blur(80px)'
          }}
        ></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="mb-16">
          <h1 className="text-8xl md:text-9xl lg:text-[10rem] font-bold mb-8 text-slate-900 tracking-tight">
            Milo
          </h1>
          
          <div className="inline-block">
            <p className="text-2xl md:text-3xl text-slate-300 font-light tracking-wide mb-2">
              AI-Powered
            </p>
            <div className="h-0.5 bg-slate-300 w-full"></div>
          </div>
          
          <p className="text-xl text-slate-400 max-w-3xl mx-auto font-light leading-relaxed mt-12">
            An intelligent, self-adapting AI that transforms scheduling, operations, and decision-making into something effortless, fast, and spectacular
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-5 justify-center items-center">
          <Button 
            size="lg" 
            className="text-base px-14 h-14 rounded-full font-medium"
            data-testid="button-start-trial"
            onClick={() => console.log('Start trial clicked')}
          >
            Get Started
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button 
            size="lg" 
            variant="outline"
            className="text-base px-14 h-14 rounded-full font-medium bg-slate-800/50 backdrop-blur-xl border-slate-600"
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
