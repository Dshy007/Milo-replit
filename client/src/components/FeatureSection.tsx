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
    <section className="py-20 px-4">
      <div className="max-w-7xl mx-auto">
        <div className={`grid md:grid-cols-2 gap-12 items-center ${reverse ? 'md:flex-row-reverse' : ''}`}>
          <div className={reverse ? 'md:order-2' : ''}>
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">{title}</h2>
            <p className="text-lg text-muted-foreground mb-6 leading-relaxed">{description}</p>
            
            {features && features.length > 0 && (
              <ul className="space-y-3" data-testid="feature-list">
                {features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-primary"></div>
                    </div>
                    <span className="text-foreground">{feature}</span>
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
              className="w-full rounded-lg border border-border shadow-lg"
              data-testid="feature-image"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
