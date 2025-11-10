import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function CTASection() {
  return (
    <section className="py-32 px-8">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-5xl md:text-6xl font-bold mb-8 text-foreground tracking-tight">
          Start Today
        </h2>
        <p className="text-xl text-muted-foreground mb-12 font-light">
          Transform your fleet operations with intelligent automation
        </p>
        <Button
          size="lg"
          className="text-base px-12 h-14 rounded-full font-medium shadow-[0_0_40px_hsl(195_100%_50%/0.4)] border-2 border-primary/50"
          data-testid="button-get-started"
          onClick={() => console.log('Get started clicked')}
        >
          Get Started
          <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    </section>
  );
}
