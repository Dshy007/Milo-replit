import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function CTASection() {
  return (
    <section className="py-20 px-4">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-6 text-foreground">
          Ready to Transform Your<br />Trucking Operations?
        </h2>
        <p className="text-xl text-muted-foreground mb-8">
          Join leading fleet operators using Milo to streamline scheduling and ensure compliance.
        </p>
        <Button
          size="lg"
          className="text-lg px-8"
          data-testid="button-get-started"
          onClick={() => console.log('Get started clicked')}
        >
          Get Started Free
          <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    </section>
  );
}
