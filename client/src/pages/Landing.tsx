import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FeatureSection from "@/components/FeatureSection";
import FeatureGrid from "@/components/FeatureGrid";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";
import ChatInterface from "@/components/ChatInterface";
import { Calendar, FileUp, Shield, Brain, Users, TrendingUp } from "lucide-react";
import dragDropImage from "@assets/generated_images/Drag_drop_upload_feature_b5e469a9.png";
import complianceImage from "@assets/generated_images/Compliance_dashboard_feature_dac05b17.png";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background relative">
      <div className="relative z-10">
        <Navbar />
        
        <Hero />

        <section className="py-20 px-8">
          <div className="max-w-7xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-4xl md:text-5xl font-bold mb-6 text-foreground tracking-tight">
                  An Evolution in Intelligence
                </h2>
                <p className="text-lg text-muted-foreground mb-8 font-light leading-relaxed">
                  Milo isn't software—it's a self-adapting AI that evolves with your operation. Talk naturally, make decisions faster, and watch complexity transform into simplicity.
                </p>
                <ul className="space-y-4">
                  {[
                    "Self-adapting AI that learns your patterns",
                    "Natural conversation replaces complex interfaces",
                    "Instant conflict resolution and optimization",
                    "Spectacular speed meets effortless control"
                  ].map((feature, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <div className="w-2 h-2 rounded-full bg-primary"></div>
                      </div>
                      <span className="text-foreground font-light">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <ChatInterface />
              </div>
            </div>
          </div>
        </section>

        <FeatureSection
          title="Instant Import"
          description="Drag and drop your CSV or Excel files. Milo automatically parses, validates, and performs bench alignment checking to ensure perfect data accuracy."
          image={dragDropImage}
          imageAlt="Drag and drop file upload interface"
          features={[
            "CSV and Excel support",
            "Automatic Operator ID parsing",
            "Bench alignment validation",
            "Carryover trip recognition"
          ]}
          reverse
        />

        <FeatureGrid
          title="Evolution in Every Feature"
          features={[
            {
              icon: Calendar,
              title: "Intelligent Scheduling",
              description: "Self-adapting AI transforms complex block assignments into effortless decisions with spectacular speed."
            },
            {
              icon: FileUp,
              title: "Rapid Import",
              description: "Upload files instantly with automatic parsing, validation, and bench alignment checking."
            },
            {
              icon: Shield,
              title: "DOT Compliance",
              description: "Automated validation of 34-hour resets, rolling 6-day patterns, and rest requirements."
            },
            {
              icon: Brain,
              title: "Evolving Intelligence",
              description: "Machine learning that adapts, predicts, and optimizes—getting smarter with every decision."
            },
            {
              icon: Users,
              title: "Protected Drivers",
              description: "Enforce custom driver rules and preferences automatically without manual oversight."
            },
            {
              icon: TrendingUp,
              title: "Analytics",
              description: "Duty-day heatmaps, utilization metrics, and actionable insights for better planning."
            }
          ]}
        />

        <FeatureSection
          title="Compliance Simplified"
          description="Milo continuously monitors rolling-6 day patterns, rest periods, and reset requirements to keep your fleet compliant with federal regulations."
          image={complianceImage}
          imageAlt="Compliance dashboard showing duty-day heatmap"
          features={[
            "Rolling-6 day pattern tracking",
            "34-hour reset validation",
            "10-hour rest monitoring",
            "Duty-day projection heatmaps"
          ]}
        />

        <CTASection />
        
        <Footer />
      </div>
    </div>
  );
}
