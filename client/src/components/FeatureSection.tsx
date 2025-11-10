import { ReactNode } from "react";

interface FeatureSectionProps {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  features?: string[];
  reverse?: boolean;
  children?: ReactNode;
}

export default function FeatureSection({
  title,
  description,
  image,
  imageAlt,
  features,
  reverse = false,
  children
}: FeatureSectionProps) {
  return (
    <section className="py-32 px-8">
      <div className="max-w-6xl mx-auto">
        <div className={`grid md:grid-cols-2 gap-20 items-center ${reverse ? 'md:flex-row-reverse' : ''}`}>
          <div className={reverse ? 'md:order-2' : ''}>
            <h2 className="text-4xl md:text-5xl font-bold mb-6 text-foreground tracking-tight">{title}</h2>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed font-light">{description}</p>
            
            {features && features.length > 0 && (
              <ul className="space-y-4" data-testid="feature-list">
                {features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0 mt-2.5"></div>
                    <span className="text-foreground/80 font-light leading-relaxed">{feature}</span>
                  </li>
                ))}
              </ul>
            )}
            
            {children}
          </div>

          <div className={reverse ? 'md:order-1' : ''}>
            <img
              src={image}
              alt={imageAlt}
              className="w-full rounded-lg border border-border/50"
              data-testid="feature-image"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
