import { LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface FeatureGridProps {
  title: string;
  description?: string;
  features: Feature[];
}

export default function FeatureGrid({ title, description, features }: FeatureGridProps) {
  return (
    <section className="py-32 px-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-foreground tracking-tight">{title}</h2>
          {description && (
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-light">{description}</p>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-12">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="group"
                data-testid={`feature-card-${index}`}
              >
                <Icon className="w-8 h-8 text-foreground/40 mb-6 group-hover:text-foreground transition-colors" />
                <h3 className="text-xl font-semibold mb-3 text-foreground">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed font-light">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
