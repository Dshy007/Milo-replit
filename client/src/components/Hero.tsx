import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import missionControlBg from "@assets/generated_images/Full_Mission_Control_dashboard_layout_3c882a6b.png";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0D1117]">
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(${missionControlBg})`,
        }}
      ></div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="min-h-[60vh] flex flex-col justify-end">
          <div className="flex flex-col sm:flex-row gap-5 justify-center items-center">
            <Button 
              size="lg" 
              className="text-base px-14 h-14 rounded-full font-medium bg-[#00BFFF] hover:bg-[#00BFFF]/90 text-white shadow-[0_0_40px_rgba(0,191,255,0.4)] border-2 border-[#00BFFF]/50"
              data-testid="button-start-trial"
              onClick={() => console.log('Start trial clicked')}
            >
              Get Started Free
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              className="text-base px-14 h-14 rounded-full font-medium border-2 border-[#00BFFF]/30 bg-[#1E1E1E]/80 backdrop-blur-xl shadow-lg text-white hover:bg-[#1E1E1E]/90"
              data-testid="button-watch-demo"
              onClick={() => console.log('Watch demo clicked')}
            >
              Watch Demo
            </Button>
          </div>
          
          <p className="text-sm text-gray-400 mt-6">
            No credit card required • 5 minute setup
          </p>
        </div>
      </div>
    </section>
  );
}
